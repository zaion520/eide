#!/usr/bin/env node
/** 扫描类方法: this 引用数 + 触及的字段名, 评估提取可行性 */
import fs from 'fs';
import ts from 'typescript';

const [SRC, CLASS_NAME] = process.argv.slice(2);
const text = fs.readFileSync(SRC, 'utf8');
const sf = ts.createSourceFile(SRC, text, ts.ScriptTarget.Latest, true);

let cls = null;
for (const n of sf.statements) {
    if (ts.isClassDeclaration(n) && n.name && n.name.text === CLASS_NAME) { cls = n; break; }
}
if (!cls) { console.error('x 未找到类'); process.exit(1); }

// 类的字段名
const fields = new Set();
for (const m of cls.members) {
    if (ts.isPropertyDeclaration(m) && m.name && ts.isIdentifier(m.name)) fields.add(m.name.text);
}

const rows = [];
for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) || !m.name || !ts.isIdentifier(m.name) || !m.body) continue;
    const name = m.name.text;
    const body = m.body.getText();
    const thisRefs = (body.match(/\bthis\./g) || []).length;
    const usedFields = [...fields].filter(f => body.split('this.' + f).length > 1);
    const lines = body.split('\n').length;
    if (thisRefs > 0) rows.push({ name, lines, thisRefs, usedFields });
}

rows.sort((a, b) => a.thisRefs - b.thisRefs || b.lines - a.lines);
console.log('类字段: ' + [...fields].join(', '));
console.log('');
console.log('方法(按 this 数升序):');
for (const r of rows.slice(0, 30)) {
    console.log('  this×' + String(r.thisRefs).padStart(3) + '  ' + String(r.lines).padStart(4) + ' 行  字段[' + r.usedFields.join(',') + ']  ' + r.name);
}
