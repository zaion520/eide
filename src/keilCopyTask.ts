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
 * Keil (MDK) 导入时合成的 "拷贝链接产物" 任务的命令渲染/修复(**零依赖**, 可纯 node 单测)。
 *
 * 背景: Keil 的 User Command (%L / #L 等) 若被引用, 需要在 `<OutputDirectory>` 下找到
 * 链接产物 `.axf`; EIDE 的产物在 `<OutDir>` 下, 因此导入时会生成一条 POST-BUILD 任务把
 * 它拷过去。
 *
 * 历史实现(单一 cmd.exe 形态)有三个缺陷, 都会在构建时报错:
 *   1. `mkdir Objects` 在目录已存在时输出 "子目录或文件 … 已经存在" 并置 errorlevel=1;
 *      因为用的是单个 `&`, `copy` 仍会执行 —— 于是**每次构建**都打印一行错误。
 *   2. `copy` 缺 `/Y`。目标已存在时会交互式询问 "覆盖 … 吗?"; builder 的子进程
 *      stdin 指向 NUL, 读到 EOF 视为 No → "已复制 0 个文件" + errorlevel=1 → 任务失败。
 *      这是**第二次及以后构建**必然失败的根因。
 *   3. Linux/macOS 下 `copy` 是 cmd 内建命令, 根本不存在; 且路径用 `\` 分隔。
 *
 * 本模块按目标平台渲染正确形态, 并修复已存进 `eide.yml` 的旧命令字符串
 * (构建时修复, 不回写工程配置 —— 与 "手改持久化" 的既定策略一致)。
 */

/** 合成任务的固定名称, 是识别"这条任务属于我们、可以安全重写"的唯一依据。 */
export const KEIL_COPY_TASK_NAME = '[Copy linker output for Keil User Commands]';

export interface KeilCopyVars {
    /** 绝对输出目录变量, 默认 `${OutDir}` */
    outDir?: string;
    /** 工程名(链接产物基名)变量, 默认 `${ProjectName}` */
    projectName?: string;
    /** Keil 的 `<OutputDirectory>`, 相对 mdk 工程目录, 默认 `${KEIL_OUTPUT_DIR}` */
    keilOutputDir?: string;
    /** Keil 的 `<OutputName>`, 默认 `${KEIL_OUTPUT_NAME}` */
    keilOutputName?: string;
}

export type KeilCopyOS = 'win32' | string;

function isWin(osType: KeilCopyOS): boolean {
    return osType === 'win32';
}

function quote(str: string): string {
    return `"${str}"`;
}

/** 统一路径分隔符为目标平台风格; 只作用于字面量部分, `${VAR}` 原样保留。 */
function toPathStyle(str: string, osType: KeilCopyOS): string {
    if (!isWin(osType)) {
        // `\` → `/`, 并折叠重复分隔符(旧串里 `\\` 转义残留会变成 `//`)。
        // 只折叠**非开头**的重复分隔符: 开头的 `//` 在 POSIX 下有 "实现定义" 语义
        // (部分工具当 UNC 用), 不该被静默改写。
        return str.replace(/\\/g, '/').replace(/(.)\/{2,}/g, '$1/');
    }
    // 以 '/' 开头的绝对路径不可能来自 win32: 工程跨平台搬家时 `cd …` 前缀同样是错的,
    // 这里不把它改写成 `\p\...` 这种看似合法实则必错的形态, 保持原样便于用户识别。
    if (str.startsWith('/')) { return str; }
    return str.replace(/\//g, '\\');
}

/**
 * 渲染"拷贝链接产物"命令(**不含**调用方追加的 `cd xxx && ` 前缀)。
 *
 * win32 : `if not exist "D" mkdir "D" & copy /Y "F" "T"`
 *   ① `if not exist` 让 `mkdir` 只在缺目录时执行 —— cmd 的 `mkdir` 对已存在目录
 *      会打印"子目录或文件 … 已经存在"并置 errorlevel=1, 这是**每次构建**都
 *      多出一行错误的原因;
 *   ② `copy` 缺 `/Y` 时, 目标已存在会交互式询问"覆盖 … 吗?"; builder 的子进程
 *      stdin 指向 NUL, 读到 EOF 视为 No → "已复制 0 个文件" + 非零退出码 →
 *      任务失败。这是**第二次及以后构建**必然报错的根因;
 *   ③ 用单个 `&` 而非 `&&` 连接: cmd 先按 `&`/`&&` 拆命令行, `if` 只覆盖
 *      `mkdir "D"` 这一句。目录已存在时 `if` 什么都不执行、errorlevel 沿用上一句,
 *      用 `&&` 会让 `copy` 因残留 errorlevel 被跳过; `&` 保证 `copy` 一定执行,
 *      整行退出码取 `copy` 的, 语义确定。
 * 其它  : `mkdir -p "D" && cp -f "F" "T"` —— `mkdir -p` 幂等, `&&` 安全。
 */
export function renderKeilCopyCommand(vars: KeilCopyVars, osType: KeilCopyOS): string {

    const arch    = vars.outDir || '${OutDir}';
    const name    = vars.projectName || '${ProjectName}';
    const outDir  = vars.keilOutputDir || '${KEIL_OUTPUT_DIR}';
    const outName = vars.keilOutputName || '${KEIL_OUTPUT_NAME}';

    const sep = isWin(osType) ? '\\' : '/';
    const from = `${arch}${sep}${name}.axf`;
    const to = `${outDir}${sep}${outName}.axf`;

    if (isWin(osType)) {
        return `if not exist ${quote(outDir)} mkdir ${quote(outDir)} & copy /Y ${quote(from)} ${quote(to)}`;
    }
    return `mkdir -p ${quote(outDir)} && cp -f ${quote(from)} ${quote(to)}`;
}

function stripQuotes(str: string): string {
    const s = str.trim();
    if (s.length >= 2 &&
        ((s.startsWith('"') && s.endsWith('"')) ||
         (s.startsWith("'") && s.endsWith("'")))) {
        return s.slice(1, -1);
    }
    return s;
}

/**
 * 匹配命令尾部的 "建目录 + 拷文件" 片段, 兼容下列已知形态:
 *
 *   `mkdir D & copy "F" "T"`                             (原始导入, 任意平台)
 *   `if not exist "D" mkdir "D" & copy /Y "F" "T"`       (本模块 win32 产物)
 *   `mkdir -p "D" && cp -f "F" "T"`                      (本模块 posix 产物)
 *
 * 前缀(可能已被 import 期烘焙成 `cd /D .\MDK && `)单独捕获, 修复时原样保留。
 */
const COPY_TAIL_RE = new RegExp(
    '^(?<prefix>[\\s\\S]*?)' +
    '(?:if\\s+not\\s+exist\\s+(?:"[^"]*"|\\S+)\\s+)?' +     // 可选 if not exist
    'mkdir\\s+(?:-p\\s+)?(?<dir>"[^"]*"|\\S+?)' +            // mkdir [-p] DIR
    '\\s*(?:2>\\s*nul\\s*)?' +
    '(?:&&|&)\\s*' +                                          // 连接符(旧形态是单个 &)
    '(?:copy|cp)\\s+' +                                       // copy | cp
    '(?:(?:\\/[A-Za-z]+|-[A-Za-z]+)\\s+)*' +                   // /Y /B /-f 之类开关
    '(?<from>"[^"]*"|\\S+)\\s+' +                             // 源
    '(?<to>"[^"]*"|\\S+)\\s*$',                               // 目标(直到行尾)
    'i'
);

/**
 * 归一化 `cd …` 前缀。
 *
 * 前缀在导入时按**当时的**平台烘焙进命令串(`cd /D .\MDK` / `cd ./MDK`), 存进 `eide.yml`。
 * 工程被搬到另一个平台(或旧版本在 Linux 上导入)后, 这段在目标 shell 里是错的:
 *   - posix: `cd /D` 是 cmd 专用开关, `\` 在 bash 里是字面反斜线而非分隔符;
 *   - win32: `/` 一般可用, 不需处理。
 *
 * 只做**无损**转换: 非 win32 上去掉 `/D`、把 `\` 换成 `/`。
 * 指向 Windows 盘符绝对路径(`C:\…`)的前缀无法修正, 保持原样以便用户识别。
 */
function normalizeCdPrefix(prefix: string, osType: KeilCopyOS): string {
    if (isWin(osType) || prefix === '') { return prefix; }
    if (/(?:^|[\\/\s])[A-Za-z]:[\\/]/.test(prefix)) { return prefix; } // 盘符绝对路径, 不动
    return prefix
        .replace(/\bcd\s+\/D\s+/gi, 'cd ')
        .replace(/\\/g, '/');
}

/**
 * 把已存的旧命令修复成目标平台的正确形态。
 *
 * - 命中 `COPY_TAIL_RE`  → 用捕获到的目录/源/目标重新渲染(保留 `cd …` 前缀);
 * - 未命中               → **原样返回**, 绝不猜测用户自定义命令。
 */
export function repairKeilCopyCommand(command: string, osType: KeilCopyOS): string {

    const m = COPY_TAIL_RE.exec(command || '');
    if (m === null || m.groups === undefined) { return command; }

    // 前缀去掉尾部的 `&&` / `&`(重新渲染时统一追加 ` && `)
    const prefix = normalizeCdPrefix(
        m.groups['prefix'].replace(/\s*(?:&&|&)\s*$/, '').trim(), osType);

    const outDir  = stripQuotes(m.groups['dir']);
    const from    = stripQuotes(m.groups['from']);
    const to      = stripQuotes(m.groups['to']);

    // 旧命令里的 `\` 在 posix 上是错的(反之亦然); 只归一**字面量**分隔符,
    // `${VAR}` 占位符原样保留, 由构建器在执行期展开。
    const shownDir  = toPathStyle(outDir, osType);
    const shownFrom = toPathStyle(from, osType);
    const shownTo   = toPathStyle(to, osType);

    // 与 renderKeilCopyCommand 保持同一形态, 否则修复过的命令下一次修复又变样, 失去幂等。
    const tail = isWin(osType)
        ? `if not exist ${quote(shownDir)} mkdir ${quote(shownDir)} & ` +
          `copy /Y ${quote(shownFrom)} ${quote(shownTo)}`
        : `mkdir -p ${quote(shownDir)} && cp -f ${quote(shownFrom)} ${quote(shownTo)}`;

    return prefix === '' ? tail : `${prefix} && ${tail}`;
}

/** 判断一条 build task 是否为本模块生成的拷贝任务(只按名称识别)。 */
export function isKeilCopyTask(task: any): boolean {
    return !!task && typeof task === 'object' && task['name'] === KEIL_COPY_TASK_NAME;
}

/**
 * 就地修复 builder options 里的拷贝任务(仅限 `KEIL_COPY_TASK_NAME`)。
 *
 * 用于构建期兜底: 存量工程 `eide.yml` 里存着旧命令字符串, 用户不会重新导入,
 * 因此在生成构建命令时统一修正(修的是构建用的 options 副本, 不回写工程配置)。
 *
 * @returns 被修复的任务条数
 */
export function repairKeilCopyTasks(options: any, osType: KeilCopyOS): number {

    if (!options || typeof options !== 'object') { return 0; }

    let fixed = 0;
    for (const field of ['beforeBuildTasks', 'afterBuildTasks']) {
        const list = options[field];
        if (!Array.isArray(list)) { continue; }
        for (const task of list) {
            if (!isKeilCopyTask(task)) { continue; }
            if (typeof task['command'] !== 'string') { continue; }
            const next = repairKeilCopyCommand(task['command'], osType);
            if (next !== task['command']) {
                task['command'] = next;
                fixed++;
            }
        }
    }
    return fixed;
}
