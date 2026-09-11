/**
 * AST 版"顶层声明提取器" —— 把某个 class/interface/enum/type/function 从大文件里精确搬出去。
 *
 * 为什么需要它: 用"扫到列 0 的 `}` 为止"这种朴素括号扫描**不可靠** —— 类体内部常出现列 0 的
 * `}`(嵌套对象字面量/联合类型收尾), 会提前截断(实测: 338 行的类只切出 28 行, 38 个编译错误)。
 * 必须用 TypeScript 官方解析器取 `node.getStart()/getEnd()` 的精确字符范围。
 *
 * 用法:
 *   # 只分析(不改文件): 打印精确行范围、需要一并搬走的同文件声明、需要复制的 import
 *   node scripts/extract-class.mjs src/BigFile.ts ProjTreeItem
 *
 *   # 执行搬移: 生成新模块 + 从原文件删除 + 原文件加 import/re-export
 *   node scripts/extract-class.mjs src/BigFile.ts ProjTreeItem --out src/ProjTreeItem.ts
 *
 *   # 一次搬多个(同文件、逗号分隔)
 *   node scripts/extract-class.mjs src/BigFile.ts A,B --out src/AB.ts
 *
 * 搬移后的自检(必做):
 *   node_modules/typescript/bin/tsc --noEmit -p .
 *   node scripts/analyze-deps.mjs --enforce
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : undefined;
const positional = argv.filter((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
const SRC_FILE = positional[0];
const NAMES = (positional[1] || '').split(',').map(s => s.trim()).filter(Boolean);

if (!SRC_FILE || !NAMES.length) {
    console.error('用法: node scripts/extract-class.mjs <源文件> <声明名[,声明名...]> [--out <新文件>]');
    process.exit(2);
}

const srcText = fs.readFileSync(SRC_FILE, 'utf8');
const sf = ts.createSourceFile(SRC_FILE, srcText, ts.ScriptTarget.Latest, true);
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos);

// ---- 收集顶层声明与 import ----
const topLevel = new Map();          // name -> node
const imported = new Map();          // localName -> { module, typeOnly, namespace, orig }

sf.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
        const mod = node.moduleSpecifier && node.moduleSpecifier.text;
        if (!mod) { return; }
        const clause = node.importClause;
        if (!clause) { return; }
        const baseTypeOnly = !!clause.isTypeOnly;
        const nb = clause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
                imported.set(el.name.text, {
                    module: mod,
                    typeOnly: baseTypeOnly || !!el.isTypeOnly,
                    namespace: false,
                    orig: el.propertyName ? el.propertyName.text : el.name.text
                });
            }
        } else if (nb && ts.isNamespaceImport(nb)) {
            imported.set(nb.name.text, { module: mod, typeOnly: baseTypeOnly, namespace: true, orig: '*' });
        }
        return;
    }
    const nm = node.name && node.name.text;
    if (nm && (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)
        || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableStatement(node))) {
        topLevel.set(nm, node);
    }
    // 变量声明语句: 逐个收集
    if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) { topLevel.set(d.name.text, node); }
        }
    }
});

const targets = [];
for (const n of NAMES) {
    const node = topLevel.get(n);
    if (!node) { console.error('找不到顶层声明: ' + n); process.exit(2); }
    targets.push({ name: n, node });
}

targets.sort((a, b) => b.node.getStart() - a.node.getStart());   // 从后往前删, 避免位移

// ---- 收集被引用的标识符(排除属性名/键名等非自由标识符) ----
function collectUsed(node) {
    const used = new Set();
    const visit = (n, parent) => {
        if (ts.isIdentifier(n)) {
            const isPropertyName = parent && (
                (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
                (ts.isPropertyAssignment(parent) && parent.name === n) ||
                (ts.isMethodDeclaration(parent) && parent.name === n) ||
                (ts.isPropertyDeclaration(parent) && parent.name === n) ||
                (ts.isPropertySignature(parent) && parent.name === n) ||
                (ts.isMethodSignature(parent) && parent.name === n) ||
                (ts.isEnumMember(parent) && parent.name === n) ||
                (ts.isQualifiedName(parent) && parent.right === n) ||
                (ts.isBindingElement(parent) && parent.propertyName === n)
            );
            if (!isPropertyName) { used.add(n.text); }
        }
        ts.forEachChild(n, (c) => visit(c, n));
    };
    visit(node, undefined);
    return used;
}

const report = [];
for (const t of targets) {
    const start = t.node.getStart();
    const end = t.node.getEnd();
    const a = lineOf(start);
    const b = lineOf(end);
    const used = collectUsed(t.node);
    const sameFile = [...used].filter(n => topLevel.has(n) && !NAMES.includes(n)).sort();
    const needImport = [...used].filter(n => imported.has(n)).sort();
    report.push({ ...t, start, end, a, b, used, sameFile, needImport });
}

// ---- 打印分析 ----
console.log('='.repeat(72));
console.log('提取分析: ' + SRC_FILE + '  ->  ' + NAMES.join(', '));
console.log('='.repeat(72));
for (const r of report) {
    console.log('');
    console.log('[' + r.name + ']');
    console.log('  字符范围 : ' + r.start + ' - ' + r.end);
    console.log('  行范围   : ' + (r.a.line + 1) + ' - ' + (r.b.line + 1) + '   (' + (r.b.line - r.a.line + 1) + ' 行)');
    console.log('  同文件依赖(需 export 或一并搬走): ' + (r.sameFile.length ? r.sameFile.join(', ') : '(无)'));
    const byMod = new Map();
    for (const n of r.needImport) {
        const info = imported.get(n);
        if (!byMod.has(info.module)) { byMod.set(info.module, []); }
        byMod.get(info.module).push(n + (info.typeOnly ? '(type)' : ''));
    }
    if (byMod.size) {
        console.log('  需复制的 import:');
        for (const [m, ns] of byMod) { console.log('    ' + m + ' <- ' + ns.join(', ')); }
    } else {
        console.log('  需复制的 import: (无)');
    }
}

if (!OUT) {
    console.log('');
    console.log('提示: 加 --out <新文件> 执行搬移。搬移后必须跑 tsc + analyze-deps.mjs --enforce。');
    process.exit(0);
}

// ---- 执行搬移 ----
const OUT_ABS = path.resolve(OUT);
const OUT_DIR = path.dirname(OUT_ABS);

/** 把 import 路径从「相对源文件」重算为「相对新文件」 */
function rewriteModulePath(mod) {
    if (!mod.startsWith('.')) { return mod; }
    const abs = path.resolve(path.dirname(path.resolve(SRC_FILE)), mod);
    let rel = path.relative(OUT_DIR, abs).split(path.sep).join('/');
    if (!rel.startsWith('.')) { rel = './' + rel; }
    return rel;
}

// 1) 组装新文件的 import: 每个用到的模块分组
const importLines = [];
const modGroups = new Map();
for (const r of report) {
    for (const n of r.needImport) {
        const info = imported.get(n);
        if (!modGroups.has(info.module)) { modGroups.set(info.module, { ns: new Map(), named: new Map() }); }
        const g = modGroups.get(info.module);
        if (info.namespace) { g.ns.set(n, info); } else { g.named.set(n, info); }
    }
}
const BLANK = '';
for (const [mod, g] of modGroups) {
    for (const [n, info] of g.ns) {
        importLines.push('import ' + (info.typeOnly ? 'type ' : '') + '* as ' + n + " from '" + rewriteModulePath(mod) + "';");
    }
    if (g.named.size) {
        const allType = [...g.named.values()].every(i => i.typeOnly);
        const names = [...g.named.entries()].map(([n, i]) => (i.orig === n ? n : i.orig + ' as ' + n));
        importLines.push('import ' + (allType ? 'type ' : '') + '{ ' + names.join(', ') + " } from '" + rewriteModulePath(mod) + "';");
    }
    importLines.push(BLANK);
}

const LICENSE_HEADER = `/*
    MIT License

    Copyright (c) 2019 github0null

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/
`;

const srcLineCount = srcText.split('\n').length;
const DOC = [
    '/**',
    ' * ' + NAMES.join(' / ') + ' —— 从 ' + path.basename(SRC_FILE) + '(' + srcLineCount + ' 行)拆出。',
    ' *',
    ' * 注意: 本文件由 scripts/extract-class.mjs 生成, 若需再次搬移请复用该工具',
    ' * (朴素括号扫描会因类体内列 0 的 `}` 提前截断)。',
    ' */',
    ''
].join('\n');

const blocks = report.slice().sort((x, y) => x.start - y.start).map(r => {
    let text = srcText.slice(r.start, r.end);
    // 原声明若未导出, 新模块里必须补 export, 否则新文件"不是模块"(TS2306) —— 实测踩过
    if (!/^export\s/.test(text)) {
        text = text.replace(/^(abstract\s+)?(class|interface|enum|type|function|const|let|var)\b/, 'export $1$2');
    }
    return text;
});
const newContent = LICENSE_HEADER + '\n' + DOC + '\n' + importLines.join('\n') + '\n' + blocks.join('\n\n') + '\n';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_ABS, newContent, 'utf8');
console.log('');
console.log('  ok 已写 ' + OUT + ' (' + newContent.split('\n').length + ' 行)');

// 2) 原文件: 删除块(从后往前) + 加 import/re-export
let srcOut = srcText;
const insertAfter = /^import[^\n]*\n/m.exec(srcText);
const addLines = [];
for (const r of report) {
    const rel = rewriteModulePath(path.relative(path.dirname(path.resolve(SRC_FILE)), OUT_ABS).split(path.sep).join('/'));
    const mod = rel.startsWith('.') ? rel : './' + rel;
    addLines.push("import { " + r.name + " } from '" + mod.replace(/\.ts$/, '') + "';");
    addLines.push('export { ' + r.name + ' };');
}
for (const r of report) {
    srcOut = srcOut.slice(0, r.start) + srcOut.slice(r.end);
}
if (insertAfter) {
    const at = insertAfter.index + insertAfter[0].length;
    srcOut = srcOut.slice(0, at) + addLines.join('\n') + '\n' + srcOut.slice(at);
}
fs.writeFileSync(SRC_FILE, srcOut, 'utf8');
console.log('  ok 已更新 ' + SRC_FILE + ' (删除块 + 加 import/re-export)');

console.log('');
console.log('下一步(必做):');
console.log('  node_modules/typescript/bin/tsc --noEmit -p .        # 编译');
console.log('  node scripts/analyze-deps.mjs --enforce             # 架构门禁');
console.log('  # 若门禁报"新增 import vscode"或环边上升, 按需收敛或显式更新基线');
