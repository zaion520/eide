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

import { File } from "../lib/node-utility/File";
import type { ToolchainName } from './types/ToolchainTypes';
import type { HexUploaderType } from './types/UploadTypes';

export { EIDE_CONF_VERSION } from './ProjectConsts';

// ----------------------------------------------------------
// - project struct define
// ----------------------------------------------------------

// !! eide project config file version !!

//
//  'C51': 8BIT MCU Project (like: mcs51, stm8, ...)
//  'ARM': Cortex-M Project
//  'RISC-V': RISCV Project
//  'ANY-GCC': Any GCC Toolchain Project
//
export type ProjectType = 'C51' | 'ARM' | 'RISC-V' | 'ANY-GCC' | 'MIPS';

export interface CreateOptions {
    name: string; // project folder name
    projectName?: string;
    outDir: File; // project location
    templateFile?: File;
    type: ProjectType;
}

export type ImportProjectIDEType = 'mdk' | 'eclipse' | 'iar';

export interface ImportOptions {
    type: ImportProjectIDEType;
    outDir?: File;
    projectFile: File;
    createNewFolder?: boolean;
    mdk_prod?: 'c51' | 'arm';
}

export interface Dependence {
    name: string;
    incList: string[];          // absolute path with env variables
    libList: string[];          // absolute path with env variables
    defineList: string[];
}

export interface DependenceGroup {
    groupName: string;
    depList: Dependence[];
}

export interface ProjectMiscInfo {
    uid: string | undefined;
}

export interface BuilderOptions {
    version: number;
    beforeBuildTasks?: any[];
    afterBuildTasks?: any[];
    global?: any;
    ['c/cpp-compiler']?: any;
    ['asm-compiler']?: any;
    linker?: any;
}

// 备注:由于历史原因,插件运行时会将 eide.json 直接转成json对象作为 项目的数据结构 使用;
// 但插件运行时的数据结构和eide.json文件的内容是不一样的,有一些键仅在插件内部使用;
// 需要保证一些键位于json对象的根下,因此需要将这些键从 targets 复制到上一层,
// 对比 ProjectTargetInfo 与 ProjectConfigData 相同的键,这些键如下:
// (同步逻辑统一收敛在 TargetManager 中,此处仅保持原导入路径兼容)
export { MAPPED_KEYS_IN_TARGET_INFO } from './TargetManager';
export interface ProjectTargetInfo {
    excludeList: string[];
    toolchain: ToolchainName;
    toolchainConfig: any;
    toolchainConfigMap: { [toolchain: string]: any };
    uploader: HexUploaderType;
    uploadConfig: any | null;
    uploadConfigMap: { [uploader: string]: any };
    cppPreprocessAttrs: Dependence;
    builderOptions: { [toolchain: string]: BuilderOptions };
    settings: {
        debugger?: string; // @ref DEBUGGER_MAPS
        [name: string]: any;
    };
}

export interface VirtualFile {
    // this must be an relative path
    // because virtual file path may be outside the project root directory
    path: string;
}

export interface VirtualFolder {
    name: string;
    files: VirtualFile[];
    folders: VirtualFolder[];
}

export interface BuilderConfigData { }

// 备注：由于历史原因，插件运行时会将 eide.json 直接转成json对象作为 项目的数据结构 使用；
// 但插件运行时的数据结构和eide.json文件的内容是不一样的，有一些键仅在插件内部使用；
// 是不需要保存到 eide.json 文件中去，因此在保存项目数据结构时，需要排除这些键，如下：

export interface ProjectConfigData<T extends BuilderConfigData> {

    name: string;
    type: ProjectType;

    // cur target info (virtual node)
    mode: string; // target name (And for historical reasons, that's what it's called)
    excludeList: string[];
    toolchain: ToolchainName;
    toolchainConfig: T; //【历史遗留属性】用于储存一些 公共的 编译相关的 属性
    toolchainConfigMap: { [toolchain: string]: any };
    uploader: HexUploaderType;
    uploadConfig: any | null;
    uploadConfigMap: { [uploader: string]: any };

    // dependences (virtual node: 'custom', 'built-in')
    dependenceList: DependenceGroup[];

    // all targets
    targets: { [target: string]: ProjectTargetInfo };

    // source
    srcDirs: string[];
    virtualFolder: VirtualFolder;

    outDir: string;
    deviceName: string | null;
    packDir: string | null;
    miscInfo: ProjectMiscInfo;
    version: string;
}

export interface ProjectUserContextData {

    target?: string;
}

export type ProjectConfigEventType =
    'dependence' | 'srcRootAdd' | 'srcRootRemoved' | 'compiler' | 'uploader' | 'projectFileChanged';

export interface ProjectConfigEvent {
    type: ProjectConfigEventType;
    data?: any;
}

export interface ProjectBaseApi {
    getRootDir: () => File;
    toolchainName: () => ToolchainName;
    toAbsolutePath: (path: string) => string;
    toRelativePath: (path: string) => string;
    resolveEnvVar: (path: string) => string;
}

// -------------------------------------------------
// - other utils types
// -------------------------------------------------

export interface ManagerInterface {
    Init(): void;
}

export interface FileItem {
    file: File;
    disabled?: boolean;
}

export interface FileGroup {
    name: string;       // dir name if it's system folder, else it's a virtual path (with '<virtual_root>/' header)
    files: FileItem[];
    disabled?: boolean;
}

export interface ProjectFileGroup extends FileGroup {
    dir: File;
    isRoot: boolean;
}

// ----------------------------------------------------------
// - class
// ----------------------------------------------------------

export class EventItem {

    readonly name: string;
    private args: string[];

    constructor(event: string) {
        this.name = event;
        this.args = [];
    }

    add(arg: string) {
        const index = this.args.findIndex((item) => { return item === arg; });
        if (index !== -1) {
            this.args.splice(index, 1);
        }
        this.args.push(arg);
    }

    getArgs(): string[] {
        return this.args;
    }
}

// ---- 以下接口原混在配置类区块里, 属纯类型, 归位到本文件 ----
export interface CppBrowseInfo {
    databaseFilename?: string;
    limitSymbolsToIncludedHeaders?: boolean;
    path?: string[];
}

export interface CppConfigItem {
    name: string;
    includePath: string[];
    defines: string[];
    compilerPath?: string;
    compilerArgs?: string[];
    forcedInclude?: string[];
    browse?: CppBrowseInfo;
    intelliSenseMode?: string;
    cStandard?: string;
    cppStandard?: string;
    cCompilerArgs?: string[];
    cppCompilerArgs?: string[];
    configurationProvider?: string;
}

export interface CppConfig {
    configurations: CppConfigItem[];
    version: number;
}

export interface WorkspaceConfig {
    folders: { name?: string, path: string }[];
    settings?: any;
    [key: string]: any;
}
