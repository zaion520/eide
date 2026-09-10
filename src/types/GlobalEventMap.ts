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
 * 全局事件总线(`GlobalEvent`)的事件契约表。
 *
 * 说明:
 * - 事件名 → 参数元组,`GlobalEvent.on/once/prepend/emit` 均以此为唯一事实来源。
 * - **新增事件必须在此登记**;未登记的事件名无法通过编译(GlobalEvents 已移除
 *   `event: any` 兜底,拼错事件名将在编译期报错,而不是运行期静默失败)。
 * - `project.opened` 使用 type-only import 引用 `AbstractProject`,
 *   编译后不产生任何运行时代码,因此不会引入运行时循环依赖。
 */

import type { Message } from '../Message';

/**
 * `project.*` 事件载荷的不透明引用。
 *
 * 刻意**不** import 领域模型 `AbstractProject`:
 * 事件总线属于 L0 基础设施, 反向依赖 L1 领域模型会在编译期形成 L0→L1 的环 ——
 * 运行时虽无影响(`import type` 会被擦除), 但会把入度 15 的 `GlobalEvents`
 * 一并拖进依赖环, 破坏分层。需要完整类型的监听器自行窄化(见 EIDEProjectExplorer)。
 */
export type ProjectEventPayload = unknown;

export interface GlobalEventMap {

    /** 扩展激活流程结束(所有组件就绪) */
    'extension_launch_done': [];

    /** 项目已打开 */
    'project.opened': [prj: ProjectEventPayload];

    /** 项目已关闭 */
    'project.closed': [uid?: string];

    /** 激活项目发生变化 */
    'project.activeStatusChanged': [newuid: string];

    /** 错误弹框(vscode 右下角) */
    'error': [error: Error];

    /**
     * 消息弹框(vscode 右下角)
     * @deprecated 请改用 `GlobalEvent.show_msgbox(type, msg)`
     */
    'msg': [msg: Message];

    /** 打印日志 + 换行 → 输出面板 */
    'globalLog': [msg: Message];

    /** 打印原始日志字串 → 输出面板 */
    'globalLog.append': [log: string];

    /** 向用户显示 eide 输出面板日志 */
    'globalLog.show': [];
}

/** 合法的事件名 */
export type GlobalEventName = keyof GlobalEventMap;

/** 指定事件的监听器签名 */
export type GlobalEventListener<K extends GlobalEventName> =
    (...args: GlobalEventMap[K]) => void;
