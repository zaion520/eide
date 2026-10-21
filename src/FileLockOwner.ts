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
 * 文件锁持有者判定(**零依赖**, 可纯 node 单测)。
 *
 * 背景(两个真实缺陷, 均为实测):
 *
 * **缺陷 1 — 互斥失效**: 原 `FileLock.lock()` 对已存在的锁文件**无条件 unlink**,
 * 本意是清理崩溃残留, 但没有存活判定。两个窗口几乎同时 `Load()` 同一项目时:
 *
 *   窗口 A: 存在锁 → 删掉 → open('wx') 成功 → 认为独占
 *   窗口 B: 存在锁 → 删掉(A 的) → open('wx') 成功 → 也认为独占
 *
 * **缺陷 2 — 自己锁死自己**: 加上判活后暴露。`unlock()` 曾把"删除锁文件"写成
 * 只在传字符串路径时生效, 而调用方传的是 fd 数字 → 锁文件永不删除。于是
 * 重载项目(`Close()` → `Load()`)时读到的是**自己的**锁记录, pid 存活、年龄未超,
 * 判定为"被别的实例占用"而失败。日志表现: 同一进程内启动 4 分钟后报
 * "项目可能已被其他 EIDE 实例打开了"。
 *
 * 因此判定需要三个维度: 主机、进程启动时刻(会话标识)、pid 存活。
 * pid 会跨会话复用, 单靠 `process.kill(pid, 0)` 无法区分"活着的自己/别的进程"。
 */

/** 锁记录格式(写入锁文件的内容) */
export interface LockOwner {
    pid: number;
    /** 抢锁时刻(ms);0 表示未知(旧版本残留) */
    startedAt: number;
    /** 抢锁主机名;旧版本记录没有该字段 */
    host?: string;
    /** 持有进程的启动时刻(ms), 用作"会话标识";旧版本记录没有该字段 */
    sessionStart?: number;
}

/**
 * 陈旧锁判定阈值(ms)。
 *
 * 下限: 需覆盖慢启动(扩展激活 + 项目加载可达数十秒),太小会误抢活锁;
 * 上限: 崩溃残留不应阻塞太久。1 小时是"绝不可能是同一次会话"的安全边界,
 * 同时作为 pid 复用的兜底。
 */
export const STALE_LOCK_MS = 60 * 60 * 1000;

/**
 * 解析锁文件内容。
 * @returns 有效持有者记录;无内容/格式错误/pid 非法时返回 undefined(视为无主)
 */
export function parseLockOwner(raw: string | undefined): LockOwner | undefined {
    if (!raw) { return undefined; }
    let obj: any;
    try {
        obj = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!obj || typeof obj !== 'object') { return undefined; }
    const pid = obj.pid;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) { return undefined; }

    const startedAt = typeof obj.startedAt === 'number' && obj.startedAt >= 0 ? obj.startedAt : 0;
    const owner: LockOwner = { pid, startedAt };
    if (typeof obj.host === 'string' && obj.host) { owner.host = obj.host; }
    if (typeof obj.sessionStart === 'number' && obj.sessionStart > 0) { owner.sessionStart = obj.sessionStart; }
    return owner;
}

export type LockAction =
    /** 无锁, 直接抢 */
    | 'acquire'
    /** 活锁, 拒绝(调用方应报"已被另一窗口打开") */
    | 'reject'
    /** 陈旧锁, 删除后抢占 */
    | 'steal';

export interface LockDecisionInput {
    /** 锁文件是否存在 */
    exists: boolean;
    /** 解析出的持有者;无主/损坏为 undefined */
    owner: LockOwner | undefined;
    /** 当前时刻 */
    now: number;
    /** pid 存活探测(注入以便单测) */
    alive: (pid: number) => boolean;
    /** 当前主机名 */
    host: string;
    /** 当前进程的启动时刻(会话标识) */
    sessionStart: number;
}

export function decideLockAction(input: LockDecisionInput): LockAction {
    if (!input.exists) { return 'acquire'; }

    const owner = input.owner;
    // 无主记录(旧版本创建的空锁 / 内容损坏): 无法判活, 保守视为陈旧
    if (owner === undefined) { return 'steal'; }

    // 主机不同: 共享 tmp 目录(网络盘/容器挂载)时别的主机的 pid 不可判定
    if (owner.host !== undefined && input.host && owner.host !== input.host) {
        return 'steal';
    }

    // 会话不同: pid 可能被系统复用给别的进程, 一定是旧锁
    // (这是"自己锁死自己"/"pid 复用误报"的关键判据)
    if (owner.sessionStart !== undefined && owner.sessionStart !== input.sessionStart) {
        return 'steal';
    }

    // 持有者进程已消失 -> 崩溃残留
    if (!input.alive(owner.pid)) { return 'steal'; }

    // pid 活着但锁太老 -> pid 复用, 不是当初那个进程
    if (input.now - owner.startedAt > STALE_LOCK_MS) { return 'steal'; }

    return 'reject';
}
