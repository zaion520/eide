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
 * 目标文件热重载的判定逻辑(**零依赖**, 可纯 node 单测)。
 *
 * v4.2 的目标数据在 `.eide/targets/<name>/<name>.yml`。手改该文件后必须把磁盘内容
 * 读进内存,否则下一次 `Save()`(含 3 分钟自动保存)会用内存旧值把改动覆盖掉。
 *
 * 但 `Save()` 自己写盘也会触发同一个 watcher,若不抑制就会出现
 * "写盘 -> 读回 -> 再写" 的无谓刷新链。抑制靠一张 `路径 -> 写入时刻` 表,
 * 且**必须带过期窗口**: 平台可能不回报某次自写事件,标记残留会误吞用户后续的真手改。
 */

/**
 * 自写抑制窗口(ms)。
 *
 * 下限考虑 watcher 回报延迟(Windows 上通常几十毫秒,极端负载下可能到数百毫秒);
 * 上限考虑误吞风险 —— 超过这个时长的同一文件事件应视为真实外部修改。
 */
export const SELF_WRITE_GUARD_MS = 2000;

export type TargetFileEventDecision =
    /** 本次 Save() 自己写出的, 消费标记并跳过 */
    | 'ignore-self-write'
    /** 真实外部修改(或标记已过期), 走热重载 */
    | 'reload';

export interface TargetFileEventInput {
    /** 事件到达时刻 */
    now: number;
    /** 该路径上次由 EIDE 写入的时刻; 无标记为 undefined */
    selfWrittenAt: number | undefined;
}

export function decideTargetFileEvent(input: TargetFileEventInput): TargetFileEventDecision {
    const { now, selfWrittenAt } = input;

    if (selfWrittenAt === undefined) { return 'reload'; }

    // 窗口内 -> 自写回响; 超过窗口 -> 标记已过期, 视为真实修改
    return (now - selfWrittenAt) <= SELF_WRITE_GUARD_MS
        ? 'ignore-self-write'
        : 'reload';
}
