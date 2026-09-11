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
 * 烧录器类型联合 —— 类型叶子模块（**零依赖**）。
 *
 * 原定义在 `HexUploader.ts` 里，只需该类型的文件不必再 import 那个大实现模块，
 * 从而在类型依赖层面断环。
 *
 * 约束：本模块不得 import 任何其他 src 模块（含类型）。
 */

export type HexUploaderType = 'JLink' | 'STVP' | 'STLink' | 'stcgal' | 'pyOCD' | 'OpenOCD' | 'probe-rs' | 'Custom';

/** CPU 标识(供应商 + 型号)。原定义在 HexUploader.ts, 下沉到叶子类型层 */
export interface CPUInfo {
    vendor: string;
    cpuName: string;
}
