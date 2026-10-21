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
 * scatter 文件写入策略(**零依赖**, 可纯 node 单测)。
 *
 * `<outDir>/<target>.sct` 由 `storageLayout` 派生, 属生成物; 但用户手改后不应被
 * 下一次 `getCommands()` 静默覆写。判定所需的三方内容指纹:
 *
 *   - `newHash`        本次按当前配置生成的内容
 *   - `lastWrittenHash` 本会话上一次由 EIDE 写入的内容(无记录 = undefined)
 *   - `diskHash`       磁盘上现存的内容(文件不存在 = undefined)
 *
 * 优先级(有意为之): **配置是源, 手改只是临时调整**。
 * 若配置变了(生成内容与上次写入不同), 必须覆盖 —— 否则改内存布局会静默失效。
 * 想永久保留自己的 scatter, 正解是 `useCustomScatterFile: true` + `scatterFilePath`。
 */

export type ScatterWriteDecision =
    /** 写入(配置驱动 / 无手改 / 无法判定时的旧行为) */
    | 'write'
    /** 保留磁盘上的手改内容, 跳过本次写入 */
    | 'keep-manual';

export interface ScatterWriteInput {
    /** 本次生成内容的指纹 */
    newHash: string;
    /** 本会话上次写入内容的指纹; 从未写过为 undefined */
    lastWrittenHash: string | undefined;
    /** 磁盘现存内容的指纹; 文件不存在或读取失败为 undefined */
    diskHash: string | undefined;
}

export function decideScatterWrite(input: ScatterWriteInput): ScatterWriteDecision {
    const { newHash, lastWrittenHash, diskHash } = input;

    // 本会话没写过: 无法区分"手改"与"上次会话留下的旧文件", 按旧行为重写
    if (lastWrittenHash === undefined) { return 'write'; }

    // 配置变了(生成内容与上次写入不同): 配置优先, 覆盖
    if (newHash !== lastWrittenHash) { return 'write'; }

    // 配置未变。磁盘内容仍等于上次写入 -> 没被改过
    if (diskHash === undefined || diskHash === lastWrittenHash) { return 'write'; }

    // 配置未变但磁盘内容变了 -> 用户手改, 保留
    return 'keep-manual';
}
