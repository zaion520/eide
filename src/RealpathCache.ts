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
 * fs.realpathSync 的会话内缓存(P1-3)。
 *
 * 背景: EIDE 的 cpp 配置刷新管线会对 include 目录列表反复调用 realpathSync,
 * 同一项目一次会话里同样的路径会被解析成百上千次, 全是重复系统调用。
 *
 * 语义与 Platform.realpathSync 保持一致:
 *  - 解析成功 → 返回真实路径并缓存;
 *  - 解析失败 → 返回原路径且**不缓存**(路径可能稍后才出现, 如首次构建前的输出目录);
 *  - 缓存容量有上限, 打满即整体清空(简单粗暴但正确; 会话内真实路径基本稳定)。
 *
 * 注意: 若用户在会话中途改动了符号链接指向, 需调用 clearRealpathCache() 失效化。
 * resolver 参数仅供测试注入, 生产调用方无需传递。
 */

import * as fs from 'fs';

export const REALPATH_CACHE_CAP = 5000;

const cache = new Map<string, string>();

export function clearRealpathCache(): void {
    cache.clear();
}

export function cachedRealpathSync(
    path: string,
    resolve: (p: string) => string = fs.realpathSync
): string {
    const hit = cache.get(path);
    if (hit !== undefined) { return hit; }

    let real: string;
    try {
        real = resolve(path);
    } catch (error) {
        return path;    // 失败不缓存: 路径可能稍后才出现
    }

    if (cache.size >= REALPATH_CACHE_CAP) { cache.clear(); }
    cache.set(path, real);
    return real;
}
