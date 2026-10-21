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
 * 「构建所有 target」结束后的激活态恢复判定(**零 src 依赖**)。
 *
 * 规格: 跑完必须回到**原来的**激活 target, 不能停在最后一个(更不是第一个)。
 *
 * 单独抽出判定的原因: 内联写法 `if (current !== original) switch(original)`
 * 有三个盲点 ——
 *  1. 并行路径在 `jobs` 为空时提前 return, 恢复语句容易被漏掉;
 *  2. `switchTarget` 抛错若被 catch 吞掉, 用户只会看到"构建完成"却停错 target;
 *  3. 构建期间原 target 被删除/重命名时, 直接 switch 会抛 "not found",
 *     需要明确报告而不是静默停在别的 target 上。
 */

export type TargetRestoreAction =
    /** 已经在原 target 上, 无需操作 */
    | 'none'
    /** 切回原 target */
    | 'switch'
    /** 原 target 已不存在, 无法恢复(调用方应明确告警) */
    | 'unavailable';

export interface TargetRestoreInput {
    /** 构建开始前的激活 target */
    originalTarget: string;
    /** 构建结束时的激活 target */
    currentTarget: string;
    /** 当前仍存在的 target 名 */
    availableTargets: string[];
}

export interface TargetRestorePlan {
    action: TargetRestoreAction;
    /** action='switch' 时为要切回的规范 target 名 */
    target?: string;
}

/**
 * 计算恢复动作。
 *
 * target 名按大小写不敏感比较(与 `validateTargetName` 的重名检查、`env.ini`
 * 段名一致), 但返回值始终用 `availableTargets` 里的规范写法, 避免把用户输入
 * 的大小写差异写回配置。
 */
export function planTargetRestore(input: TargetRestoreInput): TargetRestorePlan {
    const original = String(input.originalTarget || '');
    const current = String(input.currentTarget || '');
    const lower = (v: string) => v.toLowerCase();

    // 已经在原 target 上(大小写差异不算变化)
    if (lower(original) === lower(current)) {
        return { action: 'none' };
    }

    const canonical = (input.availableTargets || []).find((n) => lower(n) === lower(original));
    if (canonical === undefined) {
        return { action: 'unavailable', target: original };
    }

    return { action: 'switch', target: canonical };
}
