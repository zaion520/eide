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

import * as events from 'events';
import { Message, ExceptionToMessage, newMessage, MessageType } from './Message';
import type { GlobalEventMap, GlobalEventName, GlobalEventListener } from './types/GlobalEventMap';

let _globalEvent: GlobalEvent | undefined;

export class GlobalEvent {

    private _emitter: events.EventEmitter;

    private constructor() {
        this._emitter = new events.EventEmitter();
    }

    static GetInstance(): GlobalEvent {
        if (_globalEvent === undefined) {
            _globalEvent = new GlobalEvent();
        }
        return _globalEvent;
    }

    // 事件名与参数类型统一登记在 GlobalEventMap(见 ./types/GlobalEventMap.ts),
    // 此处不再保留 `event: any` 兜底 —— 拼错事件名会在编译期报错
    static on<K extends GlobalEventName>(event: K, listener: GlobalEventListener<K>): void {
        GlobalEvent.GetInstance()._emitter.on(event, listener as (...args: any[]) => void);
    }

    static once<K extends GlobalEventName>(event: K, listener: GlobalEventListener<K>): void {
        GlobalEvent.GetInstance()._emitter.once(event, listener as (...args: any[]) => void);
    }

    static prepend<K extends GlobalEventName>(event: K, listener: GlobalEventListener<K>): void {
        GlobalEvent.GetInstance()._emitter.prependListener(event, listener as (...args: any[]) => void);
    }

    // 事件名与参数类型由 GlobalEventMap 约束
    static emit<K extends GlobalEventName>(event: K, ...args: GlobalEventMap[K]): boolean {
        return GlobalEvent.GetInstance()._emitter.emit(event, ...args);
    }

    //vscode notify
    static show_msgbox(type: MessageType, msg: string | Error) {
        if (msg instanceof Error)
            return GlobalEvent.GetInstance()._emitter.emit('msg', ExceptionToMessage(msg, type));
        else
            return GlobalEvent.GetInstance()._emitter.emit('msg', newMessage(type, msg));
    }

    //log
    static log_info(msg: string) {
        GlobalEvent.GetInstance()._emitter.emit('globalLog', newMessage('Info', msg));
    }
    static log_warn(msg: string | Error) {
        if (typeof msg == 'string') {
            GlobalEvent.GetInstance()._emitter.emit('globalLog', newMessage('Warning', msg));
        } else {
            GlobalEvent.GetInstance()._emitter.emit('globalLog', ExceptionToMessage(msg, 'Warning'));
        }
        console.warn(msg);
    }
    static log_error(msg: string | Error) {
        if (typeof msg == 'string') {
            GlobalEvent.GetInstance()._emitter.emit('globalLog', newMessage('Error', msg));
        } else {
            GlobalEvent.GetInstance()._emitter.emit('globalLog', ExceptionToMessage(msg, 'Error'));
        }
        console.error(msg);
    }
    static log_show() {
        GlobalEvent.GetInstance()._emitter.emit('globalLog.show');
    }
}

GlobalEvent.on('error', (err) => {
    if (err) {
        GlobalEvent.show_msgbox('Error', err);
    } else {
        GlobalEvent.show_msgbox('Error', new Error('Empty Error received !'));
    }
});
