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
 * 刷新管线状态机。
 *
 * 取代原先"纯尾缘防抖 + 一个 `__cpptools_updateTimeout` 变量兼作状态标志"的写法。
 * 原实现有两个已确认缺陷:
 *
 * - **D1 孤儿计时器**: 全程没有 `clearTimeout`, 只在 `doUpdateCpptoolsConfig` 末尾把变量置
 *   `undefined`; 执行期间 `refresh()` 重排的计时器会脱离管理, 之后仍会触发一次。
 * - **D2 并发开链**: `doUpdateCompilerDatabase()` 未被 await(它返回 Promise), 异步段一开始
 *   变量就被置空, 此时到达的新请求会**另开一条完整刷新链**, 与仍在运行的构建器并发写同一份
 *   `builder.params` / compile_commands。
 *
 * 状态机语义:
 *
 * ```
 *   Idle ──request──▶ Debouncing ──计时到期──▶ Refreshing ──完成且无 dirty──▶ Idle
 *                        ▲   │                      │
 *                        └───┘ request 重置计时      ├─ request ▶ 仅置 dirty(不开新链)
 *                        ▲                          │
 *                        └─── 完成但有 dirty: 再排一轮 ┘
 *   Suspended: request 只置 dirty, 不排计时; resume(flush) 决定是否立即执行
 * ```
 *
 * 计时器通过 `TimerScheduler` 注入, 因此可被单元测试完全同步地驱动。
 */

export type RefreshState = 'idle' | 'debouncing' | 'refreshing' | 'suspended';

export interface TimerScheduler {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

/** 默认使用宿主环境的定时器 */
export const systemScheduler: TimerScheduler = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(<NodeJS.Timeout>handle)
};

export interface RefreshStateMachineOptions {
    /** 实际执行的刷新动作(通常为 cpptools 配置 + 编译数据库 + clangd 三连刷) */
    run: () => Promise<void> | void;
    /** 静默窗口时长(ms), 默认 300 */
    debounceMs?: number;
    /** 一轮完成后再补一轮之前的间隔(ms), 默认 50 */
    settleMs?: number;
    /** 定时器实现, 测试时注入假实现 */
    scheduler?: TimerScheduler;
    /** 状态变化回调(便于日志/可观测) */
    onStateChange?: (to: RefreshState, from: RefreshState) => void;
    /** `run` 抛错时的回调(状态机自身不吞异常语义, 只做通知) */
    onError?: (err: unknown) => void;
}

export class RefreshStateMachine {

    private _state: RefreshState = 'idle';
    private _dirty: boolean = false;
    private _timer: unknown = undefined;
    /** 计时器世代: 每次排/清计时器都自增, 过期回调据此直接丢弃(彻底杜绝孤儿计时器) */
    private _epoch: number = 0;

    private readonly _debounceMs: number;
    private readonly _settleMs: number;
    private readonly _sched: TimerScheduler;
    private readonly _run: () => Promise<void> | void;
    private readonly _onStateChange?: (to: RefreshState, from: RefreshState) => void;
    private readonly _onError?: (err: unknown) => void;

    constructor(opts: RefreshStateMachineOptions) {
        this._run = opts.run;
        this._debounceMs = opts.debounceMs ?? 300;
        this._settleMs = opts.settleMs ?? 50;
        this._sched = opts.scheduler ?? systemScheduler;
        this._onStateChange = opts.onStateChange;
        this._onError = opts.onError;
    }

    get state(): RefreshState {
        return this._state;
    }

    /** 是否正在执行刷新(用于对外暴露"忙碌中") */
    get isRefreshing(): boolean {
        return this._state === 'refreshing';
    }

    /** 是否有被合并等待处理的请求 */
    get hasPendingRequest(): boolean {
        return this._dirty;
    }

    /**
     * 请求一次刷新。
     * @param mode 'debounce'(默认) 走静默窗口; 'immediate' 立即执行(仍受 suspended/refreshing 约束)
     */
    request(mode: 'debounce' | 'immediate' = 'debounce'): void {

        switch (this._state) {

            // 挂起期间: 只记账, 不排链
            case 'suspended':
                this._dirty = true;
                return;

            // 执行中: 只置 dirty —— 绝不并发开第二条链(D2)
            case 'refreshing':
                this._dirty = true;
                return;

            // 静默窗口内: 重置计时(统一 clear + set, 不再用 refresh())
            case 'debouncing':
                this._clearTimer();
                if (mode === 'immediate') {
                    void this._fire(true);
                    return;
                }
                this._setTimer(this._debounceMs);
                return;

            // idle: 进入静默窗口
            default:
                if (mode === 'immediate') {
                    void this._fire(true);
                    return;
                }
                this._setState('debouncing');
                this._setTimer(this._debounceMs);
                return;
        }
    }

    /** 挂起: 用于 Build All / 工作区批量加载等会连续切换 target 的场景 */
    suspend(): void {
        this._clearTimer();
        this._setState('suspended');
    }

    /**
     * 恢复。
     * @param flush true 立即执行一次; false 仅在有等待请求时才排一轮
     */
    resume(flush: boolean = false): void {
        if (this._state !== 'suspended') {
            return;
        }
        this._setState('idle');
        if (flush) {
            this.request('immediate');
            return;
        }
        if (this._dirty) {
            this._setState('debouncing');
            this._setTimer(this._debounceMs);
        }
    }

    /** 清理计时器(扩展卸载/项目 dispose 时调用), 之后不再触发 */
    dispose(): void {
        this._clearTimer();
        this._setState('idle');
        this._dirty = false;
    }

    // ------------------------------------------------------------------
    // inner
    // ------------------------------------------------------------------

    private _setTimer(ms: number): void {
        const myEpoch = ++this._epoch;
        this._timer = this._sched.set(() => {
            // 世代不匹配 = 该计时器已被重置/清理, 属于过期回调, 直接丢弃(D1)
            if (myEpoch !== this._epoch) {
                return;
            }
            void this._fire();
        }, ms);
    }

    private _clearTimer(): void {
        this._epoch++;   // 使所有已排布的回调失效
        if (this._timer !== undefined) {
            this._sched.clear(this._timer);
            this._timer = undefined;
        }
    }

    private async _fire(force: boolean = false): Promise<void> {

        // 挂起/执行中一律不执行(执行中的请求改为置 dirty)
        if (this._state === 'suspended' || this._state === 'refreshing') {
            return;
        }

        // 仅"静默窗口到期"这一条路径允许执行。
        // 这一守卫同时消灭了 D1: 被 clear 掉的"孤儿"计时器即使回调被触发, 也不会再跑一轮。
        if (!force && this._state !== 'debouncing') {
            return;
        }

        this._clearTimer();
        this._dirty = false;
        this._setState('refreshing');

        try {
            await this._run();
        } catch (err) {
            if (this._onError) {
                this._onError(err);
            }
        } finally {
            if (this._isSuspended()) {
                // 执行期间被挂起: 保持挂起, 交给 resume 决定
                return;
            }
            if (this._dirty) {
                this._setState('debouncing');
                this._setTimer(this._settleMs);
            } else {
                this._setState('idle');
            }
        }
    }

    /** 单独封装以避免 `await` 之后 TS 控制流收窄造成的误报 */
    private _isSuspended(): boolean {
        return this._state === 'suspended';
    }

    private _setState(to: RefreshState): void {
        if (to === this._state) {
            return;
        }
        const from = this._state;
        this._state = to;
        if (this._onStateChange) {
            this._onStateChange(to, from);
        }
    }
}
