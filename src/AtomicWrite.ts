/*
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

/**
 * 原子文件写入(**零 src 依赖**, 可纯 node 单测)。
 *
 * `fs.writeFileSync` 不是原子操作: 先 `open(O_TRUNC)` 截断再分块写。两个进程
 * 并发写同一文件时会出现截断交错、半截内容、0 字节文件 —— 实测会写坏
 * `.eide/eide.yml` 与 `.eide/targets/<name>/<name>.yml`(YAML 解析直接报错)。
 *
 * 修复: 先写**同目录**临时文件(同卷保证 rename 原子), 再 `renameSync` 覆盖目标。
 * 读者要么看到旧内容、要么看到新内容, 绝不会看到中间态。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 临时文件后缀标记(供 listStrayTempFiles 识别崩溃残留) */
const TEMP_SUFFIX = '.tmp';

function tempPathFor(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEMP_SUFFIX}`);
}

/**
 * 原子写入文本文件。
 *
 * @returns true 写入成功; false 失败(原文件保持未改动)
 *
 * 失败回退策略: `renameSync` 在 Windows 上可能因目标被占用(编辑器打开、
 * 杀软扫描)抛 `EPERM`/`EBUSY`, 此时退化为直接写 —— 宁可非原子也不能丢更新
 * (与 clangdIntegration.writeIfChanged 的既有语义一致)。
 */
export function atomicWriteFileSync(filePath: string, content: string): boolean {
    const tmpPath = tempPathFor(filePath);

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmpPath, content, 'utf8');
    } catch {
        try { fs.unlinkSync(tmpPath); } catch { /* 临时文件可能根本没建成 */ }
        return false;
    }

    try {
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch {
        // rename 失败(目标被占用/跨卷): 退化为直接写
        try {
            fs.writeFileSync(filePath, content, 'utf8');
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            return true;
        } catch {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            return false;
        }
    }
}

/**
 * 列出目录下的原子写临时文件残留(进程崩溃在 rename 之前会留下)。
 * 供启动时的清理逻辑使用。
 */
export function listStrayTempFiles(dir: string): string[] {
    try {
        return fs.readdirSync(dir).filter((name) => {
            // 形如 `<base>.<pid>.<ts>.<rand>.tmp`; 只要带 pid+时间戳段的 .tmp
            // 都算本模块的残留(不同版本随机段长度可能不同)
            if (!name.endsWith(TEMP_SUFFIX)) { return false; }
            return /\.\d+\.\d+(\.|\.[a-z0-9]+\.)tmp$/i.test(name);
        });
    } catch {
        return [];
    }
}
