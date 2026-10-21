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
 * 项目/工作区配置模型(Configuration / ConfigMap / ProjectConfiguration / WorkspaceConfiguration)。
 *
 * 从 EIDETypeDefine.ts(1711 行, 类与类型混放)拆出:
 *   - EIDETypeDefine.ts 只剩纯类型声明 -> 基本成为叶子
 *   - 本模块只以 type-only 方式引用它的类型 -> 不构成运行时环
 *   - EIDE_CONF_VERSION 已下沉到 ProjectConsts(否则本模块与它会因该常量成环)
 */

import * as events from 'events';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as NodePath from 'path';
import { jsonc } from 'jsonc';
import * as jsonc_parser from 'jsonc-parser';
import * as yaml from 'yaml';

import { File } from "../lib/node-utility/File";
import { FileWatcher } from "../lib/node-utility/FileWatcher";
import {
    include_desc, lib_desc, source_list_desc, definition_list_desc,
    view_str$prompt$loadws_cfg_failed
} from "./StringTable";
import { ArrayDelRepetition } from "../lib/node-utility/Utility";
import { GlobalEvent } from "./GlobalEvents";
import { EIDE_CONF_VERSION, EXCL_KEYS_IN_EIDE_JSON, TARGETS_DIR_NAME } from "./ProjectConsts";
import { EventItem } from "./EIDETypeDefine";
import type { ToolchainName } from './types/ToolchainTypes';
import type { HexUploaderType } from './types/UploadTypes';
import { VirtualSource } from "./VirtualSource";
import * as utility from "./utility";
import * as platform from './Platform';
import { decideTargetFileEvent } from './targetFileWatchPolicy';
import { atomicWriteFileSync } from './AtomicWrite';
import { snapshotCurrentTarget, recoverTargetToRoot, applyTargetSnapshot } from "./TargetManager";
import {
    isV42Skeleton, splitIntoSkeleton, assembleFromSkeleton, TargetFileData,
    matchTargetConfigFile, loadTargetFromFile,
} from "./ProjectStorageV42";
import { CompileConfigModel, UploadConfigModel, SdccCompileConfigModel, GccCompileConfigModel, RiscvCompileConfigModel, AnyGccCompileConfigModel, MipsCompileConfigModel } from "./EIDEProjectModules";
import type {
    ProjectType, Dependence, DependenceGroup, ProjectMiscInfo, ProjectTargetInfo,
    BuilderConfigData, ProjectConfigData, ProjectUserContextData, ProjectConfigEvent, ProjectBaseApi,
    CppBrowseInfo, CppConfigItem, CppConfig, WorkspaceConfig
} from "./EIDETypeDefine";

export abstract class Configuration<ConfigType = any, EventType = any> {

    readonly FILE_NAME: string;

    config: ConfigType;
    needReloadProject = false;

    private _eventMergeFlag: boolean;
    private _eventCache: EventItem[];
    protected _event: events.EventEmitter;

    protected cfgFile: File;
    protected watcher: FileWatcher;
    /** 子目录监听器(可选;仅 v4.2 项目用于 targets/ 热重载) */
    protected targetsWatcher?: FileWatcher;

    protected isDelUnknownKeysWhenLoad: boolean = true;
    protected lastSaveTime: number = 0;

    constructor(configFile: File, type?: ProjectType) {
        this._event = new events.EventEmitter();
        this._eventMergeFlag = false;
        this._eventCache = [];
        this.cfgFile = configFile;
        this.FILE_NAME = configFile.name;
        this.watcher = new FileWatcher(configFile, false);
        this.watcher.on('error', (err) => GlobalEvent.log_error(err));
        this.watcher.OnChanged = () => this.loadConfig(this.watcher.file.Read());
        this.config = this.GetDefault(this.readTypeFromFile(configFile) || type);
    }

    public load(): Configuration<ConfigType, EventType> {

        try {
            const meta = fs.statSync(this.cfgFile.path);
            this.lastSaveTime = meta.mtime.getTime();
        } catch (err) {
            // nothing todo
        }

        if (this.cfgFile.IsFile()) {
            this.loadConfig(this.cfgFile.Read());
        } else {
            this.Save(true);
        }

        return this;
    }

    Dispose(): void {
        this.watcher.Close();
        this.targetsWatcher?.Close();
        this.targetsWatcher = undefined;
    }

    GetFile(): File {
        return this.cfgFile;
    }

    Watch() {
        try {
            this.watcher.Watch();
        } catch (error) {
            GlobalEvent.emit('error', <Error>error);
        }
        // v4.2 目标目录监听(目录可能尚未创建,失败不影响主链路)
        try {
            this.targetsWatcher?.Watch();
        } catch (error) {
            GlobalEvent.log_error(error);
        }
    }

    on(event: 'dataChanged', listener: (dataType: EventType) => void): void;
    on(event: any, listener: (arg?: any) => void): void {
        this._event.on(event, listener);
    }

    protected emit(event: 'dataChanged', dataType: EventType): void;
    protected emit(event: any, arg?: any): void {
        if (this._eventMergeFlag) {
            this.cacheEvent(event, arg);
        } else {
            this._event.emit(event, arg);
        }
    }

    private cacheEvent(event: any, arg?: any) {
        const index = this._eventCache.findIndex((item) => { return item.name === event; });
        if (index !== -1) {
            this._eventCache[index].add(arg || '');
        } else {
            const item = new EventItem(event);
            item.add(arg || '');
            this._eventCache.push(item);
        }
    }

    beginCacheEvents() {
        this._eventMergeFlag = true;
    }

    endCachedEvents() {

        for (const item of this._eventCache) {
            for (const arg of item.getArgs()) {
                this._event.emit(item.name, arg);
            }
        }

        this._eventCache = [];
        this._eventMergeFlag = false;
    }

    protected loadConfig(json: string): void {

        const _configFromFile: any = this.parse(json);

        // clear invalid property
        if (this.isDelUnknownKeysWhenLoad) {
            for (const key in (<any>_configFromFile)) {
                if ((<any>this.config)[key] === undefined) {
                    _configFromFile[key] = undefined;
                }
            }
        }

        // set config
        this.config = _configFromFile;

        //
        this.postLoadConfig();

        this._event.emit('dataChanged');
    }

    Save(force?: boolean): void {

        let oldContent: string | undefined;
        let newContent: string = this.toString();

        try {
            if (this.cfgFile.IsExist())
                oldContent = this.cfgFile.Read();
        } catch (error) {
            GlobalEvent.log_error(error);
        }

        if (oldContent == undefined || !this.compare(oldContent, newContent)) {
            this.lastSaveTime = Date.now();
            // 原子写: 双开时并发写同一文件不会产生半截 YAML
            atomicWriteFileSync(this.cfgFile.path, newContent);
        }
    }

    protected postLoadConfig() {
        // TODO
    }

    protected abstract parse(jsonStr: string): ConfigType;

    protected abstract toString(): string;

    protected abstract compare(old_str: string, new_str: string): boolean;

    protected abstract readTypeFromFile(configFile: File): ProjectType | undefined;

    abstract GetDefault(type?: ProjectType): ConfigType;
}

export class ConfigMap {

    private map: Map<string, Configuration>;

    constructor() {
        this.map = new Map();
    }

    Set<T>(confg: Configuration<T>, key?: string): Configuration<T> {
        this.map.set(key !== undefined ? key : confg.FILE_NAME, confg);
        return confg;
    }

    Get<T>(key: string): Configuration<T> {
        return <Configuration<T>>this.map.get(key);
    }

    GetAll(): Configuration[] {
        return Array.from(this.map.values());
    }

    Clear() {
        this.Dispose();
        this.map.clear();
    }

    Dispose() {
        this.map.forEach((val) => {
            val.Dispose();
        });
    }

    SaveAll() {
        this.map.forEach((val) => {
            val.Save();
        });
    }
}

export class ProjectConfiguration<T extends BuilderConfigData>
    extends Configuration<ProjectConfigData<T>, ProjectConfigEvent> {

    static readonly BUILD_IN_GROUP_NAME = 'build-in';
    static readonly CUSTOM_GROUP_NAME = 'custom';
    static readonly MERGE_DEP_NAME = 'merge';

    toolchainConfigModel: CompileConfigModel<any> = <any>null;
    uploadConfigModel: UploadConfigModel<any> = <any>null;

    protected project: ProjectBaseApi;
    protected rootDir: File;
    protected workspaceState: vscode.Memento;

    constructor(eideJsonFile: File, workspaceState: vscode.Memento, type?: ProjectType) {

        super(eideJsonFile, type);

        this.workspaceState = workspaceState;

        this.rootDir = new File(NodePath.dirname(this.cfgFile.dir));

        this.project = {
            getRootDir: () => this.rootDir,
            toolchainName: () => this.config.toolchain,
            toRelativePath: (p) => this.toRelativePath(p),
            toAbsolutePath: (p) => this.toAbsolutePath(p),
            resolveEnvVar: (p) => p
        };

        const _cb = () => {
            try {
                const meta = fs.statSync(this.cfgFile.path);
                if (meta.mtime.getTime() > this.lastSaveTime + 3000) {
                    this.onProjectFileChanged();
                }
            } catch (err) {
                // nothing todo
            }
        };

        this.watcher.OnChanged = _cb
        this.watcher.OnRename = _cb;

        // v4.2: 目标数据在 `.eide/targets/<name>/<name>.yml` 子目录下,主文件 watcher 盯不到。
        // 手改目标文件后把磁盘内容读进内存(热重载),这样后续任何 Save 写出的都是同一份内容,
        // 手改不会被内存旧值静默覆盖。只挂监听,不改 Save/比较逻辑。
        this.targetsWatcher = platform.createSafetyFileWatcher(
            File.from(NodePath.dirname(this.cfgFile.path), TARGETS_DIR_NAME), true, false);
        this.targetsWatcher.on('error', err => GlobalEvent.log_error(err));
        this.targetsWatcher.OnChanged = f => this.reloadChangedTargetFile(f);
        this.targetsWatcher.OnRename = f => this.reloadChangedTargetFile(f);
    }

    /** 目标目录监听器(v4.2 布局);v4.1 项目不挂 */

    /**
     * 本次 `Save()` 刚写过的目标文件路径(小写) -> 写入时刻(ms)。
     *
     * `Save()` 重写目标文件会触发自身 watcher, 若不抑制就会出现
     * “写盘 -> 读回 -> 再写” 的无谓刷新链。写入前登记, watcher 命中即消费并跳过。
     * 带时间戳而非纯 Set: 平台若未回报该次事件, 标记会残留, 之后用户真手改会被误吞。
     * 超过 `SELF_WRITE_GUARD_MS` 的标记一律视为过期。
     */
    private selfWrittenTargetFiles: Map<string, number> = new Map();
    /**
     * 外部手改了 `targets/<name>/<name>.yml` -> 把磁盘内容读回内存。
     *
     * 只处理目标主文件;旁路文件(files.options.yml / libs.yml / st.option.bytes.ini)
     * 由 `AbstractProject.onEideDirChanged` 单独处理,不在此重复接管。
     */
    private reloadChangedTargetFile(changedFile: File): void {
        try {
            // 模型尚未就绪(构造期/加载失败)时无法原位恢复,直接跳过
            if (!this.toolchainConfigModel || !this.uploadConfigModel) { return; }

            const eideDir = NodePath.dirname(this.cfgFile.path);
            const targetName = matchTargetConfigFile(eideDir, changedFile.path);
            if (!targetName) { return; }

            // 本次 Save() 自己写的 -> 消费标记并跳过(避免自触发刷新链);
            // 标记过期则视为真实外部修改(判定见 targetFileWatchPolicy, 有单测覆盖)
            const changedKey = changedFile.path.toLowerCase();
            const writtenAt = this.selfWrittenTargetFiles.get(changedKey);
            if (writtenAt !== undefined) {
                this.selfWrittenTargetFiles.delete(changedKey);
                if (decideTargetFileEvent({ now: Date.now(), selfWrittenAt: writtenAt }) === 'ignore-self-write') {
                    return;
                }
            }

            const info = loadTargetFromFile(eideDir, targetName);
            if (!info) { return; } // 文件被删/正在写(半截内容) -> 忽略本次事件

            const prjConfig = <any>this.config;
            if (!prjConfig.targets || prjConfig.targets[targetName] === undefined) {
                return; // 骨架里没有这个目标(新建/删除中) -> 交给主文件链路
            }

            // 非激活目标:直接替换表中条目即可
            if (prjConfig.mode !== targetName) {
                prjConfig.targets[targetName] = info;
                return;
            }

            // 激活目标:数据同时平铺在根节点,需整份恢复(工具链/烧录器配置模型按引用绑定,
            // 由 applyTargetSnapshot 原位写入)
            prjConfig.targets[targetName] = info;
            applyTargetSnapshot(prjConfig, info, {
                toolchainConfigModel: this.toolchainConfigModel,
                uploadConfigModel: this.uploadConfigModel,
                customDep: this.CustomDep_getDependence(),
                toAbsolutePath: (path) => this.toAbsolutePath(path)
            });

            // 通知上层重建编译配置/源文件树
            this.emit('dataChanged', { type: 'compiler' });
        } catch (error) {
            GlobalEvent.log_error(error);
        }
    }

    static parseProjectFile<T extends BuilderConfigData>(input: string): ProjectConfigData<T> {
        return yaml.parse(input);
    }

    static dumpProjectFile<T extends BuilderConfigData>(obj: ProjectConfigData<T>): string {
        const keyOrder = [
            'version',
            'name',
            'type',
            'deviceName',
            'packDir',
            'srcDirs',
            'virtualFolder',
            'dependenceList',
            'outDir',
            'miscInfo',
            'targets'
        ];
        return yaml.stringify(obj, {
            indent: 2,
            lineWidth: 1000,
            sortMapEntries: (a: any, b: any) => {
                const i_a = keyOrder.findIndex(e => e == a.key);
                const i_b = keyOrder.findIndex(e => e == b.key);
                if (i_a == -1 && i_b == -1) {
                    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
                } else if (i_a == -1) {
                    return 1;
                } else if (i_b == -1) {
                    return -1;
                } else {
                    return i_a - i_b;
                }
            }
        });
    }

    private __fileChgEvtEmitDelayTimer: NodeJS.Timeout | undefined;
    private onProjectFileChanged() {
        if (this.__fileChgEvtEmitDelayTimer) {
            this.__fileChgEvtEmitDelayTimer.refresh();
        } else {
            this.__fileChgEvtEmitDelayTimer = setTimeout((this_: ProjectConfiguration<any>) => {
                this_.__fileChgEvtEmitDelayTimer = undefined;
                this_.emit('dataChanged', { type: 'projectFileChanged' });
            }, 600, this);
        }
    }

    public load(): ProjectConfiguration<any> {

        super.load();

        this.toolchainConfigModel = CompileConfigModel.getInstance(this.config);
        this.uploadConfigModel = UploadConfigModel.getInstance(this.config.uploader, this.project);

        this.toolchainConfigModel.Update(this.config.toolchainConfig);
        this.config.toolchainConfig = this.toolchainConfigModel.data;
        this.toolchainConfigModel.on('dataChanged', () => this.emit('dataChanged', { type: 'compiler' }));

        this.uploadConfigModel.Update(this.config.uploadConfig);
        this.config.uploadConfig = this.uploadConfigModel.data;
        this.uploadConfigModel.on('dataChanged', () => this.emit('dataChanged', { type: 'uploader' }));

        // update upload model
        this.toolchainConfigModel.on('dataChanged', () => this.uploadConfigModel.emit('NotifyUpdate', this));

        this.Watch();

        return this;
    }

    private getRootDir(): File {
        return this.rootDir;
    }

    private toAbsolutePath(path_: string): string {
        const path = path_.trim();
        if (File.isAbsolute(path)) { return File.normalize(path); }
        return File.normalize(this.getRootDir().path + File.sep + path);
    }

    private toRelativePath(path_: string): string {
        const path = path_.trim();
        return this.getRootDir().ToRelativePath(path) || File.ToUnixPath(path);
    }

    private MergeDepList(depList: Dependence[], name?: string): Dependence {

        const merge: Dependence = {
            name: name ? name : ProjectConfiguration.MERGE_DEP_NAME,
            incList: [],
            libList: [],
            defineList: [],
        };

        depList.forEach(dep => {
            merge.defineList = merge.defineList.concat(dep.defineList);
            merge.libList = merge.libList.concat(dep.libList);
            merge.incList = merge.incList.concat(dep.incList);
        });

        // clear duplicate
        merge.defineList = ArrayDelRepetition(merge.defineList);
        merge.libList = ArrayDelRepetition(merge.libList);
        merge.incList = ArrayDelRepetition(merge.incList);

        return merge;
    }

    protected readTypeFromFile(configFile: File): ProjectType | undefined {
        if (configFile.IsFile()) {
            try {
                const prjObj = ProjectConfiguration.parseProjectFile(configFile.Read());
                return <ProjectType>prjObj['type'];
            } catch (error) {
                GlobalEvent.show_msgbox('Hidden', error);
            }
        }
    }

    GetDefault(type?: ProjectType): ProjectConfigData<any> {
        switch (type) {
            case 'C51':
                return {
                    version: EIDE_CONF_VERSION,
                    name: 'undefined',
                    type: type,
                    mode: 'Debug',
                    toolchain: 'SDCC',
                    uploader: 'Custom',
                    dependenceList: [],
                    toolchainConfig: SdccCompileConfigModel.getDefaultConfig(),
                    toolchainConfigMap: {},
                    srcDirs: [],
                    virtualFolder: { name: VirtualSource.rootName, files: [], folders: [] },
                    excludeList: [],
                    outDir: 'build',
                    deviceName: null,
                    packDir: null,
                    uploadConfig: null,
                    uploadConfigMap: {},
                    miscInfo: <any>{},
                    targets: {}
                };
            case 'ARM':
                return {
                    version: EIDE_CONF_VERSION,
                    name: 'undefined',
                    type: type,
                    mode: 'Debug',
                    toolchain: 'GCC',
                    dependenceList: [],
                    toolchainConfig: GccCompileConfigModel.getDefaultConfig(),
                    toolchainConfigMap: {},
                    uploader: 'JLink',
                    srcDirs: [],
                    virtualFolder: { name: VirtualSource.rootName, files: [], folders: [] },
                    excludeList: [],
                    outDir: 'build',
                    deviceName: null,
                    packDir: null,
                    uploadConfig: null,
                    uploadConfigMap: {},
                    miscInfo: <any>{},
                    targets: {}
                };
            case 'RISC-V':
                return {
                    version: EIDE_CONF_VERSION,
                    name: 'undefined',
                    type: type,
                    mode: 'Debug',
                    toolchain: 'RISCV_GCC',
                    dependenceList: [],
                    toolchainConfig: RiscvCompileConfigModel.getDefaultConfig(),
                    toolchainConfigMap: {},
                    uploader: 'JLink',
                    srcDirs: [],
                    virtualFolder: { name: VirtualSource.rootName, files: [], folders: [] },
                    excludeList: [],
                    outDir: 'build',
                    deviceName: null,
                    packDir: null,
                    uploadConfig: null,
                    uploadConfigMap: {},
                    miscInfo: <any>{},
                    targets: {}
                };
            case 'MIPS':
                return {
                    version: EIDE_CONF_VERSION,
                    name: 'undefined',
                    type: type,
                    mode: 'Debug',
                    toolchain: 'MTI_GCC',
                    dependenceList: [],
                    toolchainConfig: MipsCompileConfigModel.getDefaultConfig(),
                    toolchainConfigMap: {},
                    uploader: 'Custom',
                    srcDirs: [],
                    virtualFolder: { name: VirtualSource.rootName, files: [], folders: [] },
                    excludeList: [],
                    outDir: 'build',
                    deviceName: null,
                    packDir: null,
                    uploadConfig: null,
                    uploadConfigMap: {},
                    miscInfo: <any>{},
                    targets: {}
                };
            case 'ANY-GCC':
                return {
                    version: EIDE_CONF_VERSION,
                    name: 'undefined',
                    type: type,
                    mode: 'Debug',
                    toolchain: 'ANY_GCC',
                    dependenceList: [],
                    toolchainConfig: AnyGccCompileConfigModel.getDefaultConfig(),
                    toolchainConfigMap: {},
                    uploader: 'JLink',
                    srcDirs: [],
                    virtualFolder: { name: VirtualSource.rootName, files: [], folders: [] },
                    excludeList: [],
                    outDir: 'build',
                    deviceName: null,
                    packDir: null,
                    uploadConfig: null,
                    uploadConfigMap: {},
                    miscInfo: <any>{},
                    targets: {}
                };
            default:
                throw new Error(`not support this project type: '${type}'`);
        }
    }

    getDefaultTargetInfo(): ProjectTargetInfo {
        return {
            excludeList: [],
            toolchain: this.config.toolchain,
            toolchainConfig: {},
            toolchainConfigMap: {},
            uploader: this.config.uploader,
            uploadConfig: {},
            uploadConfigMap: {},
            cppPreprocessAttrs: {
                name: 'default',
                incList: [],
                libList: [],
                defineList: []
            },
            builderOptions: {},
            settings: {
                debugger: this.config.type === 'C51' ? 'unknown' : 'cortex-debug'
            }
        };
    }

    setHexUploader(uploader: HexUploaderType) {

        const oldModel = this.uploadConfigModel;

        // save and recover config
        this.config.uploadConfigMap[oldModel.uploader] = utility.copyObject(oldModel.data);
        const oldCfg = this.config.uploadConfigMap[uploader];
        if (oldCfg && oldCfg.bin == null) {
            oldCfg.bin = ''; // compat old cfg
        }

        // update new config
        this.uploadConfigModel = UploadConfigModel.getInstance(uploader, this.project);
        this.config.uploader = uploader;
        if (oldCfg)
            this.uploadConfigModel.data = utility.copyObject(oldCfg);
        this.config.uploadConfig = this.uploadConfigModel.data; // bind obj

        // update listeners
        this.uploadConfigModel.copyListenerFrom(oldModel);

        // update toolchainConfigModel listener
        this.toolchainConfigModel.on('dataChanged', () => this.uploadConfigModel.emit('NotifyUpdate', this));
    }

    setToolchain(toolchain: ToolchainName) {

        const oldModel = this.toolchainConfigModel;
        const oldToolchain = this.config.toolchain;

        // save and recover config
        this.config.toolchainConfigMap[oldToolchain] = utility.copyObject(oldModel.data);
        const oldCfg = this.config.toolchainConfigMap[toolchain];

        // bind
        this.config.toolchain = toolchain; // update toolchain name
        this.toolchainConfigModel = CompileConfigModel.getInstance(this.config);
        if (oldCfg)
            this.toolchainConfigModel.data = utility.copyObject(oldCfg);
        this.config.toolchainConfig = this.toolchainConfigModel.data; // bind obj

        // update
        if (!oldCfg)
            this.toolchainConfigModel.copyCommonCompileConfigFrom(oldToolchain, oldModel);
        this.toolchainConfigModel.copyListenerFrom(oldModel);
    }

    //---

    getMiscInfo(): ProjectMiscInfo {
        return this.config.miscInfo;
    }

    getOutDir(): string {
        return this.getOutDirRoot() + File.sep + this.config.mode;
    }

    getOutDirRoot(): string {
        return this.config.outDir;
    }

    //-----------------------------------------------------------

    GetDepKeyDesc(key: string, withRawName?: boolean): string {
        switch (key) {
            case 'incList':
                return include_desc + (withRawName ? ` (IncludePaths)` : '');
            case 'libList':
                return lib_desc + (withRawName ? ` (StaticLibrarySearchDirs)` : '');
            // case 'sourceList':
            //     return source_list_desc + (withRawName ? ` (SourceFiles)` : '');
            case 'defineList':
                return definition_list_desc + (withRawName ? ` (C/C++ Macros)` : '');
            default:
                return key;
        }
    }

    //-----------------------------------------------------------

    IsDependenceEmpty(groupName?: string): boolean {

        if (this.config.dependenceList.length > 0) {

            if (groupName) {

                const group = this.GetDepGroupByName(groupName);

                if (group) {

                    return group.depList.length === 0;
                }

                return true;
            }

            return false;

        } else {
            return true;
        }
    }

    IsExisted(groupName: string, depName?: string): boolean {
        return depName ? this.GetDependence(groupName, depName) !== undefined
            : this.GetDepGroupByName(groupName) !== undefined;
    }

    //--------------------------------------------------------

    /**
     * @param gExclude [<groupName>, <groupName>.<depName>]
     */
    GetAllMergeDep(gExclude?: string[]): Dependence {

        const resultList: Dependence[] = [];
        let groups = this.config.dependenceList;

        if (gExclude) {
            groups = groups.filter((_group) => { return !gExclude.includes(_group.groupName); });
        }

        groups.forEach(depGroup => {
            depGroup.depList.filter((dep) => {
                return gExclude === undefined || !gExclude.includes(`${depGroup.groupName}.${dep.name}`);
            }).forEach(dep => {
                resultList.push(dep);
            });
        });

        return this.MergeDepList(resultList);
    }

    getAllDepGroup(): DependenceGroup[] {
        return Array.from(this.config.dependenceList);
    }

    MergeDependence(groupName: string, dep: Dependence) {
        const targetDep = this.GetDependence(groupName, dep.name);
        if (targetDep) {
            const _newDep: any = this.MergeDepList([targetDep, dep], targetDep.name);
            for (let key in <any>targetDep) {
                (<any>targetDep)[key] = _newDep[key];
            }
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    AddDependence(groupName: string, dep: Dependence) {
        let depGroup = this.GetDepGroupByName(groupName);
        if (!depGroup) {
            depGroup = {
                groupName: groupName,
                depList: []
            };
            this.config.dependenceList.push(depGroup);
        }
        const index = this.GetDepIndexByName(depGroup, dep.name);
        if (index === -1) {
            depGroup.depList.push(dep);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    AddDepGroup(depGroup: DependenceGroup) {
        if (this.GetDepGroupIndexByName(depGroup.groupName) === -1) {
            this.config.dependenceList.push(depGroup);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    //------------------------------------------------------------

    RemoveDependence(groupName: string, depName: string) {
        const depGroup = this.GetDepGroupByName(groupName);
        if (depGroup) {
            const index = this.GetDepIndexByName(depGroup, depName);
            if (index !== -1) {
                depGroup.depList.splice(index, 1);
                if (depGroup.depList.length === 0) {
                    this.RemoveDepGroup(depGroup.groupName);
                    return;
                }
                this.emit('dataChanged', { type: 'dependence' });
            }
        }
    }

    RemoveDepGroup(groupName: string) {
        const index = this.GetDepGroupIndexByName(groupName);
        if (index !== -1) {
            this.config.dependenceList.splice(index, 1);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    //----------------------------------------------------------------------

    GetDepGroupIndexByName(groupName: string): number {
        return this.config.dependenceList.findIndex(depGroup => { return depGroup.groupName === groupName; });
    }

    GetDepGroupByName(groupName: string): DependenceGroup | undefined {
        const index = this.GetDepGroupIndexByName(groupName);
        if (index !== -1) {
            return this.config.dependenceList[index];
        }
        return undefined;
    }

    GetDepIndexByName(group: DependenceGroup, depName: string): number {
        return group.depList.findIndex(dep => { return dep.name === depName; });
    }

    GetDependence(groupName: string, depName: string): Dependence | undefined {
        const depGroup = this.GetDepGroupByName(groupName);
        if (depGroup) {
            const index = depGroup.depList.findIndex(dep => { return dep.name === depName; });
            if (index !== -1) {
                return depGroup.depList[index];
            }
        }
        return undefined;
    }

    AddSrcDir(absPath: string) {
        if (!this.config.srcDirs.includes(absPath)) {
            this.config.srcDirs.push(absPath);
            this.emit('dataChanged', { type: 'srcRootAdd', data: absPath });
        }
    }

    addSrcDirAtFirst(absPath: string) {
        if (!this.config.srcDirs.includes(absPath)) {
            this.config.srcDirs.unshift(absPath);
            this.emit('dataChanged', { type: 'srcRootAdd', data: absPath });
        }
    }

    RemoveSrcDir(absPath: string) {
        const index = this.config.srcDirs.findIndex((path) => { return path === absPath; });
        if (index !== -1) {
            this.config.srcDirs.splice(index, 1);
            this.emit('dataChanged', { type: 'srcRootRemoved', data: absPath });
        }
    }

    //======================== build-in ==============================

    private BuildIn_NewGroup(): DependenceGroup {
        return {
            groupName: ProjectConfiguration.BUILD_IN_GROUP_NAME,
            depList: []
        };
    }

    private BuildIn_NewDependence(): Dependence {
        return {
            name: 'default',
            incList: [],
            libList: [],
            defineList: []
        };
    }

    BuildIn_getDependence(): Dependence {

        const index = this.config.dependenceList.findIndex((dep) => {
            return dep.groupName === ProjectConfiguration.BUILD_IN_GROUP_NAME;
        });

        if (index === -1) {
            const dep = this.BuildIn_NewGroup();
            dep.depList.push(this.BuildIn_NewDependence());
            this.config.dependenceList.push(dep);
            return dep.depList[0];
        }

        const depIndex = this.config.dependenceList[index].depList.findIndex((dep) => {
            return dep.name === 'default';
        });

        if (depIndex === -1) {
            const nDep = this.BuildIn_NewDependence();
            this.config.dependenceList[index].depList.push(nDep);
            return nDep;
        }

        return this.config.dependenceList[index].depList[depIndex];
    }

    BuildIn_AddAllFromDefineList(defineList: string[]) {
        let needNotify: boolean = false;
        const dep = this.BuildIn_getDependence();

        defineList.forEach((define) => {
            if (!dep.defineList.includes(define)) {
                dep.defineList.push(define);
                needNotify = true;
            }
        });

        if (needNotify) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    BuildIn_RemoveAllDefines() {

        const dep = this.BuildIn_getDependence();
        const oldLen = dep.defineList.length;

        dep.defineList = []; // clear all

        if (oldLen !== dep.defineList.length) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    BuildIn_RemoveFromDefineList(_defineList: string[]) {

        const dep = this.BuildIn_getDependence();
        const oldLen = dep.defineList.length;

        dep.defineList = dep.defineList.filter((define) => {
            return !_defineList.includes(define);
        });

        if (oldLen !== dep.defineList.length) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    /////////////////////////////////////////////////////////
    // custom dependence
    /////////////////////////////////////////////////////////

    CustomDep_GetEnabledKeys(): string[] {
        return [
            'incList',
            'libList',
            'defineList'
        ];
    }

    private CustomDep_NewGroup(): DependenceGroup {
        return {
            groupName: ProjectConfiguration.CUSTOM_GROUP_NAME,
            depList: []
        };
    }

    private CustomDep_NewDependence(): Dependence {
        return {
            name: 'default',
            incList: [],
            libList: [],
            defineList: []
        };
    }

    CustomDep_getDependence(): Dependence {

        const index = this.config.dependenceList.findIndex((dep) => {
            return dep.groupName === ProjectConfiguration.CUSTOM_GROUP_NAME;
        });

        if (index === -1) {
            const group = this.CustomDep_NewGroup();
            group.depList.push(this.CustomDep_NewDependence());
            this.config.dependenceList.push(group);
            return group.depList[0];
        }

        const depIndex = this.config.dependenceList[index].depList.findIndex((dep) => {
            return dep.name === 'default';
        });

        if (depIndex === -1) {
            const nDep = this.CustomDep_NewDependence();
            this.config.dependenceList[index].depList.push(nDep);
            return nDep;
        }

        return this.config.dependenceList[index].depList[depIndex];
    }

    CustomDep_NotifyChanged() {
        this.emit('dataChanged', { type: 'dependence' });
    }

    // --- includePath

    CustomDep_AddIncDir(dir: File) {
        const dep = this.CustomDep_getDependence();
        if (!dep.incList.includes(dir.path)) {
            dep.incList.push(dir.path);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_AddIncDirAtFirst(dir: File) {
        const dep = this.CustomDep_getDependence();
        if (!dep.incList.includes(dir.path)) {
            dep.incList.unshift(dir.path);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    /**
     * @return duplicated paths list
    */
    CustomDep_AddIncFromPathList(pathList: string[]): string[] {

        let needNotify: boolean = false;
        const dupList: string[] = [];
        const dep = this.CustomDep_getDependence();

        pathList.forEach((path) => {
            if (!dep.incList.includes(path)) {
                dep.incList.push(path);
                needNotify = true;
            } else {
                dupList.push(path);
            }
        });

        if (needNotify) {
            this.emit('dataChanged', { type: 'dependence' });
        }

        return dupList;
    }

    CustomDep_ModifyIncDir(path: string, newPath: string) {
        if (path == newPath || newPath.trim() == '')
            return;
        const dep = this.CustomDep_getDependence();
        let index = dep.incList.findIndex((p) => { return p === path; });
        if (index !== -1) {
            dep.incList[index] = newPath;
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveIncDir(path: string) {
        const dep = this.CustomDep_getDependence();
        let index = dep.incList.findIndex((p) => { return p === path; });
        if (index !== -1) {
            dep.incList.splice(index, 1);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveIncDirs(pathList: string[]) {
        const dep = this.CustomDep_getDependence();
        const oldLen = dep.incList.length;

        dep.incList = dep.incList.filter((incPath) => {
            return !pathList.includes(incPath);
        });

        if (oldLen !== dep.incList.length) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    // --- defines (macros)

    CustomDep_AddDefine(define: string) {
        const dep = this.CustomDep_getDependence();
        if (!dep.defineList.includes(define)) {
            dep.defineList.push(define);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_AddAllFromDefineList(defineList: string[]) {
        let needNotify: boolean = false;
        const dep = this.CustomDep_getDependence();
        defineList.forEach((define) => {
            if (!dep.defineList.includes(define)) {
                dep.defineList.push(define);
                needNotify = true;
            }
        });

        if (needNotify) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_ModifyDefine(_define: string, newDefine: string) {
        if (_define == newDefine || newDefine.trim() == '')
            return;
        const dep = this.CustomDep_getDependence();
        let index = dep.defineList.findIndex((define) => { return define === _define; });
        if (index !== -1) {
            dep.defineList[index] = newDefine;
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveDefine(_define: string) {
        const dep = this.CustomDep_getDependence();
        let index = dep.defineList.findIndex((define) => { return define === _define; });
        if (index !== -1) {
            dep.defineList.splice(index, 1);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveFromDefineList(_defineList: string[]) {

        const dep = this.CustomDep_getDependence();
        const oldLen = dep.defineList.length;

        dep.defineList = dep.defineList.filter((define) => {
            return !_defineList.includes(define);
        });

        if (oldLen !== dep.defineList.length) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    // --- libraries dir

    CustomDep_AddAllFromLibList(pathList: string[]) {

        let needNotify: boolean = false;
        const dep = this.CustomDep_getDependence();

        pathList.forEach((path) => {
            if (!dep.libList.includes(path)) {
                dep.libList.push(path);
                needNotify = true;
            }
        });

        if (needNotify) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_ModifyLib(path: string, newPath: string) {
        if (path == newPath || newPath.trim() == '')
            return;
        const dep = this.CustomDep_getDependence();
        let index = dep.libList.findIndex((p) => { return path === p; });
        if (index !== -1) {
            dep.libList[index] = newPath;
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveLib(path: string) {
        const dep = this.CustomDep_getDependence();
        let index = dep.libList.findIndex((p) => { return path === p; });
        if (index !== -1) {
            dep.libList.splice(index, 1);
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    // --- src dirs

    /* CustomDep_AddAllFromSourceList(_sourceList: string[]) {

        let needNotify: boolean = false;
        const dep = this.CustomDep_getDependence();
        _sourceList.forEach((source) => {
            if (!dep.sourceDirList.includes(source)) {
                dep.sourceDirList.push(source);
                needNotify = true;
            }
        });

        if (needNotify) {
            this.emit('dataChanged', { type: 'dependence' });
        }
    }

    CustomDep_RemoveSource(source: string) {
        const dep = this.CustomDep_getDependence();
        let index = dep.sourceDirList.findIndex((src) => { return src === source; });
        if (index !== -1) {
            dep.sourceDirList.splice(index, 1);
            this.emit('dataChanged', { type: 'dependence' });
        }
    } */

    // --- store

    cloneCurrentTarget(): ProjectTargetInfo {
        return snapshotCurrentTarget(this.config, {
            customDep: this.CustomDep_getDependence(),
            toRelativePath: (path) => this.toRelativePath(path),
            defaultTargetInfo: this.getDefaultTargetInfo()
        });
    }

    private recoverTarget(targetName?: string) {
        const recovered = recoverTargetToRoot(this.config, targetName, this.CustomDep_getDependence());
        if (!recovered) {
            if (this.config.mode == undefined) {
                throw new Error(`no any target can be recovered !`);
            }
            // not found any target can be recovered, keep current mode
        }
    }

    getProjectUsrCtx(): ProjectUserContextData {
        const key = `project.${this.config.miscInfo.uid || 'unknown'}`;
        const val = this.workspaceState.get<string>(key);
        if (!val)
            return {};
        try {
            return JSON.parse(val);
        } catch (error) {
            GlobalEvent.log_error(error);
            return {}; // empty obj
        }
    };

    setProjectUsrCtx(data: ProjectUserContextData) {
        const key = `project.${this.config.miscInfo.uid || 'unknown'}`;
        const val = this.workspaceState.get<string>(key);
        const saveVal = JSON.stringify(data);
        if (val !== saveVal) {
            this.workspaceState.update(key, saveVal);
        }
    }

    //---

    protected parse<T extends BuilderConfigData>(str: string): ProjectConfigData<T> {
        const parsed = ProjectConfiguration.parseProjectFile(str);

        // v4.2 骨架:目标详情在 .eide/targets/<name>/<name>.yml,逐一读入组装
        if (isV42Skeleton(parsed)) {
            const eideDir = NodePath.dirname(this.cfgFile.path);
            const targetFiles: TargetFileData[] = [];
            for (const name of <string[]>(<unknown>parsed.targets)) {
                const targetFile = NodePath.join(eideDir, 'targets', name, `${name}.yml`);
                // 索引里有但文件缺失 = 数据损坏:必须大声失败中止加载,
                // 静默跳过会导致后续 Save 把残缺状态写盘并触发孤儿清理,造成数据永久丢失
                if (!fs.existsSync(targetFile)) {
                    throw Error(`Target config file '${targetFile}' is missing ! ` +
                        `Restore it from a backup (e.g. 'eide.v4.1.bak.yml'), ` +
                        `or remove target '${name}' from the 'targets' list in 'eide.yml' manually.`);
                }
                targetFiles.push({ name, data: yaml.parse(fs.readFileSync(targetFile, 'utf8')) });
            }
            return <ProjectConfigData<T>><unknown>assembleFromSkeleton(parsed, targetFiles);
        }

        // v4.1 及更早:全部目标平铺在单文件内
        const cfg: ProjectConfigData<T> = <ProjectConfigData<T>><unknown>parsed;
        for (const key in cfg.targets) {
            const target = cfg.targets[key];
            target.builderOptions = {};
            for (const toolchain in target.toolchainConfigMap) {
                target.builderOptions[toolchain] = target.toolchainConfigMap[toolchain].options;
                target.toolchainConfigMap[toolchain].options = '';
            }
            target.toolchainConfig = target.toolchainConfigMap[target.toolchain];
            target.uploadConfig = target.uploadConfigMap[target.uploader];
            target.cppPreprocessAttrs.name = 'default';
        }
        return cfg;
    }

    /**
     * 将运行时配置打包为"完整磁盘形态"(v4.1 风格:目标全部平铺、
     * builderOptions 并回 toolchainConfigMap、路径转相对),供 v4.1 写出与 v4.2 拆分共用。
     */
    private packToDiskObject(): ProjectConfigData<T> {

        const eidePrjObj = <ProjectConfigData<T>>utility.deepCloneObject(this.config);

        // store target
        eidePrjObj.targets[eidePrjObj.mode] = this.cloneCurrentTarget();
        for (const key in eidePrjObj.targets) {
            const target = eidePrjObj.targets[key];
            target.toolchainConfigMap[target.toolchain] = target.toolchainConfig;
            target.toolchainConfig = undefined;
            target.uploadConfigMap[target.uploader] = target.uploadConfig;
            target.uploadConfig = undefined;
            for (const toolchain in target.builderOptions) {
                if (target.toolchainConfigMap[toolchain])
                    target.toolchainConfigMap[toolchain].options = target.builderOptions[toolchain];
            }
            target.builderOptions = <any>undefined;
            target.cppPreprocessAttrs.name = <any>undefined;
        }

        // convert abspath to relative path before save to file
        eidePrjObj.srcDirs = eidePrjObj.srcDirs.map((path) => this.toRelativePath(path));

        // ignore some 'dynamic' dependence
        eidePrjObj.dependenceList = eidePrjObj.dependenceList.filter((g) => {
            return g.groupName !== ProjectConfiguration.BUILD_IN_GROUP_NAME
                && g.groupName !== ProjectConfiguration.CUSTOM_GROUP_NAME;
        });

        for (const depGroup of eidePrjObj.dependenceList) {
            for (const dep of depGroup.depList) {
                dep.incList = dep.incList.map((path) => this.toRelativePath(path));
                dep.libList = dep.libList.map((path) => this.toRelativePath(path));
            }
        }

        return eidePrjObj;
    }

    protected toString(): string {

        const eidePrjObj = this.packToDiskObject();

        // v4.2:只写骨架,目标数据由 Save 写入 .eide/targets/<name>/
        if (this.config.version === EIDE_CONF_VERSION) {
            const { skeleton } = splitIntoSkeleton(eidePrjObj);
            return ProjectConfiguration.dumpProjectFile(skeleton);
        }

        // v4.1 及更早:剥离运行时平铺键后整体写出
        for (const key in eidePrjObj) {
            if (EXCL_KEYS_IN_EIDE_JSON.includes(key))
                (<any>eidePrjObj)[key] = undefined;
        }

        return ProjectConfiguration.dumpProjectFile(eidePrjObj);
    }

    // ! 注意这里比较两个 json 字符串是否相等，需要去除空白字符，不要直接比较字符串，
    // ! 不同平台上项目文件中的 \n 可能不同，会导致 git 提示有更改
    protected compare(s1: string, s2: string): boolean {
        const a = yaml.parse(s1);
        const b = yaml.parse(s2);
        return JSON.stringify(a) === JSON.stringify(b);
    }

    protected postLoadConfig() {

        //
        // load target
        //

        // compatible missing field for old project
        let defCfg = <any>this.GetDefault(this.config.type);
        let curCfg = <any>this.config;
        for (const key in defCfg) {
            if (curCfg[key] == undefined &&
                EXCL_KEYS_IN_EIDE_JSON.includes(key) == false) {
                curCfg[key] = defCfg[key];
            }
        }

        // compatible virtualFolder field for old project
        if (Array.isArray(this.config.virtualFolder)) {
            this.config.virtualFolder = {
                name: VirtualSource.rootName,
                files: [],
                folders: this.config.virtualFolder
            };
        }

        // init targets default value
        const defTargetInfo: ProjectTargetInfo = this.getDefaultTargetInfo();
        for (const name in this.config.targets) {
            const target = this.config.targets[name];
            for (const key in defTargetInfo) {
                if ((<any>target)[key] === undefined)
                    (<any>target)[key] = utility.deepCloneObject((<any>defTargetInfo)[key]);
            }
        }

        //  old project(ver < 3.3) have 'mode' field
        //  new project(ver >= 3.3) not have 'mode' field
        if (this.config.mode == undefined) {
            const usrCtx = this.getProjectUsrCtx();
            this.recoverTarget(usrCtx.target);
        } else {
            // 如果是很旧的项目，则需要重新加载一次以更新项目数据
            this.needReloadProject = true;
        }

        // fill missing field after target recovered
        for (const key in defCfg) {
            if (curCfg[key] == undefined) {
                curCfg[key] = defCfg[key];
            }
        }

        //
        // format path
        //

        this.config.srcDirs = ArrayDelRepetition(this.config.srcDirs.map((path) => { return this.toAbsolutePath(path); }));

        for (const depGroup of this.config.dependenceList) {
            for (const dep of depGroup.depList) {
                dep.incList = ArrayDelRepetition(dep.incList.map((path) => { return this.toAbsolutePath(path); }));
                dep.libList = ArrayDelRepetition(dep.libList.map((path) => { return this.toAbsolutePath(path); }));
            }
        }
    }

    /**
     * 取某个 uploader 的配置字段名列表(用于外部校验写入的 key 是否合法)。
     * 不同 uploader 的字段集不同,所以需要按类型查。
     */
    getUploadConfigKeys(uploader: HexUploaderType): string[] {
        try {
            return Object.keys((<any>UploadConfigModel.getInstance(uploader, this.project)).GetDefault() || {});
        } catch {
            return [];
        }
    }

    Save(force?: boolean) {
        const usrCtx = this.getProjectUsrCtx();
        usrCtx.target = this.config.mode; // save current target
        this.setProjectUsrCtx(usrCtx);

        // v4.2:目标数据写入 .eide/targets/<name>/<name>.yml(仅变化时写),
        // 并清理索引中已不存在目标的残留目录;骨架 eide.yml 由 super.Save 写出
        if (this.config.version === EIDE_CONF_VERSION) {
            try {
                const eideDir = NodePath.dirname(this.cfgFile.path);
                const { skeleton, targetFiles } = splitIntoSkeleton(<any>this.packToDiskObject());
                const index = new Set(<string[]>skeleton.targets);

                for (const item of targetFiles) {
                    const targetFile = NodePath.join(eideDir, 'targets', item.name, `${item.name}.yml`);
                    const content = yaml.stringify(item.data, { indent: 2, lineWidth: 1000 });
                    if (!fs.existsSync(targetFile) || fs.readFileSync(targetFile, 'utf8') !== content) {
                        fs.mkdirSync(NodePath.dirname(targetFile), { recursive: true });
                        // 登记自写路径, 让 targets watcher 跳过本次事件
                        this.selfWrittenTargetFiles.set(targetFile.toLowerCase(), Date.now());
                        atomicWriteFileSync(targetFile, content);
                    }
                }

                // clean up orphan target dirs (targets deleted from the index)
                const targetsRoot = NodePath.join(eideDir, 'targets');
                if (fs.existsSync(targetsRoot)) {
                    for (const entry of fs.readdirSync(targetsRoot)) {
                        if (!index.has(entry)) {
                            fs.rmSync(NodePath.join(targetsRoot, entry), { recursive: true, force: true });
                        }
                    }
                }
            } catch (error) {
                GlobalEvent.log_error(error);
            }
        }

        super.Save();
    }
}

//-------------------------------------------------------------------------





export class WorkspaceConfiguration extends Configuration<WorkspaceConfig> {

    isDelUnknownKeysWhenLoad = false;
    isLoadFailed = false;

    protected readTypeFromFile(configFile: File): ProjectType | undefined {
        return undefined;
    }

    protected parse(jsonStr: string): WorkspaceConfig {
        try {
            const errors: jsonc_parser.ParseError[] = [];
            const obj = <any>jsonc_parser.parse(jsonStr, errors, { allowTrailingComma: true });
            if (errors.length > 0 || obj == undefined) {
                throw new Error(
                    errors.map(e => `${jsonc_parser.printParseErrorCode(e.error)} at offset ${e.offset}`)
                        .join('; ')
                    || 'invalid workspace config'
                );
            }
            this.isLoadFailed = false;
            return obj;
        } catch (error) {
            GlobalEvent.log_error(error);
            GlobalEvent.show_msgbox(
                'Warning', view_str$prompt$loadws_cfg_failed.replace('{}', this.FILE_NAME)
            );
            this.isLoadFailed = true;
            return this.GetDefault();
        }
    }

    protected toString(): string {
        return jsonc.stringify(this.config, undefined, 4);
    }

    protected compare(s1: string, s2: string): boolean {
        return s1 === s2;
    }

    // workspace only can be force save, because user will modify this file, 
    // so we can not override it
    Save(force?: boolean) {
        if (force)
            super.Save();
    }

    GetDefault(): WorkspaceConfig {
        return {
            folders: [
                {
                    path: "."
                }
            ],
            settings: {},
            extensions: {}
        };
    }
}
