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
 * clangd 配置片段的源码根推导与 PathMatch 渲染(**零 src 依赖**)。
 *
 * 取代方案 D 的 `resolveClangdProjectConfigDirFor`(算公共祖先后上移 `.clangd`)。
 * 那条路是启发式的: 源码在项目根之外时, `.clangd` 必须上移到能覆盖全部源码的
 * 公共祖先, 但上移位置可能跨到无关目录、或抢走兄弟项目的配置, 于是有一堆
 * 保守回退分支, 回退后根外源码就拿不到配置。
 *
 * 新做法: 每个源码根渲染一条 `If.PathMatch` 片段, 天然与文件位置无关。
 * **硬约束**: 片段必须精确锚定到源码目录, 绝不能用祖先级通配 —— 实测
 * `^[dD]:/company_project/.*$` 这类宽通配会抢在兄弟项目自己的配置之前命中,
 * 把别人的源码拿错误的命令解析(满屏 file not found)。
 */

import * as path from 'path';

/** 判断 child 是否等于 parent 或位于其子树内(路径段比较, 跨分隔符) */
function isSameOrUnder(child: string, parent: string): boolean {
    const normalize = (v: string) => v.split('\\').join('/').replace(/\/+$/, '');
    const c = normalize(child);
    const p = normalize(parent);
    if (c === p) { return true; }
    return c.startsWith(p + '/');
}

/**
 * 从 CDB 条目的绝对源码路径推导需要覆盖的源码根集合。
 *
 * 规则:
 *  1. 每个源文件取其所在目录;
 *  2. 若某目录是另一目录的祖先, 只保留祖先(减少片段数);
 *  3. **项目根恒定在内**(即使没有任何源文件);
 *  4. 输出排序去重, 保证幂等。
 *
 * 不假设"项目根 = 源码根": 项目根是构建目录(MDK/KEIL)、源码在兄弟目录的
 * 布局是常态(实测某工程 303 条 CDB 条目 100% 在根外)。
 */
export function collectSourceRootsForPathMatch(
    projectRoot: string,
    sourceAbsPaths: string[],
    platform: NodeJS.Platform = process.platform
): string[] {
    // 按目标平台解析路径: Windows 上用 path.win32, 其余用 path.posix。
    // 这样 Linux 语义可以在 Windows 上被单测覆盖(不依赖真实运行平台)。
    const p = platform === 'win32' ? path.win32 : path.posix;
    const root = p.resolve(String(projectRoot || '.'));

    const dirs: string[] = [];
    for (const source of sourceAbsPaths || []) {
        if (!source || typeof source !== 'string') { continue; }
        const dir = p.dirname(p.resolve(source));
        if (dir && dir !== '.' && !dirs.includes(dir)) { dirs.push(dir); }
    }

    // 项目根恒定保留(根下有源文件时也会被它吸收)
    if (!dirs.includes(root)) { dirs.push(root); }

    // 归并: 去掉被其他目录覆盖的条目
    const merged = dirs.filter((dir) => {
        return !dirs.some((other) => other !== dir && isSameOrUnder(dir, other));
    });

    return [...new Set(merged)].sort();
}

function escapeRegex(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 渲染某个源码根的 `PathMatch` 正则。
 *
 * - win32: 盘符大小写双写 `^[cC]:/...`, 匹配文件系统的大小写不敏感语义
 * - linux/darwin: 原样(linux 大小写敏感, darwin 实际不敏感但路径本身唯一)
 * - 末尾统一 `.*$`, 且**锚定到该目录**(不是其父目录)
 */
export function renderPathMatchForRoot(rootPath: string, platform: NodeJS.Platform): string {
    let normalized = String(rootPath || '').split('\\').join('/');
    while (normalized.length > 1 && normalized.endsWith('/') && !/^[A-Za-z]:\/$/.test(normalized)) {
        normalized = normalized.slice(0, -1);
    }

    if (platform === 'win32') {
        const drive = normalized.match(/^([A-Za-z]):(\/.*)$/);
        if (drive) {
            const letter = drive[1];
            return `^[${letter.toLowerCase()}${letter.toUpperCase()}]:${escapeRegex(drive[2])}/.*$`;
        }
    }
    return `^${escapeRegex(normalized)}/.*$`;
}
