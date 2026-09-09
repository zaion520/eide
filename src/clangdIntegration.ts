/**
 * clangd integration (orchestration, vscode-dependent).
 *
 * 把 clangd 支持整合进 EIDE 进程内:
 *  1. 读取构建时同步生成的 `<outDir>/<target>/builder.params`,
 *     经 clangdSupport 变换成 clangd 友好的 `<root>/.clangd/compile_commands.json`
 *     (项目收拢目录下单文件,随激活 target 重生成;工具链私有 flag 已翻译/剥离,
 *     C51/STM8 等家族注入关键字宏与兼容头,shim 存放于 `.eide/clangd/`);
 *  2. 维护 clangd 用户级 config.yaml 的受管配置块(PathMatch 定界 + 幂等更新 + 僵尸块回收);
 *     CompilationDatabase 指针指向 `<root>/.clangd`(按项目隔离,多项目可各指各的布局);
 *  3. 维护工作区 clangd.arguments(--clang-tidy=false / --header-insertion=never;
 *     background-index 不干预——clangd 默认开启,后台索引跟随 CDB 目录自动落在
 *     `<root>/.clangd/.cache/`,配合 files.exclude 收纳为不可见)与 files.exclude(`.clangd`);
 *  4. 迁移旧版 EIDE 生成的项目级 `.clangd`(它会在 clangd 侧覆盖用户级 config.yaml,与新管线冲突;
 *     迁移先于目录创建执行,腾出 `.clangd` 目录名);
 *  5. 升级清理:删除旧版按 target 预生成的 `.eide-clangd/` 目录与根目录散落的旧库/旧 `.cache`。
 *
 * 由 AbstractProject.UpdateCppConfig 防抖触发(始终开启,原 EIDE.Option.EnableClangdConfigGenerator 开关已移除)。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AbstractProject } from './EIDEProject';
import { SettingManager } from './SettingManager';
import { GlobalEvent } from './GlobalEvents';
import { BuilderOptions } from './EIDETypeDefine';
import { ToolchainManager, ToolchainName } from './ToolchainManager';
import { collectExternalSourceRoots } from './ProjectRootTool';
import {
    buildClangdCommandTokens,
    buildClangdContextForTarget,
    toCompilationDatabaseEntry,
    getProjectDbPath,
    getProjectDbDir,
    asCompileCommandFile,
    isSupportedSourceFile,
    createUserConfigPathMatch,
    createManagedConfigToken,
    renderClangdUserConfigBlock,
    upsertManagedConfigBlock,
    removeManagedConfigBlocks,
    extractManagedBlockInfo,
    upsertClangdWorkspaceArgs,
    isC51Toolchain,
    isStm8Toolchain,
    isAc5Toolchain,
    resolveCompatShimKind,
} from './clangdSupport';

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

/** 工具链关键字 shim 的存放目录:`.eide/clangd/`(库本身已上移项目根,shim 不再跟库同目录) */
function getClangdShimDir(prj: AbstractProject): string {
    return path.join(prj.getEideDir().path, 'clangd');
}

function writeIfChanged(filePath: string, content: string): boolean {
    try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
            return false;
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
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

    const dbPath = getProjectDbPath(rootDir);
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
        { p: path.join(rootDir, 'compile_commands.json'), note: `legacy root-level compile_commands.json` },
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
// 2. clangd user config.yaml (managed blocks)
// ---------------------------------------------------------------------------

/** clangd 无法解析的基础 Remove 列表(第二道防线,覆盖非本扩展生成的命令) */
const BASE_REMOVE_FLAGS = [
    '--depend', '--depend=*', '--no_depend_system_headers',
    '-fno-shrink-wrap', '-fstrict-volatile-bitfields', '-fno-tree-switch-conversion',
    '-fzero-init-padding-bits=all', '-fzero-init-padding-bits=*', '-fno-malloc-dce'
];

function updateClangdUserConfig(prj: AbstractProject, toolchainName: string, activeTargetKey: string): boolean {
    const configDir = getClangdUserConfigDir();
    if (!configDir) { return false; }

    const configPath = path.join(configDir, 'config.yaml');
    const rootDir = prj.getProjectRoot().path;
    const token = createManagedConfigToken(rootDir);
    // 指针恒定:CompilationDatabase 固定指向 `<root>/.clangd`(其下的 compile_commands.json 即
    // 收拢目录单文件库,后台索引 .cache 也随 CDB 目录落在 .clangd/.cache/),切换 target 由
    // 重生成库内容承担,不再翻指针。库文件尚不存在(项目从未构建)时不写新块,但先做僵尸块回收,
    // 清掉指向已删除 `.eide-clangd/...` 的旧受管块
    const dbPath = getProjectDbPath(rootDir);
    // PathMatch 覆盖:项目根 + 根外源码/包含目录(如 PROJ_A 项目的 ../Library、../EXTEND),
    // 否则根外源文件不会被 clangd 命中而回退到启发式解析
    const pathRoots = [rootDir, ...collectExternalSourceRoots(prj.GetConfiguration<any>().config, rootDir)];
    const pathMatches = pathRoots.map((root) => createUserConfigPathMatch(root));

    let existingContent = '';
    try {
        if (fs.existsSync(configPath)) { existingContent = fs.readFileSync(configPath, 'utf8'); }
    } catch (error) {
        GlobalEvent.log_error(error);
        return false;
    }

    // 僵尸块回收:编译数据库文件已不存在的受管块直接移除。
    // 放在 db-exists 早退之前:升级首跑根库尚未生成时也能清掉旧 `.eide-clangd/...` 块
    let content = existingContent;
    for (const info of extractManagedBlockInfo(content)) {
        if (info.compilationDatabase && !fs.existsSync(info.compilationDatabase)) {
            content = removeManagedConfigBlocks(content, info.token);
        }
    }

    // 异前缀孤儿块清理:历史版本/官方版曾用 `EIDE Clangd Sync` 前缀写同项目块,
    // 本管线(Support 前缀)无法 upsert 覆盖它,两个块同时命中会让 clangd 的
    // CompilationDatabase 打架(实测:孤儿块指向已删除的 .eide-clangd,新布局库被截胡)。
    // 仅当孤儿块指向的库目录已不存在时移除;指向有效目录的块(如在用配置)保留。
    const orphanSyncRe = new RegExp(
        `# BEGIN EIDE Clangd Sync ${token}[\\s\\S]*?# END EIDE Clangd Sync ${token}\\s*`, 'g');
    content = content.replace(orphanSyncRe, (orphan) => {
        const dbMatch = /CompilationDatabase:\s*"([^"]+)"/.exec(orphan);
        return (dbMatch && fs.existsSync(dbMatch[1])) ? orphan : '';
    });

    if (!fs.existsSync(dbPath)) {
        // 根库尚未生成:只落盘回收结果(若有变化),不写新块
        return content !== existingContent ? writeIfChanged(configPath, content) : false;
    }

    const block = renderClangdUserConfigBlock({
        pathMatch: pathMatches,
        compilationDatabase: toPosix(getProjectDbDir(rootDir)),
        token,
        activeTargetKey,
        addFlags: [],
        removeFlags: BASE_REMOVE_FLAGS,
        suppressDiagnostics: isDiagnosticUnsupportedToolchain(toolchainName) ? ['*'] : ['unused-includes']
    });

    const nextContent = upsertManagedConfigBlock(content, block, token);
    return writeIfChanged(configPath, nextContent);
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
 * 维护工作区 files.exclude:只隐藏 `<root>/.clangd/compile_commands.json`(大体积库文件),
 * `.clangd/.cache/` 后台索引与目录本身保持可见(便于观察索引状态)。
 * 顺带迁移旧键(整目录隐藏的 dot-clangd,会把 .cache 连带藏掉)。
 * 与 arguments 同款双写语义:已定义的作用域合并补键(不覆盖用户已有排除项),
 * 两个作用域都未定义时落到 folder 级。
 */
function updateClangdWorkspaceFileExclude(prj: AbstractProject): boolean {
    const uri = vscode.Uri.file(prj.getProjectRoot().path);
    const filesConfig = vscode.workspace.getConfiguration('files', uri);
    const inspect = filesConfig.inspect<Record<string, boolean>>('exclude');
    const EXCLUDE_KEY = '**/.clangd/compile_commands.json';
    const LEGACY_KEY = '**/.clangd';

    const nextValue = (stored: Record<string, boolean> | undefined): Record<string, boolean> => {
        const merged: Record<string, boolean> = { ...(stored || {}) };
        delete merged[LEGACY_KEY]; // 迁移:不再整目录隐藏
        merged[EXCLUDE_KEY] = true;
        return merged;
    };

    const differs = (stored: Record<string, boolean> | undefined): boolean => {
        const wanted = nextValue(stored);
        const cur = stored || {};
        // 只要还有旧的整目录键、或缺少库文件键,就需要写
        return cur[LEGACY_KEY] === true || cur[EXCLUDE_KEY] !== true
            || Object.keys(cur).length !== Object.keys(wanted).length;
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

/** 在配置变更后尝试唤醒 clangd(优先温和的重载命令) */
export async function tryRestartClangd(): Promise<boolean> {
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
}

export interface RebuildClangdCacheResult {
    targetName: string;
    entries: number;
    cacheCleared: boolean;
}

/**
 * 重建 clangd 缓存(维修通道):删 `<root>/.clangd/` 整目录(库 + 后台索引 `.cache` 一锅端)
 * + 旧布局残留(根目录库/`.cache`/`.eide-clangd/`)→ 走重生全链路 → 唤醒 clangd。
 * 日常增删文件走自动管线,不需要它;库损坏/换代残留时用它一键恢复(幂等,可重跑)。
 */
export function rebuildClangdCache(prj: AbstractProject): RebuildClangdCacheResult {
    const rootDir = prj.getProjectRoot().path;
    const targetName = prj.getCurrentTarget();

    let cacheCleared = false;
    try {
        const managedDir = getProjectDbDir(rootDir);
        if (fs.existsSync(managedDir)) {
            fs.rmSync(managedDir, { recursive: true, force: true });
            cacheCleared = true;
        }
    } catch (error) {
        GlobalEvent.log_error(error);
    }
    cacheCleared = cleanupLegacyClangdArtifacts(prj) || cacheCleared;

    const entries = generateDbForTarget(prj, targetName);
    updateClangdUserConfig(prj, prj.getToolchain().name, targetName);
    updateClangdWorkspaceSettings(prj);
    updateClangdWorkspaceFileExclude(prj);
    void tryRestartClangd();

    return { targetName, entries: Math.max(entries, 0), cacheCleared };
}

/** clangd 支持总入口:由 AbstractProject.UpdateCppConfig 防抖触发 */
export function updateClangdIntegration(prj: AbstractProject): void {

    const tStart = Date.now();
    try {
        const toolchainName = prj.getToolchain().name;
        const activeTargetKey = prj.getCurrentTarget();

        cleanupLegacyClangdArtifacts(prj); // 升级清理旧布局残留(.eide-clangd/根库/根 .cache),不计入 changed
        let changed = migrateLegacyClangdConfig(prj);
        changed = generateClangdCompilationDatabase(prj) || changed;
        changed = updateClangdUserConfig(prj, toolchainName, activeTargetKey) || changed;
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
