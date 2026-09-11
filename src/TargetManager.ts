/**
 * Build-target management core.
 *
 * 该模块是 target(构建目标)管理的唯一实现点:
 *  - 纯函数部分(无 vscode 依赖,可单元测试):
 *      validateTargetName / makeTargetInfo / applyTargetToConfigData /
 *      snapshotCurrentTarget / applyTargetSnapshot
 *  - TargetManager 类:通过 TargetManagerHost 注入项目能力,
 *    提供完整的 target 生命周期操作(创建/重命名/克隆/删除/切换)。
 *
 * 注意:由于历史原因,EIDE 运行时会将当前激活 target 的字段平铺在
 * ProjectConfigData 根节点上(遗留字段名 `mode`),与 `targets` 表互为镜像;
 * MAPPED_KEYS_IN_TARGET_INFO 列出的键由本模块负责同步,其他模块不得自行复制。
 */
import type {
    Dependence,
    ProjectConfigData,
    ProjectTargetInfo,
} from './EIDETypeDefine';
import type { ToolchainName } from './types/ToolchainTypes';
import type { HexUploaderType } from './types/UploadTypes';

// 备注:对比 ProjectTargetInfo 与 ProjectConfigData 相同的键,
// 这些键需要在运行时从 targets 复制到配置根节点(历史遗留的平铺结构)。
import { MAPPED_KEYS_IN_TARGET_INFO } from './ProjectConsts';
export { MAPPED_KEYS_IN_TARGET_INFO };

export const TARGET_NAME_MAX_LENGTH = 25;

/**
 * 校验 target 名称,合法返回 undefined,否则返回错误描述。
 * 由于 env.ini 段名与部分旁路文件名不区分大小写,重名检查也按大小写不敏感处理。
 */
export function validateTargetName(name: string, existingNames: string[]): string | undefined {
    if (!name) { return 'target name is empty !'; }
    if (name.length > TARGET_NAME_MAX_LENGTH) {
        return `string is too long !, length must < ${TARGET_NAME_MAX_LENGTH}, current is ${name.length}`;
    }
    if (!/^[\w\-]+$/.test(name)) { return `string can only contain word, number '-' or '_' !`; }
    const lowerName = name.toLowerCase();
    for (const existing of existingNames) {
        if (existing.toLowerCase() === lowerName) {
            return `Target '${existing}' is existed !`;
        }
    }
    return undefined;
}

function copyObject(src: any): any {
    if (Array.isArray(src)) {
        return Array.from(src);
    } else if (typeof src === 'object') {
        return JSON.parse(JSON.stringify(src));
    } else {
        return src;
    }
}

function getFirstKey(obj: any): string | undefined {
    if (typeof obj === 'object') {
        for (const key in obj) { return key; }
    }
    return undefined;
}

/**
 * 将 `targets[targetName]` 恢复到配置根节点(加载 eide.yml 时使用,
 * 即原 ProjectConfiguration.recoverTarget)。
 *
 * 与 applyTargetSnapshot 的区别:加载阶段编译/烧录配置模型尚未按引用绑定,
 * 因此直接写根节点字段;cppPreprocessAttrs 写入调用方提供的 customDep。
 *
 * @returns 恢复后的 target 名;无法恢复(无可用目标)时返回 undefined
 */
export function recoverTargetToRoot(config: ProjectConfigData<any>, targetName: string | undefined, customDep: Dependence): string | undefined {
    if (!targetName || !config.targets[targetName]) {
        // roll back to default target
        targetName = getFirstKey(config.targets);
    }

    const target = targetName ? config.targets[targetName] : undefined;
    if (!target) { return undefined; }

    config.mode = targetName as string;
    config.excludeList = Array.from(target.excludeList);

    config.toolchain = target.toolchain;
    config.toolchainConfig = copyObject(target.toolchainConfig);
    config.toolchainConfigMap = copyObject(target.toolchainConfigMap);

    config.uploader = target.uploader;
    config.uploadConfig = copyObject(target.uploadConfig);
    config.uploadConfigMap = copyObject(target.uploadConfigMap);

    customDep.incList = Array.from(target.cppPreprocessAttrs.incList);
    customDep.libList = Array.from(target.cppPreprocessAttrs.libList);
    customDep.defineList = Array.from(target.cppPreprocessAttrs.defineList);

    return targetName;
}

/** 构造一个字段完整的 ProjectTargetInfo,overrides 覆盖默认值;默认值均为全新实例。 */
export function makeTargetInfo(overrides: Partial<ProjectTargetInfo> = {}): ProjectTargetInfo {
    const base: ProjectTargetInfo = {
        excludeList: [],
        toolchain: 'AC5',
        toolchainConfig: {},
        toolchainConfigMap: {},
        uploader: 'Custom',
        uploadConfig: {},
        uploadConfigMap: {},
        cppPreprocessAttrs: {
            name: 'default',
            incList: [],
            libList: [],
            defineList: []
        },
        builderOptions: {},
        settings: {}
    };
    return { ...base, ...overrides };
}

/**
 * 将 `targets[targetName]` 平铺到 ProjectConfigData 根节点并设置 `mode`。
 * 用于三个导入器(Keil/IAR/Eclipse)与新项目的初始化:导入器各自解析出
 * targets 表后,统一调用本函数完成"当前激活目标"的展开。
 */
export function applyTargetToConfigData(configData: ProjectConfigData<any>, targetName: string): void {
    const target = <any>configData.targets[targetName];
    if (!target) {
        throw new Error(`not found target: '${targetName}' !`);
    }

    configData.mode = targetName;

    for (const key in target) {
        if (key === 'cppPreprocessAttrs') {
            configData.dependenceList = [{
                groupName: 'custom',
                depList: [target[key]]
            }];
            continue;
        }
        if (!MAPPED_KEYS_IN_TARGET_INFO.includes(key)) { continue; }
        (<any>configData)[key] = target[key];
    }
}

/** snapshotCurrentTarget 所需的项目上下文 */
export interface TargetSnapshotContext {
    /** 当前激活 target 的自定义依赖(CustomDep,绝对路径) */
    customDep: Dependence;
    /** 绝对路径 -> 相对路径 */
    toRelativePath(path: string): string;
    /** 缺省 target 信息(用于 builderOptions/settings 兜底) */
    defaultTargetInfo: ProjectTargetInfo;
}

/**
 * 将当前平铺在根节点的激活 target 拍成快照(即原 ProjectConfiguration.cloneCurrentTarget)。
 * - cppPreprocessAttrs 取自 customDep,inc/lib 路径转为相对路径;
 * - builderOptions/settings 沿用已存储的 targets[mode],缺失时用 defaultTargetInfo 兜底。
 */
export function snapshotCurrentTarget(config: ProjectConfigData<any>, ctx: TargetSnapshotContext): ProjectTargetInfo {
    const storedTarget = config.targets[config.mode];
    const customDep = copyObject(ctx.customDep);

    return {
        excludeList: Array.from(config.excludeList),
        toolchain: config.toolchain,
        toolchainConfig: copyObject(config.toolchainConfig),
        toolchainConfigMap: copyObject(config.toolchainConfigMap),
        uploader: config.uploader,
        uploadConfig: copyObject(config.uploadConfig),
        uploadConfigMap: copyObject(config.uploadConfigMap),
        cppPreprocessAttrs: {
            name: customDep.name,
            incList: customDep.incList.map((path: string) => ctx.toRelativePath(path)),
            libList: customDep.libList.map((path: string) => ctx.toRelativePath(path)),
            defineList: customDep.defineList
        },
        builderOptions: (storedTarget && storedTarget.builderOptions !== undefined)
            ? copyObject(storedTarget.builderOptions)
            : copyObject(ctx.defaultTargetInfo.builderOptions),
        settings: (storedTarget && storedTarget.settings)
            ? copyObject(storedTarget.settings)
            : copyObject(ctx.defaultTargetInfo.settings)
    };
}

/** applyTargetSnapshot 所需的项目上下文 */
export interface TargetRestoreContext {
    /** 编译配置模型,数据必须原位更新(模型按对象引用绑定) */
    toolchainConfigModel: { data: any };
    /** 烧录配置模型,数据必须原位更新(模型按对象引用绑定) */
    uploadConfigModel: { data: any };
    /** 当前激活 target 的自定义依赖(原位更新,inc/lib 转为绝对路径) */
    customDep: Dependence;
    /** 相对路径 -> 绝对路径 */
    toAbsolutePath(path: string): string;
}

/**
 * 将一个 target 快照恢复到平铺的根节点(即原 AbstractProject._switchTarget 的数据搬运部分):
 * - toolchainConfig/uploadConfig 原位写入对应模型的 data(引用绑定,不可替换对象);
 * - cppPreprocessAttrs 原位写入 customDep 并将 inc/lib 转为绝对路径;
 * - 其余 MAPPED 键以副本形式写到根节点。
 */
export function applyTargetSnapshot(config: ProjectConfigData<any>, targetInfo: ProjectTargetInfo, ctx: TargetRestoreContext): void {
    const curTarget = <any>config;
    const oldTarget = <any>targetInfo;

    for (const name in oldTarget) {

        if (name === 'cppPreprocessAttrs') {
            const curDep = ctx.customDep;
            const oldDep = oldTarget[name];
            for (const key in curDep) { (<any>curDep)[key] = copyObject(oldDep[key]); }
            // convert to abs path
            curDep.incList = curDep.incList.map((path) => ctx.toAbsolutePath(path));
            curDep.libList = curDep.libList.map((path) => ctx.toAbsolutePath(path));
            continue;
        }

        if (name === 'toolchainConfig') {
            const toolchainConfig = ctx.toolchainConfigModel.data;
            // delete all properties
            for (const key in toolchainConfig) { delete toolchainConfig[key]; }
            // update properties
            for (const key in oldTarget[name]) { toolchainConfig[key] = copyObject(oldTarget[name][key]); }
            continue;
        }

        if (name === 'uploadConfig') {
            const uploadConfig = ctx.uploadConfigModel.data;
            for (const key in uploadConfig) { delete uploadConfig[key]; }
            for (const key in oldTarget[name]) { uploadConfig[key] = copyObject(oldTarget[name][key]); }
            continue;
        }

        if (!MAPPED_KEYS_IN_TARGET_INFO.includes(name)) { continue; }

        curTarget[name] = copyObject(oldTarget[name]);
    }
}

/** TargetManager 所需的项目能力(由 AbstractProject 注入,避免双向依赖) */
export interface TargetManagerHost {
    getConfig(): ProjectConfigData<any>;
    snapshotContext(): TargetSnapshotContext;
    restoreContext(): TargetRestoreContext;
    /** 切换编译工具链(reload 之外的部分,如 setToolchain(name, true)) */
    applyToolchain(name: ToolchainName): void;
    /** 切换烧录器配置 */
    applyUploader(name: HexUploaderType): void;
    reloadToolchain(): void;
    reloadUploader(): void;
    /** 复制 per-target 的源文件额外编译参数(from -> to) */
    copyTargetSourceExtraArgs(fromName: string, toName: string): void;
    /** 旁路文件跟随重命名(libs.yml / files.options 条目 / env.ini 段 / st.option.bytes.ini) */
    renameTargetSidecars(oldName: string, newName: string): void;
    /** 旁路文件跟随复制 */
    copyTargetSidecars(fromName: string, toName: string): void;
    /** 删除 target 的旁路文件 */
    deleteTargetSidecars(name: string): void;
    /** 强制刷新源文件树 */
    refreshSourceTree(): void;
    save(): void;
    emitTargetEvent(type: TargetEventType, data: any): void;
}

export type TargetEventType = 'targetSwitched' | 'targetCreated' | 'targetDeleted' | 'targetRenamed';

export interface TargetSwitchResult {
    name: string;
    isNew?: boolean;
}

/**
 * target 生命周期管理器(每个项目一个实例)。
 * 所有操作在参数非法时抛出带描述的 Error,由 UI 层负责展示。
 */
export class TargetManager {

    constructor(private readonly host: TargetManagerHost) { }

    getNames(): string[] {
        const prjConfigData = this.host.getConfig();
        const result: string[] = [];
        for (const name in prjConfigData.targets) { result.push(name); }
        // mode 可能尚未落盘(例如刚创建还未保存的项目)
        if (prjConfigData.targets[prjConfigData.mode] === undefined) {
            result.push(prjConfigData.mode);
        }
        return result;
    }

    has(name: string): boolean {
        return this.host.getConfig().targets[name] !== undefined;
    }

    getCurrentName(): string {
        return this.host.getConfig().mode;
    }

    getTarget(name?: string): ProjectTargetInfo | undefined {
        const prjConfigData = this.host.getConfig();
        return prjConfigData.targets[name || prjConfigData.mode];
    }

    /** 校验名称,合法返回 undefined,否则返回错误描述 */
    validateName(name: string): string | undefined {
        return validateTargetName(name, this.getNames());
    }

    /**
     * 创建新目标并切换为激活目标。
     * @param opts.cloneFrom 从指定目标克隆;缺省克隆当前激活目标的运行时状态
     * @param opts.blank 创建空白目标(仅继承项目的工具链/烧录器设置)
     */
    create(name: string, opts?: { cloneFrom?: string; blank?: boolean }): TargetSwitchResult {
        const err = this.validateName(name);
        if (err) { throw new Error(err); }

        const prjConfigData = this.host.getConfig();
        const cloneFrom = opts?.cloneFrom;
        if (cloneFrom !== undefined && cloneFrom !== prjConfigData.mode && !this.has(cloneFrom)) {
            throw new Error(`not found target: '${cloneFrom}' !`);
        }

        const baseTargetInfo = opts?.blank
            ? makeTargetInfo({ toolchain: prjConfigData.toolchain, uploader: prjConfigData.uploader })
            : (cloneFrom !== undefined && cloneFrom !== prjConfigData.mode)
                ? copyObject(prjConfigData.targets[cloneFrom])
                : snapshotCurrentTarget(prjConfigData, this.host.snapshotContext());

        const prevTargetName = prjConfigData.mode;
        prjConfigData.targets[name] = baseTargetInfo;

        this.activate(name, baseTargetInfo);

        if (prevTargetName !== name) {
            this.host.copyTargetSourceExtraArgs(prevTargetName, name);
        }

        this.host.refreshSourceTree();

        this.host.emitTargetEvent('targetCreated', { name });
        this.host.emitTargetEvent('targetSwitched', { name, isNew: true });
        this.host.save();

        return { name, isNew: true };
    }

    /** 重命名目标;若目标是激活目标,同步更新 mode */
    rename(oldName: string, newName: string): void {
        const err = this.validateName(newName);
        if (err) { throw new Error(err); }
        if (!this.has(oldName)) {
            throw new Error(`not found target: '${oldName}' !`);
        }
        if (oldName === newName) { return; }

        const prjConfigData = this.host.getConfig();
        prjConfigData.targets[newName] = prjConfigData.targets[oldName];
        delete prjConfigData.targets[oldName];
        if (prjConfigData.mode === oldName) {
            prjConfigData.mode = newName;
        }

        this.host.renameTargetSidecars(oldName, newName);
        this.host.emitTargetEvent('targetRenamed', { oldName, newName });
        this.host.save();
    }

    /** 克隆一个已存在的目标(不切换激活目标) */
    duplicate(sourceName: string, newName: string): void {
        const err = this.validateName(newName);
        if (err) { throw new Error(err); }
        if (!this.has(sourceName)) {
            throw new Error(`not found target: '${sourceName}' !`);
        }

        const prjConfigData = this.host.getConfig();
        prjConfigData.targets[newName] = copyObject(prjConfigData.targets[sourceName]);

        this.host.copyTargetSidecars(sourceName, newName);
        this.host.emitTargetEvent('targetCreated', { name: newName });
        this.host.save();
    }

    /** 删除目标;激活目标不可删除(旁路文件一并清理) */
    delete(name: string): void {
        const prjConfigData = this.host.getConfig();
        if (prjConfigData.mode === name) {
            throw new Error(`Target '${name}' is actived !, can't remove it !`);
        }
        if (!this.has(name)) {
            throw new Error(`not found target: '${name}' !`);
        }

        delete prjConfigData.targets[name];

        this.host.deleteTargetSidecars(name);
        this.host.emitTargetEvent('targetDeleted', { name });
        this.host.save();
    }

    /**
     * 切换激活目标(即原 AbstractProject.switchTarget/_switchTarget):
     * 保存当前目标快照 -> 恢复目标数据 -> 切换工具链/烧录器 -> 刷新源文件树。
     */
    switch(name: string): TargetSwitchResult {
        const prjConfigData = this.host.getConfig();
        if (name === prjConfigData.mode) { return { name }; }

        if (!this.has(name)) {
            throw new Error(`not found target: '${name}' !`);
        }

        const prevTargetName = prjConfigData.mode;
        // save old target
        prjConfigData.targets[prevTargetName] = snapshotCurrentTarget(prjConfigData, this.host.snapshotContext());

        this.activate(name, prjConfigData.targets[name]);

        this.host.refreshSourceTree();

        return { name };
    }

    /** 内部:将目标数据恢复到根节点并同步工具链/烧录器配置 */
    private activate(name: string, targetInfo: ProjectTargetInfo): void {
        const prjConfigData = this.host.getConfig();

        prjConfigData.mode = name;
        this.host.applyToolchain(targetInfo.toolchain);
        this.host.applyUploader(targetInfo.uploader);

        applyTargetSnapshot(prjConfigData, targetInfo, this.host.restoreContext());
    }
}

/** 单个 target 的构建结果(构建所有 target 时逐个收集,失败不中断) */
export interface BuildTargetResult {
    target: string;
    success: boolean;
    /** 失败时的错误文本(可能多行,汇总时只取首行) */
    message?: string;
}

export interface BuildAllSummary {
    text: string;
    hasFailure: boolean;
}

/** 构建所有 target 的汇总文本:✓/✗ 清单,失败项只保留首行错误(纯函数) */
export function formatBuildAllSummary(results: BuildTargetResult[]): BuildAllSummary {
    const passed = results.filter((r) => r.success).length;
    const failed = results.length - passed;
    if (!results.length) {
        return { text: 'No targets to build.', hasFailure: false };
    }

    const lines = results.map((r) => {
        if (r.success) { return `✓ ${r.target}`; }
        const firstLine = String(r.message || 'failed')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) || 'failed';
        const trimmed = firstLine.length > 160 ? `${firstLine.slice(0, 160)}...` : firstLine;
        return `✗ ${r.target}: ${trimmed}`;
    });

    return {
        text: `Build all targets finished: ${passed} passed, ${failed} failed.\n${lines.join('\n')}`,
        hasFailure: failed > 0
    };
}
