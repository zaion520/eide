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

'use strict';

import * as vscode from 'vscode';

/**
 * Build All 进度状态终端(pseudoterminal):
 * 只输出 Build All 编排层面的高层状态(准备参数/启动/完成/失败),
 * 与单 target 编译终端(`build:<target>`,输出编译过程)相互独立,
 * 用于消除 Phase 1(切换 target + 生成 builder.params)等静默等待期的无反馈问题。
 */

type StatusKind = 'dim' | 'info' | 'head' | 'ok' | 'warn' | 'fail';

const ANSI_RESET = '\x1b[0m';

const paint: Record<StatusKind, (text: string) => string> = {
    dim: (text) => `\x1b[90m${text}${ANSI_RESET}`,
    info: (text) => `\x1b[97m${text}${ANSI_RESET}`,
    head: (text) => `\x1b[96;1m${text}${ANSI_RESET}`,
    ok: (text) => `\x1b[32;1m${text}${ANSI_RESET}`,
    warn: (text) => `\x1b[93;1m${text}${ANSI_RESET}`,
    fail: (text) => `\x1b[91;1m${text}${ANSI_RESET}`,
};

function timestamp(): string {
    const now = new Date();
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** 把多行错误压成单行并截断 */
function oneLine(text: string, maxLen: number = 200): string {
    const line = text.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join(' | ') || 'unknown error';
    return line.length > maxLen ? `${line.slice(0, maxLen)}...` : line;
}

class StatusPty implements vscode.Pseudoterminal {

    private readonly writeEmitter = new vscode.EventEmitter<string>();
    readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    private closed: boolean = false;
    /** open() 之前终端不接收数据,先缓冲,open 时回放(show() 触发的 open 是异步的) */
    private opened: boolean = false;
    private pending: string[] = [];

    OnClosed: () => void = () => { /* noop */ };

    open(): void {
        this.opened = true;
        if (this.pending.length) {
            const backlog = this.pending.join('');
            this.pending = [];
            this.writeEmitter.fire(backlog);
        }
    }

    close(): void {
        if (this.closed) { return; }
        this.closed = true;
        this.OnClosed();
    }

    write(text: string): void {
        if (this.closed) { return; }
        const data = text.replace(/\n/g, '\r\n');
        if (!this.opened) {
            this.pending.push(data);
            return;
        }
        this.writeEmitter.fire(data);
    }

    dispose(): void {
        this.writeEmitter.dispose();
    }
}

export class BuildAllStatus {

    private static instances = new Map<string, BuildAllStatus>();

    private readonly pty: StatusPty;
    private readonly terminal: vscode.Terminal;

    private constructor(projectName: string) {
        this.pty = new StatusPty();
        this.pty.OnClosed = () => {
            BuildAllStatus.instances.delete(projectName);
            this.pty.dispose();
        };
        this.terminal = vscode.window.createTerminal({
            name: `build-all:${projectName}`,
            pty: this.pty,
            iconPath: new vscode.ThemeIcon('tools')
        });
    }

    /** 获取(必要时重建)项目对应的 Build All 状态终端 */
    public static Get(projectName: string): BuildAllStatus {
        let instance = BuildAllStatus.instances.get(projectName);
        if (!instance) {
            instance = new BuildAllStatus(projectName);
            BuildAllStatus.instances.set(projectName, instance);
        }
        return instance;
    }

    public Show(preserveFocus: boolean = true): void {
        this.terminal.show(preserveFocus);
    }

    /** 输出一轮 Build All 的分隔头部(不清屏,保留历史,starting 提示不被擦除) */
    public Header(text: string): void {
        this.pty.write(`\n${paint.dim('──────')} ${paint.head(text)} ${paint.dim('──────')}\n`);
    }

    public Step(text: string): void {
        this.pty.write(`${paint.dim(`[${timestamp()}]`)} ${paint.head(text)}\n`);
    }

    public Info(text: string): void {
        this.pty.write(`${paint.dim(`[${timestamp()}]`)} ${paint.info(text)}\n`);
    }

    public Ok(text: string): void {
        this.pty.write(`${paint.dim(`[${timestamp()}]`)} ${paint.ok(text)}\n`);
    }

    public Warn(text: string): void {
        this.pty.write(`${paint.dim(`[${timestamp()}]`)} ${paint.warn(text)}\n`);
    }

    public Fail(text: string): void {
        this.pty.write(`${paint.dim(`[${timestamp()}]`)} ${paint.fail(text)}\n`);
    }

    /** 失败原因摘要(单行,暗色) */
    public FailReason(message: string | undefined): void {
        this.pty.write(`  ${paint.dim(oneLine(message || 'unknown error'))}\n`);
    }

    /** 失败时摘录构建输出末尾几行(不是过程回放,只是终点错误定位) */
    public ErrorExcerpt(stdout: string, maxLines: number = 6): void {
        const lines = stdout.split(/\r?\n/)
            .map((l) => l.trimEnd())
            .filter((l) => l.trim().length > 0);
        if (!lines.length) { return; }
        this.pty.write(`  ${paint.dim('└ last output:')}\n`);
        for (const line of lines.slice(-maxLines)) {
            this.pty.write(`  ${paint.dim(line)}\n`);
        }
    }
}
