/**
 * v4.2 project file storage.
 *
 * v4.2 把 v4.1 的单文件 eide.yml 拆为:
 *   .eide/eide.yml              —— 项目骨架(name/type/srcDirs/virtualFolder/outDir/
 *                                  deviceName/packDir/miscInfo/dependenceList/version)
 *                                  + targets 名列表(保序索引)
 *   .eide/targets/<name>/<name>.yml       —— 每目标全量数据(磁盘形态与 v4.1 的
 *                                  targets[name] 条目一致)
 *   .eide/targets/<name>/files.options.yml / libs.yml / st.option.bytes.ini
 *                               —— 原先以目标名为键散放在 .eide/ 下的旁路文件
 *
 * 运行时内存结构(ProjectConfigData)不变;本模块只负责磁盘形态的拆分/合并/迁移。
 * 迁移顺序保证可中断恢复:先写 targets/,再删旧旁路,最后改写 eide.yml 骨架;
 * 任意时刻崩溃,下次打开都会因 version !== '4.2' 重新迁移(幂等)。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { ProjectTargetInfo } from './EIDETypeDefine';
import { EIDE_CONF_VERSION_V41, PROJECT_CONFIG_FILE_NAME, TARGETS_DIR_NAME } from './ProjectConsts';
import { getTargetLibsFileName, getTargetOptionBytesFileName } from './TargetSidecars';
import { atomicWriteFileSync } from './AtomicWrite';

export const EIDE_CONF_VERSION_V42 = '4.2';

const V41_BACKUP_NAME = 'eide.v4.1.bak.yml';

function copyObject(src: any): any {
    if (Array.isArray(src)) {
        return Array.from(src);
    } else if (typeof src === 'object') {
        return JSON.parse(JSON.stringify(src));
    } else {
        return src;
    }
}

/** v4.2 骨架识别 */
export function isV42Skeleton(parsedYaml: any): boolean {
    return parsedYaml != undefined &&
        parsedYaml.version === EIDE_CONF_VERSION_V42 &&
        Array.isArray(parsedYaml.targets);
}

/** 运行时 target -> 磁盘形态(与 v4.1 toString 的单目标打包逻辑一致) */
export function packTargetForDisk(info: ProjectTargetInfo): any {
    const disk: any = {
        excludeList: Array.from(info.excludeList),
        toolchain: info.toolchain,
        toolchainConfigMap: copyObject(info.toolchainConfigMap),
        uploader: info.uploader,
        uploadConfigMap: copyObject(info.uploadConfigMap),
        settings: copyObject(info.settings),
        cppPreprocessAttrs: {
            incList: Array.from(info.cppPreprocessAttrs.incList),
            libList: Array.from(info.cppPreprocessAttrs.libList),
            defineList: Array.from(info.cppPreprocessAttrs.defineList)
        }
    };

    for (const toolchain in info.builderOptions) {
        // 运行时不变量:toolchainConfigMap[tc].options 为占位符,真选项在 builderOptions[tc];
        // 条目缺失时兜底创建,避免选项数据静默丢失
        disk.toolchainConfigMap[toolchain] = {
            ...(disk.toolchainConfigMap[toolchain] || {}),
            options: copyObject(info.builderOptions[toolchain])
        };
    }
    if (info.uploadConfig !== undefined && info.uploadConfig !== null) {
        disk.uploadConfigMap[info.uploader] = copyObject(info.uploadConfig);
    }

    return disk;
}

/** 磁盘形态 -> 运行时 target(与 v4.1 parse 的单目标解包逻辑一致) */
export function unpackTargetFromDisk(disk: any): ProjectTargetInfo {
    const data = copyObject(disk);

    const builderOptions: any = {};
    for (const toolchain in data.toolchainConfigMap) {
        builderOptions[toolchain] = data.toolchainConfigMap[toolchain].options;
        data.toolchainConfigMap[toolchain].options = '';
    }

    return {
        excludeList: Array.from(data.excludeList || []),
        toolchain: data.toolchain,
        toolchainConfig: data.toolchainConfigMap[data.toolchain],
        toolchainConfigMap: data.toolchainConfigMap,
        uploader: data.uploader,
        uploadConfig: data.uploadConfigMap ? data.uploadConfigMap[data.uploader] : {},
        uploadConfigMap: data.uploadConfigMap || {},
        cppPreprocessAttrs: {
            name: 'default',
            incList: data.cppPreprocessAttrs?.incList || [],
            libList: data.cppPreprocessAttrs?.libList || [],
            defineList: data.cppPreprocessAttrs?.defineList || []
        },
        builderOptions,
        settings: data.settings || {}
    };
}

/** 需要从骨架中剥离的 target 平铺键(与 v4.1 的 EXCL_KEYS 语义一致) */
const SKELETON_EXCL_KEYS = [
    'mode', 'excludeList', 'toolchain', 'toolchainConfig', 'toolchainConfigMap',
    'uploader', 'uploadConfig', 'uploadConfigMap'
];

export interface TargetFileData {
    name: string;
    data: any;
}

/** 完整磁盘形态(v4.1 打包后) -> 骨架 + 每目标磁盘数据 */
export function splitIntoSkeleton(fullConfig: any): { skeleton: any; targetFiles: TargetFileData[] } {
    const skeleton: any = {
        name: fullConfig.name,
        type: fullConfig.type,
        outDir: fullConfig.outDir,
        deviceName: fullConfig.deviceName,
        packDir: fullConfig.packDir,
        srcDirs: fullConfig.srcDirs,
        virtualFolder: fullConfig.virtualFolder,
        miscInfo: fullConfig.miscInfo,
        dependenceList: fullConfig.dependenceList,
        version: EIDE_CONF_VERSION_V42,
        targets: Object.keys(fullConfig.targets || {})
    };

    const targetFiles: TargetFileData[] = skeleton.targets.map(
        (name: string) => ({ name, data: fullConfig.targets[name] })
    );

    for (const key of SKELETON_EXCL_KEYS) {
        delete skeleton[key];
    }

    return { skeleton, targetFiles };
}

/** 骨架 + 每目标磁盘数据 -> 运行时完整数据(mode 交给 postLoadConfig/recoverTarget 填充) */
export function assembleFromSkeleton(skeleton: any, targetFiles: TargetFileData[]): any {
    const config: any = {
        name: skeleton.name,
        type: skeleton.type,
        outDir: skeleton.outDir,
        deviceName: skeleton.deviceName,
        packDir: skeleton.packDir,
        srcDirs: skeleton.srcDirs,
        virtualFolder: skeleton.virtualFolder,
        miscInfo: skeleton.miscInfo,
        dependenceList: skeleton.dependenceList,
        version: skeleton.version,
        targets: {}
    };

    for (const item of targetFiles || []) {
        config.targets[item.name] = unpackTargetFromDisk(item.data);
    }

    return config;
}

// ---------------------------------------------------------------------------
// hot reload of a single target file (external edit support)
// ---------------------------------------------------------------------------

/** `<eideDir>/targets/<name>/<name>.yml` 的绝对路径 */
export function getTargetConfigFilePath(eideDir: string, targetName: string): string {
    return path.join(getTargetDir(eideDir, targetName), `${targetName}.yml`);
}

/**
 * 判断某个被改动的绝对路径是否为 `targets/<name>/<name>.yml`。
 *
 * 只认目标主文件: `files.options.yml` / `libs.yml` / `st.option.bytes.ini` 等旁路文件
 * 另有各自的处理链(见 `AbstractProject.onEideDirChanged`),不能在这里重复接管。
 *
 * @returns 命中的目标名,不命中返回 undefined
 */
export function matchTargetConfigFile(eideDir: string, changedPath: string): string | undefined {
    const targetsRoot = path.join(eideDir, TARGETS_DIR_NAME);
    const rel = path.relative(targetsRoot, changedPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return undefined; }

    const parts = rel.split(/[\\/]+/);
    if (parts.length !== 2) { return undefined; } // 必须是 targets/<name>/<file>

    const [dirName, fileName] = parts;
    // 目录名与文件名必须同名(重命名目标时目录与文件一起改名),且后缀为 .yml
    if (fileName.toLowerCase() !== `${dirName.toLowerCase()}.yml`) { return undefined; }

    return dirName;
}

/**
 * 把磁盘上的单个目标文件读回运行时形态。
 *
 * 用于“用户手改了 `targets/<name>/<name>.yml`”的场景: 只要把磁盘内容读进内存,
 * 之后任何 `Save()` 写出的都是同一份内容,手改就不会被内存旧值覆盖。
 *
 * @returns 运行时目标信息;文件不存在或解析失败时返回 undefined(调用方忽略该次事件)
 */
export function loadTargetFromFile(eideDir: string, targetName: string): ProjectTargetInfo | undefined {
    const filePath = getTargetConfigFilePath(eideDir, targetName);
    if (!fs.existsSync(filePath)) { return undefined; }
    try {
        return unpackTargetFromDisk(yaml.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
        console.error(error);
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// migration (real fs, idempotent, crash-safe ordering)
// ---------------------------------------------------------------------------

function getTargetDir(eideDir: string, targetName: string): string {
    return path.join(eideDir, TARGETS_DIR_NAME, targetName);
}

function writeTargetFile(eideDir: string, targetName: string, fileName: string, content: string): void {
    const targetDir = getTargetDir(eideDir, targetName);
    fs.mkdirSync(targetDir, { recursive: true });
    atomicWriteFileSync(path.join(targetDir, fileName), content);
}

function moveFileIfExists(oldPath: string, newPath: string): void {
    try {
        if (fs.existsSync(oldPath)) {
            fs.mkdirSync(path.dirname(newPath), { recursive: true });
            fs.renameSync(oldPath, newPath);
        }
    } catch (error) {
        // rename 跨卷等场景退化为复制
        try {
            if (fs.existsSync(oldPath)) {
                fs.copyFileSync(oldPath, newPath);
                fs.unlinkSync(oldPath);
            }
        } catch (retryError) {
            console.error(retryError);
        }
    }
}

/**
 * 将 v4.1(或更早,已转为 eide.yml)的项目文件迁移为 v4.2 布局:
 * 备份原 eide.yml -> 写 targets/ -> 搬旁路文件 -> 改写骨架。
 * v4.2 文件原样返回(幂等);已有备份不覆盖。
 */
export function migrateProjectFileToV42(cfgFilePath: string): void {
    const raw = fs.readFileSync(cfgFilePath, 'utf8');
    const parsed = yaml.parse(raw);
    if (!parsed || typeof parsed !== 'object') { return; }
    if (isV42Skeleton(parsed)) { return; } // already migrated

    const eideDir = path.dirname(cfgFilePath);

    // 1. backup original file (never overwrite an existing backup)
    const backupPath = path.join(eideDir, V41_BACKUP_NAME);
    if (!fs.existsSync(backupPath)) {
        atomicWriteFileSync(backupPath, raw);
    }

    // 2. write per-target data files first (crash-safe: skeleton is written last)
    const targetNames = Object.keys(parsed.targets || {});
    for (const name of targetNames) {
        writeTargetFile(eideDir, name, `${name}.yml`, yaml.stringify(parsed.targets[name]));
    }

    // 3. split the shared files.options.yml into per-target files, then remove it
    const sharedOptionsPath = path.join(eideDir, 'files.options.yml');
    if (fs.existsSync(sharedOptionsPath)) {
        try {
            const sharedOptions = yaml.parse(fs.readFileSync(sharedOptionsPath, 'utf8'));
            if (sharedOptions && sharedOptions.options) {
                for (const name of Object.keys(sharedOptions.options)) {
                    writeTargetFile(
                        eideDir, name, 'files.options.yml',
                        yaml.stringify({ version: sharedOptions.version, options: sharedOptions.options[name] })
                    );
                }
            }
            fs.unlinkSync(sharedOptionsPath);
        } catch (error) {
            console.error(error);
        }
    }

    // 4. move legacy sidecar files into their target dirs
    for (const name of targetNames) {
        const lower = name.toLowerCase();
        moveFileIfExists(
            path.join(eideDir, `${lower}.libs.yml`),
            path.join(getTargetDir(eideDir, name), 'libs.yml')
        );
        moveFileIfExists(
            path.join(eideDir, `${lower}.st.option.bytes.ini`),
            path.join(getTargetDir(eideDir, name), 'st.option.bytes.ini')
        );

        // v2.x legacy per-target file options: cfg fields at top level (+ version key)
        const legacyOptionsPath = path.join(eideDir, `${lower}.files.options.yml`);
        const newOptionsPath = path.join(getTargetDir(eideDir, name), 'files.options.yml');
        if (fs.existsSync(legacyOptionsPath) && !fs.existsSync(newOptionsPath)) {
            try {
                const legacyObj = yaml.parse(fs.readFileSync(legacyOptionsPath, 'utf8')) || {};
                const version = typeof legacyObj.version === 'string' ? legacyObj.version : '2.1';
                const cfg = { ...legacyObj };
                delete (<any>cfg).version;
                writeTargetFile(eideDir, name, 'files.options.yml', yaml.stringify({ version, options: cfg }));
                fs.unlinkSync(legacyOptionsPath);
            } catch (error) {
                console.error(error);
            }
        }
    }

    // 5. finally rewrite eide.yml as the v4.2 skeleton
    const { skeleton } = splitIntoSkeleton(parsed);
    atomicWriteFileSync(cfgFilePath, yaml.stringify(skeleton));
}

// ---------------------------------------------------------------------------
// downgrade export (v4.2 -> v4.1 single file, for sharing with upstream EIDE)
// ---------------------------------------------------------------------------

/**
 * 把 v4.2 的"骨架 + 每目标文件"合并为 v4.1 单文件磁盘对象。
 *
 * v4.1 的 targets 条目形态与 v4.2 的 `targets/<name>/<name>.yml` 完全一致
 * (见 `splitIntoSkeleton`),因此这里只需把目标数据挂回骨架的 `targets` 映射,
 * 并把 version 改为 4.1。目标顺序沿用骨架里的索引。
 */
export function mergeV42ToV41Disk(skeleton: any, targetFiles: TargetFileData[]): any {
    const disk: any = {
        name: skeleton?.name,
        type: skeleton?.type,
        outDir: skeleton?.outDir,
        deviceName: skeleton?.deviceName,
        packDir: skeleton?.packDir,
        srcDirs: skeleton?.srcDirs,
        virtualFolder: skeleton?.virtualFolder,
        miscInfo: skeleton?.miscInfo,
        dependenceList: skeleton?.dependenceList,
        version: EIDE_CONF_VERSION_V41,
        targets: {}
    };

    for (const item of targetFiles || []) {
        disk.targets[item.name] = item.data;
    }

    return disk;
}

/** v4.1 单文件写出(键序与官方版一致,便于与上游工程对比 diff) */
export function dumpV41ProjectFile(obj: any): string {
    const keyOrder = [
        'version', 'name', 'type', 'deviceName', 'packDir', 'srcDirs',
        'virtualFolder', 'dependenceList', 'outDir', 'miscInfo', 'targets'
    ];
    return yaml.stringify(obj, {
        indent: 2,
        lineWidth: 1000,
        sortMapEntries: (a: any, b: any) => {
            const i_a = keyOrder.findIndex((e) => e === a.key);
            const i_b = keyOrder.findIndex((e) => e === b.key);
            if (i_a === -1 && i_b === -1) {
                return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            } else if (i_a === -1) {
                return 1;
            } else if (i_b === -1) {
                return -1;
            }
            return i_a - i_b;
        }
    });
}

export interface DowngradeExportResult {
    /** 导出的 v4.1 单文件路径 */
    cfgFilePath: string;
    /** 一并还原到 `.eide/` 根的旁路文件(源 -> 目标) */
    sidecarFiles: { from: string; to: string }[];
}

/**
 * 把 v4.2 项目导出为官方版可读的 v4.1 布局(降级导出)。
 *
 * 写出两个位置:
 *  - `<eideDir>/eide.v4.1.yml` —— 合并后的 v4.1 单文件(不覆盖正在使用的 eide.yml)
 *  - `.eide/` 根下的旁路文件副本(<target>.libs.yml / <target>.st.option.bytes.ini /
 *    files.options.yml),v4.1 按"目标名为键"查找它们
 *
 * **不改动** v4.2 源文件:导出是附加产物,当前项目仍以 v4.2 运行。
 * 回退到官方版:用导出的单文件替换 eide.yml、按需放置旁路文件即可
 * (或直接用 `eide.v4.1.bak.yml` 恢复迁移前状态)。
 */
export function exportProjectAsV41(eideDir: string): DowngradeExportResult {
    const cfgFilePath = path.join(eideDir, PROJECT_CONFIG_FILE_NAME);
    const parsed = yaml.parse(fs.readFileSync(cfgFilePath, 'utf8'));
    if (!isV42Skeleton(parsed)) {
        throw Error(`Not a v4.2 project: '${cfgFilePath}'. Nothing to downgrade.`);
    }

    const targetNames = <string[]>(<unknown>parsed.targets);
    const targetFiles: TargetFileData[] = [];
    for (const name of targetNames) {
        const targetFile = path.join(getTargetDir(eideDir, name), `${name}.yml`);
        // 缺失目标文件 = 数据损坏,宁可抛错中止,不可静默导出残缺工程
        if (!fs.existsSync(targetFile)) {
            throw Error(`Target config file '${targetFile}' is missing ! Export aborted.`);
        }
        targetFiles.push({ name, data: yaml.parse(fs.readFileSync(targetFile, 'utf8')) });
    }

    const outPath = path.join(eideDir, `eide.${EIDE_CONF_VERSION_V41}.yml`);
    atomicWriteFileSync(outPath, dumpV41ProjectFile(mergeV42ToV41Disk(parsed, targetFiles)));

    // 旁路文件:v4.1 在 `.eide/` 根按目标名查找
    const sidecarFiles: { from: string; to: string }[] = [];

    // 1) files.options.yml(各目标独立文件 -> 合并为按目标名为键的单文件)
    const sharedOptions: any = { version: undefined, options: {} };
    for (const name of targetNames) {
        const perTarget = path.join(getTargetDir(eideDir, name), 'files.options.yml');
        if (!fs.existsSync(perTarget)) { continue; }
        try {
            const optsObj = yaml.parse(fs.readFileSync(perTarget, 'utf8')) || {};
            if (optsObj.version !== undefined) { sharedOptions.version = optsObj.version; }
            if (optsObj.options !== undefined) { sharedOptions.options[name] = optsObj.options; }
        } catch (error) {
            console.error(error);
        }
    }
    if (Object.keys(sharedOptions.options).length > 0) {
        const sharedPath = path.join(eideDir, 'files.options.yml');
        atomicWriteFileSync(sharedPath, yaml.stringify(sharedOptions, { indent: 4, lineWidth: 1000 }));
        sidecarFiles.push({ from: sharedPath, to: sharedPath });
    }

    // 2) <target>.libs.yml / <target>.st.option.bytes.ini
    for (const name of targetNames) {
        const pairs: [string, string][] = [
            ['libs.yml', getTargetLibsFileName(name)],
            ['st.option.bytes.ini', getTargetOptionBytesFileName(name)]
        ];
        for (const [inner, flatName] of pairs) {
            const from = path.join(getTargetDir(eideDir, name), inner);
            if (!fs.existsSync(from)) { continue; }
            const to = path.join(eideDir, flatName);
            fs.copyFileSync(from, to);
            sidecarFiles.push({ from, to });
        }
    }

    return { cfgFilePath: outPath, sidecarFiles };
}
