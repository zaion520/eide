#!/usr/bin/env node
/**
 * 依赖分析工具 —— 架构重构(断环)的度量与验收依据。
 *
 * 用法:
 *   node scripts/analyze-deps.mjs              # 概览 + SCC + 最小断边集
 *   node scripts/analyze-deps.mjs --vscode     # 额外列出直接 import vscode 的文件
 *   node scripts/analyze-deps.mjs --node <f>   # 单模块影响分析: 去掉该文件后 SCC 如何变化
 *   node scripts/analyze-deps.mjs --edges      # 打印全部 SCC 内部边
 *
 * 指标说明:
 *   - SCC(强连通分量) 才是"环"的本质; 环数会因起点不同重复计数, 没有意义
 *   - 最小反馈边集 = 贪心求出的"最少切断多少条 import 边可让 SCC 全部消失"
 *   - 分层违规: 低层模块 import 高层 / 领域模块 import vscode
 *
 * 实现要点: 用 TypeScript 官方解析器提取 import(而非正则/手写扫描),
 * 能正确识别 `import type`(纯类型引用, 编译后不产生运行时依赖)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = 'src';
const argv = process.argv.slice(2);
const FLAG_VSCODE = argv.includes('--vscode');
const FLAG_EDGES = argv.includes('--edges');
const nodeIdx = argv.indexOf('--node');
const TARGET_NODE = nodeIdx >= 0 ? argv[nodeIdx + 1] : undefined;

/** 可接受"直接依赖 vscode"的层级(L3 编排/UI 装配层) */
const VSCODE_ALLOWED = new Set([
    'src/extension.ts',
    'src/EIDEProjectExplorer.ts',
    'src/OperationExplorer.ts',
    'src/BuildAllStatus.ts',
    'src/StatusBarManager.ts',
    'src/WebPanelManager.ts',
    'src/ProblemMatcher.ts',
    'src/VirtualDocsProvider.ts',
    'src/SimpleUIDef.ts',
    'src/ToolchainLicenceActivate.ts',
    'src/WorkspaceManager.ts',
    'src/MCPServer.ts'
]);

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== 'node_modules') { walk(p, out); }
        } else if (e.name.endsWith('.ts')) {
            out.push(p.split(path.sep).join('/'));
        }
    }
    return out;
}

/**
 * 收集文件内的标识符: 全部位置 + "类型位置"的位置集合。
 *
 * 用于判定某个具名导入是否**语义上纯类型**(只在类型标注/继承/泛型里出现)。
 * 纯类型边可以把声明搬到 `src/types/` 叶子模块, 从而零运行时成本断环。
 */
function collectIdentifiers(sf) {
    const all = new Map();      // pos -> name
    const typeIds = new Set();  // pos (位于类型上下文的标识符)
    const isTypeCtx = (node) =>
        ts.isTypeNode(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isImportDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isExportDeclaration(node) ||
        ts.isExportSpecifier(node);

    const visit = (node, inType) => {
        const nowType = inType || isTypeCtx(node);
        if (ts.isIdentifier(node)) {
            all.set(node.getStart(sf), node.text);
            if (nowType) { typeIds.add(node.getStart(sf)); }
        }
        ts.forEachChild(node, c => visit(c, nowType));
    };
    visit(sf, false);

    const byName = new Map();
    for (const [pos, name] of all) {
        if (!byName.has(name)) { byName.set(name, []); }
        byName.get(name).push(pos);
    }
    return { byName, typeIds };
}

/** 用 TS 解析器提取依赖边 */
function buildGraph(files) {
    const fileSet = new Set(files);
    const dep = new Map();          // from -> [{to, line, typeOnly}]
    const vscodeImporters = [];

    for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
        const ids = collectIdentifiers(sf);
        const list = [];

        for (const stmt of sf.statements) {
            const isImport = ts.isImportDeclaration(stmt);
            const isExport = ts.isExportDeclaration(stmt);
            if (!isImport && !isExport) { continue; }
            const spec = stmt.moduleSpecifier;
            if (!spec || !ts.isStringLiteral(spec)) { continue; }

            const raw = spec.text;
            const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;

            if (raw === 'vscode') {
                vscodeImporters.push({ file: f, line });
                continue;
            }
            if (!raw.startsWith('.')) { continue; }

            const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), raw));
            const to = [base + '.ts', base + '/index.ts', base].find(c => fileSet.has(c));
            if (!to) { continue; }

            // 语义判定: 显式 import type, 或所有具名绑定都只出现在类型位置
            let typeOnly = false;
            if (isImport && stmt.importClause) {
                const ic = stmt.importClause;
                if (ic.isTypeOnly) {
                    typeOnly = true;
                } else {
                    const bindings = [];
                    if (ic.name) { bindings.push(ic.name.text); }
                    if (ic.namedBindings) {
                        if (ts.isNamespaceImport(ic.namedBindings)) {
                            bindings.push(ic.namedBindings.name.text);
                        } else {
                            for (const el of ic.namedBindings.elements) { bindings.push(el.name.text); }
                        }
                    }
                    if (bindings.length) {
                        typeOnly = bindings.every(n => {
                            const poss = ids.byName.get(n) || [];
                            if (!poss.length) { return true; }   // 未被使用
                            return poss.every(p => ids.typeIds.has(p));
                        });
                    }
                }
            } else if (isExport) {
                typeOnly = !!stmt.isTypeOnly;
            }

            list.push({ to, line, typeOnly });
        }
        dep.set(f, list);
    }
    return { dep, vscodeImporters };
}

/** Tarjan 强连通分量 */
function findSCCs(files, dep) {
    const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    const out = [];
    let counter = 0;

    const strong = (v) => {
        index.set(v, counter); low.set(v, counter); counter++;
        stack.push(v); onStack.add(v);
        for (const e of (dep.get(v) || [])) {
            if (!index.has(e.to)) {
                strong(e.to);
                low.set(v, Math.min(low.get(v), low.get(e.to)));
            } else if (onStack.has(e.to)) {
                low.set(v, Math.min(low.get(v), index.get(e.to)));
            }
        }
        if (low.get(v) === index.get(v)) {
            const comp = [];
            for (;;) {
                const w = stack.pop(); onStack.delete(w); comp.push(w);
                if (w === v) { break; }
            }
            if (comp.length > 1) { out.push(comp); }
        }
    };

    for (const f of files) { if (!index.has(f)) { strong(f); } }
    return out.sort((a, b) => b.length - a.length);
}

/** 从依赖图中删掉指定边 */
function withoutEdges(files, dep, removed) {
    const g = new Map();
    for (const f of files) {
        g.set(f, (dep.get(f) || []).filter(e => !removed.has(f + ' -> ' + e.to)));
    }
    return g;
}

/** 贪心最小反馈边集 */
function minFeedbackEdges(files, dep) {
    const removed = new Set();
    const sizes = () => findSCCs(files, withoutEdges(files, dep, removed));
    const score = (sccs) => sccs.reduce((a, c) => a + c.length * c.length, 0);

    for (;;) {
        const sccs = sizes();
        if (!sccs.length) { break; }
        const comp = new Set(sccs[0]);
        const inner = [];
        for (const u of comp) {
            for (const e of (dep.get(u) || [])) {
                if (comp.has(e.to) && !removed.has(u + ' -> ' + e.to)) {
                    inner.push({ from: u, to: e.to, line: e.line });
                }
            }
        }
        if (!inner.length) { break; }

        let best = null;
        for (const cand of inner) {
            const trial = new Set(removed); trial.add(cand.from + ' -> ' + cand.to);
            const sc = score(findSCCs(files, withoutEdges(files, dep, trial)));
            if (best === null || sc < best.sc) { best = { sc, cand }; }
        }
        removed.add(best.cand.from + ' -> ' + best.cand.to);
    }
    return removed;
}

// ---------------------------------------------------------------------------

const files = walk(ROOT).sort();
const { dep, vscodeImporters } = buildGraph(files);

const totalEdges = [...dep.values()].reduce((a, l) => a + l.length, 0);
const typeOnlyEdges = [...dep.values()].flat().filter(e => e.typeOnly).length;

console.log('='.repeat(72));
console.log('依赖基线');
console.log('='.repeat(72));
console.log('  模块数            : ' + files.length);
console.log('  模块间依赖边      : ' + totalEdges + '  (其中 type-only ' + typeOnlyEdges + ')');
console.log('  直接 import vscode: ' + new Set(vscodeImporters.map(v => v.file)).size + ' 个文件');

// ---- 单模块影响分析 ----
if (TARGET_NODE) {
    const t = TARGET_NODE.split(path.sep).join('/');
    const rest = files.filter(f => f !== t);
    const restDep = new Map([...dep].filter(([k]) => k !== t));
    const before = findSCCs(files, dep);
    const after = findSCCs(rest, restDep);
    const inSize = before.length ? before[0].length : 0;
    const afterSize = after.length ? after[0].length : 0;
    console.log('');
    console.log('--- 单模块影响: 移除 ' + t + ' ---');
    console.log('  移除前最大 SCC: ' + inSize + ' 文件');
    console.log('  移除后最大 SCC: ' + afterSize + ' 文件' + (afterSize === 0 ? '  (完全断开!)' : ''));
    const outDeg = (dep.get(t) || []).length;
    const inDeg = files.reduce((a, f) => a + (dep.get(f) || []).filter(e => e.to === t).length, 0);
    console.log('  该文件出度/入度: ' + outDeg + ' / ' + inDeg);
    console.log('  它的出边:');
    for (const e of (dep.get(t) || [])) {
        console.log('    ' + t + ':' + e.line + ' -> ' + e.to + (e.typeOnly ? '   [type-only]' : ''));
    }
    process.exit(0);
}

// ---- SCC ----
const sccs = findSCCs(files, dep);
const core = sccs.length ? new Set(sccs[0]) : new Set();

// 剥掉"纯类型边"后的运行时依赖图
const runtimeDep = new Map();
for (const f of files) {
    runtimeDep.set(f, (dep.get(f) || []).filter(e => !e.typeOnly));
}
const runtimeSccs = findSCCs(files, runtimeDep);
const runtimeCore = runtimeSccs.length ? new Set(runtimeSccs[0]) : new Set();

console.log('');
console.log('='.repeat(72));
console.log('强连通分量 (SCC, size >= 2)');
console.log('='.repeat(72));
console.log('  [含类型边]    —— 类型层面的环');
if (!sccs.length) {
    console.log('    无 ✓');
} else {
    sccs.forEach((c, i) => {
        const inner = c.reduce((a, u) => a + (dep.get(u) || []).filter(e => c.includes(e.to)).length, 0);
        console.log('    SCC' + (i + 1) + ': ' + c.length + ' 文件 / ' + inner + ' 条内部边');
    });
}
console.log('  [仅运行时边]  —— 真正的运行时耦合(排除纯类型 import)');
if (!runtimeSccs.length) {
    console.log('    无 ✓  (所有环都是纯类型引用, 可通过搬迁类型声明消除)');
} else {
    runtimeSccs.forEach((c, i) => {
        const inner = c.reduce((a, u) => a + (runtimeDep.get(u) || []).filter(e => c.includes(e.to)).length, 0);
        console.log('    SCC' + (i + 1) + ': ' + c.length + ' 文件 / ' + inner + ' 条内部边');
        for (const m of [...c].sort()) { console.log('        ' + m); }
    });
    console.log('    --- 运行时环的内部边(逐条切断即为此小环的完整解) ---');
    for (const c of runtimeSccs) {
        for (const u of [...c].sort()) {
            for (const e of (runtimeDep.get(u) || [])) {
                if (c.includes(e.to)) {
                    console.log('      ' + u + ':' + e.line + ' -> ' + e.to);
                }
            }
        }
    }

    // 运行时图的最小断边集 = 消除运行时耦合的最少改动清单
    const rtCut = minFeedbackEdges(files, runtimeDep);
    const afterCut = findSCCs(files, withoutEdges(files, runtimeDep, rtCut));
    const rtOutDeg = (f) => (runtimeDep.get(f) || []).filter(e => runtimeCore.has(e.to)).length;
    console.log('');
    console.log('  [运行时] 最小断边集: ' + rtCut.size + ' 条 (切完剩余运行时 SCC: ' + afterCut.length + ')');
    const orderedRt = [...rtCut].sort((a, b) => rtOutDeg(a.split(' -> ')[0]) - rtOutDeg(b.split(' -> ')[0]));
    let k = 0;
    for (const key of orderedRt) {
        k++;
        const [from, to] = key.split(' -> ');
        const e = (runtimeDep.get(from) || []).find(x => x.to === to);
        console.log('    ' + String(k).padStart(2) + '. ' + from + ':' + (e ? e.line : '?') + ' -> ' + to);
    }
}

// ---- 度数排名 ----
if (core.size) {
    console.log('');
    console.log('--- 核心 SCC 内度数排名(决定分层顺序) ---');
    const rows = [...core].map(f => {
        const out = (dep.get(f) || []).filter(e => core.has(e.to)).length;
        const inn = [...core].reduce((a, u) => a + (dep.get(u) || []).filter(e => e.to === f).length, 0);
        return { f, out, inn };
    }).sort((a, b) => (b.inn + b.out) - (a.inn + a.out));
    console.log('   入度 出度  文件');
    for (const r of rows) {
        console.log('   ' + String(r.inn).padStart(3) + '  ' + String(r.out).padStart(3) + '   ' + r.f);
    }
}

// ---- 最小断边集 ----
if (core.size) {
    const cut = minFeedbackEdges(files, dep);
    const rest = findSCCs(files, withoutEdges(files, dep, cut));
    console.log('');
    console.log('='.repeat(72));
    console.log('最小反馈边集: ' + cut.size + ' 条 (切完剩余 SCC: ' + rest.length + ')');
    console.log('='.repeat(72));
    let i = 0;
    const ordered = [];
    for (const k of cut) { ordered.push(k); }
    // 按 "叶子优先"(出度小) 排序输出, 便于分批执行
    const outDegInCore = (f) => (dep.get(f) || []).filter(e => core.has(e.to)).length;
    ordered.sort((a, b) => outDegInCore(a.split(' -> ')[0]) - outDegInCore(b.split(' -> ')[0]));
    for (const k of ordered) {
        i++;
        const [from, to] = k.split(' -> ');
        const e = (dep.get(from) || []).find(x => x.to === to);
        console.log('  ' + String(i).padStart(2) + '. ' + from + ':' + (e ? e.line : '?') + ' -> ' + to +
            (e && e.typeOnly ? '   [type-only 可零成本断]' : ''));
    }
}

// ---- 分层违规 ----
if (FLAG_VSCODE) {
    console.log('');
    console.log('='.repeat(72));
    console.log('直接 import vscode 的文件(应只允许 L3 编排层)');
    console.log('='.repeat(72));
    const byFile = new Map();
    for (const v of vscodeImporters) {
        if (!byFile.has(v.file)) { byFile.set(v.file, []); }
        byFile.get(v.file).push(v.line);
    }
    for (const f of [...byFile.keys()].sort()) {
        const mark = VSCODE_ALLOWED.has(f) ? 'ok  ' : 'VIOL';
        console.log('  [' + mark + '] ' + f + '  (行 ' + byFile.get(f).join(',') + ')');
    }
}

if (FLAG_EDGES && core.size) {
    console.log('');
    console.log('--- 核心 SCC 全部内部边 ---');
    for (const u of [...core].sort()) {
        for (const e of (dep.get(u) || [])) {
            if (core.has(e.to)) {
                console.log('  ' + u + ':' + e.line + ' -> ' + e.to + (e.typeOnly ? '  [type-only]' : ''));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// --enforce / --update-baseline: 分层约束门禁(打包前 / CI 跑)
// ---------------------------------------------------------------------------
// 规则:
//   1. 运行时环内部边不得超过基线(目标恒为 0)
//   2. 类型环内部边不得超过基线(只许降, 不许升)
//   3. 直接 import vscode 的文件不得超出基线白名单(禁止新增)
//   4. 叶子模块(src/types/**、ProjectConsts、ArmCpuUtils)不得有**运行时** src 依赖
const FLAG_ENFORCE = argv.includes('--enforce');
const FLAG_UPDATE_BASELINE = argv.includes('--update-baseline');
const BASELINE_PATH = path.join(process.cwd(), 'scripts', 'dep-baseline.json');

/** 叶子模块: 应保持零运行时入边(只允许 type-only 引用与 lib/) */
const LEAF_FILES = ['src/types/', 'src/ProjectConsts.ts', 'src/ArmCpuUtils.ts'];
const isLeafFile = (f) => LEAF_FILES.some(p => p.endsWith('/') ? f.startsWith(p) : f === p);
const VSCODE_RE = /from\s+['"]vscode['"]/;

function innerEdgeCount(comps, g) {
    let n = 0;
    for (const c of comps) {
        const s = new Set(c);
        for (const u of c) {
            for (const e of (g.get(u) || [])) { if (s.has(e.to)) { n++; } }
        }
    }
    return n;
}

const vscodeFileList = files.filter(f => VSCODE_RE.test(fs.readFileSync(f, 'utf8'))).sort();
const leafRuntimeViolations = [];
for (const f of files) {
    if (!isLeafFile(f)) { continue; }
    for (const e of (dep.get(f) || [])) {
        if (!e.typeOnly && e.to.startsWith('src/')) { leafRuntimeViolations.push(f + ':' + e.line + ' -> ' + e.to); }
    }
}

const gateState = {
    runtimeSccEdges: innerEdgeCount(runtimeSccs, runtimeDep),
    typeSccEdges: innerEdgeCount(sccs, dep),
    vscodeImporters: vscodeFileList
};

console.log('');
console.log('--- 门禁状态 ---');
console.log('  运行时环内部边 : ' + gateState.runtimeSccEdges);
console.log('  类型环内部边   : ' + gateState.typeSccEdges);
console.log('  import vscode  : ' + gateState.vscodeImporters.length + ' 个文件');
console.log('  叶子运行时违规 : ' + leafRuntimeViolations.length);

if (FLAG_UPDATE_BASELINE) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(gateState, null, 2) + '\n', 'utf8');
    console.log('  → 基线已写入 ' + path.relative(process.cwd(), BASELINE_PATH));
}

if (FLAG_ENFORCE) {
    let base = null;
    try { base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch (e) { /* 缺失下面报错 */ }
    if (!base) {
        console.error('  找不到基线文件 ' + BASELINE_PATH + ', 先执行 --update-baseline');
        process.exitCode = 2;
    } else {
        const bad = [];
        if (gateState.runtimeSccEdges > base.runtimeSccEdges) {
            bad.push('运行时环内部边 ' + base.runtimeSccEdges + ' -> ' + gateState.runtimeSccEdges);
        }
        if (gateState.typeSccEdges > base.typeSccEdges) {
            bad.push('类型环内部边 ' + base.typeSccEdges + ' -> ' + gateState.typeSccEdges);
        }
        const newVscode = gateState.vscodeImporters.filter(f => base.vscodeImporters.indexOf(f) < 0);
        if (newVscode.length) { bad.push('新增 import vscode: ' + newVscode.join(', ')); }
        if (leafRuntimeViolations.length) { bad.push('叶子模块出现运行时 src 依赖: ' + leafRuntimeViolations.join(', ')); }

        console.log('');
        if (bad.length) {
            console.log('❌ 门禁未通过:');
            for (const b of bad) { console.log('   - ' + b); }
            process.exitCode = 1;
        } else {
            console.log('✅ 门禁通过 (运行时环=' + gateState.runtimeSccEdges
                + ', 类型环边=' + gateState.typeSccEdges
                + ', vscode=' + gateState.vscodeImporters.length + ')');
        }
    }
}

console.log('');
