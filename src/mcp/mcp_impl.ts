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

import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { ProjectExplorer } from '../EIDEProjectExplorer';
import { AbstractProject } from '../EIDEProject';
import { BuilderOptions } from '../EIDETypeDefine';
import type { HexUploaderType } from '../types/UploadTypes';
import { FlashCommandResult } from '../HexUploader';
import { loadBuilderOptionsSchema, validateBuilderOptions } from './mcp_builder_opts_validate';
import { findUnknownKeys, resolveTargetName, isActiveTarget } from './mcp_config_keys';

function resolveProject(
    explorer: ProjectExplorer,
    uid: string | null | undefined
): AbstractProject | undefined {
    if (uid) {
        return explorer.getProjectByUid(uid);
    }
    // uid 缺省 = 激活项目(与 MCP 工具描述一致:单项目工作区可省略 uid)
    return explorer.getActiveProject();
}

function projectNotFound(uid: string | null | undefined): CallToolResult {
    return {
        isError: true,
        content: [{
            type: 'text',
            text: uid
                ? `Error. Not such project (uid=${uid}). Use tool 'eide_list_projects' to list available projects.`
                : `Error. No active project in this window. Open a project first, or pass 'uid' explicitly (list uids with tool 'eide_list_projects').`
        }]
    };
}

function makeTextResult(success: boolean, message: string, err?: Error): CallToolResult {
    return {
        isError: !success,
        content: [{
            type: 'text',
            text: message + (err ? '\n\nError: ' + err.message : '')
        }]
    };
}

function makeJsonResult(data: unknown, isError = false): CallToolResult {
    return {
        isError,
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
    };
}

export async function executeTool(
    tool: string,
    args: Record<string, unknown>,
    explorer: ProjectExplorer
): Promise<CallToolResult> {
    const uid = args.uid as string | null | undefined;

    switch (tool) {
        case 'eide_list_projects': {
            const projects: { uid: string; name: string; rootDir: string; actived: boolean }[] = [];
            explorer.foreachProjects((prj) => {
                projects.push({
                    uid: prj.getUid(),
                    name: prj.getProjectName(),
                    rootDir: prj.getRootDir().path,
                    actived: explorer.getActiveProject()?.getUid() === prj.getUid()
                });
                return undefined;
            });
            return makeJsonResult(projects);
        }
        case 'eide_build':
        case 'eide_rebuild':
        case 'eide_clean': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            let res: { success: boolean; message: string; };
            if (tool === 'eide_build') {
                res = await explorer.buildProject(prj, { notRebuild: true, otherArgs: ['--no-color'] }, true);
            } else if (tool === 'eide_rebuild') {
                res = await explorer.buildProject(prj, { otherArgs: ['--no-color'] }, true);
            } else {
                res = await explorer.cleanProject(prj, true);
            }
            return makeTextResult(res.success, res.message);
        }
        case 'eide_flash': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const eraseAll = Boolean(args.eraseAll);
            let res: FlashCommandResult | void;
            if (eraseAll) {
                res = await explorer.programFlashProject(prj, true, true);
                if (!res || !res.success)
                    return makeTextResult(false, res ? res.message : 'Failed to erase chip.');
            }
            res = await explorer.programFlashProject(prj, false, true);
            if (res) {
                return makeTextResult(res.success, res.message, res.error);
            } else {
                return makeTextResult(false, 'Unknown Error.');
            }
        }
        case 'eide_reload': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            await new Promise(r => setTimeout(r, 1500)); // delay before reload project.
            const ok = await explorer.reloadProject(prj.getUid(), false);
            const result = makeTextResult(ok, ok ? 'Succeed.' : 'Failed.');
            await new Promise(r => setTimeout(r, ok ? 2000 : 500)); // delay after reload project.
            return result;
        }
        case 'eide_switch_target': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const targetName = args.targetName as string;
            const targets = prj.getTargets();
            if (!targets.includes(targetName))
                return makeTextResult(false, `Project '${prj.getProjectName()}' (uid=${uid}) not have this target: '${targetName}'`);
            await prj.switchTarget(targetName);
            await new Promise(r => setTimeout(r, 1500));
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_add_src_dir': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const srcDir = args.path as string;
            const absSrcDir = prj.ToAbsolutePath(srcDir);
            const res = prj.getNormalSourceManager().verify(absSrcDir);
            if (!res.valid) {
                return makeTextResult(false, res.message);
            }
            prj.GetConfiguration().AddSrcDir(absSrcDir);
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_del_src_dir': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const absSrcDir = prj.ToAbsolutePath(args.path as string);
            const srcDirs = prj.GetConfiguration().config.srcDirs;
            if (!srcDirs.includes(absSrcDir)) {
                return makeTextResult(false, `Source directory not in project: ${args.path}`);
            }
            prj.GetConfiguration().RemoveSrcDir(absSrcDir);
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_get_src_dirs': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const srcList = prj.getNormalSourceManager()
                .getRootFolderList().map(info => prj.toRelativePath(info.fileWatcher.file.path));
            return makeJsonResult(srcList);
        }
        case 'eide_exclude_src_file': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const filePath = args.path as string;
            prj.excludeSourceFile(prj.ToAbsolutePath(filePath));
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_include_src_file': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const filePath = args.path as string;
            prj.unexcludeSourceFile(prj.ToAbsolutePath(filePath));
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_get_inc_dirs': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const depMerge = prj.GetConfiguration().GetAllMergeDep();
            const incList = depMerge.incList.map(p => {
                const rel = prj.toRelativePath(p);
                return rel !== undefined ? rel : p;
            });
            return makeJsonResult(incList);
        }
        case 'eide_set_inc_dirs': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const paths = args.paths as string[];
            if (!Array.isArray(paths)) {
                return makeTextResult(false, 'paths must be an array of strings.');
            }
            const dep = prj.GetConfiguration().CustomDep_getDependence();
            dep.incList = paths.map(p => prj.ToAbsolutePath(p));
            prj.GetConfiguration().CustomDep_NotifyChanged();
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_get_defines': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const depMerge = prj.GetConfiguration().GetAllMergeDep();
            return makeJsonResult(depMerge.defineList);
        }
        case 'eide_set_defines': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const defines = args.defines as string[];
            if (!Array.isArray(defines)) {
                return makeTextResult(false, 'defines must be an array of strings.');
            }
            const dep = prj.GetConfiguration().CustomDep_getDependence();
            dep.defineList = defines.map(d => d.trim()).filter(d => d.length > 0);
            prj.GetConfiguration().CustomDep_NotifyChanged();
            return makeTextResult(true, 'Succeed.');
        }
        case 'eide_get_builder_opts': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const builderOpts = prj.GetConfiguration().toolchainConfigModel.getOptions();
            return makeJsonResult(builderOpts);
        }
        case 'eide_get_builder_opts_schema': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            try {
                return makeJsonResult(loadBuilderOptionsSchema(prj));
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                return makeTextResult(false, 'Failed to load builder options schema.', error);
            }
        }
        case 'eide_get_targets': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            return makeJsonResult({
                actived: prj.getCurrentTarget(),
                targets: prj.getTargets()
            });
        }
        case 'eide_set_builder_opts': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const options = args.options;
            if (!options || typeof options !== 'object' || Array.isArray(options)) {
                return makeTextResult(false, 'options must be a BuilderOptions JSON object.');
            }
            const validateErr = validateBuilderOptions(prj, options);
            if (validateErr) {
                return makeTextResult(false, `Builder options validation failed:\n${validateErr}`);
            }
            try {
                prj.GetConfiguration().toolchainConfigModel.setOptions(options as BuilderOptions);
                prj.onBuilderConfigChanged();
                return makeTextResult(true, 'Succeed.');
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                return makeTextResult(false, 'Failed to set builder options.', error);
            }
        }
        case 'eide_get_toolchain_config': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const targetName = resolveTargetName(args.targetName as string | undefined, prj.getCurrentTarget());
            const targets = prj.getTargets();
            if (!targets.includes(targetName)) {
                return makeTextResult(false, `Project '${prj.getProjectName()}' has no target: '${targetName}'. ` +
                    `Available: ${targets.join(', ')}`);
            }
            const config = prj.GetConfiguration<any>().config;
            const tc = config.targets[targetName]?.toolchain;
            const tcConfig = config.targets[targetName]?.toolchainConfigMap?.[tc];
            if (!tcConfig) {
                return makeTextResult(false, `No toolchain config found for target '${targetName}'.`);
            }
            return makeJsonResult({
                targetName,
                toolchain: tc,
                actived: isActiveTarget(targetName, prj.getCurrentTarget()),
                config: tcConfig
            });
        }
        case 'eide_set_toolchain_config': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const targetName = resolveTargetName(args.targetName as string | undefined, prj.getCurrentTarget());
            const targets = prj.getTargets();
            if (!targets.includes(targetName)) {
                return makeTextResult(false, `Project '${prj.getProjectName()}' has no target: '${targetName}'. ` +
                    `Available: ${targets.join(', ')}`);
            }
            const patch = args.config;
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
                return makeTextResult(false, 'config must be a JSON object.');
            }
            const keys = Object.keys(patch);
            if (keys.length === 0) {
                return makeTextResult(false, 'config must contain at least one key.');
            }

            const prjConfig = prj.GetConfiguration<any>();
            const config = prjConfig.config;
            const tc = config.targets[targetName]?.toolchain;
            const stored = config.targets[targetName]?.toolchainConfigMap?.[tc];
            if (!stored) {
                return makeTextResult(false, `No toolchain config found for target '${targetName}'.`);
            }

            // 拒绝未知字段:写进去的 key 会在下次加载时被静默剥除,不如当场报错
            const unknown = findUnknownKeys(keys, Object.keys(stored));
            if (unknown.length > 0) {
                return makeTextResult(false,
                    `Unknown toolchain config key(s) for '${targetName}': ${unknown.join(', ')}. ` +
                    `Existing keys: ${Object.keys(stored).join(', ')}`);
            }

            try {
                if (isActiveTarget(targetName, prj.getCurrentTarget())) {
                    // 激活 target: 走配置模型,数据原位更新(模型按引用绑定),
                    // 并触发 onPropertyChanged 等副作用(cpuType/fpu 校验)
                    const model = prjConfig.toolchainConfigModel;
                    for (const key of keys) {
                        model.SetKeyValue(key, (patch as any)[key]);
                    }
                } else {
                    // 非激活 target: 直接改存档条目。其平铺副本不存在,
                    // 因此不需要同步根节点(切到该 target 时由 applyTargetSnapshot 搬运)。
                    // 也不触发编译配置刷新 —— 当前激活态未变。
                    for (const key of keys) {
                        stored[key] = (patch as any)[key];
                    }
                }

                // 落盘:直接写,不等防抖(配置类修改应当立即持久化)
                prj.Save(true);
                return makeTextResult(true,
                    `Succeed. Updated target '${targetName}': ${keys.join(', ')}`);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                return makeTextResult(false, 'Failed to set toolchain config.', error);
            }
        }
        case 'eide_get_upload_config': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const targetName = resolveTargetName(args.targetName as string | undefined, prj.getCurrentTarget());
            const targets = prj.getTargets();
            if (!targets.includes(targetName)) {
                return makeTextResult(false, `Project '${prj.getProjectName()}' has no target: '${targetName}'. ` +
                    `Available: ${targets.join(', ')}`);
            }
            const config = prj.GetConfiguration<any>().config;
            const target = config.targets[targetName];
            if (!target) {
                return makeTextResult(false, `No such target: '${targetName}'.`);
            }
            const uploader = target.uploader;
            return makeJsonResult({
                targetName,
                actived: isActiveTarget(targetName, prj.getCurrentTarget()),
                uploader,
                configuredUploaders: Object.keys(target.uploadConfigMap || {}),
                config: (target.uploadConfigMap || {})[uploader] ?? {}
            });
        }
        case 'eide_set_upload_config': {
            const prj = resolveProject(explorer, uid);
            if (!prj)
                return projectNotFound(uid);
            const targetName = resolveTargetName(args.targetName as string | undefined, prj.getCurrentTarget());
            const targets = prj.getTargets();
            if (!targets.includes(targetName)) {
                return makeTextResult(false, `Project '${prj.getProjectName()}' has no target: '${targetName}'. ` +
                    `Available: ${targets.join(', ')}`);
            }

            const patch = args.config;
            if (patch !== undefined && (typeof patch !== 'object' || patch === null || Array.isArray(patch))) {
                return makeTextResult(false, 'config must be a JSON object.');
            }
            const patchKeys = patch ? Object.keys(patch as object) : [];
            const newUploader = args.uploader as string | undefined;
            if (!newUploader && patchKeys.length === 0) {
                return makeTextResult(false, 'Nothing to do: provide "uploader" and/or "config".');
            }

            const prjConfig = prj.GetConfiguration<any>();
            const config = prjConfig.config;
            const target = config.targets[targetName];
            if (!target) {
                return makeTextResult(false, `No such target: '${targetName}'.`);
            }

            const uploader = (newUploader || target.uploader) as HexUploaderType;
            const isActive = isActiveTarget(targetName, prj.getCurrentTarget());

            try {
                // 1) 切换 uploader 类型(只改存档条目;激活 target 走项目接口以同步根节点)
                if (newUploader && newUploader !== target.uploader) {
                    if (isActive) {
                        prj.setUploader(uploader, true);
                    } else {
                        target.uploader = uploader;
                        if (!target.uploadConfigMap) { target.uploadConfigMap = {}; }
                        if (target.uploadConfigMap[uploader] === undefined) {
                            target.uploadConfigMap[uploader] = {};
                        }
                    }
                }

                // 2) 合并配置字段
                if (patchKeys.length > 0) {
                    // 用该 uploader 模型的默认配置做 key 校验(不同 uploader 字段集不同)
                    const validKeys = prjConfig.getUploadConfigKeys(uploader);
                    const unknown = findUnknownKeys(patchKeys, validKeys);
                    if (unknown.length > 0) {
                        return makeTextResult(false,
                            `Unknown upload config key(s) for uploader '${uploader}': ${unknown.join(', ')}. ` +
                            `Valid keys: ${validKeys.join(', ')}`);
                    }

                    if (isActive) {
                        const model = prjConfig.uploadConfigModel;
                        for (const key of patchKeys) {
                            model.SetKeyValue(key, (patch as any)[key]);
                        }
                    } else {
                        if (!target.uploadConfigMap) { target.uploadConfigMap = {}; }
                        const stored = target.uploadConfigMap[uploader] ||
                            (target.uploadConfigMap[uploader] = {});
                        for (const key of patchKeys) {
                            stored[key] = (patch as any)[key];
                        }
                    }
                }

                // 3) 落盘(配置类修改立即持久化)
                prj.Save(true);
                return makeTextResult(true,
                    `Succeed. Target '${targetName}': uploader='${uploader}'` +
                    (patchKeys.length > 0 ? `, updated: ${patchKeys.join(', ')}` : ''));
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                return makeTextResult(false, 'Failed to set upload config.', error);
            }
        }
        default:
            return makeTextResult(false, `Unknown tool: ${tool}`);
    }
}
