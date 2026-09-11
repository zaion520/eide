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
 * 资源树右键/命令的处理器 —— 从 EIDEProjectExplorer.ts 的 ProjectExplorer 类提取(原为仅使用 this.dataProvider 的私有方法)。
 *
 * 由 scripts/extract-methods.mjs 自动生成: 原方法是零 this 依赖的私有方法,
 * 提取为纯函数后由 ProjectExplorer 直接调用(调用点已自动改写)。
 */
import * as vscode from 'vscode';
import type { ProjectDataProvider } from './ProjectDataProvider';
import type { ImporterProjectInfo } from './types/ExplorerTypes';
import * as fs from 'fs';
import * as NodePath from 'path';
import * as child_process from 'child_process';
import * as os from 'os';
import * as jsonc_parser from 'jsonc-parser';
import { ProjTreeItem, ModifiableDepInfo } from './ProjTreeItem';
import { WebPanelManager } from './WebPanelManager';
import { SimpleUIConfig, SimpleUIConfigData_table, SimpleUIConfigData_input, SimpleUIConfigData_text } from './SimpleUIDef';
import { File } from '../lib/node-utility/File';
import { view_str$prompt$removeSrcDir, txt_yes, txt_no, view_str$project$add_source, add_include_path, add_define, add_lib_path, WARNING, remove_this_item, view_str$compile$selectToolchain, getLocalLanguageType, LanguageIndexs, view_str$compile$selectFlasher, view_str$prompt$needReloadToUpdateEnv } from './StringTable';
import { TreeItemType } from './types/ExplorerTypes';
import type { VirtualFolderInfo, VirtualFileInfo } from './types/ExplorerTypes';
import { VirtualSource, AbstractProject } from './EIDEProject';
import { VirtualFolder, VirtualFile } from './EIDETypeDefine';
import { GlobalEvent } from './GlobalEvents';
import { ResManager } from './ResManager';
import { exeSuffix, osType } from './Platform';
import { ProjectConfiguration } from './ProjectConfiguration';
import { sortPaths, isGccFamilyToolchain, redirectHost, readGithubRepoFolder, readGithubRepoTxtFile, downloadFile, notifyReloadWindow, execInternalCommand } from './utility';
import { ToolchainManager } from './ToolchainManager';
import type { ToolchainName } from './types/ToolchainTypes';
import { SettingManager } from './SettingManager';
import { HexUploaderManager } from './HexUploader';
import type { HexUploaderType } from './types/UploadTypes';
import { SevenZipper } from './Compress';
import { ShellFlasherIndexItem } from './WebInterface/WebInterface';
import { jsonc } from 'jsonc';
import { genDebugConfig_internal } from './DebugConfigGenerator';

export async function ShowProjectVariables(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const prjVars = prj.getProjectVariables();

        const vars: { [k: string]: string }[] = [];

        const cfg: SimpleUIConfig = {
            title: 'Project Variables',
            ref_id: `<project-variables>:${prj.getUid()}`,
            readonly: true,
            btns: {
                submit: {
                    title: '',
                    hidden: true
                },
                reset: {
                    title: '',
                    hidden: true
                }
            },
            items: {
                vars: {
                    type: 'table',
                    attrs: {},
                    name: '',
                    data: <SimpleUIConfigData_table>{
                        value: vars,
                        default: vars,
                    }
                }
            }
        };

        for (const key in prjVars) {
            vars.push({
                Name: key,
                Value: prjVars[key] || ''
            });
        }

        WebPanelManager.instance().showSimpleConfigUI(cfg, async () => {
            // nothing todo
        });
    }

export async function RemoveSrcDir(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        if (!(item.val.obj instanceof File)) {
            return;
        }

        const srcDir = item.val.obj;

        const answer = await vscode.window.showInformationMessage(view_str$prompt$removeSrcDir.replace('{}', srcDir.path), txt_yes, txt_no);
        if (answer == txt_yes) {
            const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
            prj.GetConfiguration().RemoveSrcDir(srcDir.path);
        }
    }

export async function Virtual_folderAddFile(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const project = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const curFolder = <VirtualFolderInfo>item.val.obj;

        const fileUriList = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: view_str$project$add_source,
            defaultUri: vscode.Uri.file(project.GetRootDir().path),
            filters: {
                'c/c++': ['c', 'cpp', 'cxx', 'cc', 'c++', 'h', 'hxx', 'hpp', 'inc'],
                'c/c++ source': ['c', 'cpp', 'cxx', 'cc', 'c++'],
                'c/c++ header': ['h', 'hxx', 'hpp', 'inc'],
                'asm': ['s', 'asm', 'a51'],
                'lib': ['lib', 'a', 'o', 'obj'],
                'any (*.*)': ['*']
            }
        });

        if (fileUriList === undefined) {
            return;
        }

        project.getVirtualSourceManager().addFiles(
            curFolder.path,
            fileUriList.map((uri) => uri.fsPath)
        );
    }

export async function Virtual_removeFolder(dataProvider: ProjectDataProvider, item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const project = dataProvider.GetProjectByIndex(folderItem.val.projectIndex);
            const curFolder = <VirtualFolderInfo>folderItem.val.obj;

            const answer = await vscode.window.showInformationMessage(view_str$prompt$removeSrcDir.replace('{}', curFolder.path), txt_yes, txt_no);
            if (answer == txt_yes) {
                project.getVirtualSourceManager().removeFolder(curFolder.path);
            }
        }
    }

export async function ModifyCompileConfig_openFile(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const key = <string>item.val.key;

        if (/\b(linkerScript|scatterFile)/.test(key)) {
            const scatterFilePath = <string>item.val.value;
            const ldFileList: string[] = [];
            scatterFilePath.split(',')
                .filter(s => s.trim() != '')
                .forEach((sctPath) => {
                    ldFileList.push(sctPath);
                });
            try {
                if (ldFileList.length == 1) {
                    const fpath = prj.ToAbsolutePath(ldFileList[0]);
                    vscode.window.showTextDocument(
                        vscode.Uri.parse(File.ToUri(fpath)), { preview: true });
                } else if (ldFileList.length > 1) {
                    const sel = await vscode.window.showQuickPick(ldFileList, {
                        canPickMany: false,
                        placeHolder: `Select One To Open`
                    });
                    if (sel) {
                        const fpath = prj.ToAbsolutePath(sel);
                        vscode.window.showTextDocument(
                            vscode.Uri.parse(File.ToUri(fpath)), { preview: true });
                    }
                }
            } catch (error) {
                GlobalEvent.emit('error', error);
            }
        }
    }

export async function ImportSourceFromExtProject(dataProvider: ProjectDataProvider, treeItem: ProjTreeItem) {

        const prj = dataProvider.GetProjectByIndex(treeItem.val.projectIndex);

        try {
            //
            // select importer
            //
            const scriptRoot = File.fromArray([ResManager.GetInstance().getBinDir().path, 'scripts']);
            const imptrFolder = File.fromArray([scriptRoot.path, 'importer']);
            const items: any[] = [];

            imptrFolder.GetList([/^(?:[^\.]+)\.(?:[^\.]+)\.js$/i])
                .forEach((imptrFile) => {
                    const m = /^(?<type>[^\.]+)\.(?<suffix>[^\.]+)\.js$/i.exec(imptrFile.name);
                    if (m && m.groups) {
                        items.push({
                            label: m.groups['type'].replace(/\-/g, ' ').replace(/_/g, ' '),
                            detail: `project file suffix: '${m.groups['suffix']}'`,
                            suffix: m.groups['suffix'],
                            file: imptrFile
                        });
                    }
                });

            const imptrType: any = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
                placeHolder: `Select an importer`,
                canPickMany: false
            });

            if (imptrType == undefined) {
                return;
            }

            const filter: any = {};
            filter[<string>imptrType.label] = [imptrType.suffix];

            const uri = await vscode.window.showOpenDialog({
                openLabel: 'Import This File',
                canSelectFiles: true,
                filters: filter,
                defaultUri: vscode.Uri.file(prj.GetRootDir().path)
            });

            if (uri == undefined) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Importing Resources`,
                cancellable: false
            }, async (progress, __) => {
                try {
                    //
                    // show progress message
                    //
                    progress.report({ message: `running importer ...` });
                    await new Promise<void>((resolve) => {
                        setTimeout(() => resolve(), 500);
                    });

                    //
                    // run importer
                    //
                    const prjFile = new File(uri[0].fsPath);
                    const imptrName = (<File>imptrType.file).noSuffixName;
                    const cmds = ['--std', './importer/index.js', imptrName, prjFile.path];
                    const result = child_process
                        .execFileSync(`${scriptRoot.path}/qjs${exeSuffix()}`, cmds, { cwd: scriptRoot.path })
                        .toString();

                    let prjList: ImporterProjectInfo[];
                    try {
                        prjList = JSON.parse(result);
                        if (!Array.isArray(prjList)) throw new Error('project list must be an array !');
                    } catch (error) {
                        throw new Error(`Import Error !, msg: '${result}'`);
                    }

                    //
                    // select project
                    //
                    let prjInfo: ImporterProjectInfo | undefined;

                    if (prjList.length > 0) {
                        // if have multi project, select one to import
                        if (prjList.length > 1) {
                            const itemList = prjList.map((prj) => {
                                return {
                                    id: `${prj.name}-${prj.target}`,
                                    label: prj.name,
                                    description: prj.target,
                                    detail: `${prjFile.name} -> ${prj.name}${prj.target ? (': ' + prj.target) : ''}`
                                }
                            });
                            const selectedItem = await vscode.window.showQuickPick<any>(itemList,
                                {
                                    placeHolder: `Found ${prjList.length} sub project, select one to import`,
                                    ignoreFocusOut: true,
                                    canPickMany: false
                                }
                            );
                            if (selectedItem) {
                                const index = itemList.findIndex((item) => item.id == selectedItem.id);
                                if (index != -1) {
                                    prjInfo = prjList[index];
                                }
                            }
                        }
                        // if only have one, use it
                        else {
                            prjInfo = prjList[0];
                        }
                    }

                    if (prjInfo == undefined) {
                        return;
                    }

                    // make abs path to relative path
                    const formatVirtualFolder = (vFolderRoot: VirtualFolder) => {
                        const folderStack: VirtualFolder[] = [vFolderRoot];
                        while (folderStack.length > 0) {
                            const vFolder = folderStack.pop();
                            if (vFolder) {
                                vFolder.files = vFolder.files.map((file) => {
                                    return { path: prj.toRelativePath(file.path) }
                                });
                                vFolder.folders.forEach((folder) => {
                                    folderStack.push(folder)
                                });
                            }
                        }
                    };

                    //
                    // start import project
                    //
                    const prjConf = prj.GetConfiguration();
                    prjConf.config.virtualFolder = prjInfo.files;
                    formatVirtualFolder(prjConf.config.virtualFolder);
                    const deps = prjConf.CustomDep_getDependence();
                    deps.incList = prjInfo.incList;
                    deps.libList = [];
                    deps.defineList = prjInfo.defineList;

                    //
                    // notify update
                    //
                    prj.getVirtualSourceManager().load();
                    prjConf.CustomDep_NotifyChanged();

                    //
                    // exclude source
                    //
                    if (prjInfo.excludeList) {

                        prjInfo.excludeList = Array.isArray(prjInfo.excludeList) ?
                            prjInfo.excludeList :
                            prjInfo.excludeList[prjInfo.target || 'null'];

                        if (Array.isArray(prjInfo.excludeList)) {

                            const excRePathLi = prjInfo.excludeList
                                .filter(path => path.trim() != '')
                                .map(path => prj.toRelativePath(path));

                            const realExcLi: string[] = [];

                            prj.getVirtualSourceManager().traverse((vFolderInfo) => {
                                vFolderInfo.folder.files.forEach(vFile => {
                                    if (excRePathLi.includes(vFile.path)) {
                                        const vFullPath = `${vFolderInfo.path}/${NodePath.basename(vFile.path)}`;
                                        realExcLi.push(vFullPath);
                                    }
                                });
                            });

                            realExcLi.forEach(vPath => prj.excludeSourceFile(vPath));
                        }
                    }

                    // show message and exit
                    progress.report({ message: `done !` });

                    prj.Save();

                    await new Promise<void>((resolve) => {
                        setTimeout(() => resolve(), 1000);
                    });

                } catch (error) {
                    GlobalEvent.emit('error', error);
                }
            });

        } catch (error) {
            GlobalEvent.emit('error', error);
        }
    }

export async function AddIncludeDir(dataProvider: ProjectDataProvider, prjIndex: number) {

        const prj = dataProvider.GetProjectByIndex(prjIndex);
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: add_include_path,
            defaultUri: vscode.Uri.file(prj.GetRootDir().path)
        });

        if (uris && uris.length > 0) {
            const dupLi = prj
                .addIncludePaths(uris.map(uri => { return uri.fsPath; }))
                .map(path => prj.ToRelativePath(path) || path);
            if (dupLi.length > 0) {
                const msg = `${dupLi.length} redundant include paths (ignored): ${JSON.stringify(dupLi)}`;
                GlobalEvent.show_msgbox('Warning', msg);
            }
        }
    }

export async function AddDefine(dataProvider: ProjectDataProvider, prjIndex: number) {
        const prj = dataProvider.GetProjectByIndex(prjIndex);
        const str = await vscode.window.showInputBox({
            placeHolder: add_define,
            ignoreFocusOut: true,
            validateInput: (_val: string): string | undefined => {
                const val = _val.trim();
                if (val !== '') {
                    const defines = val.endsWith(';') ? val : (val + ';');
                    if (!/^(?:[a-zA-Z_][\w]*(?:=[^;=]+)?;)+$/.test(defines)) {
                        return 'Format error !';
                    }
                }
                return undefined;
            }
        });
        if (str && str.trim() !== '') {
            str.split(';')
                .filter((define) => { return define.trim() !== ''; })
                .forEach((define) => {
                    prj.GetConfiguration().CustomDep_AddDefine(define);
                });
        }
    }

export async function AddLibDir(dataProvider: ProjectDataProvider, prjIndex: number) {
        const prj = dataProvider.GetProjectByIndex(prjIndex);
        const uri = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: add_lib_path,
            defaultUri: vscode.Uri.file(prj.GetRootDir().path)
        });
        if (uri && uri.length > 0) {
            prj.GetConfiguration().CustomDep_AddAllFromLibList(uri.map(_uri => { return _uri.fsPath; }));
        }
    }

export async function showIncludeDir(dataProvider: ProjectDataProvider, prjIndex: number) {

        const prj = dataProvider.GetProjectByIndex(prjIndex);
        const pickItems: vscode.QuickPickItem[] = [];
        const includesMap: Map<string, string> = new Map();

        let includes: string[] = [];

        // add dependence include paths
        prj.GetConfiguration().getAllDepGroup().forEach((group) => {
            for (const dep of group.depList) {
                for (const incPath of dep.incList) {
                    const repath = prj.toRelativePath(incPath);
                    if (includes.includes(repath))
                        continue; // skip it existed
                    includes.push(repath);
                    includesMap.set(repath, group.groupName);
                }
            }
        });

        // add source include paths
        prj.getSourceIncludeList().forEach((incPath) => {
            const repath = prj.toRelativePath(incPath);
            includes.push(repath);
            includesMap.set(repath, 'source');
        });

        includes = sortPaths(includes, '/');

        for (const repath of includes) {

            const incPath = repath;
            const grpName = includesMap.get(repath);

            let descpLi: string[] = [];

            if (grpName && grpName != ProjectConfiguration.CUSTOM_GROUP_NAME) {
                descpLi.push(grpName);
            }

            if (File.isEnvPath(incPath)) {
                descpLi.push(`loc: ${prj.resolveEnvVar(incPath)}`);
            }

            pickItems.push({
                label: incPath,
                description: descpLi.join(', ')
            });
        }

        const item = await vscode.window.showQuickPick(pickItems, {
            placeHolder: `${pickItems.length} results, click one copy to clipboard`
        });

        if (item) {
            vscode.env.clipboard.writeText(item.label);
        }
    }

export async function showLibDir(dataProvider: ProjectDataProvider, prjIndex: number) {

        const prj = dataProvider.GetProjectByIndex(prjIndex);
        let pickItems: vscode.QuickPickItem[] = [];
        const libMaps: Map<string, string> = new Map();

        prj.GetConfiguration().getAllDepGroup().forEach((group) => {
            for (const dep of group.depList) {
                for (const libPath of dep.libList) {
                    libMaps.set(prj.toRelativePath(libPath), group.groupName);
                }
            }
        });

        for (const keyVal of libMaps) {

            const libPath = keyVal[0];
            const grpName = keyVal[1];

            let descpLi: string[] = [];

            if (grpName != ProjectConfiguration.CUSTOM_GROUP_NAME) {
                descpLi.push(grpName);
            }

            if (File.isEnvPath(libPath)) {
                descpLi.push(`loc: ${prj.resolveEnvVar(libPath)}`);
            }

            pickItems.push({
                label: libPath,
                description: descpLi.join(', ')
            });
        }

        // sort result
        pickItems = pickItems.sort((i1, i2) => {
            if (i1.description && i2.description && i1.description != i2.description) {
                return i1.description.localeCompare(i2.description);
            } else {
                return i1.label.length - i2.label.length;
            }
        });

        const item = await vscode.window.showQuickPick(pickItems, {
            placeHolder: `${pickItems.length} results, click one copy to clipboard`
        });

        if (item) {
            vscode.env.clipboard.writeText(item.label);
        }
    }

export async function showDefine(dataProvider: ProjectDataProvider, prjIndex: number) {

        const prj = dataProvider.GetProjectByIndex(prjIndex);
        let pickItems: vscode.QuickPickItem[] = [];
        const defineMaps: Map<string, string> = new Map();

        // add dependence macros
        prj.GetConfiguration().getAllDepGroup().forEach((group) => {
            for (const dep of group.depList) {
                for (const macro of dep.defineList) {
                    defineMaps.set(macro, group.groupName);
                }
            }
        });

        for (const keyVal of defineMaps) {
            pickItems.push({
                label: keyVal[0],
                description: keyVal[1]
            });
        }

        // sort result
        pickItems = pickItems.sort((i1, i2) => {
            if (i1.description && i2.description && i1.description != i2.description) {
                return i1.description.localeCompare(i2.description);
            } else {
                return i1.label.length - i2.label.length;
            }
        });

        const item = await vscode.window.showQuickPick(pickItems, {
            placeHolder: `${pickItems.length} results, click one copy to clipboard`
        });

        if (item) {
            vscode.env.clipboard.writeText(item.label);
        }
    }

export function ExcludeSourceFile(dataProvider: ProjectDataProvider, item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const sourceItem of items) {
            const prj = dataProvider.GetProjectByIndex(sourceItem.val.projectIndex);

            // if it's a virtual file, we use virtual path
            if (sourceItem.type === TreeItemType.V_FILE_ITEM) {
                prj.excludeSourceFile((<VirtualFileInfo>sourceItem.val.obj).path);
            }

            // if it's a fs file, we use fs path
            else if (sourceItem.val.value instanceof File) {
                prj.excludeSourceFile(sourceItem.val.value.path);
            }
        }
    }

export function UnexcludeSourceFile(dataProvider: ProjectDataProvider, item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const sourceItem of items) {
            const prj = dataProvider.GetProjectByIndex(sourceItem.val.projectIndex);

            if (sourceItem.type === TreeItemType.V_EXCFILE_ITEM) {
                prj.unexcludeSourceFile((<VirtualFileInfo>sourceItem.val.obj).path);
            }
            else if (sourceItem.val.value instanceof File) {
                prj.unexcludeSourceFile(sourceItem.val.value.path);
            }
        }
    }

export function ExcludeFolder(dataProvider: ProjectDataProvider, item: ProjTreeItem, items: ProjTreeItem[], onlyChildren?: boolean) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const prj = dataProvider.GetProjectByIndex(folderItem.val.projectIndex);

            switch (folderItem.type) {
                // filesystem folder
                case TreeItemType.FOLDER:
                case TreeItemType.FOLDER_ROOT:
                    if (onlyChildren) {
                        const dir = <File>folderItem.val.obj;
                        dir.GetList(undefined, File.EXCLUDE_ALL_FILTER).forEach(f => {
                            prj.excludeSourceFile(f.path);
                        });
                    } else {
                        prj.excludeFolder((<File>folderItem.val.obj).path);
                    }
                    break;
                // virtual folder
                case TreeItemType.V_FOLDER:
                case TreeItemType.V_FOLDER_ROOT:
                    if (onlyChildren) {
                        const dir = <VirtualFolderInfo>folderItem.val.obj;
                        dir.vFolder.files.forEach(f => {
                            prj.excludeSourceFile(`${dir.path}/${NodePath.basename(f.path)}`);
                        });
                    } else {
                        prj.excludeFolder((<VirtualFolderInfo>folderItem.val.obj).path);
                    }
                    break;
                default:
                    break;
            }
        }
    }

export function UnexcludeFolder(dataProvider: ProjectDataProvider, item: ProjTreeItem, items: ProjTreeItem[], onlyChildren?: boolean) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const prj = dataProvider.GetProjectByIndex(folderItem.val.projectIndex);

            if (onlyChildren) { // viewItem == FOLDER || viewItem == V_FOLDER || viewItem == FOLDER_ROOT || viewItem == V_FOLDER_ROOT
                switch (folderItem.type) {
                    // filesystem folder
                    case TreeItemType.FOLDER:
                    case TreeItemType.FOLDER_ROOT:
                        {
                            const dir = <File>folderItem.val.obj;
                            dir.GetList(undefined, File.EXCLUDE_ALL_FILTER).forEach(f => {
                                prj.unexcludeSourceFile(f.path);
                            });
                        }
                        break;
                    // virtual folder
                    case TreeItemType.V_FOLDER:
                    case TreeItemType.V_FOLDER_ROOT:
                        {
                            const dir = <VirtualFolderInfo>folderItem.val.obj;
                            dir.vFolder.files.forEach(f => {
                                prj.unexcludeSourceFile(`${dir.path}/${NodePath.basename(f.path)}`);
                            });
                        }
                        break;
                    default:
                        break;
                }
            }

            else { // viewItem == EXCFOLDER || viewItem == V_EXCFOLDER
                switch (folderItem.type) {
                    // filesystem folder
                    case TreeItemType.EXCFOLDER:
                        prj.unexcludeFolder((<File>folderItem.val.obj).path);
                        break;
                    // virtual folder
                    case TreeItemType.V_EXCFOLDER:
                        prj.unexcludeFolder((<VirtualFolderInfo>folderItem.val.obj).path);
                        break;
                    default:
                        break;
                }
            }
        }
    }

export async function editDependenceItem(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        if (item.val.value instanceof File)
            throw new Error('editDependenceItem: Invalid context item');

        const itype = (<ModifiableDepInfo>item.val.obj).type;

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        let newVal = await vscode.window.showInputBox({
            value: item.val.value,
            ignoreFocusOut: true,
            validateInput: (input: string): string | undefined => {
                if (input.trim() === '')
                    return 'Cannot be empty or whitespace !'
                if (itype == 'DEFINE_ITEM') {
                    if (!/^\w+(=[^\s].*)?$/i.test(input))
                        return "Cannot have whitespace on either side of '=' !";
                }
            }
        });

        if (newVal) {
            newVal = newVal.trim();
            switch (itype) {
                case 'INC_ITEM':
                    prj.GetConfiguration().CustomDep_ModifyIncDir(prj.ToAbsolutePath(<string>item.val.value), prj.ToAbsolutePath(newVal));
                    break;
                case 'DEFINE_ITEM':
                    prj.GetConfiguration().CustomDep_ModifyDefine(<string>item.val.value, newVal);
                    break;
                case 'LIB_ITEM':
                    prj.GetConfiguration().CustomDep_ModifyLib(prj.ToAbsolutePath(<string>item.val.value), prj.ToAbsolutePath(newVal));
                    break;
                default:
                    break;
            }
        }
    }

export async function RemoveDependenceItem(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        if (item.val.value instanceof File)
            throw new Error('RemoveDependenceItem: Invalid context item');

        const msg = `${WARNING}: ${remove_this_item.replace('{}', item.val.value)}`;
        const choice = await vscode.window.showWarningMessage(msg, 'Yes', 'No');
        if (choice === undefined || choice === 'No')
            return undefined;

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        switch ((<ModifiableDepInfo>item.val.obj).type) {
            case 'INC_ITEM':
                prj.GetConfiguration().CustomDep_RemoveIncDir(prj.ToAbsolutePath(item.val.value));
                break;
            case 'DEFINE_ITEM':
                prj.GetConfiguration().CustomDep_RemoveDefine(item.val.value);
                break;
            case 'LIB_ITEM':
                prj.GetConfiguration().CustomDep_RemoveLib(prj.ToAbsolutePath(item.val.value));
                break;
            default:
                break;
        }
    }

export async function onSwitchCompileTools(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const toolchianManager = ToolchainManager.getInstance();
        const pickItems: any[] = [];

        for (const name of toolchianManager.getToolchainNameList(prj.GetConfiguration().config.type)) {
            pickItems.push({
                label: toolchianManager.getToolchainDesc(name),
                value: name,
                description: name
            });
        }

        const pItem = await vscode.window.showQuickPick(pickItems, {
            canPickMany: false,
            placeHolder: view_str$compile$selectToolchain,
        });

        if (pItem == undefined) return; /* user canceled */

        if (prj.getToolchain().name !== <ToolchainName>pItem.value) {
            prj.setToolchain(<ToolchainName>pItem.value);
        }
    }

export async function onSetupToolchain(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const project = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const setting = SettingManager.GetInstance();

        let toolchainPathSettingName = setting.trimSettingTag(project.getToolchain().settingName);
        let toolchainPath = setting.getConfiguration().get(toolchainPathSettingName) || '';

        const toolchain = project.getToolchain();
        const isChinese = getLocalLanguageType() == LanguageIndexs.Chinese;

        const cfg: SimpleUIConfig = {
            ref_id: `<toolchain-config>:${project.getUid()}`,
            title: isChinese 
                ? `设置工具链 (项目：${project.getProjectName()})`
                : `Setup Toolchain (Project: ${project.getProjectName()})`,
            items: {}
        };

        if (isGccFamilyToolchain(toolchain.name) && toolchain.getToolchainPrefix) {
            const toolchainPrefix = toolchain.getToolchainPrefix() || '';
            cfg.items['prefix'] = {
                type: 'input',
                attrs: {
                    singleLine: true,
                    size: 30,
                },
                name: isChinese 
                    ? '编译器前缀' 
                    : 'Toolchain Prefix',
                data: <SimpleUIConfigData_input>{
                    placeHolder: 'like: arm-none-eabi-',
                    value: toolchainPrefix,
                    default: toolchainPrefix
                },
            };
        }

        // toolchain path
        cfg.items['path'] = {
            type: 'input',
            attrs: {
                singleLine: true,
            },
            name: isChinese ? '编译器根目录位置' : 'Toolchain Path',
            data: <SimpleUIConfigData_input>{
                placeHolder: 'toolchain dir, like: ${userHome}/.eide/tools/<toolchain_id>',
                value: toolchainPath,
                default: toolchainPath
            }
        };

        if (isGccFamilyToolchain(toolchain.name)) {
            cfg.items['path_note'] = {
                type: 'text',
                attrs: {},
                name: '',
                data: <SimpleUIConfigData_text>{
                    subType: 'raw',
                    value: isChinese 
                        ? `提示：如果您已经将编译器 bin 目录设置到系统环境变量中，则您无需设置上述路径，重启工作区，插件将自动搜索可用的路径` 
                        : `Note: If you have already set the compiler bin directory to the system environment variables, you do not need to set the above path. Restart the workspace, and the plugin will automatically search for available paths.`
                },
            };
        }

        WebPanelManager.instance().showSimpleConfigUI(cfg, async (newCfg) => {

            // update toolchain path
            setting.getConfiguration().update(
                toolchainPathSettingName, newCfg.items['path'].data.value, vscode.ConfigurationTarget.Workspace);

            // update toolchain prefix
            if (newCfg.items['prefix'])
                setting.setGccFamilyToolPrefix(
                    project.getToolchain().name, newCfg.items['prefix'].data.value);
        });
    }

export async function switchUploader(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const prj = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const prjConfig = prj.GetConfiguration().config;

        const pickerItems: any[] = HexUploaderManager.getInstance()
            .getUploaderList(prjConfig.toolchain)
            .map<vscode.QuickPickItem>((item) => {
                return {
                    label: item.label || item.type,
                    uploader: item.type,
                    description: item.description
                };
            });

        const selection = await vscode.window.showQuickPick(pickerItems, {
            placeHolder: view_str$compile$selectFlasher
        });

        if (selection && selection.uploader !== prjConfig.uploader) {
            try {
                prj.setUploader(<HexUploaderType>selection.uploader);
            } catch (error) {
                GlobalEvent.emit('error', error);
            }
        }
    }

export async function fetchShellFlasher(dataProvider: ProjectDataProvider, item: ProjTreeItem) {

        const project = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const resManager = ResManager.GetInstance();

        const err = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Setup Shell Flasher`,
            cancellable: true
        }, async (reporter, cancel): Promise<Error | undefined> => {

            try {

                const REPO_PATH = 'github0null/eide_shell_flasher_index';

                // get index.json
                //

                if (cancel.isCancellationRequested) {
                    return;
                }

                reporter.report({ message: 'fetching index.json' });
                const idxTxt = await readGithubRepoTxtFile(REPO_PATH, 'index.json');
                if (typeof idxTxt != 'string') {
                    throw idxTxt || new Error(`Cannot read index.json`);
                }

                const idxObj = <ShellFlasherIndexItem[]>JSON.parse(idxTxt);
                const pickItems: any[] = [];

                idxObj.forEach((item, idx) => {
                    if (item.platform.includes(osType())) {
                        let detail = item.detail || `no detail`;
                        if (item.provider) detail = detail + `, provider: ${item.provider}`;
                        pickItems.push(<vscode.QuickPickItem>{
                            idx: idx,
                            label: item.name,
                            detail: detail
                        });
                    }
                });

                // select flasher
                //

                if (cancel.isCancellationRequested) {
                    return;
                }

                reporter.report({ message: 'select flasher' });
                const sel = await vscode.window.showQuickPick(pickItems, {
                    title: 'Select Flasher',
                    matchOnDescription: true,
                    matchOnDetail: true,
                    canPickMany: false,
                    ignoreFocusOut: true
                });

                if (sel == undefined) {
                    return;
                }

                // install
                //

                if (cancel.isCancellationRequested) {
                    return;
                }

                const tarFlasher = idxObj[sel.idx];

                reporter.report({ message: 'download shell scripts' });

                // download and install flasher script
                const scriptsList = await readGithubRepoFolder(`https://api.github.com/repos/${REPO_PATH}/contents/scripts/${tarFlasher.id}`);
                if (scriptsList instanceof Error) {
                    if (scriptsList.message?.trim() != 'Not Found')
                        throw scriptsList;
                } else {
                    let scriptDir = new File(project.getRootDir().path);
                    if (tarFlasher.scriptInstallDir) scriptDir = File.fromArray([scriptDir.path, tarFlasher.scriptInstallDir]);
                    scriptDir.CreateDir(true);
                    for (const scriptInfo of scriptsList) {
                        if (scriptInfo.download_url) {
                            const buff = await downloadFile(redirectHost(scriptInfo.download_url));
                            if (!(buff instanceof Buffer)) throw buff || new Error(`Cannot download '${scriptInfo.name}'`);
                            fs.writeFileSync(`${scriptDir.path}/${scriptInfo.name}`, buff);
                        }
                    }
                }

                let needReload = false;
                if (tarFlasher.resources[osType()]) {

                    if (cancel.isCancellationRequested)
                        return;

                    const res = tarFlasher.resources[osType()];

                    let installDir: File;
                    let isFirstInstall: boolean = false;

                    if (res.locationType == 'workspace')
                        installDir = File.fromArray([project.getRootDir().path, res.location]);
                    else // global
                        installDir = File.fromArray([resManager.getEideToolsInstallDir(), res.location]);

                    // if have a resource and not install, download it
                    if (res.zipType != 'none' && installDir.IsDir() == false) {

                        reporter.report({ message: 'downloading resources' });
                        const buf = await downloadFile(redirectHost(res.url));
                        if (!(buf instanceof Buffer)) throw buf || new Error('Cannot download resource');
                        const tmpPath = os.tmpdir() + File.sep + Date.now().toString();
                        fs.writeFileSync(tmpPath, buf);

                        reporter.report({ message: 'unzip resources' });
                        installDir.CreateDir(true);
                        const szip = new SevenZipper();
                        const r = szip.UnzipSync(new File(tmpPath), installDir);
                        GlobalEvent.log_info(r);

                        isFirstInstall = true;
                    }

                    if (res.setupCommand) {
                        reporter.report({ message: 'execuate setup command ...' });
                        const done = await execInternalCommand(res.setupCommand, installDir.path, cancel);
                        if (!done) {
                            if (cancel.isCancellationRequested) {
                                GlobalEvent.emit('globalLog.append', `\n----- user canceled -----\n`);
                                return;
                            } else {
                                return new Error(`Setup command failed, see detail in 'OUTPUT panel' -> 'eide.log' !`);
                            }
                        }
                    }

                    needReload = isFirstInstall && res.locationType == 'global';
                }

                if (cancel.isCancellationRequested) {
                    return;
                }

                project.GetConfiguration().uploadConfigModel.SetKeyValue('bin', tarFlasher.flashConfigTemplate.bin);
                project.GetConfiguration().uploadConfigModel.SetKeyValue('commandLine', tarFlasher.flashConfigTemplate.commandLine);
                project.GetConfiguration().uploadConfigModel.SetKeyValue('eraseChipCommand', tarFlasher.flashConfigTemplate.eraseChipCommand);

                GlobalEvent.show_msgbox('Info', `Shell flasher '${tarFlasher.id}' has been setup !`);
                if (needReload) {
                    notifyReloadWindow(view_str$prompt$needReloadToUpdateEnv);
                }

                return;

            } catch (error) {
                return error;
            }
        });

        if (err) {
            GlobalEvent.show_msgbox('Warning', err);
        }
    }

export async function genDebugConfigTemplate(dataProvider: ProjectDataProvider, item: ProjTreeItem, type: 'jlink' | 'openocd' | 'pyocd') {

        const project = dataProvider.GetProjectByIndex(item.val.projectIndex);
        const cfgfile = File.from(project.GetWorkspaceConfig().GetFile().dir, AbstractProject.vsCodeDir, 'launch.json');

        try {

            let cur_cfgs;
            if (cfgfile.IsFile())
                cur_cfgs = <any[]>jsonc_parser.parse(cfgfile.Read(), undefined, { allowTrailingComma: true }).configurations;
            else
                cur_cfgs = [];

            const result = await genDebugConfig_internal(type, project, cur_cfgs);
            if (!result) {
                return; // skip if user canceled
            }

            if (!cfgfile.IsFile()) {
                cfgfile.Write(JSON.stringify({
                    version: '0.2.0',
                    configurations: [result.debug_config]
                }, undefined, 4));
                vscode.window.showTextDocument(vscode.Uri.file(cfgfile.path), { preview: true });
                return;
            }

            /* merge debugConfig and write into launch.json */
            let edits: jsonc_parser.EditResult;
            let fmtOpts = <jsonc_parser.FormattingOptions>{ tabSize: 4, insertSpaces: true };
            let raw_cont = cfgfile.Read();
            if (result.override_idx != -1)
                edits = jsonc_parser.modify(raw_cont, ['configurations', result.override_idx], result.debug_config, { formattingOptions: fmtOpts });
            else
                edits = jsonc_parser.modify(raw_cont, ['configurations', 0], result.debug_config, { formattingOptions: fmtOpts, isArrayInsertion: true });
            cfgfile.Write(jsonc_parser.applyEdits(raw_cont, edits));

            /* show launch.json */
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgfile.path));
            let cursorSel: vscode.Range | undefined;
            if (edits.length > 0) {
                const s = document.positionAt(edits[0].offset);
                const e = document.positionAt(edits[0].offset + edits[0].length);
                cursorSel = new vscode.Range(s, e);
            }
            vscode.window.showTextDocument(document, { preview: true, selection: cursorSel });
        } catch (error) {
            GlobalEvent.emit('error', error);
        }
    }
