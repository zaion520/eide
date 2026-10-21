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
 * clangd 重建结果的校验逻辑(**零 src 依赖**)。
 *
 * 维修通道(右键「生成 clangd 配置」)的语义是"强制修复到已知良好状态"。
 * 原实现把每一步的失败都吞进 `log_error`, 用户点完看到"成功"提示但实际什么
 * 都没写成 —— 维修通道因此形同虚设。
 *
 * 这里把校验做成纯函数: 写完**读回**验证, 结果可判定。要么 ok=true(逐项验过),
 * 要么 ok=false 且每步失败原因清楚, 供 UI 明确报告。
 */

import { countManagedBlocks, extractBlockPointers } from './clangdUserConfigBlock';

export type RebuildStepName =
    | 'cache-root'
    | 'shim'
    | 'cdb'
    | 'config-block'
    | 'workspace-settings'
    | 'file-exclude'
    | 'cleanup'
    | 'restart';

export interface RebuildStep {
    name: RebuildStepName;
    ok: boolean;
    /** 失败原因 / 写入位置 / 条目数等可读信息 */
    detail?: string;
}

/**
 * 校验编译数据库内容。
 *
 * @param expectedCount 期望条目数; -1 表示缺 `builder.params`(从未构建过)
 */
export function verifyCdbContent(raw: string, expectedCount: number): RebuildStep {
    if (expectedCount < 0) {
        return {
            name: 'cdb',
            ok: false,
            detail: "no 'builder.params' for this target - build the project at least once first"
        };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (error: any) {
        return { name: 'cdb', ok: false, detail: `invalid JSON: ${error?.message || String(error)}` };
    }

    if (!Array.isArray(parsed)) {
        return { name: 'cdb', ok: false, detail: 'not a JSON array' };
    }

    if (parsed.length !== expectedCount) {
        return {
            name: 'cdb',
            ok: false,
            detail: `wrote ${expectedCount} entries but read back ${parsed.length} (truncated write?)`
        };
    }

    return { name: 'cdb', ok: true, detail: `${parsed.length} entries` };
}

/** 校验受管块唯一性(历史事故: 外部工具复制/累积导致多份块并存) */
export function verifyBlockUnique(content: string, token: string): RebuildStep {
    const count = countManagedBlocks(content, token);
    if (count === 1) {
        return { name: 'config-block', ok: true, detail: 'single block' };
    }
    if (count === 0) {
        return { name: 'config-block', ok: false, detail: 'managed block missing after write' };
    }
    return {
        name: 'config-block',
        ok: false,
        detail: `found ${count} blocks for this project (expected 1)`
    };
}

function normalizePathForCompare(p: string): string {
    return String(p || '').split('\\').join('/').replace(/\/+$/, '').toLowerCase();
}

/** 校验块内的 CDB 指针是否指向期望目录 */
export function verifyBlockPointer(
    content: string,
    token: string,
    expectedDb: string
): RebuildStep {
    const pointers = extractBlockPointers(content).filter((p) => p.token === token);
    if (pointers.length === 0) {
        return { name: 'config-block', ok: false, detail: 'managed block missing after write' };
    }

    const expected = normalizePathForCompare(expectedDb);
    const hit = pointers.some((p) => normalizePathForCompare(p.compilationDatabase) === expected);
    if (hit) {
        return { name: 'config-block', ok: true, detail: `pointer -> ${expectedDb}` };
    }

    return {
        name: 'config-block',
        ok: false,
        detail: `pointer mismatch: expected '${expectedDb}', found '${pointers[0].compilationDatabase}'`
    };
}

export interface RebuildSummary {
    ok: boolean;
    failures: RebuildStep[];
}

/**
 * 汇总步骤结果。
 *
 * 空列表视为失败 —— "什么都没验证"不等于成功(维修通道绝不允许这种假阳性)。
 */
export function summarizeSteps(steps: RebuildStep[]): RebuildSummary {
    const failures = (steps || []).filter((s) => !s.ok);
    return {
        ok: steps.length > 0 && failures.length === 0,
        failures
    };
}
