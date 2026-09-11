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
 * 工具链名字联合类型 —— 类型叶子模块（**零依赖**）。
 *
 * 原定义在 `ToolchainManager.ts`（4000+ 行的实现文件）里，导致 12 个只需要这个
 * 字符串联合的文件都必须 import 那个大模块，在类型依赖层面形成环。
 * 下沉到本模块后，双方都只依赖叶子，类型级环即断。
 *
 * 约束：本模块不得 import 任何其他 src 模块（含类型），否则断环失效。
 */

export type ToolchainName =
    'GNU_SDCC_MCS51' | 'SDCC' | 'Keil_C51' | 'IAR_STM8' | 'GNU_SDCC_STM8' | 'COSMIC_STM8' |
    'AC5' | 'AC6' | 'GCC' | 'IAR_ARM' |
    'RISCV_GCC' | 'ANY_GCC' | 'MIPS_GCC' | 'MTI_GCC' | 'LLVM_ARM' | 'None';
