/**
 * Project root locating / relocating tools.
 *
 * 无 vscode 依赖,可单元测试:
 *  1. 根目搜索:isProjectRoot / findProjectRootUp / findProjectRootsUnder
 *     (支持诡异布局:.eide 与 Keil 工程不同级、多项目同级共享父目录、深嵌套);
 *  2. 路径机械重写:adjustRelativePath / rewriteConfigRelativePaths
 *     (项目根移动时按层级差增删 `../` 前缀,无法机械处理的内容原样保留);
 *     rewriteEmbeddedAbsolutePaths 负责 JSON/JSONC 文本(如 `.code-workspace`、
 *     `.vscode/settings.json`)中内嵌的绝对路径,按新根重新定位;
 *  3. 外部引用体检:auditExternalReferences
 *     (列出所有出根引用、存在性,识别公用目录与断链(实测背景:构建目录做根的工程里 `../Library` 一类公用库引用))。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc_parser from 'jsonc-parser';
import { EIDE_DIR, PROJECT_CONFIG_FILE_NAMES } from './ProjectConsts';

// ---------------------------------------------------------------------------
// 1. root searching
// ---------------------------------------------------------------------------

export function isProjectRoot(dir: string): boolean {
    for (const name of PROJECT_CONFIG_FILE_NAMES) {
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
 * 用于 clangd config.yaml 的 PathMatch 覆盖(如构建目录做根的工程里 ../Library 一类公用目录)。
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
 *  - 不存在的引用 = 断链(实测背景:公用库目录被移走后的 `../Library`);
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

// ---------------------------------------------------------------------------
// 4. embedded absolute path rewriting (JSON / JSONC documents)
// ---------------------------------------------------------------------------

function toUnixLower(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * 把单个字符串字面量中的项目根绝对路径前缀替换为新根。
 *
 * 返回 undefined 表示无需改动。只替换"路径前缀 + 边界"的形态
 * (`D:/old/root/x` → `D:/new/root/x`),避免把 `D:/old/root2` 这类
 * 同前缀但不同目录的路径误伤;分隔符与大小写在 Windows 上不敏感,
 * 替换文本沿用原值的分隔符风格(原值用 `\` 就写回 `\`)。
 *
 * 一个字面量里可能出现**多段**路径(如 `--query-driver=a;b` 形式的多值参数),
 * 因此逐段扫描替换,而不是只处理第一处。
 */
export function retargetAbsolutePath(value: string, oldRoot: string, newRoot: string): string | undefined {
    const raw = String(value || '');
    if (!raw) { return undefined; }

    const normalizedOld = toUnixLower(path.resolve(oldRoot)).replace(/\/$/, '');
    if (!normalizedOld) { return undefined; }

    const resolvedNew = path.resolve(newRoot);
    const replacement = raw.includes('\\') ? resolvedNew : resolvedNew.replace(/\\/g, '/');
    const normalizedRaw = toUnixLower(raw);

    let result = '';
    let cursor = 0;
    let searchFrom = 0;
    let changed = false;

    while (searchFrom < normalizedRaw.length) {
        const index = normalizedRaw.indexOf(normalizedOld, searchFrom);
        if (index === -1) { break; }

        const afterIndex = index + normalizedOld.length;
        // 前缀必须落在路径边界上:起点即开头或紧跟在非路径字符之后,
        // 终点即原文末尾或下一个分隔符(防止 'root' 命中 'root2')
        const before = index === 0 ? '' : raw[index - 1];
        const after = afterIndex < raw.length ? raw[afterIndex] : '';
        const onBoundary = (!before || /[\s"'=,:;(\[{]/.test(before)) && (!after || after === '/' || after === '\\');

        if (onBoundary) {
            result += raw.slice(cursor, index) + replacement;
            cursor = afterIndex;
            changed = true;
        }
        searchFrom = afterIndex;
    }

    if (!changed) { return undefined; }
    result += raw.slice(cursor);
    return result === raw ? undefined : result;
}

export interface EmbeddedPathRewriteResult {
    /** 重写后的文档文本(无改动时与输入完全相同) */
    content: string;
    /** 被改写的字段路径(如 `settings.clangd.arguments[0]`),供日志/提示 */
    rewritten: { path: string; before: string; after: string }[];
}

/**
 * 重写 JSON/JSONC 文档中内嵌的项目根绝对路径(项目根移动时使用)。
 *
 * 覆盖 `.code-workspace` 与 `.vscode/settings.json` 这类"配置里写死绝对路径"
 * 的场景:前者内嵌 settings(如 `clangd.arguments` 的 `--query-driver=<abs>`),
 * 后者可能持有路径型选项。采用 jsonc-parser 的 AST 定位 + applyEdits,
 * 只改动字符串字面量本身,注释与缩进原样保留;解析失败时原样返回(不冒险重写)。
 *
 * 注意:`modify()` 返回的是**针对原文**的编辑数组,必须全部收集后一次性
 * 交给 `applyEdits`(它按偏移倒序应用);对同一份原文逐个应用会因偏移失效
 * 而抛 'Overlapping edit'。
 *
 * 无改动 / 文档损坏 / 编辑冲突时一律原样返回 `text`,调用方据 `rewritten` 判断。
 */
export function rewriteEmbeddedAbsolutePaths(
    content: string,
    oldRoot: string,
    newRoot: string
): EmbeddedPathRewriteResult {
    const text = String(content || '');
    if (!text || toUnixLower(oldRoot) === toUnixLower(newRoot)) {
        return { content: text, rewritten: [] };
    }

    const rewritten: EmbeddedPathRewriteResult['rewritten'] = [];
    const edits: jsonc_parser.Edit[] = [];

    // 先校验文档:visit 对残缺输入不抛异常,只会"尽力"报告看到的字面量,
    // 直接重写会在损坏的文件上动手脚。宁可原样返回,也不写坏用户配置。
    const parseErrors: jsonc_parser.ParseError[] = [];
    jsonc_parser.parse(text, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length > 0) {
        return { content: text, rewritten: [] };
    }

    try {
        jsonc_parser.visit(text, {
            onLiteralValue: (
                value: unknown,
                _offset: number,
                _length: number,
                _startLine: number,
                _startCharacter: number,
                pathSupplier: () => jsonc_parser.JSONPath
            ) => {
                if (typeof value !== 'string') { return; }
                const next = retargetAbsolutePath(value, oldRoot, newRoot);
                if (next === undefined) { return; }
                const path = pathSupplier();
                edits.push(...jsonc_parser.modify(text, path, next, {
                    formattingOptions: { insertSpaces: true, tabSize: 4 }
                }));
                rewritten.push({
                    path: path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : String(segment))).join('.'),
                    before: value,
                    after: next
                });
            }
        });
    } catch {
        return { content: text, rewritten: [] }; // 非法 JSONC:保持原样,交由调用方提示
    }

    if (edits.length === 0) { return { content: text, rewritten: [] }; }

    try {
        return { content: jsonc_parser.applyEdits(text, edits), rewritten };
    } catch {
        return { content: text, rewritten: [] }; // 编辑冲突:宁可不改,也不写坏用户配置
    }
}

