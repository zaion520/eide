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
 * 项目 YAML 配置文件(骨架 eide.yml 及每目标 targets/<name>/<name>.yml)写盘裁决策略。
 *
 * 核心规格: 用户手改 YAML 文件后, 绝不因自动保存或构建触发的 Save() 被内存旧值覆盖。
 *
 * 裁决依据三方内容状态:
 *   - `currentDiskContent`: 当前磁盘文件内容(未存在则为 undefined)
 *   - `lastDiskContent`:    EIDE 上一次加载或写入时登记的基准内容(未记录则为 undefined)
 *   - `memoryContent`:      当前内存对象序列化后的内容
 */

export type YamlSaveDecision =
    /** 磁盘被外部修改: 将磁盘最新内容重载进内存, 严禁覆写磁盘 */
    | 'reload-from-disk'
    /** 内存被 UI/MCP 修改且磁盘未动: 将内存内容写到磁盘 */
    | 'write-memory-to-disk'
    /** 两侧均无变化: 跳过写盘 */
    | 'skip';

export interface YamlSaveDecisionInput {
    /** 内存序列化后准备写出的内容 */
    memoryContent: string;
    /** 上次加载或写入时记录的磁盘内容 */
    lastDiskContent: string | undefined;
    /** 当前磁盘上的内容(若文件不存在则为 undefined) */
    currentDiskContent: string | undefined;
}

/**
 * 裁决是否写盘或反向重载。
 */
export function decideYamlFileSave(input: YamlSaveDecisionInput): YamlSaveDecision {
    const { memoryContent, lastDiskContent, currentDiskContent } = input;

    // 磁盘文件不存在 -> 首次写盘
    if (currentDiskContent === undefined) {
        return 'write-memory-to-disk';
    }

    // 从未记录过上次内容(初次加载未记录或新目标)
    if (lastDiskContent === undefined) {
        // 如果当前磁盘与内存不同, 优先以磁盘为准(保留磁盘上手改内容)
        if (currentDiskContent !== memoryContent) {
            return 'reload-from-disk';
        }
        return 'skip';
    }

    // 磁盘内容变了(与上次记录不同) -> 用户在外部手改了文件!
    if (currentDiskContent !== lastDiskContent) {
        // 外部手改绝对优先: 保留磁盘手改, 重载进内存
        return 'reload-from-disk';
    }

    // 磁盘未变。检查内存是否被 UI/MCP 修改
    if (memoryContent !== lastDiskContent) {
        return 'write-memory-to-disk';
    }

    // 两边都没变
    return 'skip';
}
