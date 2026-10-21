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
 * clangd 全局缓存布局(**零 src 依赖**, 可纯 node 单测)。
 *
 * 为什么搬到全局: 原先 CDB / shim / 索引都放在项目内(`<root>/clangd/`),
 * 导致 ① 项目目录被生成物污染 ② 每个项目根还要额外写一个 `.clangd` 配置文件,
 * 而 `.clangd` 只对**位于它所在目录子树内**的文件生效 —— 源码在根外时
 * 完全不可见(实测满屏 file not found)。
 *
 * 搬到全局后: 项目目录零产物, `config.yaml` 里只留"源码根 -> 库目录"的指针
 * (实测 `CompilationDatabase` 接受绝对路径), 与源码位置无关。
 *
 * 平台差异全部通过参数注入, 因此 Linux/macOS 分支可在任意平台被单测覆盖。
 */

import * as path from 'path';
import * as crypto from 'crypto';

/** 缓存子目录名(位于平台缓存根之下) */
const EIDE_CACHE_DIR = 'eide';
const CLANGD_CACHE_DIR = 'clangd';
const PROJECTS_DIR = 'projects';

export interface CacheRootInput {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    homedir: string;
}

/**
 * 解析全局缓存根。
 *
 *  - `VSCODE_PORTABLE` 优先: 便携版必须自包含, 缓存跟着走(否则换机器丢索引)
 *  - win32: `%LOCALAPPDATA%\eide\clangd`, 缺失时回退 `<home>\AppData\Local\...`
 *  - darwin: `~/Library/Caches/eide/clangd`
 *  - 其他(linux/bsd): `$XDG_CACHE_HOME/eide/clangd`, 缺失或非绝对路径时回退
 *    `~/.cache/eide/clangd`(XDG 规范要求绝对路径)
 */
export function resolveClangdCacheRoot(input: CacheRootInput): string {
    const env = input.env || {};
    const portable = env['VSCODE_PORTABLE'];
    if (portable) {
        return path.join(portable, 'user-data', EIDE_CACHE_DIR, CLANGD_CACHE_DIR);
    }

    if (input.platform === 'win32') {
        const localAppData = env['LOCALAPPDATA'] || path.join(input.homedir, 'AppData', 'Local');
        return path.join(localAppData, EIDE_CACHE_DIR, CLANGD_CACHE_DIR);
    }

    if (input.platform === 'darwin') {
        return path.join(input.homedir, 'Library', 'Caches', EIDE_CACHE_DIR, CLANGD_CACHE_DIR);
    }

    const xdg = env['XDG_CACHE_HOME'];
    if (xdg && path.isAbsolute(xdg)) {
        return path.join(xdg, EIDE_CACHE_DIR, CLANGD_CACHE_DIR);
    }
    return path.join(input.homedir, '.cache', EIDE_CACHE_DIR, CLANGD_CACHE_DIR);
}

/**
 * 规范化项目根, 用于计算稳定哈希。
 *
 *  - 分隔符统一为 `/`(避免 `\` 与 `/` 写法算出不同哈希)
 *  - 去掉尾部分隔符
 *  - win32/darwin 转小写(文件系统大小写不敏感); linux 保留大小写
 *
 * 注意: 调用方应传入 `realpath` 结果, 否则符号链接的不同写法会算出不同哈希。
 */
export function normalizeProjectRoot(projectRoot: string, platform: NodeJS.Platform): string {
    let p = String(projectRoot || '').replace(/\\/g, '/');
    // 去掉尾部分隔符,但保留根("/" 或 "C:/")
    while (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) {
        p = p.slice(0, -1);
    }
    const caseInsensitive = platform === 'win32' || platform === 'darwin';
    return caseInsensitive ? p.toLowerCase() : p;
}

/** 项目根 -> 缓存目录名(16 位 hex, 稳定且无非法字符) */
export function hashProjectRoot(projectRoot: string, platform: NodeJS.Platform): string {
    const normalized = normalizeProjectRoot(projectRoot, platform);
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export interface ClangdCacheLayout {
    /** `<cacheRoot>/projects/<hash>` */
    projectDir: string;
    /** 编译数据库(每项目独立文件, 无并发竞争) */
    cdbPath: string;
    /** 工具链关键字 shim 目录 */
    shimDir: string;
    /** 元数据(记录原始项目根, 供反查与 GC) */
    metaPath: string;
    /** clangd 后台索引缓存(clangd 自动落在 CDB 同级 `.cache/`) */
    indexCacheDir: string;
}

export function getClangdCacheLayout(
    cacheRoot: string,
    projectRoot: string,
    platform: NodeJS.Platform
): ClangdCacheLayout {
    const projectDir = path.join(cacheRoot, PROJECTS_DIR, hashProjectRoot(projectRoot, platform));
    return {
        projectDir,
        cdbPath: path.join(projectDir, 'compile_commands.json'),
        shimDir: path.join(projectDir, 'shim'),
        metaPath: path.join(projectDir, 'project.json'),
        indexCacheDir: path.join(projectDir, '.cache')
    };
}
