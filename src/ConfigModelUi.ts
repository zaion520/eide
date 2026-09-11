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
 * ConfigModel 的 UI 适配器 —— 领域模型(P1-1)不再直接调用 vscode.window.*,
 * 而是通过本模块持有的适配器间接访问;具体实现由组合根(extension.ts)在激活时注入。
 *
 * 设计约束:
 *  - 本模块对 vscode 只允许 **import type**(运行时零依赖), 因此可在纯 node 测试里
 *    注入假适配器来驱动 ConfigModel.ShowModifyWindow 的各分支;
 *  - 适配器未注入前调用 getter 会抛错 —— 组合根必须在 activate() 最先注册。
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as vscode from 'vscode';

export interface ConfigModelUiAdapter {
    showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined>;
    showQuickPick<T extends vscode.QuickPickItem>(items: T[], options: vscode.QuickPickOptions): Promise<T | undefined>;
    showOpenDialog(options: vscode.OpenDialogOptions): Promise<vscode.Uri[] | undefined>;
    /** vscode.QuickPickItemKind.Separator 的值(枚举是运行时值, 须经适配器传递) */
    readonly quickPickItemKindSeparator: vscode.QuickPickItemKind;
    /** vscode.Uri.file 的等价构造 */
    fileUri(path: string): vscode.Uri;
}

let adapter: ConfigModelUiAdapter | undefined;

export function setConfigModelUiAdapter(a: ConfigModelUiAdapter): void {
    adapter = a;
}

export function getConfigModelUiAdapter(): ConfigModelUiAdapter {
    if (!adapter) {
        throw new Error('ConfigModelUiAdapter not registered: call setConfigModelUiAdapter() in extension activate() first');
    }
    return adapter;
}

/** 测试辅助: 清空适配器(恢复未注册状态) */
export function resetConfigModelUiAdapter(): void {
    adapter = undefined;
}
