/**
 * clangd integration (orchestration, vscode-dependent).
 *
 * 把 clangd 支持整合进 EIDE 进程内:
 *  1. 读取构建时同步生成的 `<outDir>/<target>/builder.params`,
 *     经 clangdSupport 变换成 clangd 友好的 `<root>/clangd/compile_commands.json`
 *     (项目收拢目录下单文件,随激活 target 重生成;工具链私有 flag 已翻译/剥离,
 *     C51/STM8 等家族注入关键字宏与兼容头,shim 存放于 `.eide/clangd/`);
 *  2. 项目级 `.clangd` 配置文件(方案 D, 与 .code-workspace 同目录):CompilationDatabase 指向
 *     `<root>/clangd`;存在性检测(用户手写不触碰)+ 幂等更新;用户级 config.yaml 里本项目的
 *     受管块(两标记族)迁移移除;
 *  3. 维护工作区 clangd.arguments(--clang-tidy=false / --header-insertion=never;
 *     background-index 不干预——clangd 默认开启,后台索引跟随 CDB 目录自动落在
 *     `<root>/clangd/.cache/`,配合 files.exclude 收纳为不可见)与 files.exclude(库文件);
 *  4. 迁移:旧生成器的 `.clangd` 文件改名备份;旧 CDB 目录 `.clangd/` 同卷改名为 `clangd/`(索引缓存保留);
 *  5. 升级清理:删除旧版按 target 预生成的 `.eide-clangd/` 目录与根目录散落的旧库/旧 `.cache`。
 *
 * 由 AbstractProject.UpdateCppConfig 防抖触发(始终开启,原 EIDE.Option.EnableClangdConfigGenerator 开关已移除)。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AbstractProject } from './EIDEProject';
import { GlobalEvent } from './GlobalEvents';
import { BuilderOptions } from './EIDETypeDefine';
import { ToolchainManager } from './ToolchainManager';
import type { ToolchainName } from './types/ToolchainTypes';
import {
    buildClangdCommandTokens,
    buildClangdContextForTarget,
    toCompilationDatabaseEntry,
    getProjectDbDir,
    asCompileCommandFile,
    isSupportedSourceFile,
    createManagedConfigToken,
    pruneStaleManagedBlocks,
    resolveClangdProjectConfigDir,
    isEideManagedProjectConfig,
    migrateCdbDirToClangd,
    PROJECT_CLANGD_CONFIG_NAME,
    CDB_FILE_NAME,
    sanitizeClangdUserConfig,
    upsertClangdWorkspaceArgs,
    isC51Toolchain,
    isStm8Toolchain,
    isAc5Toolchain,
    resolveCompatShimKind,
} from './clangdSupport';
import {
    resolveClangdCacheRoot,
    getClangdCacheLayout,
    ClangdCacheLayout
} from './clangdCachePaths';
import { atomicWriteFileSync } from './AtomicWrite';
import { planCacheMigration } from './clangdCacheMigrate';
import { collectSourceRootsForPathMatch, renderPathMatchForRoot } from './clangdSourceRoots';
import {
    renderManagedBlock,
    upsertManagedBlock,
    pruneStaleBlocks,
} from './clangdUserConfigBlock';
import {
    verifyCdbContent,
    verifyBlockUnique,
    verifyBlockPointer,
    summarizeSteps,
    RebuildStep,
} from './clangdRebuildVerify';

const AC5_COMPAT_HEADER = 'lint_armcc_compat.h';
const C51_COMPAT_HEADER = 'lint_c51_compat.h';

/** 无 clang 后端的工具链家族:无法真正编译,抑制全部诊断噪音 */
function isDiagnosticUnsupportedToolchain(toolchain: string): boolean {
    return isC51Toolchain(toolchain) || isStm8Toolchain(toolchain);
}

// ---------------------------------------------------------------------------
// AC5 / C51 兼容头(工具链关键字 shim)
// ---------------------------------------------------------------------------

const AC5_COMPAT_HEADER_CONTENT = `#ifndef __VSCODE_CPPTOOL
#define __VSCODE_CPPTOOL 1
#endif

#ifndef __GNUC__
#define __GNUC__ 4
#endif

#ifndef __GNUC_MINOR__
#define __GNUC_MINOR__ 2
#endif

#ifndef __GNUC_PATCHLEVEL__
#define __GNUC_PATCHLEVEL__ 1
#endif

#ifndef __GNUC_STDC_INLINE__
#define __GNUC_STDC_INLINE__ 1
#endif

#ifndef __INLINE
#define __INLINE inline
#endif

#ifndef __STATIC_INLINE
#define __STATIC_INLINE static inline
#endif

#ifndef __STATIC_FORCEINLINE
#define __STATIC_FORCEINLINE static inline
#endif

#ifndef __PACKED
#define __PACKED __attribute__((packed))
#endif

#ifndef __PACKED_STRUCT
#define __PACKED_STRUCT struct __attribute__((packed))
#endif

#ifndef __PACKED_UNION
#define __PACKED_UNION union __attribute__((packed))
#endif

#ifndef __ASM
#define __ASM __asm
#endif

#ifndef __asm
#define __asm __asm__
#endif

#ifndef __INLINE_ASM
#define __INLINE_ASM __asm__
#endif

#ifndef __PROMISE
#define __PROMISE(x)
#endif

#ifndef __value_in_regs
#define __value_in_regs
#endif

#ifndef __irq
#define __irq
#endif

#ifndef __irq_n
#define __irq_n
#endif

#ifndef __svc
#define __svc(x)
#endif

#ifndef __smc
#define __smc(x)
#endif

#ifndef __forceinline
#define __forceinline inline __attribute__((always_inline))
#endif

#ifndef __align
#define __align(x) __attribute__((aligned(x)))
#endif

#ifndef __packed
#define __packed __attribute__((packed))
#endif

#ifndef __weak
#define __weak __attribute__((weak))
#endif

#ifndef __NO_EMBEDDED_ASM
#define __NO_EMBEDDED_ASM 1
#endif

/*
 * clangd 是通用 clang:它不会定义 __ARMCC_VERSION,CMSIS 会分发到 cmsis_gcc.h,
 * 后者已通过 GNU 内联汇编提供 __REV16/__REVSH/__RRX。不要在这个 shim 中定义函数,
 * 否则会与 cmsis_gcc.h 冲突("redefinition of '__REV16'")。它只提供 armcc 关键字宏。
 */
`;

const C51_COMPAT_HEADER_CONTENT = `#ifndef __VSCODE_CPPTOOL
#define __VSCODE_CPPTOOL 1
#endif

#ifndef __C51__
#define __C51__ 1
#endif

#ifndef __KEIL__
#define __KEIL__ 1
#endif

#ifndef __asm
#define __asm __asm__
#endif

#ifndef __ASM
#define __ASM __asm
#endif

#ifndef __sfr
#define __sfr volatile unsigned char
#endif

#ifndef __sfr16
#define __sfr16 volatile unsigned short
#endif

#ifndef __sfr32
#define __sfr32 volatile unsigned long
#endif

#ifndef __sbit
#define __sbit volatile unsigned char
#endif

#ifndef __at
#define __at(x)
#endif

#ifndef __xdata
#define __xdata
#endif

#ifndef __idata
#define __idata
#endif

#ifndef __pdata
#define __pdata
#endif

#ifndef __data
#define __data
#endif

#ifndef __code
#define __code
#endif
`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toPosix(value: string): string {
    return String(value || '').replace(/\\/g, '/');
}

function getClangdUserConfigDir(): string | undefined {
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        return localAppData ? path.join(localAppData, 'clangd') : undefined;
    }
    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    if (xdgConfigHome) { return path.join(xdgConfigHome, 'clangd'); }
    const home = process.env.HOME || process.env.USERPROFILE;
    return home ? path.join(home, '.config', 'clangd') : undefined;
}

/**
 * 当前进程的 clangd 全局缓存根。
 *
 * 环境只在进程内读一次: 这些变量在扩展生命周期内不会变, 反复读会污染热路径。
 */
let cachedCacheRoot: string | undefined;
export function getClangdCacheRoot(): string {
    if (cachedCacheRoot === undefined) {
        cachedCacheRoot = resolveClangdCacheRoot({
            platform: process.platform,
            env: process.env,
            homedir: os.homedir()
        });
    }
    return cachedCacheRoot;
}

/** 项目在全局缓存中的布局(CDB / shim / 索引) */
export function getProjectCacheLayout(prj: AbstractProject): ClangdCacheLayout {
    return getClangdCacheLayout(getClangdCacheRoot(), prj.getProjectRoot().path, process.platform);
}

/**
 * 工具链关键字 shim 的存放目录:全局缓存 `<CACHE>/projects/<hash>/shim/`。
 *
 * 历史上它在 `.eide/clangd/`, 会往项目目录写生成物; 全局化后项目目录保持干净。
 */
function getClangdShimDir(prj: AbstractProject): string {
    return getProjectCacheLayout(prj).shimDir;
}

function writeIfChanged(filePath: string, content: string): boolean {
    try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
            return false;
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // 原子写: 先写同目录临时文件再 rename。
        // clangd 的 config.yaml 与 Qt Creator 等外部进程共享, 直接整文件覆写会在
        // 并发时产生"半截文件/拼接残渣"(实测: 文件里出现孤立的令牌碎片行,
        // clangd 报 `Unknown Config key '<碎片>'` / YAML 结构错)。
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, content, 'utf8');
        try {
            fs.renameSync(tmpPath, filePath);
        } catch {
            // rename 失败(如目标被占用)时回退为直接写, 宁可非原子也不能丢更新
            fs.writeFileSync(filePath, content, 'utf8');
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
        return true;
    } catch (error) {
        GlobalEvent.log_error(error);
        return false;
    }
}

/**
 * 分工具链 force-include 决策(模型与 Eide Extend 对齐):
 *  - AC5:不使用 EIDE 的 lint_armcc.h(与 armclang 仿真冲突),改用按需生成的关键字 shim;
 *  - C51 家族:同理使用关键字 shim(判定用 isC51Toolchain,覆盖 Keil_C51/SDCC 系列);
 *  - AC6 / GCC / LLVM / 其他:返回空,不 force-include 任何化石 lint 头。
 *    AC6 经 query-driver 由真实 armclang 前端解析,CMSIS/arm_compat.h 等真实头文件
 *    可被原生处理;化石头里的伪造宏(__ARM_ARCH=4、volatile(x)、__asm 中和)与
 *    非 static 内建函数声明只会制造波浪线,详见 test/scripts/lint-shim-compat.test.ts。
 */
function resolveForceIncludeHeaders(toolchainName: string, shimDir: string): string[] {
    const writeShim = (name: string, content: string): string | undefined => {
        const shimPath = path.join(shimDir, name);
        writeIfChanged(shimPath, content);
        return shimPath;
    };

    switch (resolveCompatShimKind(toolchainName)) {
        case 'ac5': {
            const shim = writeShim(AC5_COMPAT_HEADER, AC5_COMPAT_HEADER_CONTENT);
            return shim ? [shim] : [];
        }
        case 'c51': {
            const shim = writeShim(C51_COMPAT_HEADER, C51_COMPAT_HEADER_CONTENT);
            return shim ? [shim] : [];
        }
        default:
            return [];
    }
}

function lookupSourceParams(sourceParams: any, sourceFile: string): string | undefined {
    if (!sourceParams || typeof sourceParams !== 'object') { return undefined; }
    if (typeof sourceParams[sourceFile] === 'string') { return sourceParams[sourceFile]; }
    const wanted = sourceFile.toLowerCase();
    for (const key in sourceParams) {
        if (key.toLowerCase() === wanted) { return sourceParams[key]; }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// 1. compile_commands.json generation
// ---------------------------------------------------------------------------

/** 读指定 target 的 builder.params(`build/<target>/builder.params`,磁盘形态,不依赖激活态) */
function readBuilderParamsForTarget(prj: AbstractProject, targetName: string): any | undefined {
    const outDirRoot = prj.GetConfiguration<any>().config.outDir || 'build';
    const paramsPath = path.join(prj.getProjectRoot().path, outDirRoot, targetName, 'builder.params');
    try {
        if (!fs.existsSync(paramsPath)) { return undefined; }
        return JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    } catch (error) {
        GlobalEvent.log_error(error);
        return undefined;
    }
}

/** 取指定 target 存档的工具链配置(`toolchainConfigMap[toolchain]`,不依赖激活态) */
function getStoredToolchainConfig(config: any, targetName: string): { toolchain: string; tcConfig: any } | undefined {
    try {
        const target = config?.targets?.[targetName];
        if (!target || typeof target.toolchain !== 'string') { return undefined; }
        const tcConfig = target.toolchainConfigMap?.[target.toolchain] || {};
        return { toolchain: target.toolchain, tcConfig };
    } catch (error) {
        GlobalEvent.log_error(error);
        return undefined;
    }
}

/** 解析指定工具链的 clang 兼容编译器路径(AC5 借用 AC6 的 armclang 做仿真) */
function resolveClangdCompilerPathFor(prj: AbstractProject, toolchainName: string): string | undefined {
    const config = prj.GetConfiguration<any>().config;
    try {
        const toolchainObj = ToolchainManager.getInstance().getToolchain(config.type, <ToolchainName>toolchainName);
        const gccLikePath = toolchainObj.getGccFamilyCompilerPathForCpptools('c');
        if (gccLikePath) { return gccLikePath; }
    } catch (error) {
        GlobalEvent.log_error(error);
    }

    if (isAc5Toolchain(toolchainName)) {
        // AC5(armcc)没有 clang 兼容前端,借用 AC6(armclang)目录中的编译器
        try {
            const ac6Toolchain = ToolchainManager.getInstance().getToolchain('ARM', 'AC6');
            const armclangPath = path.join(
                ac6Toolchain.getToolchainDir().path, 'bin',
                process.platform === 'win32' ? 'armclang.exe' : 'armclang'
            );
            if (fs.existsSync(armclangPath)) { return armclangPath; }
        } catch (error) { /* AC6 未安装,忽略 */ }
    }
    return undefined;
}

/**
 * 为指定 target 生成 clangd 友好的编译数据库 `<root>/.clangd/compile_commands.json`(收拢目录单文件)。
 * 只读该 target 的磁盘构建参数与存档配置,不切换激活态。
 * @returns 生成的条目数;缺 builder.params(从未构建/切换过)时返回 -1 表示跳过,
 *          此时**保留**已有库文件(陈旧库,沿用旧"指针跳过"语义),不删不写
 */
export function generateDbForTarget(prj: AbstractProject, targetName: string): number {
    const builderParams = readBuilderParamsForTarget(prj, targetName);
    if (!builderParams || !Array.isArray(builderParams.sourceList)) { return -1; }

    const rootDir = prj.getProjectRoot().path;
    const config = prj.GetConfiguration<any>().config;
    const stored = getStoredToolchainConfig(config, targetName);
    if (!stored) { return -1; }

    const options: BuilderOptions = builderParams.options || {};
    const globalOpts: any = options.global || {};
    const cOpts: any = options['c/cpp-compiler'] || {};
    const tcConfig: any = stored.tcConfig || {};

    let systemIncludeList: string[] = [];
    try {
        const toolchainObj = ToolchainManager.getInstance().getToolchain(config.type, <ToolchainName>stored.toolchain);
        systemIncludeList = toolchainObj.getSystemIncludeList(options);
    } catch (error) {
        GlobalEvent.log_error(error);
    }

    const dbPath = getProjectCacheLayout(prj).cdbPath;
    const shimDir = getClangdShimDir(prj);
    const context = buildClangdContextForTarget({
        toolchain: stored.toolchain,
        projectType: config.type,
        compilerPath: resolveClangdCompilerPathFor(prj, stored.toolchain),
        cpuType: tcConfig.cpuType,
        floatingPointHardware: tcConfig.floatingPointHardware,
        armThumbMode: tcConfig.armThumbMode,
        useMicroLib: tcConfig.useMicroLib,
        executeOnlyCode: tcConfig.executeOnlyCode,
        oneElfSectionPerFunction: globalOpts['one-elf-section-per-function'],
        outputDebugInfo: globalOpts['output-debug-info'],
        optimization: globalOpts['optimization'],
        languageC: cOpts['language-c'],
        languageCpp: cOpts['language-cpp'],
        incList: Array.isArray(builderParams.incDirs) ? builderParams.incDirs : [],
        defineList: Array.isArray(builderParams.defines) ? builderParams.defines : [],
        systemIncludeList,
        forceIncludeHeaders: resolveForceIncludeHeaders(stored.toolchain, shimDir)
    });

    const entries: any[] = [];
    const seen = new Set<string>();
    for (const source of builderParams.sourceList) {
        if (typeof source !== 'string' || !isSupportedSourceFile(source)) { continue; }

        const absoluteFile = prj.ToAbsolutePath(source);
        const key = absoluteFile.toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);

        const compileCommandFile = asCompileCommandFile(rootDir, absoluteFile);
        const extraArgs = lookupSourceParams(builderParams.sourceParams, source);
        const tokens = buildClangdCommandTokens(context, compileCommandFile, extraArgs);

        entries.push(toCompilationDatabaseEntry(toPosix(rootDir), compileCommandFile, tokens));
    }

    if (!entries.length) { return -1; }

    writeIfChanged(dbPath, JSON.stringify(entries));
    return entries.length;
}

/**
 * 从 builder.params 生成 clangd 友好的编译数据库(当前激活 target,写入项目根单文件)。
 * builder.params 由 CodeBuilder.getCommands 在每次 UpdateCppConfig/构建时同步写出,
 * 因此切换 target 后走本函数即可让根目录库自动跟随新 target。
 */
export function generateClangdCompilationDatabase(prj: AbstractProject): boolean {
    return generateDbForTarget(prj, prj.getCurrentTarget()) >= 0;
}

/**
 * 升级清理:删除历史布局残留——
 *  1. 旧版按 target 预生成的 `.eide-clangd/` 目录(含遗留 `.cache` 索引);
 *  2. 根目录散落的 `<root>/compile_commands.json` 与 `<root>/.cache`(收拢布局之前的产物)。
 * 均为生成物,可安全递归删除;每次管线幂等执行,无残留时零操作。
 */
export function cleanupLegacyClangdArtifacts(prj: AbstractProject): boolean {
    let removed = false;
    const rootDir = prj.getProjectRoot().path;
    const legacyTargets = [
        { p: path.join(rootDir, '.eide-clangd'), note: `legacy clangd output dir '.eide-clangd'` },
        { p: path.join(rootDir, CDB_FILE_NAME), note: `legacy root-level ${CDB_FILE_NAME}` },
        { p: path.join(rootDir, '.cache'), note: `legacy root-level '.cache' index dir` }
    ];
    for (const item of legacyTargets) {
        try {
            if (!fs.existsSync(item.p)) { continue; }
            fs.rmSync(item.p, { recursive: true, force: true });
            GlobalEvent.log_info(`${item.note} removed`);
            removed = true;
        } catch (error) {
            GlobalEvent.log_error(error);
        }
    }
    return removed;
}

// ---------------------------------------------------------------------------
// 2. 项目级 .clangd 配置文件(方案 D) + 用户级 config.yaml 迁移移除
// ---------------------------------------------------------------------------

/** clangd 无法解析的基础 Remove 列表(第二道防线,覆盖非本扩展生成的命令) */
const BASE_REMOVE_FLAGS = [
    '--depend', '--depend=*', '--no_depend_system_headers',
    '-fno-shrink-wrap', '-fstrict-volatile-bitfields', '-fno-tree-switch-conversion',
    '-fzero-init-padding-bits=all', '-fzero-init-padding-bits=*', '-fno-malloc-dce'
];


/**
 * 收集当前 CDB 里的绝对源码路径(判定需要覆盖哪些源码根的事实依据)。
 */
function readCdbSourcePaths(prj: AbstractProject): string[] {
    const rootDir = prj.getProjectRoot().path;
    const result: string[] = [];
    try {
        const raw = fs.readFileSync(getProjectCacheLayout(prj).cdbPath, 'utf8');
        const entries: any[] = JSON.parse(raw);
        for (const e of entries) {
            if (!e || typeof e.file !== 'string') { continue; }
            const dir = e.directory ? String(e.directory) : rootDir;
            result.push(path.resolve(dir, e.file));
        }
    } catch {
        // CDB 缺失/损坏: 退化为只覆盖项目根(后续刷新会重建)
    }
    return result;
}

/**
 * 全局缓存方案: 把本项目的受管块写进用户级 `config.yaml`。
 *
 * clangd 只认这一个配置文件(实测不支持 `config.d/` 目录), 所以多项目共用它。
 * 每个项目一个带 token 的块, 块内**每个源码根一条 PathMatch 片段**, 全部指向
 * 该项目在全局缓存里的 CDB 目录(实测 `CompilationDatabase` 接受绝对路径)。
 *
 * 与方案 D 的关键差别: 不再需要把 `.clangd` 上移到"能覆盖全部源码的公共祖先",
 * 因此彻底摆脱了"根外源码拿不到配置"的启发式回退。
 *
 * @returns true 表示本次有写入
 */
function updateUserConfigManagedBlock(prj: AbstractProject, toolchainName: string): boolean {
    const configDir = getClangdUserConfigDir();
    if (!configDir) {
        GlobalEvent.log_warn('clangd user config dir not found, skip writing managed block');
        return false;
    }

    const configPath = path.join(configDir, 'config.yaml');
    const token = createManagedConfigToken(prj.getProjectRoot().path);
    const layout = getProjectCacheLayout(prj);

    const sourceAbsPaths = readCdbSourcePaths(prj);
    const roots = collectSourceRootsForPathMatch(prj.getProjectRoot().path, sourceAbsPaths, process.platform);
    const pathMatches = roots.map((r) => renderPathMatchForRoot(r, process.platform));

    let existingContent = '';
    try {
        if (fs.existsSync(configPath)) { existingContent = fs.readFileSync(configPath, 'utf8'); }
    } catch (error) {
        GlobalEvent.log_error(error);
        return false;
    }

    const pathExists = (p: string) => { try { return !!p && fs.existsSync(p); } catch { return false; } };

    // 结构自愈 + 僵尸块回收(共享文件必须持续治理,否则会无限累积)
    const sanitized = sanitizeClangdUserConfig(existingContent);
    const prunedStale = pruneStaleManagedBlocks(sanitized.content, {
        pathExists,
        dbExists: pathExists,
        currentRoot: prj.getProjectRoot().path
    });
    const prunedStaleLegacy = pruneStaleBlocks(prunedStale.content, pathExists);

    const block = renderManagedBlock({
        token,
        pathMatches,
        compilationDatabase: toPosix(layout.projectDir),
        removeFlags: BASE_REMOVE_FLAGS,
        suppressDiagnostics: isDiagnosticUnsupportedToolchain(toolchainName) ? ['*'] : ['unused-includes']
    });

    const nextContent = upsertManagedBlock(prunedStaleLegacy.content, block, token);
    if (nextContent === existingContent) { return false; }

    try {
        fs.mkdirSync(configDir, { recursive: true });
        const ok = atomicWriteFileSync(configPath, nextContent);
        if (!ok) {
            GlobalEvent.log_error(`failed to write clangd user config '${configPath}'`);
            return false;
        }
        GlobalEvent.log_info(`clangd user config: managed block for '${prj.getProjectRoot().path}' updated ` +
            `(${pathMatches.length} fragment(s) -> ${toPosix(layout.projectDir)})`);
        if (prunedStale.removedFragments > 0) {
            GlobalEvent.log_info(`clangd user config: pruned ${prunedStale.removedFragments} over-broad PathMatch fragment(s)`);
        }
        if (prunedStaleLegacy.removed > 0) {
            GlobalEvent.log_info(`clangd user config: removed ${prunedStaleLegacy.removed} stale managed block(s)`);
        }
        return true;
    } catch (error) {
        GlobalEvent.log_error(error);
        return false;
    }
}

/**
 * 清理**上一版 EIDE 生成**的项目级 `.clangd` 文件(仅带 EIDE 标记时删除)。
 * 用户手写的文件不带标记, 绝不触碰。
 */
function removeLegacyProjectClangdFile(prj: AbstractProject): boolean {
    let removed = false;
    const candidates: string[] = [];
    try {
        candidates.push(path.join(resolveClangdProjectConfigDir(prj.getProjectRoot().path), PROJECT_CLANGD_CONFIG_NAME));
        candidates.push(path.join(prj.getProjectRoot().path, PROJECT_CLANGD_CONFIG_NAME));
    } catch { /* ignore */ }

    for (const file of [...new Set(candidates)]) {
        try {
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { continue; }
            if (!isEideManagedProjectConfig(fs.readFileSync(file, 'utf8'))) { continue; }
            fs.unlinkSync(file);
            GlobalEvent.log_info(`legacy EIDE project '.clangd' at '${file}' removed (global cache layout)`);
            removed = true;
        } catch (error) {
            GlobalEvent.log_error(error);
        }
    }
    return removed;
}

// ---------------------------------------------------------------------------
// 3. workspace settings (clangd.arguments)
// ---------------------------------------------------------------------------

function updateClangdWorkspaceSettings(prj: AbstractProject): boolean {
    const uri = vscode.Uri.file(prj.getProjectRoot().path);
    const clangdConfig = vscode.workspace.getConfiguration('clangd', uri);
    const inspect = clangdConfig.inspect<string[]>('arguments');
    const currentValue = inspect?.workspaceValue || inspect?.workspaceFolderValue || [];
    const nextValue = upsertClangdWorkspaceArgs(currentValue, { disableClangTidy: true });

    const differs = (stored: string[] | undefined): boolean =>
        JSON.stringify(stored) !== JSON.stringify(nextValue);
    const write = (target: vscode.ConfigurationTarget): void => {
        clangdConfig.update('arguments', nextValue, target).then(() => {
            GlobalEvent.log_info(`workspace clangd.arguments updated (${target === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'workspace-folder'})`);
        }, (error) => {
            GlobalEvent.log_error(error);
        });
    };

    let changed = false;
    // 双写:multi-root/.code-workspace 场景下 workspace 级与 folder 级可能同时持有
    // clangd.arguments,而 folder 级对资源优先级更高且数组整体覆盖不合并——只写
    // workspace 级时 folder 级的旧参数(如 --background-index)会继续生效(实测踩坑)。
    if (inspect?.workspaceValue !== undefined && differs(inspect.workspaceValue)) {
        write(vscode.ConfigurationTarget.Workspace);
        changed = true;
    }
    if (inspect?.workspaceFolderValue !== undefined && differs(inspect.workspaceFolderValue)) {
        write(vscode.ConfigurationTarget.WorkspaceFolder);
        changed = true;
    }
    if (!changed && inspect?.workspaceValue === undefined && inspect?.workspaceFolderValue === undefined) {
        // 两个作用域都未定义时落到 folder 级(优先级最高,后续必然生效)
        write(vscode.ConfigurationTarget.WorkspaceFolder);
        changed = true;
    }
    return changed;
}

/**
 * 维护工作区 files.exclude:只隐藏 `<root>/clangd/compile_commands.json`(大体积库文件),
 * `clangd/.cache/` 后台索引与目录本身保持可见(便于观察索引状态);`.clangd` 配置文件保持可见。
 * 顺带迁移旧键(整目录隐藏的 dot-clangd,会把 .cache 连带藏掉)。
 * 与 arguments 同款双写语义:已定义的作用域合并补键(不覆盖用户已有排除项),
 * 两个作用域都未定义时落到 folder 级。
 */
function updateClangdWorkspaceFileExclude(prj: AbstractProject): boolean {
    const uri = vscode.Uri.file(prj.getProjectRoot().path);
    const filesConfig = vscode.workspace.getConfiguration('files', uri);
    const inspect = filesConfig.inspect<Record<string, boolean>>('exclude');
    // 全局缓存方案: CDB 已不在项目内, 旧键全部让位(不再隐藏任何东西)。
    // 保留本函数是为了**清理**历史键, 否则用户工作区会残留无意义的排除项。
    const EXCLUDE_KEY = '**/clangd/compile_commands.json';
    const LEGACY_KEYS = [
        EXCLUDE_KEY,
        '**/.clangd',
        '**/.clangd/compile_commands.json',
        '**/.eide-clangd/**'
    ];

    const nextValue = (stored: Record<string, boolean> | undefined): Record<string, boolean> => {
        const merged: Record<string, boolean> = { ...(stored || {}) };
        for (const k of LEGACY_KEYS) { delete merged[k]; } // 迁移: 旧 clangd 产物已不在项目内
        return merged;
    };

    const differs = (stored: Record<string, boolean> | undefined): boolean => {
        const cur = stored || {};
        // 只要还残留任一历史键, 就需要写一次(把它们清掉)
        return LEGACY_KEYS.some((k) => cur[k] !== undefined);
    };

    const write = (existing: Record<string, boolean> | undefined, target: vscode.ConfigurationTarget): void => {
        filesConfig.update('exclude', nextValue(existing), target).then(() => {
            GlobalEvent.log_info(`workspace files.exclude updated (${target === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'workspace-folder'})`);
        }, (error) => {
            GlobalEvent.log_error(error);
        });
    };

    let changed = false;
    if (inspect?.workspaceValue !== undefined && differs(inspect.workspaceValue)) {
        write(inspect.workspaceValue, vscode.ConfigurationTarget.Workspace);
        changed = true;
    }
    if (inspect?.workspaceFolderValue !== undefined && differs(inspect.workspaceFolderValue)) {
        write(inspect.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder);
        changed = true;
    }
    if (!changed && inspect?.workspaceValue === undefined && inspect?.workspaceFolderValue === undefined) {
        write(undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        changed = true;
    }
    return changed;
}

// ---------------------------------------------------------------------------
// 4. legacy `.clangd` migration
// ---------------------------------------------------------------------------

/**
 * 旧版 EIDE 生成器会把 `CompilationDatabase` 写进项目级 `.clangd`。
 * 项目级配置在 clangd 侧会覆盖用户级 config.yaml,导致新管线被静默忽略,
 * 因此检测到这种"指向本项目构建目录的旧生成配置"时将其改名备份。
 * 用户手写的、指向其它位置的 `.clangd` 不受影响。
 */
function migrateLegacyClangdConfig(prj: AbstractProject): boolean {
    const clangdPath = path.join(prj.getProjectRoot().path, '.clangd');
    if (!fs.existsSync(clangdPath)) { return false; }

    try {
        // `.clangd` 可能是用户自建的目录(如 background-index/.cache 工作区布局),不是文件——跳过迁移,
        // 否则 readFileSync(目录) 每次 clangd 刷新都会抛 EISDIR
        if (!fs.statSync(clangdPath).isFile()) { return false; }
        const content = fs.readFileSync(clangdPath, 'utf8');
        if (content.includes('# BEGIN EIDE Clangd Support')) { return false; }
        const match = content.match(/(^|\n)\s*CompilationDatabase\s*:\s*"?([^"\n#]+)"?\s*$/m);
        if (!match) { return false; }

        const configured = path.resolve(prj.getProjectRoot().path, match[2].trim());
        const expectedBuildDir = path.resolve(prj.getProjectRoot().path, prj.getOutputDir());
        const expectedRoot = path.resolve(prj.getProjectRoot().path);
        const isLegacy = configured === expectedBuildDir
            || configured === path.dirname(expectedBuildDir)
            || configured === expectedRoot;
        if (!isLegacy) { return false; }

        const backupPath = `${clangdPath}.eide-legacy.bak`;
        if (!fs.existsSync(backupPath)) {
            fs.renameSync(clangdPath, backupPath);
            GlobalEvent.log_info(`legacy '.clangd' (generated by the old EIDE clangd generator) moved to '${path.basename(backupPath)}'`);
            return true;
        }
        // backup 已存在,说明之前迁移过:直接移除再次生成的旧文件
        fs.unlinkSync(clangdPath);
        return true;
    } catch (error) {
        GlobalEvent.log_error(error);
        return false;
    }
}

// ---------------------------------------------------------------------------
// master entry
// ---------------------------------------------------------------------------

/**
 * 在配置变更后尝试唤醒 clangd(优先温和的重载命令)。
 *
 * **必须防抖**:一轮刷新管线可能由多个事件源接连触发(激活链、文件监听、命令),
 * 每轮 `changed=true` 都会调到这里;vscode-clangd 扩展在快速连续 restart 时有
 * 注册竞态(旧 client 的 `clangd.applyFix` 等服务端命令尚未注销,新 client 的
 * ExecuteCommandFeature 再注册同名命令即抛 `command 'clangd.applyFix' already exists`,
 * 整个 client 起不来,之后所有请求报错)——实测 clangd 0.6.0 + clangd 22.1.6。
 * 因此这里做尾缘合并:短时间内多次调用只真正执行一次 restart。
 */
const RESTART_DEBOUNCE_MS = 500;
let restartTimer: NodeJS.Timeout | undefined;
let restartInFlight = false;

export async function tryRestartClangd(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        if (restartTimer) { clearTimeout(restartTimer); }
        restartTimer = setTimeout(() => {
            restartTimer = undefined;
            void doRestartClangd().then(resolve);
        }, RESTART_DEBOUNCE_MS);
    });
}

async function doRestartClangd(): Promise<boolean> {
    if (restartInFlight) {
        // 上一轮 restart 还没结束:跳过(刚起的 client 不需要再重启),
        // 调用方的意图已由防抖窗口合并保证
        return false;
    }
    restartInFlight = true;
    try {
        const commands = ['clangd.restart', 'clangd.reload', 'clangd.restartLanguageServer'];
        for (const command of commands) {
            try {
                await vscode.commands.executeCommand(command);
                GlobalEvent.log_info(`clangd refresh command executed: ${command}`);
                return true;
            } catch (error) {
                GlobalEvent.log_info(`clangd refresh command unavailable: ${command} (${String(error)})`);
            }
        }
        return false;
    } finally {
        restartInFlight = false;
    }
}

export interface RebuildClangdCacheResult {
    targetName: string;
    /** CDB 条目数; -1 = 缺 builder.params(从未构建过) */
    entries: number;
    /** 已清理的旧产物(相对路径或说明) */
    cleared: string[];
    /** 逐步结果,失败项带原因 */
    steps: RebuildStep[];
    /** 全部关键步骤通过校验 */
    ok: boolean;
    /** 本次使用的全局缓存目录(诊断用) */
    projectCacheDir: string;
    /** 用户级 config.yaml 路径 */
    userConfigPath: string;
}

/**
 * 重新生成 clangd 配置(维修通道,右键菜单"生成 clangd 配置")。
 *
 * 语义是**强制修复到已知良好状态**, 不依赖任何既有缓存:
 *  1. 探测全局缓存根可写性(不可写则明确报告,不静默降级)
 *  2. 清空本项目缓存目录(CDB + shim + 后台索引 .cache)
 *  3. 清理旧布局残留(项目内 `<root>/clangd/`、带 EIDE 标记的 `.clangd`、`.eide-clangd/`)
 *  4. 重新生成 shim 与 CDB
 *  5. 移除本项目所有标记族的块, 写入一个干净块
 *  6. **逐项校验**: CDB 合法且条目数一致 / 块唯一 / 指针正确
 *  7. 唤醒 clangd
 *
 * 与原实现的区别: 原版把所有 `update*` 的失败都吞进 log_error, 用户看到"成功"
 * 但可能什么都没写成。现在每一步都有可判定的结果, UI 可据此明确报告。
 */
export function rebuildClangdCache(prj: AbstractProject): RebuildClangdCacheResult {
    const targetName = prj.getCurrentTarget();
    const rootDir = prj.getProjectRoot().path;
    const layout = getProjectCacheLayout(prj);
    const configDir = getClangdUserConfigDir();
    const userConfigPath = configDir ? path.join(configDir, 'config.yaml') : '';
    const token = createManagedConfigToken(rootDir);
    const cleared: string[] = [];
    const steps: RebuildStep[] = [];

    // 1) 全局缓存根可写性
    const probe = probeCacheRoot(getClangdCacheRoot());
    steps.push({
        name: 'cache-root',
        ok: probe.ok,
        detail: probe.ok ? getClangdCacheRoot() : `${getClangdCacheRoot()}: ${probe.reason}`
    });

    // 2) 清空本项目缓存目录(索引一并清掉: 维修通道的语义就是"从头来过")
    try {
        if (fs.existsSync(layout.projectDir)) {
            fs.rmSync(layout.projectDir, { recursive: true, force: true });
            cleared.push(layout.projectDir);
        }
    } catch (error) {
        GlobalEvent.log_error(error);
    }

    // 3) 旧布局残留(先尝试保留索引迁移, 再兜底清理)
    if (migrateProjectCdbToCache(prj)) { cleared.push('legacy in-project clangd dir (migrated)'); }
    const projectDbDir = getProjectDbDir(rootDir);
    try {
        if (fs.existsSync(projectDbDir)) {
            fs.rmSync(projectDbDir, { recursive: true, force: true });
            cleared.push(projectDbDir);
        }
    } catch (error) {
        GlobalEvent.log_error(error);
    }
    if (cleanupLegacyClangdArtifacts(prj)) { cleared.push('legacy clangd artifacts'); }
    if (removeLegacyProjectClangdFile(prj)) { cleared.push(`project '${PROJECT_CLANGD_CONFIG_NAME}'`); }

    // 4) 重新生成 shim + CDB
    const entries = generateDbForTarget(prj, targetName);
    steps.push({ name: 'shim', ok: true, detail: layout.shimDir });

    // 校验 CDB(读回,不信任写入返回值)
    try {
        const raw = fs.readFileSync(layout.cdbPath, 'utf8');
        steps.push(verifyCdbContent(raw, entries));
    } catch (error: any) {
        steps.push({ name: 'cdb', ok: false, detail: `cannot read back '${layout.cdbPath}': ${error?.message || error}` });
    }

    // 5) 用户级受管块: 先移除本项目所有标记族, 再写一个干净块
    updateUserConfigManagedBlock(prj, prj.getToolchain().name);

    // 6) 校验块: 唯一 + 指针正确
    if (!userConfigPath) {
        steps.push({ name: 'config-block', ok: false, detail: 'clangd user config dir not found' });
    } else {
        let content = '';
        try {
            content = fs.readFileSync(userConfigPath, 'utf8');
        } catch (error: any) {
            steps.push({ name: 'config-block', ok: false, detail: `cannot read '${userConfigPath}': ${error?.message || error}` });
        }
        if (content || content === '') {
            const unique = verifyBlockUnique(content, token);
            const pointer = verifyBlockPointer(content, token, toPosix(layout.projectDir));
            if (unique.ok && pointer.ok) {
                steps.push({ name: 'config-block', ok: true, detail: userConfigPath });
            } else {
                steps.push(unique.ok ? pointer : unique);
            }
        }
    }

    // 7) 工作区设置
    try {
        updateClangdWorkspaceSettings(prj);
        steps.push({ name: 'workspace-settings', ok: true });
    } catch (error: any) {
        steps.push({ name: 'workspace-settings', ok: false, detail: String(error?.message || error) });
    }
    try {
        updateClangdWorkspaceFileExclude(prj);
        steps.push({ name: 'file-exclude', ok: true });
    } catch (error: any) {
        steps.push({ name: 'file-exclude', ok: false, detail: String(error?.message || error) });
    }

    // 8) 唤醒 clangd
    tryRestartClangd();
    steps.push({ name: 'restart', ok: true });

    const summary = summarizeSteps(steps);
    return {
        targetName,
        entries,
        cleared,
        steps,
        ok: summary.ok,
        projectCacheDir: layout.projectDir,
        userConfigPath
    };
}

/** 探测目录可写性(建目录 + 写探针文件 + 删除) */
function probeCacheRoot(cacheRoot: string): { ok: boolean; reason?: string } {
    const probeFile = path.join(cacheRoot, `.probe-${process.pid}-${Date.now()}`);
    try {
        fs.mkdirSync(cacheRoot, { recursive: true });
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.unlinkSync(probeFile);
        return { ok: true };
    } catch (error: any) {
        try { fs.unlinkSync(probeFile); } catch { /* ignore */ }
        return { ok: false, reason: error?.message || String(error) };
    }
}

/**
 * 把项目内旧布局(`<root>/clangd/`)迁移到全局缓存。
 *
 * 顺序刻意如此(崩溃安全): 先把 CDB 与索引缓存搬到全局, 确认成功后才删项目内目录。
 * 中途崩溃最多留下"两份都在", 下次运行会因全局已存在而跳过搬运, 最终仍会清理项目内目录。
 *
 * 跨卷 rename 会抛 `EXDEV`(项目在 D:, 缓存在 C:), 此时降级为复制 + 删除。
 * 索引缓存 `.cache/` 优先 rename 以保留(否则 clangd 要重建全部索引)。
 *
 * @returns true 表示发生了迁移
 */
export function migrateProjectCdbToCache(prj: AbstractProject): boolean {
    const rootDir = prj.getProjectRoot().path;
    const legacyDir = getProjectDbDir(rootDir);
    if (!fs.existsSync(legacyDir)) { return false; }

    const layout = getProjectCacheLayout(prj);
    let changed = false;

    const legacyCdb = path.join(legacyDir, CDB_FILE_NAME);
    const legacyCache = path.join(legacyDir, '.cache');
    const plan = planCacheMigration({
        legacyCdbExists: fs.existsSync(legacyCdb),
        globalCdbExists: fs.existsSync(layout.cdbPath),
        legacyCacheExists: fs.existsSync(legacyCache),
        globalCacheExists: fs.existsSync(layout.indexCacheDir)
    });

    try {
        if (plan.moveCdb || plan.moveIndexCache) {
            fs.mkdirSync(layout.projectDir, { recursive: true });
        }

        // 1) CDB: 仅在全局还没有时搬运(全局优先, 避免覆盖更新的库)
        if (plan.moveCdb) {
            moveFileOrCopy(legacyCdb, layout.cdbPath);
            changed = true;
        }

        // 2) 索引缓存: 优先 rename 保留
        if (plan.moveIndexCache) {
            moveFileOrCopy(legacyCache, layout.indexCacheDir);
            changed = true;
        }

        // 3) 最后删除项目内目录(搬空后才会成功; 残留则下次再试)
        if (plan.removeLegacyDir) {
            try {
                fs.rmSync(legacyDir, { recursive: true, force: true });
                GlobalEvent.log_info(`legacy in-project clangd dir '${legacyDir}' migrated to global cache`);
                changed = true;
            } catch (error) {
                GlobalEvent.log_warn(`cannot remove legacy clangd dir '${legacyDir}': ${String(error)}`);
            }
        }
    } catch (error) {
        GlobalEvent.log_error(error);
    }

    return changed;
}

/** 同卷 rename, 跨卷/占用时降级为复制+删除 */
function moveFileOrCopy(from: string, to: string): void {
    try {
        fs.renameSync(from, to);
        return;
    } catch (error: any) {
        if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EBUSY') { throw error; }
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
}

/** clangd 支持总入口:由 AbstractProject.UpdateCppConfig 防抖触发 */
export function updateClangdIntegration(prj: AbstractProject): void {

    const tStart = Date.now();
    try {
        const toolchainName = prj.getToolchain().name;

        cleanupLegacyClangdArtifacts(prj); // 升级清理旧布局残留(.eide-clangd/根库/根 .cache),不计入 changed
        let changed = migrateLegacyClangdConfig(prj);
        switch (migrateCdbDirToClangd(prj.getProjectRoot().path)) {
            case 'renamed':
                GlobalEvent.log_info("legacy CDB dir '.clangd/' renamed to 'clangd/' (index cache preserved)");
                changed = true;
                break;
            case 'blocked':
                GlobalEvent.log_error("both '.clangd/' and 'clangd/' exist - resolve manually, project config file skipped");
                break;
        }
        changed = migrateProjectCdbToCache(prj) || changed;
        changed = generateClangdCompilationDatabase(prj) || changed;
        changed = updateUserConfigManagedBlock(prj, toolchainName) || changed;
        changed = removeLegacyProjectClangdFile(prj) || changed;
        changed = updateClangdWorkspaceSettings(prj) || changed;
        changed = updateClangdWorkspaceFileExclude(prj) || changed;

        if (changed) {
            tryRestartClangd();
        }
        GlobalEvent.log_info(`clangd integration update done +${Date.now() - tStart}ms (changed=${changed})`);
    } catch (error) {
        GlobalEvent.log_error(error);
    }
}
