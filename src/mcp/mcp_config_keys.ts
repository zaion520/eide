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
 * MCP 配置写入的纯校验逻辑(**零依赖**, 可纯 node 单测)。
 *
 * 从 `mcp_builder_opts_validate.ts` 拆出: 后者 import 了 `ResManager`(传递依赖 vscode),
 * 导致这些纯函数无法被单测覆盖。
 */

/**
 * 校验一组待写入的配置键是否都属于允许的键集合。
 *
 * 用于 `eide_set_toolchain_config` / `eide_set_upload_config`: 写入未知键会在
 * 下次加载时被静默剥除(`UpdateConfigData` 会清掉不在默认结构里的属性),
 * 与其静默失效,不如当场报错并列出合法键。
 *
 * @returns 未知键列表(空数组 = 全部合法),保持输入顺序
 */
export function findUnknownKeys(keys: string[], validKeys: string[]): string[] {
    if (!Array.isArray(keys)) { return []; }
    const valid = new Set(validKeys || []);
    return keys.filter((k) => !valid.has(k));
}

/**
 * 解析目标工具要作用的 target 名。
 *
 * `targetName` 在 MCP 工具里是可选的(缺省 = 激活 target),且 AI 常会传空串或
 * 带空白,统一在这里归一,避免每个工具各写一遍判断。
 */
export function resolveTargetName(
    requested: string | null | undefined,
    activeTarget: string
): string {
    if (requested === undefined || requested === null) { return activeTarget; }
    const trimmed = requested.trim();
    return trimmed.length > 0 ? trimmed : activeTarget;
}

/**
 * 判断给定 target 是否为当前激活 target。
 *
 * target 名不区分大小写(与 `validateTargetName` 的重名检查、`env.ini` 段名一致),
 * 因此这里按小写比较。
 */
export function isActiveTarget(targetName: string, activeTarget: string): boolean {
    return targetName.toLowerCase() === activeTarget.toLowerCase();
}
