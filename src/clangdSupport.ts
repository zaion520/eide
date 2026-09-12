/**
 * clangd support pure logic.
 *
 * 该模块无 vscode 依赖,可单元测试。职责:
 *  1. 将 EIDE 的构建信息(builder.params / 项目配置)转换为 clangd 友好的
 *     compile_commands.json 条目(工具链私有 flag 仿真/剥离,见 buildClangdCommandTokens);
 *  2. 渲染/维护 clangd 用户级 config.yaml 的受管配置块(带标记,便于幂等更新);
 *  3. 管理工作区 clangd.arguments。
 *
 * 设计参考了 Eide Extend(独立扩展)的实现,并将其整合进 EIDE 进程内:
 * 使用 EIDE 的精确 ToolchainName 类型替代外部字符串模糊匹配。
 */
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// command line token utils
// ---------------------------------------------------------------------------

/** 按空白拆分命令行参数,保留引号包裹的片段(引号本身被剥离) */
export function splitCommandArgs(value: string): string[] {
    return String(value || '').match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/g) || [];
}

export function quoteCommandToken(token: string): string {
    const text = String(token);
    if (!/[\s"]/.test(text)) { return text; }
    return `"${text.replace(/(["\\])/g, '\\$1')}"`;
}

export function joinCommandTokens(tokens: string[]): string {
    return tokens.map(quoteCommandToken).join(' ');
}

// ---------------------------------------------------------------------------
// toolchain classification (exact EIDE toolchain names)
// ---------------------------------------------------------------------------

export function isAc5Toolchain(toolchain?: string): boolean { return toolchain === 'AC5'; }
export function isAc6Toolchain(toolchain?: string): boolean { return toolchain === 'AC6'; }
export function isLlvmToolchain(toolchain?: string): boolean { return toolchain === 'LLVM_ARM'; }
export function isGccToolchain(toolchain?: string): boolean {
    return toolchain === 'GCC' || toolchain === 'RISCV_GCC' || toolchain === 'MTI_GCC'
        || toolchain === 'MIPS_GCC' || toolchain === 'ANY_GCC';
}
/** 8051 系列(Keil C51 / SDCC 及其 GNU 变体) */
export function isC51Toolchain(toolchain?: string): boolean {
    return toolchain === 'Keil_C51' || toolchain === 'SDCC' || toolchain === 'GNU_SDCC_MCS51';
}
/** STM8 系列(clang 无 STM8 后端,不能注入 ARM target) */
export function isStm8Toolchain(toolchain?: string): boolean {
    return toolchain === 'COSMIC_STM8' || toolchain === 'IAR_STM8' || toolchain === 'GNU_SDCC_STM8';
}
export function isRiscvContext(toolchain?: string, projectType?: string): boolean {
    const haystack = [toolchain, projectType].map((item) => String(item || '').toLowerCase()).join(' ');
    return haystack.includes('riscv');
}

/**
 * 兼容 shim 种类决策(纯函数,参考 Eide Extend 的分工具链模型):
 *  - AC5 / C51:需要关键字 shim(本扩展按需生成到 `.eide/clangd/`,见 clangdIntegration);
 *  - AC6 / GCC / LLVM / 其他:一律不需要 force-include。clangd 经 query-driver
 *    直接使用真实工具链前端,真实头文件(CMSIS/arm_compat.h 等)可被原生解析;
 *    此时再 force-include 化石 lint 头反而是波浪线的来源
 *    (伪造的 __ARM_ARCH=4、volatile(x)/__asm 中和宏、非 static 内建函数声明
 *    都会与真实头文件冲突)。
 */
export type CompatShimKind = 'ac5' | 'c51' | 'none';

export function resolveCompatShimKind(toolchain?: string): CompatShimKind {
    if (isAc5Toolchain(toolchain)) { return 'ac5'; }
    if (isC51Toolchain(toolchain)) { return 'c51'; }
    return 'none';
}

export type GccFamily = 'ARM' | 'RISC-V' | 'MIPS';

export function getGccCompilerBaseName(family: GccFamily): string {
    switch (family) {
        case 'RISC-V': return 'riscv-none-elf-gcc';
        case 'MIPS': return 'mips-mti-elf-gcc';
        default: return 'arm-none-eabi-gcc';
    }
}

function getGccFamilyOf(ctx: { toolchain?: string; projectType?: string }): GccFamily {
    if (isRiscvContext(ctx.toolchain, ctx.projectType)) { return 'RISC-V'; }
    if (String(ctx.toolchain || '').includes('MTI') || String(ctx.toolchain || '').includes('MIPS')) { return 'MIPS'; }
    return 'ARM';
}

// ---------------------------------------------------------------------------
// language standard mapping
// ---------------------------------------------------------------------------

export function resolveCompileLanguageStandard(
    ctx: { toolchain?: string; languageC?: string; languageCpp?: string },
    sourceKind: 'c' | 'cpp'
): string {
    const fallback = sourceKind === 'c'
        ? (isAc5Toolchain(ctx?.toolchain) ? 'gnu99' : isC51Toolchain(ctx?.toolchain) ? 'gnu89' : 'gnu11')
        : 'c++14';
    const requested = String(
        sourceKind === 'c'
            ? (ctx?.languageC || '')
            : (ctx?.languageCpp || '')
    ).trim();
    if (!requested) { return fallback; }

    const normalized = requested.toLowerCase();
    if (sourceKind === 'c') {
        if (normalized === 'c89' || normalized === 'c90' || normalized === 'gnu90') {
            // 保持传统 C 行为,同时允许 vendor 头文件中的 GNU 扩展(如 inline)
            return 'gnu89';
        }
    }

    return requested;
}

// ---------------------------------------------------------------------------
// ARM CPU/FPU option emulation
// ---------------------------------------------------------------------------

export function getArmFpuFlags(fpuText?: string): string[] {
    const normalized = String(fpuText || '').toLowerCase();
    if (!normalized) { return []; }
    if (normalized.includes('soft') || normalized.includes('none') || normalized.includes('nofp') || normalized.includes('no-fpu')) {
        return [];
    }
    if (normalized.includes('fpv5-sp-d16')) { return ['-mfloat-abi=hard', '-mfpu=fpv5-sp-d16']; }
    if (normalized.includes('fpv5-d16') || normalized.includes('double')) { return ['-mfloat-abi=hard', '-mfpu=fpv5-d16']; }
    if (normalized.includes('fpv4-sp-d16') || normalized.includes('single')) { return ['-mfloat-abi=hard', '-mfpu=fpv4-sp-d16']; }
    if (normalized.includes('hard') && (normalized.includes('fpu') || normalized.includes('fp'))) {
        return ['-mfloat-abi=hard', '-mfpu=fpv4-sp-d16'];
    }
    return [];
}

export function getArmCpuFlags(ctx: { toolchain?: string; cpuType?: string; floatingPointHardware?: string }): string[] {
    const cpuText = String(ctx.cpuType || '').toLowerCase();
    const flags: string[] = [];
    const endianFlag = isLlvmToolchain(ctx.toolchain) ? '' : '-mlittle-endian';

    if (cpuText.includes('cortex-m55')) {
        flags.push('-mcpu=cortex-m55', endianFlag);
    } else if (cpuText.includes('cortex-m33')) {
        flags.push('-mcpu=cortex-m33', endianFlag);
    } else if (cpuText.includes('cortex-m23')) {
        flags.push('-mcpu=cortex-m23', endianFlag);
    } else if (cpuText.includes('cortex-m7')) {
        flags.push('-mcpu=cortex-m7', endianFlag);
    } else if (cpuText.includes('cortex-m4')) {
        flags.push('-mcpu=cortex-m4', endianFlag);
    } else if (cpuText.includes('cortex-m3')) {
        flags.push('-mcpu=cortex-m3', endianFlag);
    } else if (cpuText.includes('cortex-m0+')) {
        flags.push('-mcpu=cortex-m0plus', endianFlag);
    } else if (cpuText.includes('cortex-m0')) {
        flags.push('-mcpu=cortex-m0', endianFlag);
    } else if (cpuText.trim()) {
        flags.push('-mcpu=cortex-m4', endianFlag);
    }

    for (const flag of getArmFpuFlags(ctx.floatingPointHardware)) {
        if (!flags.includes(flag)) { flags.push(flag); }
    }

    return flags.filter(Boolean);
}

export function shouldUseThumbMode(ctx: { armThumbMode?: string; cpuType?: string }): boolean {
    const thumbText = [ctx.armThumbMode || '', ctx.cpuType || ''].join(' ').toLowerCase();
    return thumbText.includes('thumb') || thumbText.includes('cortex-m');
}

export function getOptimizationFlags(level?: string): string[] {
    switch (level) {
        case 'level-debug': return ['-Og'];
        case 'level-0':
        case 'none': return ['-O0'];
        case 'level-fast': return ['-O2'];
        case 'level-balanced': return ['-Os'];
        case 'level-size': return ['-Oz'];
        default: return ['-Os'];
    }
}

export function formatDefine(define: string): string {
    let text = String(define || '').trim();
    if (text.startsWith('-D')) { text = text.slice(2).trim(); }
    // 清理常会破坏 clangd 命令行的转义引号,如 VER=\"1.0\" -> VER="1.0"
    text = text.replace(/\\"/g, '"');
    return `-D${text}`;
}

// ---------------------------------------------------------------------------
// toolchain compatibility defines
// ---------------------------------------------------------------------------

export function getToolchainCompatibilityDefines(ctx: { toolchain?: string; projectType?: string }): string[] {
    const commonDefines = [
        '-D__VSCODE_CPPTOOL=1',
        '-D__inline=inline',
        '-D__inline__=inline',
        '-D__asm=__asm__',
        '-D__irq=',
        '-D__packed=__attribute__((packed))',
        '-D__align(x)=__attribute__((aligned(x)))',
        '-D__weak=__attribute__((weak))',
        '-D__value_in_regs=',
        '-D__forceinline=inline',
        '-D__promise(x)=',
        '-D__global_reg(x)=',
        '-D__softfp='
    ];

    if (isC51Toolchain(ctx.toolchain)) {
        return [
            ...commonDefines,
            '-D__C51__=1',
            '-D__KEIL__=1',
            '-Ddata=',
            '-Dxdata=',
            '-Dcode=',
            '-Dbit=char',
            '-Dsbit=char',
            '-Dsfr=char',
            '-Dinterrupt=',
            '-Dusing='
        ];
    }

    const armDefines = (isRiscvContext(ctx.toolchain, ctx.projectType))
        ? []
        : ['-D__arm__=1', '-D__thumb__=1', '-D__TARGET_ARCH_ARM=0', '-D__TARGET_ARCH_THUMB=4'];

    // AC5/AC6 都用 armclang 前端仿真:__ARMCC_VERSION/__clang__/__GNUC__ 由前端原生定义,
    // 从命令行再注入会与原生值冲突并产生 "macro redefined" 警告。
    if (isAc6Toolchain(ctx.toolchain) || isAc5Toolchain(ctx.toolchain)) {
        return [...commonDefines, ...armDefines];
    }

    if (isGccToolchain(ctx.toolchain) || isLlvmToolchain(ctx.toolchain)) {
        return [...commonDefines, ...armDefines];
    }

    // 未知工具链(如 IAR)的兜底
    return [
        ...commonDefines,
        ...armDefines,
        '-D__CC_ARM=1',
        '-D__ARMCC_VERSION=5060960',
        '-D__TARGET_PROFILE_M=1',
        '-D__TARGET_FEATURE_DSPMUL=1',
        '-D__TARGET_FEATURE_DOUBLEWORD=1'
    ];
}

/** 依据 CPU 类型注入 CMSIS 常用宏(参考实现中的 fallback defines) */
export function getFallbackDefinesForTarget(target: { cpuType?: string; floatingPointHardware?: string }): string[] {
    const cpuText = String(target?.cpuType || '').toLowerCase();
    const fpuText = String(target?.floatingPointHardware || '').toLowerCase();

    const fallback: string[] = [];
    const add = (macro: string) => { if (!fallback.includes(macro)) { fallback.push(macro); } };

    if (cpuText.includes('cortex-m55')) {
        add('CORTEX_M55'); add('ARM_MATH_MVEF');
    } else if (cpuText.includes('cortex-m33')) {
        add('CORTEX_M33'); add('ARM_MATH_CM33');
    } else if (cpuText.includes('cortex-m23')) {
        add('CORTEX_M23'); add('ARM_MATH_CM23');
    } else if (cpuText.includes('cortex-m7')) {
        add('CORTEX_M7'); add('ARM_MATH_CM7');
    } else if (cpuText.includes('cortex-m4')) {
        add('CORTEX_M4'); add('ARM_MATH_CM4');
    } else if (cpuText.includes('cortex-m3')) {
        add('CORTEX_M3'); add('ARM_MATH_CM3');
    } else if (cpuText.includes('cortex-m0+')) {
        add('CORTEX_M0PLUS'); add('ARM_MATH_CM0PLUS');
    } else if (cpuText.includes('cortex-m0')) {
        add('CORTEX_M0'); add('ARM_MATH_CM0');
    }

    const hasHardwareFpu = !(
        fpuText.includes('soft') || fpuText.includes('none') ||
        fpuText.includes('nofp') || fpuText.includes('no-fpu')
    );
    if (hasHardwareFpu && (fpuText.includes('single') || fpuText.includes('double') || fpuText.includes('fpv') || fpuText.includes('hard'))) {
        add('__FPU_PRESENT=1');
    }

    return fallback;
}

// ---------------------------------------------------------------------------
// extra compile args sanitization
// ---------------------------------------------------------------------------

function pushUnique(list: string[], value: string): void {
    if (value && !list.includes(value)) { list.push(value); }
}

/** 将 armcc(AC5)私有 flag 翻译/剥离为 clang 兼容参数 */
export function sanitizeAc5CompileCommandExtraTokens(tokens: string[], sourceKind: 'c' | 'cpp'): string[] {
    const sanitized: string[] = [];
    const passthroughWithValue = new Set(['-I', '-D', '-U', '-include', '-isystem', '-iquote']);
    const skipWithValue = new Set([
        '-o', '--output', '-MF', '-MT', '-MQ', '-MJ', '-dependency-file',
        '--cpu', '--fpu', '--apcs', '--device', '--library_type',
        '--diag_error', '--diag_remark', '--diag_suppress', '--diag_warning', '--diag_style',
        '--split_ldm', '--via', '--depend', '--depend_format', '--depend_dir', '--depend_extension',
        '--list', '--xref', '--omf_browse', '--feedback'
    ]);
    const skipStandaloneTokens = new Set([
        '-c', '-MD', '-MMD', '-MG', '-MP', '-MM', '-E', '/c',
        '--brief_diagnostics', '--gnu', '--strict', '--multibyte_chars', '--split_sections',
        '--littleend', '--bigend', '--no_depend_system_headers', '--remove',
        '--compile_all_input_files', '--keep', '--debug'
    ]);

    for (let index = 0; index < (tokens || []).length; index += 1) {
        const token = tokens[index];
        if (!token) { continue; }

        if (skipStandaloneTokens.has(token)) { continue; }

        if (skipWithValue.has(token)) { index += 1; continue; }
        if ([...skipWithValue].some((prefix) => token.startsWith(`${prefix}=`))) { continue; }

        if (token.endsWith('.o') || token.endsWith('.obj') || token.endsWith('.d')) { continue; }

        if (token === '--c90') { pushUnique(sanitized, '-std=c89'); continue; }
        if (token === '--c99') { pushUnique(sanitized, '-std=c99'); continue; }
        if (token === '--cpp') { continue; }
        if (token === '--cpp11') { pushUnique(sanitized, sourceKind === 'c' ? '-std=c99' : '-std=c++11'); continue; }
        if (token === '--exceptions') { pushUnique(sanitized, '-fexceptions'); continue; }
        if (token === '--no_exceptions') { pushUnique(sanitized, '-fno-exceptions'); continue; }
        if (token === '--rtti') { pushUnique(sanitized, '-frtti'); continue; }
        if (token === '--no_rtti') { pushUnique(sanitized, '-fno-rtti'); continue; }
        if (token === '--signed_chars') { pushUnique(sanitized, '-fsigned-char'); continue; }
        if (token === '--unsigned_chars') { pushUnique(sanitized, '-funsigned-char'); continue; }
        if (token === '--signed_wchar') { pushUnique(sanitized, '-fsigned-wchar'); continue; }
        if (token === '--unsigned_wchar') { pushUnique(sanitized, '-funsigned-wchar'); continue; }
        if (token === '--no_inline') { pushUnique(sanitized, '-fno-inline'); continue; }

        if (token === '--preinclude') {
            const nextToken = tokens[index + 1];
            if (nextToken) { sanitized.push('-include', stripMatchingQuotes(nextToken)); index += 1; }
            continue;
        }
        if (token.startsWith('--preinclude=')) {
            const includePath = token.slice('--preinclude='.length);
            if (includePath) { sanitized.push('-include', stripMatchingQuotes(includePath)); }
            continue;
        }
        if (token === '--sys_include') {
            const nextToken = tokens[index + 1];
            if (nextToken) { sanitized.push('-isystem', stripMatchingQuotes(nextToken)); index += 1; }
            continue;
        }
        if (token.startsWith('--sys_include=')) {
            const includePath = token.slice('--sys_include='.length);
            if (includePath) { sanitized.push('-isystem', stripMatchingQuotes(includePath)); }
            continue;
        }

        if (passthroughWithValue.has(token)) {
            const nextToken = tokens[index + 1];
            if (nextToken) { sanitized.push(token, stripMatchingQuotes(nextToken)); index += 1; }
            continue;
        }

        if (/^-(?:I|D|U).+/.test(token)) { sanitized.push(token); continue; }

        if (/^-std=/.test(token) || /^--target=/.test(token) || /^-m/.test(token) || /^-f/.test(token) || /^-Wno-/.test(token)) {
            pushUnique(sanitized, token);
            continue;
        }
    }

    return sanitized;
}

/** 通用(非 AC5)额外参数清洗:剥离仅构建期有意义的 flag */
export function sanitizeGenericCompileCommandExtraTokens(tokens: string[], _sourceKind: 'c' | 'cpp'): string[] {
    const sanitized: string[] = [];
    const skipNextValuePrefixes = new Set(['-o', '--output', '-MF', '-MT', '-MQ', '-MJ', '-dependency-file']);
    const skipStandaloneTokens = new Set(['-c', '-MD', '-MMD', '-MG', '-MP', '-MM', '-E', '/c', '-Werror', '-pedantic-errors']);

    for (let index = 0; index < (tokens || []).length; index += 1) {
        const token = tokens[index];
        if (!token) { continue; }

        if (skipStandaloneTokens.has(token)) { continue; }

        if (skipNextValuePrefixes.has(token)) { index += 1; continue; }
        if ([...skipNextValuePrefixes].some((prefix) => token.startsWith(`${prefix}=`))) { continue; }

        // -Werror/-pedantic-errors 会把普通警告变成红色波浪线
        if (token === '-Werror' || token.startsWith('-Werror=') || token === '-pedantic-errors') { continue; }

        if (token.endsWith('.o') || token.endsWith('.obj') || token.endsWith('.d')) { continue; }

        sanitized.push(token);
    }

    return sanitized;
}

function stripMatchingQuotes(value: string): string {
    return String(value || '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// ---------------------------------------------------------------------------
// clangd-friendly compile command building
// ---------------------------------------------------------------------------

export interface ClangdTargetContext {
    /** EIDE ToolchainName,如 'AC5' / 'GCC' / 'Keil_C51' */
    toolchain: string;
    projectType?: string;
    /** 已解析的 clang 兼容编译器路径;缺省时按工具链家族取可执行名 */
    compilerPath?: string;
    cpuType?: string;
    floatingPointHardware?: string;
    armThumbMode?: string;
    useMicroLib?: boolean;
    executeOnlyCode?: boolean;
    oneElfSectionPerFunction?: boolean;
    shortEnumsWchar?: boolean;
    outputDebugInfo?: boolean;
    optimization?: string;
    languageC?: string;
    languageCpp?: string;
    /** 项目包含目录(绝对路径) */
    incList: string[];
    /** 项目宏(NAME 或 NAME=value) */
    defineList: string[];
    /** 工具链系统包含目录 */
    systemIncludeList?: string[];
    /** 强制包含头(如 lint 兼容头) */
    forceIncludeHeaders?: string[];
}

/**
 * 显式 target 的上下文输入(纯数据,不依赖激活态):
 * 调用方从 `build/<target>/builder.params`(源文件/包含/宏/选项)与该 target 存档的
 * `toolchainConfigMap[toolchain]`(cpu/fpu/语言等)组装,替代原来只读激活态的写法。
 */
export interface ClangdTargetInputs {
    toolchain: string;
    projectType?: string;
    compilerPath?: string;
    cpuType?: string;
    floatingPointHardware?: string;
    armThumbMode?: string;
    useMicroLib?: boolean;
    executeOnlyCode?: boolean;
    oneElfSectionPerFunction?: boolean;
    shortEnumsWchar?: boolean;
    outputDebugInfo?: boolean;
    optimization?: string;
    languageC?: string;
    languageCpp?: string;
    /** builder.params 的 incDirs(原始相对写法,保持原样透传) */
    incList: string[];
    /** builder.params 的 defines(不含 fallback,内部自动前置 CPU/FPU 宏) */
    defineList: string[];
    systemIncludeList?: string[];
    forceIncludeHeaders?: string[];
}

/** 从显式 target 输入组装 clangd 上下文(含 CPU/FPU fallback 宏前置) */
export function buildClangdContextForTarget(inputs: ClangdTargetInputs): ClangdTargetContext {
    return {
        toolchain: inputs.toolchain,
        projectType: inputs.projectType,
        compilerPath: inputs.compilerPath,
        cpuType: inputs.cpuType,
        floatingPointHardware: inputs.floatingPointHardware,
        armThumbMode: inputs.armThumbMode,
        useMicroLib: inputs.useMicroLib,
        executeOnlyCode: inputs.executeOnlyCode,
        oneElfSectionPerFunction: inputs.oneElfSectionPerFunction,
        shortEnumsWchar: inputs.shortEnumsWchar,
        outputDebugInfo: inputs.outputDebugInfo,
        optimization: inputs.optimization,
        languageC: inputs.languageC,
        languageCpp: inputs.languageCpp,
        incList: Array.isArray(inputs.incList) ? inputs.incList : [],
        defineList: [
            ...getFallbackDefinesForTarget({ cpuType: inputs.cpuType, floatingPointHardware: inputs.floatingPointHardware }),
            ...(Array.isArray(inputs.defineList) ? inputs.defineList : [])
        ],
        systemIncludeList: inputs.systemIncludeList,
        forceIncludeHeaders: inputs.forceIncludeHeaders
    };
}

export function isSupportedSourceFile(filePath: string): boolean {
    return ['.c', '.cc', '.cpp', '.cxx'].includes(path.extname(String(filePath)).toLowerCase());
}

export function getSourceKind(filePath: string): 'c' | 'cpp' {
    return path.extname(String(filePath)).toLowerCase() === '.c' ? 'c' : 'cpp';
}

function toPosix(value: string): string {
    return String(value || '').replace(/\\/g, '/');
}

function toLookupPathKey(filePath: string): string {
    const normalized = path.normalize(String(filePath || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** 生成 compile_commands.json 的 `file` 字段:项目内相对路径(./ 前缀),项目外绝对路径 */
export function asCompileCommandFile(rootDir: string, absoluteFile: string): string {
    const normalizedRoot = path.normalize(rootDir || '.');
    const normalizedFile = path.normalize(absoluteFile);
    const relative = path.relative(normalizedRoot, normalizedFile);
    if (!relative) { return `./${toPosix(path.basename(absoluteFile))}`; }

    if (path.isAbsolute(relative)) { return toPosix(normalizedFile); }

    const normalizedRelative = toPosix(relative);
    return normalizedRelative.startsWith('.') ? normalizedRelative : `./${normalizedRelative}`;
}

/**
 * 组装 compile_commands.json 条目。JSON Compilation Database 规范里 `arguments`
 * 与 `command` 二选一即可,clangd 原生支持 `arguments` 形态,因此不再重复存一份
 * `command` 字符串(库体积减半,几乎全是重复文本)。
 */
export function toCompilationDatabaseEntry(
    directory: string, file: string, tokens: string[]
): { directory: string; file: string; arguments: string[] } {
    return { directory, file, arguments: [...tokens] };
}

/**
 * 项目级 clangd 生成物收拢目录:`<root>/clangd/`(方案 D —— 由旧名 `.clangd/` 改名而来)。
 * - 编译数据库:`<root>/clangd/compile_commands.json`(单文件,随激活 target 重生成)
 * - 后台索引缓存:跟随 CDB 所在目录,自动落 `<root>/clangd/.cache/clangd/index`
 *
 * 为什么改名:项目级配置必须放在名为 **`.clangd` 的文件**里(clangd 22.1.6 实测:
 * `.clangd/config.yaml` 目录形式完全不被读取),文件与旧目录同名互斥。
 * 目录改名后配置文件落在项目根(与 .code-workspace 同目录),且同卷 rename
 * 可原样保留后台索引缓存(migrateCdbDirToClangd)。
 */
export function getProjectDbDir(rootDir: string): string {
    return path.join(rootDir, 'clangd');
}

export function getProjectDbPath(rootDir: string): string {
    return path.join(getProjectDbDir(rootDir), 'compile_commands.json');
}

/** 旧布局的 CDB 目录名(升级时改名为 `clangd/`, 见 migrateCdbDirToClangd) */
export const LEGACY_CDB_DIR_NAME = '.clangd';

/** 项目级配置文件名(clangd 唯一认这个文件名, 不认目录形式) */
export const PROJECT_CLANGD_CONFIG_NAME = '.clangd';

/** 项目配置文件首行的管理标记 —— 有它才允许 EIDE 覆写 */
const PROJECT_CONFIG_MARKER = '# This file is generated by EIDE (cl.eide).';

/**
 * 把旧 CDB 目录 `<root>/.clangd/` 改名为 `<root>/clangd/`。
 * 同卷 rename:compile_commands.json 与后台索引缓存(.cache)原样保留,零重建。
 * 返回: 'renamed' 已改名 | 'absent' 旧目录不存在(含已是文件的情况,那由
 * migrateLegacyClangdConfig 负责) | 'blocked' 新目录已存在(不覆盖,报告后人工处理)。
 */
export function migrateCdbDirToClangd(rootDir: string): 'renamed' | 'absent' | 'blocked' {
    const from = path.join(rootDir, LEGACY_CDB_DIR_NAME);
    const to = getProjectDbDir(rootDir);
    let fromIsDir = false;
    try {
        fromIsDir = fs.statSync(from).isDirectory();
    } catch {
        return 'absent';
    }
    if (!fromIsDir) { return 'absent'; }        // 是文件: 旧生成器配置,归 migrateLegacyClangdConfig 管
    if (fs.existsSync(to)) { return 'blocked'; }
    fs.renameSync(from, to);
    return 'renamed';
}

/** 解析配置目录:项目根顶层第一个 `*.code-workspace` 的所在目录;找不到回退项目根 */
export function resolveClangdProjectConfigDir(rootDir: string): string {
    try {
        const workspaceFiles = fs.readdirSync(rootDir, { withFileTypes: true })
            .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.code-workspace'))
            .map(e => e.name)
            .sort();
        if (workspaceFiles.length > 0) {
            return path.dirname(path.join(rootDir, workspaceFiles[0]));
        }
    } catch {
        // readdir 失败按回退处理
    }
    return rootDir;
}

export interface ProjectClangdConfigInput {
    /** CDB 目录(建议 POSIX 化) */
    compilationDatabase: string;
    addFlags: string[];
    removeFlags: string[];
    suppressDiagnostics: string[];
}

/**
 * 渲染项目级 `.clangd` 配置文件内容。
 * 与用户级受管块的区别:没有 PathMatch(那是用户级配置的能力,项目配置天然只覆盖本根子树)。
 * 空列表省略对应键,输出对相同输入稳定(配合 writeIfChanged 幂等)。
 */
export function renderProjectClangdConfigFile(input: ProjectClangdConfigInput): string {
    const lines: string[] = [
        PROJECT_CONFIG_MARKER,
        '# Regenerated on configuration changes; delete freely, it will be recreated.',
        'CompileFlags:',
        `  CompilationDatabase: ${String(input.compilationDatabase || '.').replace(/\\/g, '/')}`
    ];
    if (input.addFlags && input.addFlags.length > 0) {
        lines.push('  Add:');
        for (const f of input.addFlags) { lines.push(`    - ${f}`); }
    }
    if (input.removeFlags && input.removeFlags.length > 0) {
        lines.push('  Remove:');
        for (const f of input.removeFlags) { lines.push(`    - ${f}`); }
    }
    if (input.suppressDiagnostics && input.suppressDiagnostics.length > 0) {
        lines.push('Diagnostics:', '  Suppress:');
        for (const d of input.suppressDiagnostics) { lines.push(`    - ${d}`); }
    }
    return lines.join('\n') + '\n';
}

export function isEideManagedProjectConfig(content: string): boolean {
    return String(content || '').startsWith(PROJECT_CONFIG_MARKER);
}

export type UpsertProjectConfigResult =
    | 'created' | 'updated' | 'unchanged' | 'skipped-user-owned' | 'skipped-directory';

/**
 * 项目级 `.clangd` 配置文件落盘(存在性检测 + 幂等):
 *  - 不存在 → 创建
 *  - 存在且带 EIDE 标记 → 内容变化才写(writeIfChanged)
 *  - 存在但无标记 → **用户手写,不触碰**
 *  - 目标是目录 → 旧布局未迁移,跳过(由 migrateCdbDirToClangd 先行改名)
 */
export function upsertProjectClangdConfigFile(
    configPath: string,
    input: ProjectClangdConfigInput
): UpsertProjectConfigResult {
    let existing: string | undefined;
    try {
        const st = fs.statSync(configPath);
        if (st.isDirectory()) { return 'skipped-directory'; }
        existing = fs.readFileSync(configPath, 'utf8');
        if (!isEideManagedProjectConfig(existing)) { return 'skipped-user-owned'; }
    } catch {
        existing = undefined;   // 不存在 → 走创建
    }

    const next = renderProjectClangdConfigFile(input);
    if (existing !== undefined && existing === next) { return 'unchanged'; }

    // 原子写: 同目录临时文件 + rename(与用户级 config.yaml 同款语义)
    const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmpPath, next, 'utf8');
        fs.renameSync(tmpPath, configPath);
    } catch (error) {
        try { fs.unlinkSync(tmpPath); } catch { /* 清理失败不影响主流程 */ }
        throw error;
    }
    return existing === undefined ? 'created' : 'updated';
}

/**
 * 用户级 config.yaml 迁移移除:把**本项目 token** 的受管块从两个标记族里无条件移除
 * (方案 D 后不再走用户级块;其他项目的块保留,各自升级时迁移)。
 */
export function removeManagedBlocksAllFamilies(
    content: string,
    token: string
): { content: string; removed: number } {
    let out = String(content || '');
    let removed = 0;
    for (const markers of [CLANGD_MANAGED_MARKERS, CLANGD_LEGACY_MANAGED_MARKERS]) {
        const blockRegex = new RegExp(
            `${escapeRegex(markers.begin)} ${escapeRegex(token)}[\\s\\S]*?${escapeRegex(markers.end)} ${escapeRegex(token)}\\s*`,
            'g'
        );
        out = out.replace(blockRegex, () => { removed++; return ''; });
    }
    return { content: out, removed };
}

export function isInvalidIncludePathToken(includePath?: string): boolean {
    const text = String(includePath || '').trim().replace(/\\/g, '/').toLowerCase();
    return text.startsWith('null/') || text === 'null';
}

/**
 * 为单个源文件构造 clangd 友好的编译命令(tokens 形式)。
 * 编译器/参数均来自仿真映射,保证 clangd 能解析:
 *  - AC5/AC6 用 armclang 前端仿真(armclang 与 armcc 语法相近,且自带 __ARMCC_VERSION);
 *  - GCC 家族用对应 gcc 前端语义(由 --target/-mcpu 等表达);
 *  - C51/STM8 等无 clang 后端的家族仅注入 include/define 与关键字宏,并抑制诊断。
 */
export function buildClangdCommandTokens(ctx: ClangdTargetContext, sourceFile: string, extraArgs?: string): string[] {
    const sourceKind = getSourceKind(sourceFile);
    const flags: string[] = [];

    const compiler = ctx.compilerPath || (
        isAc6Toolchain(ctx.toolchain)
            ? (process.platform === 'win32' ? 'armclang.exe' : 'armclang')
            : isGccToolchain(ctx.toolchain)
                ? getGccCompilerBaseName(getGccFamilyOf(ctx))
                : (process.platform === 'win32' ? 'clang.exe' : 'clang')
    );

    const skipTargetFlag = isC51Toolchain(ctx.toolchain) || isStm8Toolchain(ctx.toolchain);
    // 真实 GCC 驱动不接受 clang 风格的 --target=...(直接报错退出,会连带搞砸
    // clangd 的 query-driver,使系统头文件全部丢失)。GCC 的目标已烘焙在驱动里,
    // query-driver 成功后目标/系统包含都由驱动提供,因此 GCC 家族一律不发 --target。
    // 注意:-mcpu/-mfpu/-mfloat-abi 等 CPU 标志必须保留,驱动靠它们算出正确的
    // 架构宏(缺了会回退到 armv4t/soft 默认,照样满屏红),所以这里只跳过 --target。
    const skipTargetForGcc = isGccToolchain(ctx.toolchain);
    const isRiscv = isRiscvContext(ctx.toolchain, ctx.projectType);

    if (!skipTargetFlag && !skipTargetForGcc) {
        if (isRiscv) {
            pushUnique(flags, '--target=riscv32-unknown-elf');
        } else if (isLlvmToolchain(ctx.toolchain)) {
            pushUnique(flags, '--target=arm-unknown-none-eabi');
        } else {
            pushUnique(flags, '--target=arm-arm-none-eabi');
        }
    }
    pushUnique(flags, '-fsyntax-only');
    pushUnique(flags, sourceKind === 'c' ? '-xc' : '-xc++');
    pushUnique(flags, `-std=${resolveCompileLanguageStandard(ctx, sourceKind)}`);
    if (!isC51Toolchain(ctx.toolchain)) {
        pushUnique(flags, '-ffreestanding');
        pushUnique(flags, '-funsigned-char');
    }

    for (const define of getToolchainCompatibilityDefines(ctx)) {
        pushUnique(flags, define);
    }

    for (const systemInclude of ctx.systemIncludeList || []) {
        flags.push('-isystem', systemInclude);
    }

    for (const inc of ctx.incList || []) {
        if (isInvalidIncludePathToken(inc)) { continue; }
        pushUnique(flags, `-I${inc}`);
    }

    if ((ctx.forceIncludeHeaders || []).length) {
        pushUnique(flags, '-D__VSCODE_CPPTOOL');
    }

    for (const define of ctx.defineList || []) {
        pushUnique(flags, formatDefine(define));
    }

    const sourceFileKey = toLookupPathKey(sourceFile);
    for (const forceInclude of ctx.forceIncludeHeaders || []) {
        // 防止 "main file cannot be included recursively" 递归错误
        if (toLookupPathKey(forceInclude) === sourceFileKey) { continue; }
        flags.push('-include', forceInclude);
    }

    if (!skipTargetFlag && !isRiscv) {
        for (const cpuFlag of getArmCpuFlags(ctx)) {
            pushUnique(flags, cpuFlag);
        }
    }

    if ((isGccToolchain(ctx.toolchain) || isLlvmToolchain(ctx.toolchain)) && shouldUseThumbMode(ctx)) {
        pushUnique(flags, '-mthumb');
    }

    if (ctx.useMicroLib) {
        pushUnique(flags, '-D__MICROLIB');
    }

    if (isAc5Toolchain(ctx.toolchain)) {
        pushUnique(flags, '-fms-extensions');
        pushUnique(flags, '-Wno-unknown-attributes');
        pushUnique(flags, '-Wno-ignored-attributes');
        // armcc 代码中大量 armcc 专有 pragma(#pragma arm、#pragma O2 ...),
        // armclang 会以 [-Warmcc-pragma-*]/[-Wunknown-pragmas] 诊断,直接抑制
        pushUnique(flags, '-Wno-armcc-pragmas');
        pushUnique(flags, '-Wno-unknown-pragmas');
    }

    if (ctx.executeOnlyCode && isAc6Toolchain(ctx.toolchain)) {
        pushUnique(flags, '-mexecute-only');
    }

    for (const optFlag of getOptimizationFlags(ctx.optimization)) {
        pushUnique(flags, optFlag);
    }

    if (ctx.oneElfSectionPerFunction) {
        pushUnique(flags, '-ffunction-sections');
    }

    if (ctx.shortEnumsWchar) {
        pushUnique(flags, '-fshort-enums');
        pushUnique(flags, '-fshort-wchar');
    }

    if (ctx.outputDebugInfo) {
        pushUnique(flags, '-g');
    }

    const extraTokens = typeof extraArgs === 'string' && extraArgs.trim() ? splitCommandArgs(extraArgs.trim()) : [];
    const sanitizedExtraTokens = isAc5Toolchain(ctx.toolchain)
        ? sanitizeAc5CompileCommandExtraTokens(extraTokens, sourceKind)
        : sanitizeGenericCompileCommandExtraTokens(extraTokens, sourceKind);

    return [compiler, ...flags, ...sanitizedExtraTokens, sourceFile];
}

// ---------------------------------------------------------------------------
// clangd user config.yaml managed blocks
// ---------------------------------------------------------------------------

export const CLANGD_MANAGED_BEGIN = '# BEGIN EIDE Clangd Support';
export const CLANGD_MANAGED_END = '# END EIDE Clangd Support';

export function escapeYamlString(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function escapeRegex(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 生成 clangd config.yaml 的 If.PathMatch 正则(windows 盘符大小写均可) */
export function createUserConfigPathMatch(workspaceRoot: string): string {
    const normalized = toPosix(path.normalize(String(workspaceRoot || '')));
    const windowsMatch = normalized.match(/^([A-Za-z]):(\/.*)$/);
    if (windowsMatch) {
        const driveLetter = windowsMatch[1];
        return `^[${driveLetter.toLowerCase()}${driveLetter.toUpperCase()}]:${escapeRegex(windowsMatch[2])}/.*$`;
    }
    return `^${escapeRegex(normalized)}/.*$`;
}

/** 受管块的令牌:项目根路径的 base64(仅保留字母数字) */
export function createManagedConfigToken(workspaceRoot: string): string {
    return Buffer.from(toPosix(path.normalize(String(workspaceRoot || '')))).toString('base64').replace(/[^A-Za-z0-9]/g, '');
}

export interface ClangdUserConfigBlockOptions {
    /** 单根或多个根(项目根 + 根外源码目录),每个根渲染一个 If.PathMatch 片段 */
    pathMatch: string | string[];
    compilationDatabase: string;
    /** 受管令牌(BEGIN/END 行携带,upsert/remove 按它定位块;缺省时行尾为空) */
    token?: string;
    activeTargetKey?: string;
    addFlags?: string[];
    removeFlags?: string[];
    suppressDiagnostics?: string[];
}

function yamlListItem(value: string): string {
    return `    - "${escapeYamlString(String(value || '').replace(/[\r\n]+/g, ' '))}"`;
}

/** 渲染单个项目的受管配置块(带 BEGIN/END 标记;多根时渲染多个 PathMatch 片段) */
export function renderClangdUserConfigBlock(opts: ClangdUserConfigBlockOptions): string {
    const pathMatchList = Array.isArray(opts.pathMatch) ? opts.pathMatch : [opts.pathMatch];
    const addBlock = (opts.addFlags || []).length
        ? `\n  Add:\n${opts.addFlags!.map(yamlListItem).join('\n')}`
        : '';
    const removeBlock = (opts.removeFlags || []).map(yamlListItem).join('\n');
    const suppressBlock = (opts.suppressDiagnostics || ['unused-includes']).map(yamlListItem).join('\n');
    const targetKey = String(opts.activeTargetKey || '<auto>').replace(/[\r\n]+/g, ' ');
    const token = opts.token;

    const fragments = pathMatchList.map((pathMatch) => `---
If:
  PathMatch: "${escapeYamlString(pathMatch)}"
# EIDE Active Target: ${targetKey}
CompileFlags:
  CompilationDatabase: "${escapeYamlString(opts.compilationDatabase)}"${addBlock}
  Remove:
${removeBlock}
Diagnostics:
  UnusedIncludes: None
  Suppress:
${suppressBlock}`);

    const begin = token ? `${CLANGD_MANAGED_BEGIN} ${token}` : CLANGD_MANAGED_BEGIN;
    const end = token ? `${CLANGD_MANAGED_END} ${token}` : CLANGD_MANAGED_END;
    return `${begin}
${fragments.join('\n')}
${end}`;
}

/** 在 config.yaml 文本中用新块替换同令牌旧块(无则追加),并保持用户自定义内容不动 */
export function upsertManagedConfigBlock(content: string, block: string, token: string): string {
    let next = removeManagedConfigBlocks(content, token).trimEnd();
    if (next) { next += '\n\n'; }
    return `${next}${block.trimEnd()}\n`;
}

/** 删除文本中所有带指定令牌的受管块 */
export function removeManagedConfigBlocks(content: string, token: string): string {
    const blockRegex = new RegExp(
        `${escapeRegex(CLANGD_MANAGED_BEGIN)} ${escapeRegex(token)}[\\s\\S]*?${escapeRegex(CLANGD_MANAGED_END)} ${escapeRegex(token)}\\s*`,
        'g'
    );
    return String(content || '').replace(blockRegex, '');
}

export interface ManagedBlockInfo {
    token: string;
    compilationDatabase: string;
}

/** 列出文本中所有受管块(令牌 + 编译数据库目录),供僵尸块回收使用 */
export function extractManagedBlockInfo(content: string): ManagedBlockInfo[] {
    const result: ManagedBlockInfo[] = [];
    const text = String(content || '');
    const blockRegex = new RegExp(
        `${escapeRegex(CLANGD_MANAGED_BEGIN)} (\\S+)[\\s\\S]*?${escapeRegex(CLANGD_MANAGED_END)} \\1`,
        'g'
    );
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(text)) !== null) {
        const dbMatch = /CompilationDatabase:\s*"([^"]+)"/.exec(match[0]);
        result.push({
            token: match[1],
            compilationDatabase: dbMatch ? dbMatch[1] : ''
        });
    }
    return result;
}

// ---------------------------------------------------------------------------
// 受管块治理(遗留标记族 + 失效项目回收)
// ---------------------------------------------------------------------------

/** 标记族(一个 begin/end 对) */
export interface ManagedBlockMarkers {
    begin: string;
    end: string;
}

export const CLANGD_MANAGED_MARKERS: ManagedBlockMarkers = {
    begin: CLANGD_MANAGED_BEGIN,
    end: CLANGD_MANAGED_END
};

/**
 * 遗留标记族:历史版本/官方版曾用 `EIDE Clangd Sync` 写同项目块。
 * 本管线不再生成它,但必须先按"失效即回收"清理,否则块会跨版本无限累积
 * (实测:一份 config.yaml 里堆了 16 个 Sync 块 / 227 条 PathMatch,131KB)。
 */
export const CLANGD_LEGACY_MANAGED_MARKERS: ManagedBlockMarkers = {
    begin: '# BEGIN EIDE Clangd Sync',
    end: '# END EIDE Clangd Sync'
};

/**
 * 把 `createUserConfigPathMatch` 生成的正则还原为文件系统路径(无法还原时返回 undefined)。
 * 生成形态: `^[dD]:/path/to/root/.*$` 或 `^/path/to/root/.*$`
 */
export function pathFromPathMatch(pattern: string): string | undefined {
    const p = String(pattern || '').trim();
    if (!p.startsWith('^') || !p.endsWith('/.*$')) { return undefined; }

    let body = p.slice(1, -4);                         // 去掉开头 ^ 与结尾 /.*$
    const drive = body.match(/^\[([A-Za-z])([A-Za-z])\]:/);
    if (drive) {
        body = `${drive[1].toUpperCase()}:` + body.slice(drive[0].length);
    }
    body = body.replace(/\\(.)/g, '$1');               // 还原 escapeRegex 的转义
    return body || undefined;
}

/**
 * 判断一个受管块是否已失效(可回收):
 *  - 全部 PathMatch 指向的项目根都不存在 → 失效(项目已被删除/移动)
 *  - 或:声明了 CompilationDatabase 但全部库目录都不存在 → 失效(僵尸库)
 */
export function isManagedBlockStale(
    block: string,
    pathExists: (p: string) => boolean,
    dbExists: (p: string) => boolean
): boolean {

    // ---- 规则: 项目根全部不存在 ----
    const pmRe = /PathMatch:\s*"([^"]+)"/g;
    let pm: RegExpExecArray | null;
    let hasPathMatch = false;
    let anyRootExists = false;
    while ((pm = pmRe.exec(block)) !== null) {
        hasPathMatch = true;
        const root = pathFromPathMatch(pm[1]);
        if (root && pathExists(root)) { anyRootExists = true; break; }
    }
    if (hasPathMatch && !anyRootExists) { return true; }

    // ---- 规则: 编译数据库全部不存在 ----
    const dbRe = /CompilationDatabase:\s*"([^"]+)"/g;
    let db: RegExpExecArray | null;
    let hasDb = false;
    while ((db = dbRe.exec(block)) !== null) {
        hasDb = true;
        if (dbExists(db[1])) { return false; }
    }
    return hasDb;
}

/**
 * 治理受管块内**越界的 PathMatch 片段**。
 *
 * 背景(实测根因):受管块可含多个 `If: PathMatch` 片段(历史版本为
 * "项目根 + 根外源码目录"各渲染一个)。旧版对根外目录生成的正则可能是
 * **祖先级通配**,例如 `^[dD]:/projects/.*$` —— 它匹配该目录下
 * **所有**项目,于是同一份 config.yaml 里后出现的这个片段会把兄弟项目的
 * 编译数据库全部截胡(实测:DSP 项目被 PROJ_C 的片段命中,clangd 拿
 * PROJ_C 的 AC5 命令去解析 DSP 的 AC6 源码,满屏 `file not found`)。
 *
 * 判定:块的标记行携带 token(= 该块所属项目根的 base64),把 token 解出
 * 来的根记为 `ownerRoot`。**若某片段路径是 ownerRoot 的严格祖先**,
 * 则该片段必为越界 —— 它对 ownerRoot 是冗余的(块内本就有 ownerRoot 片段),
 * 对兄弟项目却是截胡。合法的"根外源码目录"片段是其兄弟/子目录,不会被误删。
 *
 * token 缺失(旧格式)时退化为保守规则:同块内若片段 A 的路径是片段 B 的
 * 严格祖先,则 A 视为越界。
 *
 * 只删片段本身,块的其余片段与标记行原样保留。
 */
export function pruneForeignPathMatchFragments(
    block: string,
    ownerRoot?: string
): { block: string; removedFragments: number } {

    const text = String(block || '');

    // 从标记行取 token 并还原 ownerRoot(调用方未提供时)
    let owner = ownerRoot;
    if (!owner) {
        const tokenMatch = text.match(/# BEGIN EIDE Clangd (?:Support|Sync)\s*(\S+)/);
        if (tokenMatch) {
            try {
                const decoded = Buffer.from(tokenMatch[1], 'base64').toString('utf8');
                if (decoded && /[\\/]/.test(decoded)) { owner = decoded; }
            } catch { /* token 非法:退化为保守规则 */ }
        }
    }

    // 切成 "---" 分隔的片段(保留分隔符,便于原样重组)
    const parts = text.split(/(?=^---\s*$)/m);

    type Frag = { text: string; root?: string };
    const frags: Frag[] = parts.map((part) => {
        const pm = part.match(/PathMatch:\s*"([^"]+)"/);
        return { text: part, root: pm ? pathFromPathMatch(pm[1]) : undefined };
    });

    const normalize = (p: string): string => toPosix(path.normalize(p)).replace(/\/+$/, '').toLowerCase();
    const isAncestor = (ancestor: string, descendant: string): boolean => {
        const a = normalize(ancestor);
        const d = normalize(descendant);
        return a !== d && d.startsWith(`${a}/`);
    };

    let removedFragments = 0;
    const kept = frags.map((frag) => {
        if (!frag.root) { return frag.text; }

        // 规则 1(优先):片段路径是块所属项目根的严格祖先 → 越界
        let overbroad = !!owner && isAncestor(frag.root, owner);

        // 规则 2(退化):无法确定 ownerRoot 时,同块内的祖先片段视为越界
        if (!overbroad && !owner) {
            overbroad = frags.some((other) => other !== frag && other.root && isAncestor(frag.root!, other.root));
        }

        if (overbroad) { removedFragments++; return ''; }
        return frag.text;
    });

    // 兜底:任何情况下都不允许把块削到"无法覆盖自己项目根"。
    // 正常配置不会触发(块内本就有 ownerRoot 自身的片段);万一遇到畸形块,
    // 宁可原样保留也不制造"拆掉配置却没补上"的真空。
    if (removedFragments > 0) {
        const covered = frags.some((frag, index) =>
            frag.root && kept[index] !== '' &&
            (!owner || normalize(frag.root) === normalize(owner) || isAncestor(frag.root, owner))
        );
        if (!covered) { return { block: text, removedFragments: 0 }; }
    }

    return { block: kept.join(''), removedFragments };
}

/**
 * 治理 config.yaml:回收受管块。
 *
 * 三条规则:
 *  1. **当前标记族(`Clangd Support`)**: 回收"已失效"的块
 *     (项目根已不存在 / 编译数据库已不存在) —— 在用配置保留;
 *     同时在保留的块内剔除**越界 PathMatch 片段**(祖先级通配会截胡兄弟项目)。
 *  2. **遗留标记族(`Clangd Sync`)**: **无条件全部回收**。
 *     该格式已废弃,且它指向的 `.eide-clangd/` 旧布局已被本管线移除;
 *     更关键的是:同一项目若同时存在 Sync 块与 Support 块,两者的
 *     CompilationDatabase 会打架(实测:旧块把新布局的库截胡)。
 *     真正在用的项目会在同一趟刷新里由 Support 块重新写入,因此整体回收是安全的。
 */
export function pruneStaleManagedBlocks(
    content: string,
    opts: {
        pathExists: (p: string) => boolean;
        dbExists: (p: string) => boolean;
        /** 是否回收遗留标记族(默认 true;仅测试/诊断场景需要关掉) */
        removeLegacy?: boolean;
    }
): { content: string; removed: number; removedLegacy: number; removedFragments: number } {

    let out = String(content || '');
    let removed = 0;
    let removedLegacy = 0;
    let removedFragments = 0;

    // ---- 1) 当前标记族: 按失效判定回收 + 剔除越界片段 ----
    const currentRe = new RegExp(
        `${escapeRegex(CLANGD_MANAGED_MARKERS.begin)} (\\S+)[\\s\\S]*?${escapeRegex(CLANGD_MANAGED_MARKERS.end)} \\1\\s*`,
        'g'
    );
    out = out.replace(currentRe, (block) => {
        if (isManagedBlockStale(block, opts.pathExists, opts.dbExists)) {
            removed++;
            return '';
        }
        const pruned = pruneForeignPathMatchFragments(block);
        if (pruned.removedFragments > 0) {
            removedFragments += pruned.removedFragments;
            return pruned.block;
        }
        return block;
    });

    // ---- 2) 遗留标记族: 无条件回收 ----
    if (opts.removeLegacy !== false) {
        const legacyRe = new RegExp(
            `${escapeRegex(CLANGD_LEGACY_MANAGED_MARKERS.begin)} (\\S+)[\\s\\S]*?${escapeRegex(CLANGD_LEGACY_MANAGED_MARKERS.end)} \\1\\s*`,
            'g'
        );
        out = out.replace(legacyRe, () => { removedLegacy++; return ''; });
    }

    return { content: out, removed, removedLegacy, removedFragments };
}

/**
 * 结构自愈:清掉 config.yaml 中**顶层裸标量行**。
 *
 * clangd 的 config.yaml 顶层只允许映射(`key: value`)、注释(`#`)与文档分隔(`---`);
 * 任何位于受管块之外的"裸标量"行都是无效 YAML,clangd 会报
 * `Implicit map keys need to be followed by map values` /
 * `Unknown Config key '<...>'`(实测: 出现过孤立的 base64 令牌碎片行)。
 *
 * 这种残渣来自**并发写入**:本扩展用整文件覆写,而同一份文件也被
 * Qt Creator 等外部进程写,两边交叠就会拼接出残片。写前做一次自愈即可消除。
 *
 * 受管块**内部**的内容一律原样保留(里面本来就有缩进的标量,不能误删)。
 */
export function sanitizeClangdUserConfig(content: string): { content: string; removedLines: number } {

    const lines = String(content ?? '').split('\n');
    const out: string[] = [];
    let removedLines = 0;
    let inBlock = false;

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');

        if (/^# BEGIN EIDE Clangd (?:Support|Sync) \S+\s*$/.test(line)) {
            inBlock = true;
            out.push(raw);
            continue;
        }
        if (/^# END EIDE Clangd (?:Support|Sync) \S+\s*$/.test(line)) {
            inBlock = false;
            out.push(raw);
            continue;
        }
        if (inBlock) {
            out.push(raw);                    // 块内内容不动
            continue;
        }

        const t = line.trim();
        const isBlank = t.length === 0;
        const isComment = t.startsWith('#');
        const isDocSep = t === '---';
        const isList = t.startsWith('-');
        const isMapping = /^[^\s:#][^:]*:/.test(t);

        if (!isBlank && !isComment && !isDocSep && !isList && !isMapping) {
            removedLines++;                   // 顶层裸标量 → 视为残渣丢弃
            continue;
        }
        out.push(raw);
    }

    return { content: out.join('\n'), removedLines };
}

/** 判断文本是否含指定标记族的块(供诊断使用) */
export function hasManagedBlocks(content: string, markers: ManagedBlockMarkers = CLANGD_MANAGED_MARKERS): boolean {
    return new RegExp(`${escapeRegex(markers.begin)} \\S+`).test(String(content ?? ''));
}

// ---------------------------------------------------------------------------
// workspace settings (clangd.arguments)
// ---------------------------------------------------------------------------

export function upsertClangdWorkspaceArgs(args: string[], opts: { disableClangTidy: boolean }): string[] {
    const next = (args || []).filter((item) => {
        const text = String(item);
        // 剥除 --compile-commands-dir:CDB 位置由 config.yaml 受管块的 CompilationDatabase
        // 指针(按项目 PathMatch 隔离)唯一表达,避免两处事实源打架。
        // --background-index=false / =0 剥除:旧版(≤3.27.28)管线曾在工作区注入显式关闭,
        // 3.27.29 起后台索引恢复默认开启(索引随 CDB 目录落 .clangd/.cache),残留的 false
        // 会永久锁死"未打开文件跳转定义";统一移除让 clangd 走默认。裸参 / true / priority
        // 等显式开启形态原样保留,不注入任何形态。
        if (text.startsWith('--compile-commands-dir=')) { return false; }
        if (text === '--background-index=false' || text === '--background-index=0') { return false; }
        return true;
    });

    const upsert = (value: string) => {
        if (!next.includes(value)) { next.push(value); }
    };
    const removeExact = (value: string) => {
        const index = next.indexOf(value);
        if (index >= 0) { next.splice(index, 1); }
    };

    if (opts.disableClangTidy) {
        upsert('--clang-tidy=false');
    } else {
        removeExact('--clang-tidy=false');
    }
    upsert('--header-insertion=never');

    return next;
}
