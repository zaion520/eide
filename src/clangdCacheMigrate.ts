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
 * 项目内 clangd 产物 -> 全局缓存的迁移决策(**零 src 依赖**)。
 *
 * 迁移的崩溃安全要求: 先把 CDB 与索引缓存搬到全局, 确认成功后才删项目内目录。
 * 中途崩溃最多留下"两份都在", 下次运行仍能继续(全局已存在则跳过搬运, 项目内
 * 目录继续被清理)。
 *
 * 两条"不覆盖"规则:
 *  - 全局 CDB 已存在 -> 不搬运(全局可能更新, 反向覆盖会丢数据)
 *  - 全局索引缓存已存在 -> 不搬运(索引可重建, 但没必要覆盖)
 */

export interface CacheMigrationInput {
    legacyCdbExists: boolean;
    globalCdbExists: boolean;
    legacyCacheExists: boolean;
    globalCacheExists: boolean;
}

export interface CacheMigrationPlan {
    /** 把项目内 CDB 搬到全局 */
    moveCdb: boolean;
    /** 把项目内 `.cache/` 索引搬到全局(优先 rename 保留) */
    moveIndexCache: boolean;
    /** 删除项目内旧目录 */
    removeLegacyDir: boolean;
}

export function planCacheMigration(input: CacheMigrationInput): CacheMigrationPlan {
    const moveCdb = input.legacyCdbExists && !input.globalCdbExists;
    const moveIndexCache = input.legacyCacheExists && !input.globalCacheExists;
    // 只要项目内还有任何 clangd 产物, 就清理该目录
    const removeLegacyDir = input.legacyCdbExists || input.legacyCacheExists;
    return { moveCdb, moveIndexCache, removeLegacyDir };
}
