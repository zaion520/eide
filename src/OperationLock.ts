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
 * 键控互斥锁。
 *
 * 取代此前散落在 `ProjectExplorer` 里的 5 个布尔标志
 * (`_builderLock` / `_uploadLock` / `installLocked` / `exportLocked` / `install_lock`):
 * 它们各自为政、命名不一(其中两个还是同一概念的两份字段), 且异常路径容易漏解锁。
 *
 * 本类把"某个操作正在进行中"收敛为一处状态, 并提供 `tryRun` 统一保证 finally 释放。
 */
export class OperationLock {

    private readonly _held = new Set<string>();

    /** 尝试获取锁; 已被占用则返回 false(不阻塞, 立即返回) */
    tryAcquire(key: string): boolean {
        if (this._held.has(key)) {
            return false;
        }
        this._held.add(key);
        return true;
    }

    /** 释放锁(未持有时为无操作, 不抛异常) */
    release(key: string): void {
        this._held.delete(key);
    }

    isLocked(key: string): boolean {
        return this._held.has(key);
    }

    /** 当前持有的全部 key(便于调试/断言) */
    get heldKeys(): string[] {
        return [...this._held];
    }

    /**
     * 获取锁并执行 `fn`, 无论成功或抛异常都会在 finally 中释放。
     * - 锁已被占用: 不执行 `fn`, 返回 `{ ok: false }`
     * - 执行成功: 返回 `{ ok: true, value }`
     * - `fn` 抛异常: 释放锁后向上抛出(调用方自行 try/catch)
     */
    async tryRun<T>(key: string, fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false }> {
        if (!this.tryAcquire(key)) {
            return { ok: false };
        }
        try {
            return { ok: true, value: await fn() };
        } finally {
            this.release(key);
        }
    }
}

/** 常用的操作锁 key(避免各处手写字符串拼错) */
export const OpLockKeys = {
    Build: 'build',
    BuildAllTargets: 'buildAllTargets',
    Upload: 'upload',
    InstallPackage: 'installPackage',
    Export: 'export',
    CmsisInstall: 'cmsisInstall'
} as const;

export type OpLockKey = typeof OpLockKeys[keyof typeof OpLockKeys];
