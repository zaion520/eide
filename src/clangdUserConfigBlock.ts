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
 * clangd 用户级 `config.yaml` 受管块的渲染与增删(**零 src 依赖**)。
 *
 * 全局缓存方案下, 所有项目共用 `%LOCALAPPDATA%/clangd/config.yaml`(clangd 只认
 * 这一个文件, 实测不支持 `config.d/` 目录)。每个项目写一个带 token 的受管块:
 *
 *   # BEGIN EIDE Clangd Support <token>
 *   ---
 *   If:
 *     PathMatch: "^[cC]:/proj/A/.*$"
 *   CompileFlags:
 *     CompilationDatabase: "C:/cache/projects/<hash>"
 *   ---
 *   If:
 *     PathMatch: "^[cC]:/proj/A/lib/.*$"     # 根外源码目录
 *   CompileFlags:
 *     CompilationDatabase: "C:/cache/projects/<hash>"
 *   # END EIDE Clangd Support <token>
 *
 * 三条硬规格(均为历史事故总结):
 *  1. **同 token 只允许一个块** —— 曾有项目累积 16 个块 / 227 条 PathMatch / 131KB;
 *  2. **片段锚定到源码目录** —— 祖先级通配(`^[dD]:/proj/.*$`)会抢在兄弟项目
 *     自己的配置之前命中, 把别人的源码拿错误命令解析(实测满屏 file not found);
 *  3. **用户自定义内容一律不动** —— 只在自己的标记范围内增删。
 */

export const BEGIN_MARKER = '# BEGIN EIDE Clangd Support';
export const END_MARKER = '# END EIDE Clangd Support';

/** 历史标记族(官方版/旧版本使用), 回收时一并清理 */
export const LEGACY_BEGIN_MARKER = '# BEGIN EIDE Clangd Sync';
export const LEGACY_END_MARKER = '# END EIDE Clangd Sync';

function escapeYamlString(value: string): string {
    return String(value)
        .split('\\').join('\\\\')
        .split('"').join('\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function escapeRegex(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yamlListItem(value: string): string {
    return `    - "${escapeYamlString(String(value || '').replace(/[\r\n]+/g, ' '))}"`;
}

export interface ManagedBlockInput {
    /** 受管令牌(项目根 base64), 决定块的归属 */
    token: string;
    /** 每个源码根一条(由 renderPathMatchForRoot 生成, 已锚定到具体目录) */
    pathMatches: string[];
    /** 全局缓存里的 CDB 目录(绝对路径, 实测 clangd 接受) */
    compilationDatabase: string;
    removeFlags?: string[];
    suppressDiagnostics?: string[];
}

/** 渲染受管块(不含前后空行, 由 upsert 负责排版) */
export function renderManagedBlock(input: ManagedBlockInput): string {
    const pathMatches = (input.pathMatches || []).filter((p) => !!p);
    if (pathMatches.length === 0) {
        throw new Error('renderManagedBlock: at least one pathMatch is required');
    }

    const removeBlock = (input.removeFlags || []).length
        ? `\n  Remove:\n${input.removeFlags!.map(yamlListItem).join('\n')}`
        : '';
    const suppressBlock = (input.suppressDiagnostics || []).length
        ? `\nDiagnostics:\n  Suppress:\n${input.suppressDiagnostics!.map(yamlListItem).join('\n')}`
        : '';

    const fragments = pathMatches.map((pathMatch) => `---
If:
  PathMatch: "${escapeYamlString(pathMatch)}"
CompileFlags:
  CompilationDatabase: "${escapeYamlString(input.compilationDatabase)}"${removeBlock}${suppressBlock}`);

    return `${BEGIN_MARKER} ${input.token}
${fragments.join('\n')}
${END_MARKER} ${input.token}`;
}

function blockRegex(begin: string, end: string, token: string): RegExp {
    // 标记行 + 令牌, 到对应 end 标记 + 同一令牌; 容忍 CRLF
    return new RegExp(
        `${escapeRegex(begin)} ${escapeRegex(token)}[\\s\\S]*?${escapeRegex(end)} ${escapeRegex(token)}[ \\t]*\\r?\\n?`,
        'g'
    );
}

/** 删除指定 token 的所有受管块(两个标记族都删) */
export function removeManagedBlock(content: string, token: string): string {
    let out = String(content || '');
    out = out.replace(blockRegex(BEGIN_MARKER, END_MARKER, token), '');
    out = out.replace(blockRegex(LEGACY_BEGIN_MARKER, LEGACY_END_MARKER, token), '');
    return out;
}

/**
 * 用新块替换同 token 的旧块(无则追加), 保持用户自定义内容不动。
 *
 * 先删后加(而不是就地替换)是刻意的: 即使文件里有**多份**同 token 的块
 * (外部工具复制/历史累积), 也会被收敛成一份。
 */
export function upsertManagedBlock(content: string, block: string, token: string): string {
    let next = removeManagedBlock(content, token).replace(/\s+$/, '');
    if (next) { next += '\n\n'; }
    return `${next}${block.replace(/\s+$/, '')}\n`;
}

/** 统计某 token 的受管块数量(校验唯一性用) */
export function countManagedBlocks(content: string, token: string): number {
    const text = String(content || '');
    let count = 0;
    for (const [begin, end] of [
        [BEGIN_MARKER, END_MARKER],
        [LEGACY_BEGIN_MARKER, LEGACY_END_MARKER]
    ] as const) {
        const re = blockRegex(begin, end, token);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) { count++; }
    }
    return count;
}

export interface BlockPointer {
    token: string;
    compilationDatabase: string;
}

/**
 * 提取所有受管块的 token 与 CDB 指针(诊断/校验用)。
 * 只认本管线的标记族; 用户自定义片段不计入。
 */
export function extractBlockPointers(content: string): BlockPointer[] {
    const text = String(content || '');
    const result: BlockPointer[] = [];
    for (const [begin, end] of [
        [BEGIN_MARKER, END_MARKER],
        [LEGACY_BEGIN_MARKER, LEGACY_END_MARKER]
    ] as const) {
        const re = new RegExp(
            `${escapeRegex(begin)} (\\S+)[\\s\\S]*?${escapeRegex(end)} \\1`,
            'g'
        );
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const db = /CompilationDatabase:\s*"([^"]*)"/.exec(m[0]);
            result.push({ token: m[1], compilationDatabase: db ? db[1] : '' });
        }
    }
    return result;
}

/**
 * 回收失效项目的块(项目根与 CDB 目录都不存在)。
 *
 * 共享文件里会残留已删除/已移动项目的块; 不清会无限累积。判定保守:
 * 只有 PathMatch 指向的**全部**目录都不存在时才回收。
 */
export function pruneStaleBlocks(
    content: string,
    exists: (p: string) => boolean
): { content: string; removed: number } {
    let out = String(content || '');
    let removed = 0;

    for (const [begin, end] of [
        [BEGIN_MARKER, END_MARKER],
        [LEGACY_BEGIN_MARKER, LEGACY_END_MARKER]
    ] as const) {
        const re = new RegExp(
            `${escapeRegex(begin)} (\\S+)[\\s\\S]*?${escapeRegex(end)} \\1[ \\t]*\\r?\\n?`,
            'g'
        );
        out = out.replace(re, (whole: string) => {
            const pmRe = /PathMatch:\s*"([^"]*)"/g;
            let anyRootExists = false;
            let sawPathMatch = false;
            let pm: RegExpExecArray | null;
            while ((pm = pmRe.exec(whole)) !== null) {
                sawPathMatch = true;
                const root = pathFromPathMatch(pm[1]);
                if (root && exists(root)) { anyRootExists = true; break; }
            }
            if (sawPathMatch && !anyRootExists) {
                removed++;
                return '';
            }
            return whole;
        });
    }
    return { content: out, removed };
}

/**
 * 把 `renderPathMatchForRoot` 生成的正则还原为文件系统路径(无法还原时 undefined)。
 * 生成形态: `^[cC]:/path/.*$` 或 `^/path/.*$`
 */
export function pathFromPathMatch(pattern: string): string | undefined {
    const p = String(pattern || '').trim();
    if (!p.startsWith('^') || !p.endsWith('/.*$')) { return undefined; }

    let body = p.slice(1, -4);
    const drive = body.match(/^\[([A-Za-z])([A-Za-z])\]:/);
    if (drive) {
        body = `${drive[1].toUpperCase()}:` + body.slice(drive[0].length);
    }
    body = body.replace(/\\(.)/g, '$1');
    return body || undefined;
}
