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
 * 项目级常量叶子模块(**零依赖**)。
 *
 * 为什么单独成模块: 这些常量原先挂在 `AbstractProject` 上, 于是
 * `EIDEProjectModules` / `PackageManager` 为了几个静态常量而反向依赖领域模型
 * `EIDEProject`, 在运行时依赖图里形成环。下沉到零依赖的叶子模块后,
 * 双方都只依赖本模块, 环即断开, 且行为完全不变。
 *
 * 约束: **本模块不得 import 任何其他 src 模块**(含类型), 否则断环失效。
 */

/** 项目元数据目录名 */
export const EIDE_DIR = '.eide';

/** EIDE 用户级主目录名(`~/.eide`,存放工具链/日志/Python 等;与项目内元数据目录同名,位置在用户主目录) */
export const EIDE_HOME_DIR_NAME = EIDE_DIR;

/** 项目配置文件名(各版本解析顺序: 先新后旧) */
export const PROJECT_CONFIG_FILE_NAMES = ['eide.yml', 'eide.json'];

/** 项目配置文件当前名 */
export const PROJECT_CONFIG_FILE_NAME = PROJECT_CONFIG_FILE_NAMES[0];

/** 旧版项目配置文件名的别名(仅迁移/兼容读取使用) */
export const LEGACY_PROJECT_CONFIG_FILE_NAME = PROJECT_CONFIG_FILE_NAMES[1];

/** 头文件后缀匹配(用于"哪些文件算头文件"的统一判定) */
export const HEADER_FILE_FILTER: RegExp = /\.(?:h|hxx|hpp|inc)$/i;

/** C/C++ 源文件后缀匹配(值原属 AbstractProject.cppfileFilter) */
export const CPP_FILE_FILTER: RegExp = /\.(?:c|cpp|c\+\+|cc|cxx)$/i;

/** 库/目标文件后缀匹配(值原属 AbstractProject.libFileFilter) */
export const LIB_FILE_FILTER: RegExp = /\.(?:lib|a|o|obj)$/i;

/** 汇编源文件后缀匹配(值原属 AbstractProject.asmfileFilter) */
export const ASM_FILE_FILTER: RegExp = /\.(?:s|asm|a51)$/i;

/** 项目配置文件版本。原在 EIDETypeDefine.ts, 下沉到叶子以切断 ProjectConfiguration 与它的运行时环 */
export const EIDE_CONF_VERSION = '4.2';

/** 官方版(v3.27.2)可读取的单文件布局版本 —— 降级导出时的目标版本 */
export const EIDE_CONF_VERSION_V41 = '4.1';

/** 保存项目数据结构时需从 eide.json 中排除的键(仅插件内部使用)。原在 EIDETypeDefine.ts, 下沉到叶子 */
export const EXCL_KEYS_IN_EIDE_JSON = [
    'mode',
    'excludeList',
    'toolchain',
    'toolchainConfig',
    'toolchainConfigMap',
    'uploader',
    'uploadConfig',
    'uploadConfigMap'
];

/** 需要从 targets 复制到配置根节点的键(历史遗留平铺结构)。原在 TargetManager.ts, 下沉到叶子以断边 */
export const MAPPED_KEYS_IN_TARGET_INFO = [
    'excludeList',
    'toolchain',
    'toolchainConfig',
    'toolchainConfigMap',
    'uploader',
    'uploadConfig',
    'uploadConfigMap',
    'cppPreprocessAttrs',
];
