/**
 * Project root locating / relocating tools.
 *
 * 无 vscode 依赖,可单元测试:
 *  1. 根目搜索:isProjectRoot / findProjectRootUp / findProjectRootsUnder
 *     (支持诡异布局:.eide 与 Keil 工程不同级、多项目同级共享父目录、深嵌套);
 *  2. 路径机械重写:adjustRelativePath / rewriteConfigRelativePaths
 *     (项目根移动时按层级差增删 `../` 前缀,无法机械处理的内容原样保留);
 *  3. 外部引用体检:auditExternalReferences
 *     (列出所有出根引用、存在性,识别公用目录与断链——如 PROJ_A 项目的 `../Library`)。
 */
import * as fs from 'fs';
import * as path from 'path';

const EIDE_DIR = '.eide';
const PROJECT_FILE_NAMES = ['eide.yml', 'eide.json'];

// ---------------------------------------------------------------------------
// 1. root searching
// ---------------------------------------------------------------------------

export function isProjectRoot(dir: string): boolean {
    for (const name of PROJECT_FILE_NAMES) {
        if (fs.existsSync(path.join(dir, EIDE_DIR, name))) { return true; }
    }
    return false;
}

/**
 * 从 `fromDir` 逐级向上搜索最近的项目根。
 * @param opts.maxDepth 最多向上遍历的层数(默认 16)
 */
export function findProjectRootUp(fromDir: string, opts?: { maxDepth?: number }): string | undefined {
    const maxDepth = opts?.maxDepth ?? 16;
    let current = path.resolve(fromDir);

    for (let depth = 0; depth <= maxDepth; depth++) {
        if (isProjectRoot(current)) { return current; }
        const parent = path.dirname(current);
        if (parent === current) { break; } // filesystem root
        current = parent;
    }
    return undefined;
}

/**
 * 在 `rootDir` 下递归搜索所有项目根(找到项目根后不再向其内部下钻)。
 * @param opts.maxDepth   最大下钻深度(默认 8)
 * @param opts.maxResults 最大结果数(默认 64)
 */
export function findProjectRootsUnder(rootDir: string, opts?: { maxDepth?: number; maxResults?: number }): string[] {
    const maxDepth = opts?.maxDepth ?? 8;
    const maxResults = opts?.maxResults ?? 64;
    const results: string[] = [];

    const walk = (dir: string, depth: number): void => {
        if (results.length >= maxResults || depth > maxDepth) { return; }

        if (isProjectRoot(dir)) {
            results.push(dir);
            return; // 不在项目内部继续找项目
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }
            if (entry.name.startsWith('.') || entry.name === 'node_modules') { continue; }
            walk(path.join(dir, entry.name), depth + 1);
            if (results.length >= maxResults) { return; }
        }
    };

    walk(path.resolve(rootDir), 0);
    return results;
}

// ---------------------------------------------------------------------------
// 2. mechanical path rewriting
// ---------------------------------------------------------------------------

/**
 * 项目根上移/下移 levelDelta 层时,按机械规则调整相对路径:
 *  - delta > 0(根上移):剥掉 delta 个 `../` 前缀(不足则原样返回,交由体检报告);
 *  - delta < 0(根下移):前面补 |delta| 个 `../`;
 *  - 绝对路径与空串原样返回。
 */
export function adjustRelativePath(p: string, levelDelta: number): string {
    const raw = String(p || '');
    if (levelDelta === 0 || raw === '' || path.isAbsolute(raw)) { return raw; }

    if (levelDelta > 0) {
        const match = raw.match(/^((?:\.\.\/|\.\.\\)*)/);
        const prefixCount = match ? (match[1].length / 3) : 0;
        if (prefixCount < levelDelta) { return raw; } // 无法机械重写,交由报告
        return raw.slice(levelDelta * 3);
    }

    // levelDelta < 0:根下移,所有相对路径都补 ../ 前缀(先去掉 './' 前缀)
    const prefix = '../'.repeat(-levelDelta);
    const clean = (/^(\.\/|\.\\)/.test(raw)) ? raw.slice(2) : raw;
    return prefix + clean;
}

/** 需要重写的配置字段中的路径收集/回写描述 */
interface PathRef {
    get(): string[];
    set(values: string[]): void;
}

function collectPathRefs(configData: any): PathRef[] {
    const refs: PathRef[] = [];
    const targets = configData?.targets || {};

    refs.push({
        get: () => (Array.isArray(configData?.srcDirs) ? configData.srcDirs : []),
        set: (v) => { configData.srcDirs = v; }
    });

    // virtual folder files (recursive)
    const walkFolder = (folder: any): void => {
        if (!folder) { return; }
        if (Array.isArray(folder.files)) {
            folder.files.forEach((f: any, i: number) => {
                refs.push({
                    get: () => [f.path],
                    set: (v) => { folder.files[i].path = v[0]; }
                });
            });
        }
        for (const sub of folder.folders || []) { walkFolder(sub); }
    };
    walkFolder(configData?.virtualFolder);

    for (const name in targets) {
        const target = targets[name];
        const dep = target?.cppPreprocessAttrs;
        if (dep) {
            refs.push({ get: () => dep.incList || [], set: (v) => { dep.incList = v; } });
            refs.push({ get: () => dep.libList || [], set: (v) => { dep.libList = v; } });
        }
        // scatter file(ARM toolchainConfig)
        const tc = target?.toolchainConfig;
        if (tc && typeof tc.scatterFilePath === 'string') {
            refs.push({
                get: () => [tc.scatterFilePath],
                set: (v) => { tc.scatterFilePath = v[0]; }
            });
        }
    }

    return refs;
}

/**
 * 对运行时配置做机械路径重写(项目根移动 levelDelta 层)。
 * 已知路径字段:srcDirs / virtualFolder files / cppPreprocessAttrs.incList·libList /
 * toolchainConfig.scatterFilePath;beforeBuildTasks 等命令串中的路径无法机械识别,
 * 需由外部体检报告提示。
 *
 * @returns 无法机械重写而保持原样的路径列表
 */
export function rewriteConfigRelativePaths(configData: any, levelDelta: number): { unrewritten: string[] } {
    const unrewritten: string[] = [];
    if (levelDelta === 0) { return { unrewritten }; }

    for (const ref of collectPathRefs(configData)) {
        const values = ref.get();
        if (!values.length) { continue; }
        const adjusted = values.map((p) => {
            const next = adjustRelativePath(p, levelDelta);
            if (next === p && levelDelta > 0 && !path.isAbsolute(p) && /^(\.\.\/|\.\.\\)/.test(p)) {
                unrewritten.push(p);
            }
            return next;
        });
        ref.set(adjusted);
    }

    return { unrewritten };
}

/**
 * 计算项目根移动的层级差:
 *  - 返回值 > 0:根上移(newRoot 是 oldRoot 的祖先),相对路径剥掉相应 `../` 前缀;
 *  - 返回值 < 0:根下移(newRoot 在 oldRoot 内部),相对路径补 `../` 前缀;
 *  - 返回 0:同一目录;
 *  - 返回 undefined:无祖先关系(如平级移动),无法机械重写。
 */
export function computeLevelDelta(oldRoot: string, newRoot: string): number | undefined {
    const oldAbs = path.resolve(oldRoot);
    const newAbs = path.resolve(newRoot);
    if (oldAbs === newAbs) { return 0; }

    const rel = path.relative(oldAbs, newAbs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return -rel.split(/[\\/]+/).filter(Boolean).length; // 根下移
    }

    const relBack = path.relative(newAbs, oldAbs);
    if (relBack && !relBack.startsWith('..') && !path.isAbsolute(relBack)) {
        return relBack.split(/[\\/]+/).filter(Boolean).length; // 根上移
    }

    return undefined;
}

/**
 * 收集配置中引用的、位于项目根之外的源码/包含目录(绝对路径、去重)。
 * 用于 clangd config.yaml 的 PathMatch 覆盖(如 PROJ_A 项目的 ../Library、../EXTEND)。
 */
export function collectExternalSourceRoots(configData: any, rootDir: string): string[] {
    const normalizedRoot = path.resolve(rootDir);
    const roots: string[] = [];
    const seen = new Set<string>();

    const addDir = (dir: string): void => {
        const resolved = path.resolve(dir);
        const rel = path.relative(normalizedRoot, resolved);
        if (!rel.startsWith('..') || path.isAbsolute(rel)) { return; } // root 内部不需要单独覆盖
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) { return; }
        seen.add(key);
        roots.push(resolved);
    };

    /** srcDirs / incList / libList 中的条目本身就是目录 */
    const addDirRef = (rawPath: string): void => {
        const raw = String(rawPath || '').trim();
        if (!raw) { return; }
        addDir(path.isAbsolute(raw) ? raw : path.resolve(normalizedRoot, raw));
    };

    /** virtualFolder 中的条目是文件,取其所在目录 */
    const addFileRef = (rawPath: string): void => {
        const raw = String(rawPath || '').trim();
        if (!raw) { return; }
        addDir(path.dirname(path.isAbsolute(raw) ? raw : path.resolve(normalizedRoot, raw)));
    };

    (configData?.srcDirs || []).forEach((p: string) => addDirRef(p));

    const walkFolder = (folder: any): void => {
        if (!folder) { return; }
        for (const f of folder.files || []) { addFileRef(f.path); }
        for (const sub of folder.folders || []) { walkFolder(sub); }
    };
    walkFolder(configData?.virtualFolder);

    for (const name in configData?.targets || {}) {
        const dep = configData.targets[name]?.cppPreprocessAttrs;
        if (dep) {
            (dep.incList || []).forEach((p: string) => addDirRef(p));
            (dep.libList || []).forEach((p: string) => addDirRef(p));
        }
    }

    return roots;
}

// ---------------------------------------------------------------------------
// 3. external reference auditing
// ---------------------------------------------------------------------------

export interface ReferenceAuditItem {
    /** 配置中的原始写法 */
    rawPath: string;
    /** 相对项目根解析后的绝对路径 */
    resolvedPath: string;
    /** 解析目标是否存在(断链检测) */
    exists: boolean;
    /** 是否为出根引用(即指向项目根之外的"外部/公用"目录) */
    isExternal: boolean;
    /** 引用所在字段,如 'srcDirs' / 'targets.Debug.cppPreprocessAttrs.incList' */
    field: string;
}

/**
 * 体检项目配置中的全部相对路径引用:
 *  - 出根引用(解析后位于项目根之外)= 外部/公用目录;
 *  - 不存在的引用 = 断链(如 PROJ_A 项目的 `../Library`);
 *  - 项目内引用不进入报告。
 */
export function auditExternalReferences(
    configData: any,
    rootDir: string,
    exists: (absPath: string) => boolean
): ReferenceAuditItem[] {
    const report: ReferenceAuditItem[] = [];
    const normalizedRoot = path.resolve(rootDir);
    const seen = new Set<string>();

    const push = (rawPath: string, field: string): void => {
        const raw = String(rawPath || '').trim();
        if (!raw || path.isAbsolute(raw)) { return; }

        const resolved = path.resolve(normalizedRoot, raw);
        const relFromRoot = path.relative(normalizedRoot, resolved);
        const isExternal = relFromRoot.startsWith('..') && !path.isAbsolute(relFromRoot);
        if (!isExternal) { return; } // 项目内引用不在报告范围

        const key = `${raw}|${field.split('.')[0]}`;
        if (seen.has(key)) { return; }
        seen.add(key);

        report.push({
            rawPath: raw,
            resolvedPath: resolved,
            exists: exists(resolved),
            isExternal,
            field
        });
    };

    const targets = configData?.targets || {};

    (configData?.srcDirs || []).forEach((p: string) => push(p, 'srcDirs'));

    const walkFolder = (folder: any, field: string): void => {
        if (!folder) { return; }
        for (const f of folder.files || []) { push(f.path, `${field}.files`); }
        for (const sub of folder.folders || []) { walkFolder(sub, `${field}.folders`); }
    };
    walkFolder(configData?.virtualFolder, 'virtualFolder');

    for (const name in targets) {
        const target = targets[name];
        const dep = target?.cppPreprocessAttrs;
        if (dep) {
            (dep.incList || []).forEach((p: string) => push(p, `targets.${name}.cppPreprocessAttrs.incList`));
            (dep.libList || []).forEach((p: string) => push(p, `targets.${name}.cppPreprocessAttrs.libList`));
        }
    }

    return report;
}
