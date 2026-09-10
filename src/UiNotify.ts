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
 * 纯 UI 通知叶子模块(只依赖 vscode, 不依赖任何业务模块)。
 *
 * 为什么单独成模块: `notifyReloadWindow` 原先放在 `utility.ts`(垃圾抽屉),
 * 而 `SettingManager` 需要用它 —— 于是形成 `SettingManager ↔ utility` 的
 * 运行时环。把它下沉到叶子模块后, 两侧都只依赖本模块, 环即断开。
 */

import * as vscode from 'vscode';

/** 提示用户重启窗口(用户点 Ok 才真正 reload) */
export async function notifyReloadWindow(msg: string): Promise<void> {
    const resp = await vscode.window.showInformationMessage(msg, 'Ok', 'Later');
    if (resp == 'Ok') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
