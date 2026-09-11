#!/usr/bin/env node
/**
 * extract-methods.mjs —— 把"零 this 依赖"的类方法提取为模块级函数(P3-3 上帝类拆分工具)。
 *
 * 与 extract-class.mjs(顶层声明)互补: 本工具处理**类方法**。
 *   - 用 ts.createSourceFile + getStart()/getEnd() 取精确范围(朴素括号扫描会切错, 已两次踩坑)
 *   - 自动把 `private async m(...)` 转成 `export async function m(...)`
 *   - 自动改写原文件里的 `this.m(` 调用点(字符串 split/join, 不用 RegExp 避免 \b 被管道层吃掉)
 *   - 自动推导新模块的 import(按原文件导入映射, 保留 import type 语义)
 *   - 新模块自动带 MIT 许可头 + 文件说明
 *
 * 用法: node scripts/extract-methods.mjs <source.ts> <ClassName> <m1,m2,...> --out <out.ts> [--desc "说明"]
 *
 * 前提(调用方自行验证): 目标方法体不引用 this./super(可用 grep -c "this\." 或 AST 验证)。
 */
import fs from 'fs';
import ts from 'typescript';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const descIdx = argv.indexOf('--desc');
const injectIdx = argv.indexOf('--inject');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : undefined;
const DESC = descIdx >= 0 ? argv[descIdx + 1] : undefined;
/** --inject "dataProvider:ProjectDataProvider" : 方法体 this.<名> → 首参数 <名>: <类型> */
const INJECT_RAW = injectIdx >= 0 ? argv[injectIdx + 1] : undefined;
const INJECT = INJECT_RAW ? (() => {
    const i = INJECT_RAW.indexOf(':');
    if (i < 0) { console.error('--inject 需要 "参数名:类型名" 形式'); process.exit(1); }
    return { param: INJECT_RAW.slice(0, i), type: INJECT_RAW.slice(i + 1) };
})() : undefined;
const positional = argv.filter((a, i) => a !== '--out' && a !== '--desc' && a !== '--inject' && i !== outIdx + 1 && i !== descIdx + 1 && i !== injectIdx + 1);
const [SRC, CLASS_NAME, NAMES_RAW] = positional;
if (!SRC || !CLASS_NAME || !NAMES_RAW || !OUT) {
    console.error('用法: node scripts/extract-methods.mjs <source.ts> <ClassName> <m1,m2,...> --out <out.ts> [--desc "说明"]');
    process.exit(1);
}
const NAMES = NAMES_RAW.split(',').map(s => s.trim()).filter(Boolean);

const LICENSE = `/*
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

const text = fs.readFileSync(SRC, 'utf8');
const sf = ts.createSourceFile(SRC, text, ts.ScriptTarget.Latest, true);

// ---- 原文件导入映射: binding -> { mod, isType, isNamespace, rawStmt } ----
const bindings = {};
const importStmts = [];   // { node, mod, text }
for (const n of sf.statements) {
    if (!ts.isImportDeclaration(n)) continue;
    const mod = n.moduleSpecifier.text;
    importStmts.push({ node: n, mod, text: n.getText() });
    const c = n.importClause;
    if (!c) continue;
    if (c.name) bindings[c.name.text] = { mod, isType: false, isNamespace: false };
    if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) {
            bindings[c.namedBindings.name.text] = { mod, isType: false, isNamespace: true };
        } else {
            for (const el of c.namedBindings.elements) {
                bindings[el.name.text] = { mod, isType: c.isTypeOnly || el.isTypeOnly, isNamespace: false };
            }
        }
    }
}

// ---- 找类与目标方法 ----
let cls = null;
for (const n of sf.statements) {
    if (ts.isClassDeclaration(n) && n.name && n.name.text === CLASS_NAME) { cls = n; break; }
}
if (!cls) { console.error('x 未找到类 ' + CLASS_NAME); process.exit(1); }

const members = [];
for (const m of cls.members) {
    if (!m.name || !ts.isIdentifier(m.name)) continue;
    if (NAMES.indexOf(m.name.text) < 0) continue;
    if (!m.body) { console.error('x 方法无函数体(可能是重载声明): ' + m.name.text); process.exit(1); }
    members.push(m);
}
const foundNames = members.map(m => m.name.text);
const missing = NAMES.filter(n => foundNames.indexOf(n) < 0);
if (missing.length) { console.error('x 未找到方法: ' + missing.join(', ')); process.exit(1); }

// ---- 安全检查: 方法体不得引用 this/super ----
for (const m of members) {
    const body = m.body.getText();
    if (body.split('super.').length > 1) { console.error('x 方法引用 super.: ' + m.name.text); process.exit(1); }
    if (INJECT) {
        // 注入模式: 允许且仅允许 this.<注入名>
        const total = body.split('this.').length - 1;
        const injected = body.split('this.' + INJECT.param).length - 1;
        if (total !== injected) {
            console.error('x 方法引用了注入之外的 this.*: ' + m.name.text + ' (this.×' + total + ', this.' + INJECT.param + '×' + injected + ')');
            process.exit(1);
        }
    } else if (body.split('this.').length > 1) {
        console.error('x 方法引用 this.: ' + m.name.text + ' (先手动解耦, 或使用 --inject)');
        process.exit(1);
    }
}
// 注入模式: 源文件内不得存在 this.<名>( 调用点(本批次的接线在 extension.ts, 由后续步骤单独改写)
if (INJECT) {
    for (const name of NAMES) {
        if (text.split('this.' + name + '(').length > 1) {
            console.error('x 源文件内存在 this.' + name + '( 调用点 —— 注入模式需要先把这些调用点改写或外移');
            process.exit(1);
        }
    }
}

// ---- 转换为函数文本 ----
const funcTexts = [];
for (const m of members) {
    const name = m.name.text;
    const before = text.slice(m.getStart(), m.name.getStart());   // e.g. "private async "
    let rest = text.slice(m.name.getStart(), m.getEnd());         // "name(...): Ret { ... }"
    const isAsync = before.split('async').length > 1;
    if (INJECT) {
        // 在参数列表最前面插入注入参数
        if (m.parameters && m.parameters.length > 0) {
            const head = text.slice(m.name.getStart(), m.parameters[0].getStart());   // "name("
            rest = head + INJECT.param + ': ' + INJECT.type + ', ' + text.slice(m.parameters[0].getStart(), m.getEnd());
        } else {
            const p = rest.indexOf('(');
            if (p < 0) { console.error('x 未找到参数列表: ' + name); process.exit(1); }
            rest = rest.slice(0, p + 1) + INJECT.param + ': ' + INJECT.type + rest.slice(p + 1);
        }
    }
    let fn = 'export ' + (isAsync ? 'async ' : '') + 'function ' + rest;
    if (INJECT) { fn = fn.split('this.' + INJECT.param).join(INJECT.param); }
    funcTexts.push(fn);
}

// ---- 新模块 import 推导(用**转换后**的函数文本, 含注入参数的类型; 字符串 split/join 判定) ----
const needByMod = {};   // mod -> Set(binding)
const needNamespace = new Set();
for (const fn of funcTexts) {
    for (const [id, info] of Object.entries(bindings)) {
        if (fn.split(id).length > 1) {
            if (info.isNamespace) needNamespace.add(id);
            else (needByMod[info.mod] = needByMod[info.mod] || new Set()).add(id);
        }
    }
}
const outImports = [];
for (const id of needNamespace) {
    outImports.push('import * as ' + id + ' from ' + quote(bindings[id].mod) + ';');
}
for (const [mod, set] of Object.entries(needByMod)) {
    const typeNames = [], valueNames = [];
    for (const id of set) (bindings[id].isType ? typeNames : valueNames).push(id);
    if (valueNames.length) outImports.push('import { ' + valueNames.join(', ') + ' } from ' + quote(mod) + ';');
    if (typeNames.length) outImports.push('import type { ' + typeNames.join(', ') + ' } from ' + quote(mod) + ';');
}
function quote(s) { return "'" + s + "'"; }

// ---- 相对路径调整(同目录搬迁, './x' 与 '../lib/...' 均不变; 若未来跨目录需在此调整) ----

// ---- 写新模块 ----
const docLines = [
    '/**',
    ' * ' + (DESC || ('从 ' + SRC + ' 的 ' + CLASS_NAME + ' 类提取的模块级函数。')),
    ' *',
    ' * 由 scripts/extract-methods.mjs 自动生成: 原方法是零 this 依赖的私有方法,',
    ' * 提取为纯函数后由 ' + CLASS_NAME + ' 直接调用(调用点已自动改写)。',
    ' */',
    ''
];
const outContent = LICENSE + '\n' + docLines.join('\n') + outImports.join('\n') + '\n\n' + funcTexts.join('\n\n') + '\n';
fs.writeFileSync(OUT, outContent, 'utf8');
console.log('ok 已写 ' + OUT + ' (' + funcTexts.length + ' 个函数, import ' + outImports.length + ' 条)');

// ---- 原文件: 删除成员(降序), 改写调用点, 加导入 ----
let src = text;
const cuts = members.map(m => ({ start: m.getStart(), end: m.getEnd() })).sort((a, b) => b.start - a.start);
for (const c of cuts) src = src.slice(0, c.start) + src.slice(c.end);
for (const name of NAMES) {
    src = src.split('this.' + name).join(name);
}
// 清理删除后产生的连续空行(3+ -> 2)
while (src.split('\r\n\r\n\r\n').length > 1) src = src.split('\r\n\r\n\r\n').join('\r\n\r\n');
while (src.split('\n\n\n').length > 1) src = src.split('\n\n\n').join('\n\n');

const outBase = OUT.replace(/^.*\//, '').replace(/\.ts$/, '');
const importLine = 'import { ' + NAMES.join(', ') + ' } from ' + quote('./' + outBase) + ';';
// 插到最后一条顶层 import 之后
let lastEnd = -1;
for (const s of importStmts) lastEnd = Math.max(lastEnd, s.node.getEnd());
if (lastEnd >= 0) {
    src = src.slice(0, lastEnd) + '\n' + importLine + src.slice(lastEnd);
} else {
    src = importLine + '\n' + src;
}
fs.writeFileSync(SRC, src, 'utf8');
console.log('ok 已更新 ' + SRC + ' (调用点改写 + 导入 ' + importLine + ')');
