import * as NodePath from "path";
import * as os from "os";
import * as fs from "fs";
import { File } from "../lib/node-utility/File";
import { EIDE_CONF_VERSION } from './EIDETypeDefine';
import { EIDE_DIR, PROJECT_CONFIG_FILE_NAME, LEGACY_PROJECT_CONFIG_FILE_NAME } from './ProjectConsts';
import { ProjectConfiguration } from './ProjectConfiguration';
import { compareVersion } from "./utility";
import { view_str$prompt$migrationFailed } from "./StringTable";
import { GlobalEvent } from "./GlobalEvents";
import { getGlobalState } from "./Platform";

export function detectProject(dir: File): boolean {
    if (File.IsExist(NodePath.join(dir.path, EIDE_DIR, PROJECT_CONFIG_FILE_NAME)))
        return true;
    if (File.IsExist(NodePath.join(dir.path, EIDE_DIR, LEGACY_PROJECT_CONFIG_FILE_NAME)))
        return true;
    return false;
}

async function _doMigration(projectRootDir: File) {

    // move eide.json to eide.yml
    const eideJsonFile = File.from(projectRootDir.path, EIDE_DIR, LEGACY_PROJECT_CONFIG_FILE_NAME);
    const projCfgFile = File.from(projectRootDir.path, EIDE_DIR, PROJECT_CONFIG_FILE_NAME);
    if (eideJsonFile.IsExist()) {
        const obj = ProjectConfiguration.parseProjectFile(eideJsonFile.Read());
        projCfgFile.Write(ProjectConfiguration.dumpProjectFile(obj));
    }

    const prjCfg = ProjectConfiguration.parseProjectFile(projCfgFile.Read());

    if (compareVersion(prjCfg.version, '4.0') < 0) {
        GlobalEvent.log_info(`migration ${projCfgFile.path} from ${prjCfg.version} to 4.0`);
        for (const key in prjCfg.targets) {
            const target = prjCfg.targets[key];
            // rename compileConfig to toolchainConfig
            if ((<any>target).compileConfig) {
                (<any>target).toolchainConfig = (<any>target).compileConfig;
                (<any>target).compileConfig = undefined;
            }
            if ((<any>target).compileConfigMap) {
                (<any>target).toolchainConfigMap = (<any>target).compileConfigMap;
                (<any>target).compileConfigMap = undefined;
            }
            // toolchain config
            if (target.toolchainConfigMap == undefined)
                target.toolchainConfigMap = {};
            if (target.toolchainConfig) {
                target.toolchainConfigMap[target.toolchain] = target.toolchainConfig;
                target.toolchainConfig = undefined;
            }
            if (target.builderOptions) {
                for (const key in target.builderOptions) {
                    const opts = target.builderOptions[key];
                    if (target.toolchainConfigMap[key])
                        target.toolchainConfigMap[key].options = opts;
                }
                target.builderOptions = <any>undefined;
            }
            // uploader config
            if (target.uploadConfigMap == undefined)
                target.uploadConfigMap = {};
            if (target.uploadConfig) {
                target.uploadConfigMap[target.uploader] = target.uploadConfig;
                target.uploadConfig = undefined;
            }
            // custom_dep -> cppPreprocessAttrs
            if ((<any>target)['custom_dep']) {
                target.cppPreprocessAttrs = (<any>target)['custom_dep'];
                (<any>target)['custom_dep'] = undefined;
            }
        }
        projCfgFile.Write(ProjectConfiguration.dumpProjectFile(prjCfg));
    }

    // rm .eide.usr.ctx.json
    const p = NodePath.join(projectRootDir.path, '.eide.usr.ctx.json');
    if (File.IsFile(p)) {
        try {
            if (prjCfg.miscInfo && prjCfg.miscInfo.uid) {
                const ctx = JSON.parse(fs.readFileSync(p, 'utf8'));
                const key = `project.${prjCfg.miscInfo.uid}`;
                const val = getGlobalState().get<string>(key);
                const saveVal = JSON.stringify(ctx);
                if (val !== saveVal)
                    getGlobalState().update(key, saveVal);
            }
            fs.unlinkSync(p);
        } catch (error) {
            const errMsg = `${(<Error>error).name} ${(<Error>error).message}`;
            GlobalEvent.log_warn(`Fail to migrate user context '${p}'. msg: ${errMsg}`);
            GlobalEvent.log_show();
        }
    }
}

export async function doMigration(projectRootDir: File) {
    try {
        await _doMigration(projectRootDir);
    } catch (error) {
        GlobalEvent.log_error(view_str$prompt$migrationFailed.replace('{}', projectRootDir.path));
        GlobalEvent.log_error(error);
        GlobalEvent.log_show();
        throw error;
    }
}
