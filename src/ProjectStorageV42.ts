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

export const EIDE_CONF_VERSION_V42 = '4.2';

const TARGETS_DIR_NAME = 'targets';
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
// migration (real fs, idempotent, crash-safe ordering)
// ---------------------------------------------------------------------------

function getTargetDir(eideDir: string, targetName: string): string {
    return path.join(eideDir, TARGETS_DIR_NAME, targetName);
}

function writeTargetFile(eideDir: string, targetName: string, fileName: string, content: string): void {
    const targetDir = getTargetDir(eideDir, targetName);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, fileName), content, 'utf8');
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
        fs.writeFileSync(backupPath, raw, 'utf8');
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
    fs.writeFileSync(cfgFilePath, yaml.stringify(skeleton), 'utf8');
}
