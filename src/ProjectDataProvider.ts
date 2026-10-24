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
 * getTreeItemTypeName / ProjectDataProvider —— 从 EIDEProjectExplorer.ts(7816 行)拆出。
 *
 * 注意: 本文件由 scripts/extract-class.mjs 生成, 若需再次搬移请复用该工具
 * (朴素括号扫描会因类体内列 0 的 `}` 提前截断)。
 */

import { AbstractProject, DataChangeType, EIDE_FILE_OPTION_VERSION, SourceFileOptions, VirtualSource } from './EIDEProject';

import { AnyGccCompileData, ArmBaseCompileConfigModel, ArmBaseCompileData, ComponentFileItem, DeviceInfo, PackInfo, RiscvCompileData, getComponentKeyDescription } from './EIDEProjectModules';

import * as ArmCpuUtils from './ArmCpuUtils';

import { ArrayDelRepetition } from '../lib/node-utility/Utility';

import { BuilderOptions, CreateOptions, ImportOptions, ProjectTargetInfo, ProjectType, VirtualFolder } from './EIDETypeDefine';

import { DEBUGGER_MAPS, copyObject, isGccFamilyToolchain, newFileTooltipString, newMarkdownString, sortPaths, toArray } from './utility';

import { DependenceManager } from './DependenceManager';

import { File } from '../lib/node-utility/File';

import { GlobalEvent } from './GlobalEvents';

import { HexUploaderManager } from './HexUploader';

import { KeilARMOption, KeilC51Option, KeilParser, KeilRteDependence } from './KeilXmlParser';

import { LanguageIndexs, WARNING, cancel_text, compile_config, continue_text, getLocalLanguageType, invalid_project_path, pack_info, project_dependence, project_exist_txt, project_load_failed, set_device_hint, switch_workspace_hint, txt_no, txt_yes, uploadConfig_desc, view_str$operation$create_prj_done, view_str$operation$import_done, view_str$operation$import_failed, view_str$pack$components, view_str$pack$installed_component, view_str$project$cmsis_components, view_str$project$excludeFile, view_str$project$excludeFolder, view_str$project$fileNotExisted, view_str$project$needRefresh, view_str$project$other_settings, view_str$project$title, view_str$prompt$filesOptionsComment, view_str$prompt$need_reload_project, view_str$prompt$prj_location, view_str$prompt$unresolved_deps, view_str$settings$debugger, view_str$settings$outFolderName, view_str$settings$prjEnv, view_str$settings$prj_name } from './StringTable';

import { ModifiableDepInfo, ProjTreeItem } from './ProjTreeItem';

import * as NodePath from 'path';

import { ProjectConfiguration } from './ProjectConfiguration';

import { ProjectItemCache } from './ExplorerSmallItems';

import { ResManager } from './ResManager';

import { SettingManager } from './SettingManager';

import { SevenZipper } from './Compress';

import { StatusBarManager } from './StatusBarManager';

import { ToolchainManager } from './ToolchainManager';

import type { ToolchainName } from './types/ToolchainTypes';

import { TreeItemType, VirtualFileInfo, VirtualFolderInfo } from './types/ExplorerTypes';

import { WorkspaceManager } from './WorkspaceManager';

import { applyTargetToConfigData, makeTargetInfo } from './TargetManager';

import { detectProject, doMigration } from './EIDEProjectMigration';

import * as eclipseParser from './EclipseProjectParser';

import * as events from 'events';

import * as fs from 'fs';

import { getGlobalState, osType } from './Platform';

import * as iarParser from './IarProjectParser';

import * as ini from 'ini';

import * as os from 'os';

import * as vscode from 'vscode';

import * as yaml from 'yaml';

export function getTreeItemTypeName(typ: TreeItemType): string {
    return TreeItemType[typ];
}

export class ProjectDataProvider implements vscode.TreeDataProvider<ProjTreeItem>, vscode.TreeDragAndDropController<ProjTreeItem> {

    private static readonly recName = 'sln.record';
    private static readonly RecMaxNum = 50;

    private event: events.EventEmitter;
    private prjList: AbstractProject[] = [];
    private slnRecord: string[] = [];
    private recFile: File;
    private context: vscode.ExtensionContext;
    private activePrjPath: string | undefined;

    // project tree item refresh cache
    treeCache: ProjectItemCache = new ProjectItemCache();

    private needReload?: (uid: string) => boolean;
    private hasReloadPending?: () => boolean;

    bindReloadChecker(needReload: (uid: string) => boolean, hasAny: () => boolean) {
        this.needReload = needReload;
        this.hasReloadPending = hasAny;
    }

    onDidChangeTreeData?: vscode.Event<ProjTreeItem | null | undefined> | undefined;
    dataChangedEvent: vscode.EventEmitter<ProjTreeItem | undefined>;

    constructor(_context: vscode.ExtensionContext) {

        this.event = new events.EventEmitter();
        this.context = _context;
        this.dataChangedEvent = new vscode.EventEmitter<ProjTreeItem>();
        this.context.subscriptions.push(this.dataChangedEvent);
        this.onDidChangeTreeData = this.dataChangedEvent.event;
        this.recFile = File.fromArray([ResManager.GetInstance().getEideHomeFolder().path, ProjectDataProvider.recName]);
        this.loadRecord();
    }

    onDispose() {
        this.SaveAll();
        this.CloseAll();
        this.saveRecord();
    }

    public on(event: 'rootItems_inited', listener: () => void): void;
    public on(event: any, listener: (arg?: any) => void): void {
        this.event.on(event, listener);
    }

    //---------------------------------------
    // TreeDragAndDropController
    //---------------------------------------

    static readonly PROJECT_TREE_ITEM_MIME_ID: string = `application/vnd.code.tree.cl.eide.view.projects`;

    readonly dragMimeTypes: string[] = [
        ProjectDataProvider.PROJECT_TREE_ITEM_MIME_ID
    ];

    readonly dropMimeTypes: string[] = [
        ProjectDataProvider.PROJECT_TREE_ITEM_MIME_ID,
        'text/uri-list'
    ];

    handleDrag(source: readonly ProjTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Thenable<void> | void {

        console.log('[cl.eide] handleDrag');
        console.log(source);

        const fList: File[] = [];

        for (const treeItem of source) {
            if (ProjTreeItem.isFileItem(treeItem.type) &&
                treeItem.val.value instanceof File) {
                fList.push(treeItem.val.value);
            }
        }

        if (fList.length > 0) {
            const val = fList.map(f => vscode.Uri.file(f.path).toString()).join('\r\n');
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(val));
        }
    }

    handleDrop(target: ProjTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Thenable<void> | void {

        console.log('[cl.eide] handleDrop');

        if (target == undefined)
            return;

        console.log(target);

        if (!ProjTreeItem.isVirtualFolderItem(target.type) && target.type != TreeItemType.PROJECT) {
            console.log(`[cl.eide] 'target' is not a virtual folder`);
            return; // it's not a virtual folder
        }

        const targetProject = this.GetProjectByIndex(target.val.projectIndex);
        const targetProjectUid = targetProject.getUid();
        const targetVirtualFolder = <VirtualFolderInfo>target.val.obj;

        let dataTransferItem: vscode.DataTransferItem | undefined;

        // DataTransferItem struct:
        //   data:{ value: '{"id":"cl.eide.view.projects","itemHandles":[0/…3b0d9bcc1193787cc:PROJECT/0:user/0:dlink.h"]}' }
        dataTransferItem = dataTransfer.get(ProjectDataProvider.PROJECT_TREE_ITEM_MIME_ID);
        if (dataTransferItem) {

            const vPaths = (<string[]>JSON.parse(dataTransferItem.value)['itemHandles'])
                .filter(s => s.includes(`${targetProjectUid}:PROJECT/`))
                .map(s => s.replace(/^.+?:PROJECT\//, `${VirtualSource.rootName}/`).replace(/\d+:/g, ''));

            console.log(`[cl.eide] try drop file items '[ ${vPaths.join(', ')} ]' -> '${targetVirtualFolder.path}/'`);

            const vSourceManager = targetProject.getVirtualSourceManager();

            for (const vpath of vPaths) {

                // if it is itself, ignore
                if (vpath == targetVirtualFolder.path) {
                    console.log(`[cl.eide] '${vpath}' -> '${targetVirtualFolder.path}/' it is itself, ignore`);
                    continue;
                }

                // it's a file ?
                const vf = vSourceManager.getFile(vpath);
                if (vf) {
                    const nf = vSourceManager.addFile(targetVirtualFolder.path, vf.path);
                    if (nf) { // moved done, del old
                        vSourceManager.removeFile(vpath);
                        console.log(`[cl.eide] '${vpath}' -> '${targetVirtualFolder.path}/' moved done`);
                    }
                    continue;
                }

                // it's a folder ?
                const vd = vSourceManager.getFolder(vpath);
                if (vd && !File.isSubPathOf(vpath, targetVirtualFolder.path)) { // can't move parent into their child
                    const npath = vSourceManager.insertFolder(targetVirtualFolder.path, vd);
                    if (npath) { // moved done, del old
                        vSourceManager.removeFolder(vpath);
                        console.log(`[cl.eide] '${vpath}' -> '${targetVirtualFolder.path}/' moved done`);
                    }
                    continue;
                }
            }

            return;
        }

        // DataTransferItem struct:
        //  data:{ value: 'file:///c%3A/xx/xxx.c\r\nfile:///xxx/xxx/m.c' }
        dataTransferItem = dataTransfer.get('text/uri-list');
        if (dataTransferItem) {
            const fileList: string[] = (<string>dataTransferItem.value).split(/\r\n|\n/).map(s => vscode.Uri.parse(s).fsPath);
            console.log(`[cl.eide] drop files: { ${fileList.join(',')} }`);
            targetProject.getVirtualSourceManager().addFiles(targetVirtualFolder.path, fileList);
            return;
        }
    }

    // ------------------------------------------

    onProjectChanged(prj: AbstractProject, type?: DataChangeType) {

        switch (type) {
            case 'files':
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.PROJECT));
                break;
            case 'compiler':
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.COMPILE_CONFIGURATION));
                break;
            case 'uploader':
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.UPLOAD_OPTION));
                break;
            case 'pack':
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.PACK));
                break;
            case 'dependence':
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.PACK));
                this.UpdateView(this.treeCache.getTreeItem(prj, TreeItemType.DEPENDENCE));
                break;
            default:
                this.UpdateView();
                break;
        }

        prj.Save(false, 2500); // save project file with a delay
    }

    LoadWorkspaceProject(workspaceState: vscode.Memento) {

        const workspaceManager = WorkspaceManager.getInstance();

        // not a workspace, exit
        if (workspaceManager.getWorkspaceRoot() === undefined) {
            return;
        }

        const wsFolders = workspaceManager.getWorkspaceList();
        const validList: File[] = [];

        for (const wsDir of wsFolders) {
            const wsList = wsDir.GetList([/.code-workspace$/i], File.EXCLUDE_ALL_FILTER);
            if (wsList.length > 0) {
                if (detectProject(wsDir)) {
                    validList.push(wsList[0]);
                }
            }
        }

        /* init active project */
        if (validList.length > 0) {
            this.activePrjPath = validList[0].path;
        }

        /* if prj count > 1, this is a workspace project
         * active workspace control btns
         */
        if (validList.length > 1) {
            vscode.commands.executeCommand('setContext', 'cl.eide.isWorkspaceProject', true);
        }

        for (const wsFile of validList) {
            this._OpenProject(wsFile.path, workspaceState);
        }
    }

    /**
     * @deprecated please use getProjectByIndex
    */
    GetProjectByIndex(index: number): AbstractProject {
        return this.prjList[index];
    }

    getProjectByIndex(index: number): AbstractProject {
        return this.prjList[index];
    }

    getProjectByUid(uid: string): AbstractProject | undefined {
        const idx = this.getIndexByProjectUid(uid);
        if (idx != -1) {
            return this.GetProjectByIndex(idx);
        }
    }

    getIndexByProjectUid(uid: string): number {
        return this.prjList.findIndex(prj => prj.getUid() == uid);
    }

    getProjectCount(): number {
        return this.prjList.length;
    }

    /**
     * traverse all projects by async mode
     * @note if callbk_func's return code == true, loop will be break
     */
    async traverseProjectsAsync(fn: (prj: AbstractProject, index: number) => Promise<boolean | undefined>) {
        for (let index = 0; index < this.prjList.length; index++) {
            const res = await fn(this.prjList[index], index);
            if (res) { break; }
        }
    }

    /**
     * traverse all projects by block mode
     * @note if callbk_func's return code == true, loop will be break
     */
    traverseProjects(fn: (prj: AbstractProject, index: number) => boolean | undefined) {
        for (let index = 0; index < this.prjList.length; index++) {
            const res = fn(this.prjList[index], index);
            if (res) { break; }
        }
    }

    foreachProject(callbk: (val: AbstractProject, index: number) => void): void {
        this.prjList.forEach(callbk);
    }

    UpdateView(ele?: ProjTreeItem) {

        // update treeview ui
        this.dataChangedEvent.fire(ele);

        // whole treeview updated
        this.updateStatusBarForActiveProjects();
    }

    updateStatusBarForActiveProjects() {

        const statusbars = StatusBarManager.getInstance();

        statusbars.foreach((bar, name) => {

            const activeProj = this.getActiveProject();

            if (name == 'project') {
                bar.text = `EIDE Project: ${activeProj?.getCurrentTarget() || 'unspecified'}`;
                if (activeProj) {
                    let txt = `Switch target for eide project:`;
                    txt += `${os.EOL}  - path: \`${activeProj.getProjectRoot().path}\``;
                    bar.tooltip = new vscode.MarkdownString(txt);
                } else {
                    bar.tooltip = `Switch target for eide project`;
                }
            }

            else if (name == 'build') {
                bar.text = `$(tools) Build`;
                if (activeProj) {
                    let txt = `Build eide project:`;
                    let repath = activeProj.ToRelativePath(activeProj.getExecutablePath());
                    txt += `${os.EOL}  - output: \`${repath}\``;
                    bar.tooltip = new vscode.MarkdownString(txt);
                } else {
                    bar.tooltip = `Build eide project`;
                }
            }

            else if (name == 'flash') {
                bar.text = '$(arrow-down) Flash';
                if (activeProj) {
                    try {
                        const flasher = HexUploaderManager.getInstance().createUploader(activeProj);
                        let txt = `Upload binary file to device:`;
                        flasher.getAllProgramFiles().forEach(f => {
                            let repath = activeProj.ToRelativePath(f.path) || f.path;
                            txt += `${os.EOL}  - \`${repath}\``
                        });
                        bar.tooltip = new vscode.MarkdownString(txt);
                    } catch (error) {
                        bar.tooltip = `Upload binary file to device`;
                        GlobalEvent.log_error(error);
                    }
                } else {
                    bar.tooltip = `Upload binary file to device`;
                }
            }
        });
    }

    clearTreeViewCache() {
        this.treeCache.clear();
    }

    syncReloadPendingContext() {
        const pending = this.hasReloadPending?.() ?? false;
        void vscode.commands.executeCommand('setContext', 'cl.eide.reloadPending', pending);
        // disable statusbar buttons when pending, 
        // because they will cause error if click when project is in reloading
        const buildBar = StatusBarManager.getInstance().get('build');
        const flashBar = StatusBarManager.getInstance().get('flash');
        const projectBar = StatusBarManager.getInstance().get('project');
        if (buildBar) {
            buildBar.command = pending ? undefined : '_cl.eide.statusbar.build';
        }
        if (flashBar) {
            flashBar.command = pending ? undefined : '_cl.eide.statusbar.flash';
        }
        if (projectBar) {
            projectBar.command = pending ? undefined : '_cl.eide.statusbar.switch-target';
        }
    }

    isNeedReload(uid: string): boolean {
        return this.needReload?.(uid) ?? false;
    }

    isRootWorkspaceProject(prj: AbstractProject): boolean {
        const rootDir = prj.GetRootDir();
        const wsDir = WorkspaceManager.getInstance().getWorkspaceRoot();
        if (rootDir && wsDir) {
            return rootDir.path === wsDir.path;
        }
        return false;
    }

    getActiveProject(): AbstractProject | undefined {

        if (this.prjList.length == 1) {
            return this.prjList[0];
        }

        const index = this.prjList.findIndex((prj) => prj.getWsPath() == this.activePrjPath);
        if (index != -1) {
            return this.prjList[index];
        }
    }

    getParent(element: ProjTreeItem): vscode.ProviderResult<ProjTreeItem> {

        if (element.type == TreeItemType.SOLUTION || element.type == TreeItemType.RELOAD_ROOT)
            return undefined;

        if (ProjTreeItem.PROJ_ROOT_ITEM_TYPES.includes(element.type))
            return this.treeCache.getRootTreeItem(this.getProjectByIndex(element.val.projectIndex));

        /* 除了几个根节点之外，其他的忽略，getParent 主要用于 {@link TreeView.reveal reveal} API. */
        return undefined;
    }

    getTreeItem(element: ProjTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: ProjTreeItem | undefined): vscode.ProviderResult<ProjTreeItem[]> {

        let iList: ProjTreeItem[] = [];

        if (element === undefined) {

            this.prjList.forEach((project, projectIndex) => {

                if (this.isNeedReload(project.getUid())) {
                    // root
                    const msg = view_str$prompt$need_reload_project.replace('{}', project.getProjectName());
                    const rootItem = new ProjTreeItem(TreeItemType.RELOAD_ROOT, {
                        value: msg,
                        projectIndex: projectIndex,
                        tooltip: msg,
                    }, project.getUid());
                    iList.push(rootItem);
                    this.treeCache.setTreeItem(project, rootItem, true);
                    // child: ok item
                    const okItem = new ProjTreeItem(TreeItemType.RELOAD_YES_ITEM, {
                        label: txt_yes,
                        value: txt_yes,
                        projectIndex: projectIndex,
                    }, project.getUid())
                    this.treeCache.setTreeItem(project, okItem, false);
                    // child: no item
                    const noItem = new ProjTreeItem(TreeItemType.RELOAD_NO_ITEM, {
                        label: txt_no,
                        value: txt_no,
                        projectIndex: projectIndex,
                    }, project.getUid())
                    this.treeCache.setTreeItem(project, noItem, false);
                    return;
                }

                // --- init root Treeitem

                const isActived = this.activePrjPath === project.getWsPath();
                const cItem = new ProjTreeItem(TreeItemType.SOLUTION, {
                    value: project.getProjectName() + ' : ' + project.getProjectCurrentTargetName(),
                    projectIndex: projectIndex,
                    icon: this.prjList.length > 1 ? (isActived ? 'active.svg' : 'idle.svg') : undefined,
                    tooltip: new vscode.MarkdownString([
                        `**Name:** \`${project.getProjectName()}\``,
                        `- **Uid:** \`${project.getUid()}\``,
                        `- **Config:** \`${project.getProjectCurrentTargetName()}\``,
                        `- **Path:** \`${project.GetRootDir().path}\``
                    ].join(os.EOL)),
                }, project.getUid());

                iList.push(cItem);
                // cache project root item
                this.treeCache.setTreeItem(project, cItem, true);

                // --- pre-init primary TreeItems

                const primaryItems: ProjTreeItem[] = [];

                primaryItems.push(new ProjTreeItem(TreeItemType.PROJECT, {
                    value: view_str$project$title,
                    projectIndex: projectIndex,
                    tooltip: view_str$project$title,
                    obj: <VirtualFolderInfo>{ path: VirtualSource.rootName, vFolder: project.getVirtualSourceRoot() }
                }, project.getUid()));

                if (project.getProjectType() === 'ARM') { // only display for ARM project 
                    primaryItems.push(new ProjTreeItem(TreeItemType.PACK, {
                        value: pack_info,
                        projectIndex: projectIndex,
                        tooltip: pack_info
                    }, project.getUid()));
                }

                const toolchain = project.getToolchain();
                const toolprefix = toolchain.getToolchainPrefix ? toolchain.getToolchainPrefix() : undefined;
                primaryItems.push(new ProjTreeItem(TreeItemType.COMPILE_CONFIGURATION, {
                    value: `${compile_config} : ${toolchain.name}`,
                    projectIndex: projectIndex,
                    tooltip: newMarkdownString([
                        `${compile_config} : ${toolchain.name}`,
                        ` - **Id:** \`${toolchain.name}\``,
                        ` - **Prefix:** ` + (toolprefix ? `\`${toolprefix}\`` : ''),
                        ` - **Family:** \`${toolchain.categoryName}\``,
                        ` - **Description:** \`${ToolchainManager.getInstance().getToolchainDesc(toolchain.name)}\``,
                    ])
                }, project.getUid()));

                const curUploader = project.GetConfiguration().uploadConfigModel.uploader;
                const uploaderLabel = HexUploaderManager.getInstance().getUploaderLabelByName(curUploader);
                primaryItems.push(new ProjTreeItem(TreeItemType.UPLOAD_OPTION, {
                    value: `${uploadConfig_desc} : ${uploaderLabel}`,
                    projectIndex: projectIndex,
                    contextVal: curUploader == 'Custom' ? `${getTreeItemTypeName(TreeItemType.UPLOAD_OPTION)}_Shell` : undefined,
                    tooltip: `${uploadConfig_desc} : ${uploaderLabel}`
                }, project.getUid()));

                primaryItems.push(new ProjTreeItem(TreeItemType.DEPENDENCE, {
                    value: project_dependence,
                    projectIndex: projectIndex,
                    tooltip: project_dependence
                }, project.getUid()));

                primaryItems.push(new ProjTreeItem(TreeItemType.SETTINGS, {
                    value: view_str$project$other_settings,
                    projectIndex: projectIndex,
                    tooltip: view_str$project$other_settings
                }, project.getUid()));

                // cache primary views
                primaryItems.forEach(item => this.treeCache.setTreeItem(project, item));
            });

            // --- notify primary items all inited
            setTimeout(() => this.event.emit('rootItems_inited'), 300);

        } else {

            const project = this.prjList[element.val.projectIndex];
            const prjExtraArgs = project.getSourceExtraArgsCfg();

            switch (element.type) {
                case TreeItemType.RELOAD_ROOT:
                    {
                        const itemTypes: TreeItemType[] = [
                            TreeItemType.RELOAD_YES_ITEM,
                            TreeItemType.RELOAD_NO_ITEM
                        ];

                        for (const itemType of itemTypes) {
                            const item = this.treeCache.getTreeItem(project, itemType);
                            if (item) {
                                iList.push(item);
                            }
                        }
                    }
                    break;
                case TreeItemType.SOLUTION:
                    {
                        const itemTypes: TreeItemType[] = [
                            TreeItemType.PROJECT,
                            TreeItemType.PACK,
                            TreeItemType.COMPILE_CONFIGURATION,
                            TreeItemType.UPLOAD_OPTION,
                            TreeItemType.DEPENDENCE,
                            TreeItemType.SETTINGS,
                        ];

                        for (const itemType of itemTypes) {
                            const item = this.treeCache.getTreeItem(project, itemType);
                            if (item) {
                                iList.push(item);
                            }
                        }
                    }
                    break;
                case TreeItemType.PROJECT:
                    {
                        // add some specific folder to first
                        const _depsFolder = project
                            .getVirtualSourceManager()
                            .getFolder(`${VirtualSource.rootName}/${DependenceManager.DEPS_VFOLDER_NAME}`);
                        if (_depsFolder && (_depsFolder.files.length + _depsFolder.folders.length) > 0) {
                            const folderDispName = view_str$project$cmsis_components;
                            const itemType = TreeItemType.V_FOLDER_ROOT;
                            const vFolderPath = `${VirtualSource.rootName}/${_depsFolder.name}`;
                            const hasExtraArgs = project.hasExtraArgsForFolder(vFolderPath, prjExtraArgs, true);
                            iList.push(new ProjTreeItem(itemType, {
                                value: folderDispName,
                                obj: <VirtualFolderInfo>{ path: vFolderPath, vFolder: _depsFolder },
                                projectIndex: element.val.projectIndex,
                                otherCtx: { hasExtraArgs: hasExtraArgs },
                                contextVal: 'FOLDER_ROOT_DEPS',
                                icon: 'DependencyGraph_16x.svg',
                                tooltip: newFileTooltipString({
                                    name: folderDispName,
                                    path: vFolderPath,
                                    desc: undefined,
                                    attr: {
                                        'SubFiles': _depsFolder.files.length.toString(),
                                        'SubFolders': _depsFolder.folders.length.toString()
                                    }
                                })
                            }));
                        }

                        // push filesystem source folder
                        project.getSourceRootFolders()
                            .sort((folder_1, folder_2) => { return folder_1.displayName.localeCompare(folder_2.displayName); })
                            .forEach((rootInfo) => {
                                const folderDispName = rootInfo.displayName;
                                const isExisted = rootInfo.fileWatcher.file.IsDir();
                                let dirIcon: string | undefined;
                                if (rootInfo.needUpdate || !isExisted) dirIcon = 'StatusWarning_16x.svg';
                                let dirDesc: string | undefined;
                                if (rootInfo.needUpdate) dirDesc = view_str$project$needRefresh;
                                if (!isExisted) dirDesc = view_str$project$fileNotExisted;
                                const hasExtraArgs = project.hasExtraArgsForFolder(rootInfo.fileWatcher.file.path, prjExtraArgs);
                                iList.push(new ProjTreeItem(TreeItemType.FOLDER_ROOT, {
                                    value: folderDispName,
                                    obj: rootInfo.fileWatcher.file,
                                    projectIndex: element.val.projectIndex,
                                    icon: dirIcon,
                                    otherCtx: { hasExtraArgs: hasExtraArgs },
                                    tooltip: newFileTooltipString({
                                        name: rootInfo.displayName,
                                        path: rootInfo.fileWatcher.file.path,
                                        desc: dirDesc,
                                        attr: {}
                                    }, project.getRootDir())
                                }));
                            });

                        // push virtual source folder
                        project.getVirtualSourceRoot().folders
                            .sort((folder1, folder2) => { return folder1.name.localeCompare(folder2.name); })
                            .forEach((vFolder) => {
                                if (vFolder.name == DependenceManager.DEPS_VFOLDER_NAME) return; // skip <deps> folder
                                const vFolderPath = `${VirtualSource.rootName}/${vFolder.name}`;
                                const isExcluded = project.isExcluded(vFolderPath);
                                const itemType = isExcluded ? TreeItemType.V_EXCFOLDER : TreeItemType.V_FOLDER_ROOT;
                                const hasExtraArgs = project.hasExtraArgsForFolder(vFolderPath, prjExtraArgs, true);
                                iList.push(new ProjTreeItem(itemType, {
                                    value: vFolder.name,
                                    obj: <VirtualFolderInfo>{ path: vFolderPath, vFolder: vFolder },
                                    projectIndex: element.val.projectIndex,
                                    otherCtx: { hasExtraArgs: hasExtraArgs },
                                    tooltip: newFileTooltipString({
                                        name: vFolder.name,
                                        path: vFolderPath,
                                        desc: isExcluded ? view_str$project$excludeFolder : undefined,
                                        attr: {
                                            'SubFiles': vFolder.files.length.toString(),
                                            'SubFolders': vFolder.folders.length.toString()
                                        }
                                    })
                                }));
                            });

                        // put virtual source files
                        project.getVirtualSourceRoot().files
                            .sort((a, b) => a.path.localeCompare(b.path))
                            .forEach((vFile) => {
                                const file = new File(project.ToAbsolutePath(vFile.path));
                                const vFilePath = `${VirtualSource.rootName}/${file.name}`;
                                const isFileExcluded = project.isExcluded(vFilePath);
                                const itemType = isFileExcluded ? TreeItemType.V_EXCFILE_ITEM : TreeItemType.V_FILE_ITEM;
                                const hasExtraArgs = project.hasExtraArgsForFile(file.path, vFilePath, prjExtraArgs);
                                iList.push(new ProjTreeItem(itemType, {
                                    value: file,
                                    collapsibleState: project.getSourceRefs(file).length > 0 ?
                                        vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                                    obj: <VirtualFileInfo>{ path: vFilePath, vFile: vFile },
                                    projectIndex: element.val.projectIndex,
                                    otherCtx: { hasExtraArgs: hasExtraArgs },
                                    tooltip: newFileTooltipString({
                                        name: file.name,
                                        path: file.path,
                                        desc: isFileExcluded ? view_str$project$excludeFile : undefined,
                                        attr: {
                                            'VirtualPath': vFilePath
                                        }
                                    }, project.getRootDir()),
                                }));
                            });

                        // show output files
                        if (SettingManager.GetInstance().isShowOutputFilesInExplorer()) {
                            const label = `Output Files`;
                            const tItem = new ProjTreeItem(TreeItemType.OUTPUT_FOLDER, {
                                value: label,
                                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                projectIndex: element.val.projectIndex,
                                tooltip: label,
                            });
                            iList.push(tItem);
                            this.treeCache.setTreeItem(project, tItem);
                        } else {
                            this.treeCache.delTreeItem(project, TreeItemType.OUTPUT_FOLDER);
                        }
                    }
                    break;
                case TreeItemType.PACK:
                    {
                        const packInfo = project.GetPackManager().GetPack();
                        if (packInfo) {
                            iList.push(new ProjTreeItem(TreeItemType.PACK_GROUP, {
                                value: packInfo.name,
                                projectIndex: element.val.projectIndex,
                                groupRegion: 'PACK'
                            }));
                        }
                    }
                    break;
                case TreeItemType.COMPILE_CONFIGURATION:
                    {
                        const cConfig = project.GetConfiguration().toolchainConfigModel;
                        const keyMap = <any>cConfig.GetDefault();
                        const excludeKeys = project.getToolchain().excludeViewList || [];

                        for (const key in keyMap) {
                            if (cConfig.isKeyEnable(key) && !excludeKeys.includes(key)) {
                                let uiContext: string | undefined;
                                // 为 "链接器脚本文件" 增加一个可以打开文件的小按钮
                                if (/\b(linkerScript|scatterFile)/.test(key)) {
                                    uiContext = 'COMPILE_CONFIGURATION_ITEM_FILEPATH';
                                }
                                iList.push(new ProjTreeItem(TreeItemType.COMPILE_CONFIGURATION_ITEM, {
                                    key: key,
                                    keyAlias: cConfig.GetKeyDescription(key),
                                    value: cConfig.getKeyValue(key),
                                    tooltip: newMarkdownString([
                                        `${cConfig.GetKeyDescription(key)}`,
                                        `- **Value:** \`${cConfig.getKeyValue(key)}\``]),
                                    icon: cConfig.getKeyIcon(key),
                                    projectIndex: element.val.projectIndex,
                                    contextVal: uiContext
                                }));
                            }
                        }
                    }
                    break;
                case TreeItemType.UPLOAD_OPTION:
                    {
                        const model = project.GetConfiguration().uploadConfigModel;
                        const config = model.GetDefault();

                        if (config) {
                            for (const key in config) {
                                if (model.isKeyEnable(key)) {
                                    iList.push(new ProjTreeItem(TreeItemType.UPLOAD_OPTION_ITEM, {
                                        key: key,
                                        keyAlias: model.GetKeyDescription(key),
                                        value: model.getKeyValue(key),
                                        tooltip: newMarkdownString([
                                            `${model.GetKeyDescription(key)}`,
                                            `- **Value:** \`${model.getKeyValue(key)}\``]),
                                        icon: model.getKeyIcon(key),
                                        projectIndex: element.val.projectIndex
                                    }));
                                }
                            }
                        }
                    }
                    break;
                case TreeItemType.DEPENDENCE:
                    {
                        const config = project.GetConfiguration();
                        const customDep = config.CustomDep_getDependence();
                        const keyList = config.CustomDep_GetEnabledKeys();

                        for (const key of keyList) {

                            let depValues: string[] = (<any>customDep)[key];

                            if (key == 'incList' || key == 'libList') { // is path list ?
                                depValues = sortPaths(depValues.map((val) => project.toRelativePath(val)), '/');
                            }

                            if (Array.isArray(depValues)) {
                                iList.push(new ProjTreeItem(TreeItemType.DEPENDENCE_GROUP_ARRAY_FIELD, {
                                    value: config.GetDepKeyDesc(key),
                                    tooltip: newMarkdownString([
                                        `${config.GetDepKeyDesc(key, getLocalLanguageType() == LanguageIndexs.Chinese)}`,
                                        `- **Count:** \`${depValues.length}\``]),
                                    obj: new ModifiableDepInfo('None', key),
                                    childKey: key,
                                    child: depValues,
                                    projectIndex: element.val.projectIndex
                                }));
                            }
                        }
                    }
                    break;
                // The edit setting value's callback is in @ref ModifyOtherSettings(...)
                case TreeItemType.SETTINGS:
                    {
                        const config = project.GetConfiguration();

                        // setting: project name
                        iList.push(new ProjTreeItem(TreeItemType.SETTINGS_ITEM, {
                            key: 'name',
                            value: config.config.name,
                            keyAlias: view_str$settings$prj_name,
                            tooltip: newMarkdownString(`**${view_str$settings$prj_name}**: \`${config.config.name}\``),
                            projectIndex: element.val.projectIndex
                        }));

                        // setting: out folder
                        iList.push(new ProjTreeItem(TreeItemType.SETTINGS_ITEM, {
                            key: 'outDir',
                            value: File.normalize(config.config.outDir),
                            keyAlias: view_str$settings$outFolderName,
                            tooltip: newMarkdownString(`**${view_str$settings$outFolderName}**: \`${config.config.outDir}\``),
                            projectIndex: element.val.projectIndex
                        }));

                        // setting: debugger
                        const debuggerId = project.getTargetInfo().settings.debugger || 'unknown';
                        iList.push(new ProjTreeItem(TreeItemType.SETTINGS_ITEM, {
                            key: 'debugger',
                            value: DEBUGGER_MAPS[debuggerId].name,
                            keyAlias: view_str$settings$debugger,
                            tooltip: newMarkdownString(`**${view_str$settings$debugger}**: \`${DEBUGGER_MAPS[debuggerId].name}\``),
                            projectIndex: element.val.projectIndex
                        }));

                        // setting: project env
                        iList.push(new ProjTreeItem(TreeItemType.SETTINGS_ITEM, {
                            key: 'project.env',
                            value: 'object {...}',
                            keyAlias: view_str$settings$prjEnv,
                            tooltip: view_str$settings$prjEnv,
                            projectIndex: element.val.projectIndex
                        }));
                    }
                    break;
                case TreeItemType.DEPENDENCE_GROUP:
                case TreeItemType.DEPENDENCE_SUB_GROUP:
                    // deprecated
                    break;
                case TreeItemType.DEPENDENCE_GROUP_ARRAY_FIELD:
                    {
                        const arr = <string[]>element.val.child;
                        let depInfo: ModifiableDepInfo | undefined;

                        if (element.val.obj instanceof ModifiableDepInfo) {
                            depInfo = element.val.obj.GetItemDepType();
                        }

                        for (const val of arr) {
                            iList.push(new ProjTreeItem(TreeItemType.DEPENDENCE_ITEM, {
                                value: val,
                                obj: depInfo,
                                projectIndex: element.val.projectIndex
                            }));
                        }
                    }
                    break;
                // filesystem folder
                case TreeItemType.FOLDER:
                case TreeItemType.FOLDER_ROOT:
                    if (element.val.obj && element.val.obj instanceof File) {
                        const dir: File = element.val.obj;
                        if (dir.IsDir()) {

                            const fchildren = dir.GetList()
                                .filter((f) => !AbstractProject.excludeDirFilter.test(f.name));

                            const iFileList: ProjTreeItem[] = [];
                            const iFolderList: ProjTreeItem[] = [];

                            fchildren.forEach((f) => {

                                const isExcluded = project.isExcluded(f.path);

                                if (f.IsDir()) { // is folder
                                    const type = isExcluded ? TreeItemType.EXCFOLDER : TreeItemType.FOLDER;
                                    iFolderList.push(new ProjTreeItem(type, {
                                        value: f.name,
                                        obj: f,
                                        otherCtx: {
                                            hasExtraArgs: project.hasExtraArgsForFolder(f.path, prjExtraArgs, false)
                                        },
                                        tooltip: newFileTooltipString({
                                            name: f.name,
                                            path: f.path,
                                            desc: isExcluded ? view_str$project$excludeFolder : undefined,
                                            attr: {}
                                        }, project.getRootDir()),
                                        projectIndex: element.val.projectIndex
                                    }));
                                } else { // is file
                                    const type = isExcluded ? TreeItemType.EXCFILE_ITEM : TreeItemType.FILE_ITEM;
                                    const treeItem = new ProjTreeItem(type, {
                                        value: f,
                                        collapsibleState: project.getSourceRefs(f).length > 0 ?
                                            vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                                        projectIndex: element.val.projectIndex,
                                        otherCtx: {
                                            hasExtraArgs: project.hasExtraArgsForFile(f.path, undefined, prjExtraArgs)
                                        },
                                        tooltip: newFileTooltipString({
                                            name: f.name,
                                            path: f.path,
                                            desc: isExcluded ? view_str$project$excludeFile : undefined,
                                            attr: {}
                                        }, project.getRootDir())
                                    });
                                    // use normal file icon for 'obj' file
                                    if (!project.isAutoSearchObjectFile()) {
                                        if (AbstractProject.libFileFilter.test(f.name)) {
                                            treeItem.iconPath = vscode.ThemeIcon.File;
                                        }
                                    }
                                    iFileList.push(treeItem);
                                }
                            });

                            // merge folders and files
                            iList = iFolderList.concat(iFileList);
                        }
                    }
                    break;
                // virtual folder
                case TreeItemType.V_FOLDER:
                case TreeItemType.V_FOLDER_ROOT:
                    {
                        const curFolder = <VirtualFolderInfo>element.val.obj;

                        // put child folders
                        curFolder.vFolder.folders
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .forEach((vFolder) => {
                                const vFolderPath = `${curFolder.path}/${vFolder.name}`;
                                const isFolderExcluded = project.isExcluded(vFolderPath);
                                const itemType = isFolderExcluded ? TreeItemType.V_EXCFOLDER : TreeItemType.V_FOLDER;
                                iList.push(new ProjTreeItem(itemType, {
                                    value: vFolder.name,
                                    obj: <VirtualFolderInfo>{ path: vFolderPath, vFolder: vFolder },
                                    projectIndex: element.val.projectIndex,
                                    otherCtx: {
                                        hasExtraArgs: project.hasExtraArgsForFolder(vFolderPath, prjExtraArgs, true)
                                    },
                                    tooltip: newFileTooltipString({
                                        name: vFolder.name,
                                        path: vFolderPath,
                                        desc: isFolderExcluded ? view_str$project$excludeFolder : undefined,
                                        attr: {
                                            'SubFiles': vFolder.files.length.toString(),
                                            'SubFolders': vFolder.folders.length.toString()
                                        }
                                    })
                                }));
                            });

                        // put child files
                        curFolder.vFolder.files
                            .sort((a, b) => a.path.localeCompare(b.path))
                            .forEach((vFile) => {
                                const file = new File(project.ToAbsolutePath(vFile.path));
                                const vFilePath = `${curFolder.path}/${file.name}`;
                                const isFileExcluded = project.isExcluded(vFilePath);
                                const itemType = isFileExcluded ? TreeItemType.V_EXCFILE_ITEM : TreeItemType.V_FILE_ITEM;
                                iList.push(new ProjTreeItem(itemType, {
                                    value: file,
                                    collapsibleState: project.getSourceRefs(file).length > 0 ?
                                        vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                                    obj: <VirtualFileInfo>{ path: vFilePath, vFile: vFile },
                                    projectIndex: element.val.projectIndex,
                                    otherCtx: {
                                        hasExtraArgs: project.hasExtraArgsForFile(file.path, vFilePath, prjExtraArgs)
                                    },
                                    tooltip: newFileTooltipString({
                                        name: file.name,
                                        path: file.path,
                                        desc: isFileExcluded ? view_str$project$excludeFile : undefined,
                                        attr: {
                                            'VirtualPath': vFilePath
                                        }
                                    }, project.getRootDir())
                                }));
                            });
                    }
                    break;
                case TreeItemType.EXCFOLDER:
                case TreeItemType.EXCFILE_ITEM:
                case TreeItemType.V_EXCFOLDER:
                case TreeItemType.V_EXCFILE_ITEM:
                    // ignore
                    break;
                // show refs
                case TreeItemType.FILE_ITEM:
                case TreeItemType.V_FILE_ITEM:
                    {
                        const srcFile: File = <File>element.val.value;
                        const refs = project.getSourceRefs(srcFile);

                        for (const refFile of refs) {
                            iList.push(new ProjTreeItem(TreeItemType.SRCREF_FILE_ITEM, {
                                value: refFile,
                                projectIndex: element.val.projectIndex,
                                tooltip: newFileTooltipString(refFile, project.getRootDir()),
                            }));
                        }
                    }
                    break;
                // output folder
                case TreeItemType.OUTPUT_FOLDER:
                    {
                        // put output files
                        const outFolder = project.getOutputFolder();
                        if (outFolder.IsDir()) {
                            const fList = outFolder.GetList([AbstractProject.buildOutputMatcher], File.EXCLUDE_ALL_FILTER);
                            fList.forEach((file) => {
                                iList.push(new ProjTreeItem(TreeItemType.OUTPUT_FILE_ITEM, {
                                    value: file,
                                    collapsibleState: vscode.TreeItemCollapsibleState.None,
                                    projectIndex: element.val.projectIndex,
                                    tooltip: newFileTooltipString({
                                        name: file.name,
                                        path: file.path,
                                        attr: {}
                                    }, project.getRootDir()),
                                }));
                            });
                        }

                        // put virtual views
                        {
                            // Symbol Table
                            // - not support sdcc, keil_c51 now !
                            if (!['Keil_C51', 'SDCC'].includes(project.getToolchain().name)) {

                                iList.push(new ProjTreeItem(TreeItemType.OUTPUT_FILE_ITEM, {
                                    label: `Symbol Table`,
                                    value: File.from(`${project.getUid()}.elf-symbols`),
                                    isVirtualFile: true,
                                    collapsibleState: vscode.TreeItemCollapsibleState.None,
                                    projectIndex: element.val.projectIndex,
                                    tooltip: `Symbols Of Program`,
                                    icon: `Table_16x.svg`
                                }));
                            }

                            // Callgraph View
                            if (isGccFamilyToolchain(project.getToolchain().name)) {
                                iList.push(new ProjTreeItem(TreeItemType.OUTPUT_FILE_ITEM, {
                                    label: `Callgraph View`,
                                    value: File.from(`${project.getUid()}.elf-callgraph`),
                                    isVirtualFile: true,
                                    collapsibleState: vscode.TreeItemCollapsibleState.None,
                                    projectIndex: element.val.projectIndex,
                                    tooltip: `Callgraph View`,
                                    icon: `ShowCallGraph_16x.svg`
                                }));
                            }
                        }
                    }
                    break;
                // output file item
                case TreeItemType.OUTPUT_FILE_ITEM:
                    break;
                case TreeItemType.COMPONENT_GROUP:
                case TreeItemType.ACTIVED_GROUP:
                case TreeItemType.PACK_GROUP:
                case TreeItemType.GROUP:
                    switch (element.val.groupRegion) {
                        case 'PACK':
                            {
                                const deviceInfo = project.GetPackManager().GetCurrentDevice();
                                if (deviceInfo) {

                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'PackageName',
                                        value: deviceInfo.packInfo.name,
                                        projectIndex: element.val.projectIndex
                                    }));
                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'Vendor',
                                        value: deviceInfo.packInfo.vendor,
                                        projectIndex: element.val.projectIndex
                                    }));

                                    const device = <DeviceInfo>project.GetPackManager().getCurrentDevInfo();

                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'Core',
                                        value: device.core || 'null',
                                        projectIndex: element.val.projectIndex
                                    }));

                                    const devFamily = project.GetPackManager().getDeviceFamily();
                                    let description: vscode.MarkdownString | string | undefined;
                                    if (devFamily && devFamily.description) {
                                        description = devFamily.description; // newMarkdownString(devFamily.description);
                                    }

                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'DeviceName',
                                        value: device.name,
                                        projectIndex: element.val.projectIndex,
                                        tooltip: description
                                    }));

                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'Endian',
                                        value: device.endian || 'null',
                                        projectIndex: element.val.projectIndex
                                    }));

                                    iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                        key: 'SvdPath',
                                        value: device.svdPath ? project.toRelativePath(device.svdPath) : 'null',
                                        projectIndex: element.val.projectIndex
                                    }));

                                    iList.push(new ProjTreeItem(TreeItemType.GROUP, {
                                        value: view_str$pack$components,
                                        groupRegion: 'Components',
                                        projectIndex: element.val.projectIndex,
                                        tooltip: view_str$pack$components,
                                    }));
                                }
                            }
                            break;
                        case 'Components':
                            {
                                const packInfo = project.GetPackManager().GetPack();
                                const prjConfig = project.GetConfiguration();
                                if (packInfo) {
                                    packInfo.components.forEach((component, index) => {
                                        if (component.enable) {

                                            const type = prjConfig.IsExisted((<PackInfo>packInfo).name, component.groupName) ?
                                                TreeItemType.ACTIVED_GROUP : TreeItemType.COMPONENT_GROUP;
                                            const description = type === TreeItemType.ACTIVED_GROUP ?
                                                (`${component.description} (${view_str$pack$installed_component})`) : component.description;

                                            iList.push(new ProjTreeItem(type, {
                                                obj: index,
                                                value: component.groupName,
                                                groupRegion: 'ComponentItem',
                                                tooltip: description,
                                                projectIndex: element.val.projectIndex
                                            }));
                                        }
                                    });
                                }
                            }
                            break;
                        case 'ComponentItem':
                            {
                                const packInfo = project.GetPackManager().GetPack();
                                if (packInfo) {

                                    const component: any = packInfo.components[element.val.obj];
                                    for (const key in component) {

                                        if (Array.isArray(component[key])) {
                                            const list: string[] = (<ComponentFileItem[]>component[key])
                                                .map(item => project.toRelativePath(item.path));
                                            iList.push(new ProjTreeItem(TreeItemType.GROUP, {
                                                value: getComponentKeyDescription(key),
                                                child: list,
                                                projectIndex: element.val.projectIndex
                                            }));
                                        }
                                    }
                                }
                            }
                            break;
                        default:
                            {
                                if (element.val.child) {
                                    element.val.child.forEach((v) => {
                                        iList.push(new ProjTreeItem(TreeItemType.ITEM, {
                                            value: v,
                                            projectIndex: element.val.projectIndex
                                        }));
                                    });
                                }
                            }
                            break;
                    }
                    break;
                case TreeItemType.ITEM:
                    //Do nothing
                    break;
                default:
                    break;
            }
        }
        return iList;
    }

    async _OpenProject(workspaceFilePath: string, workspaceState: vscode.Memento): Promise<AbstractProject | undefined> {

        const wsFile: File = new File(workspaceFilePath);
        if (!wsFile.IsFile()) {
            GlobalEvent.show_msgbox('Warning', invalid_project_path + wsFile.path);
            return undefined;
        }

        if (!detectProject(File.from(wsFile.dir))) {
            GlobalEvent.show_msgbox('Warning', `File not existed, [path]: ${wsFile.dir}`);
            return undefined;
        }

        try {
            await doMigration(File.from(wsFile.dir));
            const prj = AbstractProject.NewProject(workspaceState);
            await prj.Load(wsFile);
            this.registerProject(prj);
            GlobalEvent.emit('project.opened', prj);
            return prj;
        } catch (err) {
            GlobalEvent.show_msgbox('Warning', project_load_failed);
            GlobalEvent.log_error(err);
            GlobalEvent.emit('globalLog.show');
            return undefined;
        }
    }

    setActiveProject(index: number) {
        const prj = this.prjList[index];
        const wsPath = prj.getWsPath();
        if (this.activePrjPath !== wsPath) {
            this.activePrjPath = wsPath;
            this.UpdateView();
            GlobalEvent.emit('project.activeStatusChanged', prj.getUid());
        }
    }

    async OpenProject(workspaceFilePath: string, switchWorkspaceImmediately?: boolean): Promise<AbstractProject | undefined> {

        const wsFolder = new File(NodePath.dirname(workspaceFilePath));

        // check workspace
        if (!detectProject(wsFolder)) { // not found project file, open workspace ?
            const msg = `Not found eide project in this workspace !, Open this workspace directly ?`;
            const selection = await vscode.window.showInformationMessage(msg, continue_text, cancel_text);
            if (selection === continue_text) { WorkspaceManager.getInstance().openWorkspace(new File(workspaceFilePath)); }
            return undefined;
        }

        const prj = await vscode.window.withProgress({
            title: 'Open Project',
            location: vscode.ProgressLocation.Notification,
        }, (progress) => {
            progress.report({ message: `${workspaceFilePath}` });
            return this._OpenProject(workspaceFilePath, getGlobalState());
        });
        if (prj) {
            this.SwitchProject(prj, switchWorkspaceImmediately);
            return prj;
        }

        return undefined;
    }

    async CreateProject(option: CreateOptions): Promise<AbstractProject | undefined> {

        // check folder
        const dList = option.outDir.GetList(File.EXCLUDE_ALL_FILTER);
        if (dList.findIndex((_folder) => { return _folder.name === option.name; }) !== -1) {
            const item = await vscode.window.showWarningMessage(`${WARNING}: ${project_exist_txt}`, 'Yes', 'No');
            if (item === undefined || item === 'No') {
                return undefined;
            }
        }

        try {
            const prj = AbstractProject.NewProject(getGlobalState());
            await prj.Create(option);
            this.registerProject(prj);
            this.SwitchProject(prj);
            return prj;
        } catch (err) {
            GlobalEvent.emit('error', err);
            GlobalEvent.show_msgbox('Warning', project_load_failed);
            return undefined;
        }
    }

    private importCmsisHeaders(rootDir: File): string[] {

        const result: string[] = [];

        const headerInfos = ResManager.GetInstance().getCMSISHeaderPacks();
        for (const info of headerInfos) {
            const outDir = File.fromArray([rootDir.path, '.cmsis', info.name]);
            if (!outDir.IsDir()) {
                outDir.CreateDir(true);
                const compresser = new SevenZipper(ResManager.GetInstance().Get7zDir());
                compresser.UnzipSync(File.from(info.zippath), outDir);
            }
            info.exportIncs?.forEach(p => result.push(File.normalize(File.from(outDir.path, p).path)));
        }

        return result;
    }

    ImportProject(option: ImportOptions) {

        let catchErr = (error: any) => {
            const msg = `${view_str$operation$import_failed}: ${(<Error>error).message}`;
            GlobalEvent.show_msgbox('Warning', msg);
            GlobalEvent.show_msgbox('Hidden', error);
        }

        switch (option.type) {
            case 'mdk':
                this.ImportKeilProject(option).catch(err => catchErr(err));
                break;
            case 'eclipse':
                this.ImportEclipseProject(option).catch(err => catchErr(err));
                break;
            case 'iar':
                this.ImportIarProject(option).catch(err => catchErr(err));
                break;
            default:
                break;
        }
    }

    private async ImportIarProject(option: ImportOptions) {

        if (!ToolchainManager.getInstance().isToolchainPathReady('IAR_ARM')) {
            const msg = `Your 'IAR_ARM' toolchain path is invalid, we suggest that you set it before start to import !`;
            const ans = await vscode.window.showWarningMessage(msg, `Ok`, 'Skip');
            if (ans != 'Skip') {
                if (ans == 'Ok') { // jump to setup toolchain
                    vscode.commands.executeCommand('eide.operation.install_toolchain');
                }
                return;
            }
        }

        const ewwInfo = await iarParser.parseIarWorkbench(
            new File(option.projectFile.path), SettingManager.GetInstance().getIarForArmDir());
        const ewwRoot = new File(option.projectFile.dir);

        let projectnum = 0;
        for (const _ in ewwInfo.projects) projectnum++;

        if (projectnum == 0)
            throw new Error(`Not found any project in this IAR workbench ! [path]: ${option.projectFile.path}`);

        const vscWorkspace = {
            "folders": <any[]>[]
        };

        const vscWorkspaceFile = File.fromArray([ewwRoot.path, `${ewwInfo.name}.code-workspace`]);

        const toolchainType: ToolchainName = 'IAR_ARM';

        //
        let project0workspacefile: File = <any>undefined;
        for (const path_ in ewwInfo.projects) {

            const iarproj = ewwInfo.projects[path_];
            const iarPrjRoot = new File(NodePath.dirname(path_));

            const needCreateNewDir = File.normalize(iarPrjRoot.path) == File.normalize(ewwRoot.path);
            const basePrj = AbstractProject.NewProject(getGlobalState()).createBase({
                name: iarproj.name,
                projectName: iarproj.name,
                type: 'ARM',
                outDir: iarPrjRoot
            }, needCreateNewDir);

            const prjRoot = basePrj.rootFolder;

            vscWorkspace.folders.push({
                name: iarproj.name,
                path: ewwRoot.ToRelativePath(prjRoot.path) || prjRoot.path
            });

            if (!project0workspacefile)
                project0workspacefile = basePrj.workspaceFile;

            const eidePrjCfg = basePrj.prjConfig.config;
            const eideFolder = File.fromArray([prjRoot.path, AbstractProject.EIDE_DIR]);

            // export project env
            {
                const envFile = File.fromArray([eideFolder.path, 'env.ini']);
                const envCont = [
                    `###########################################################`,
                    `#              project environment variables`,
                    `###########################################################`,
                    ``,
                ];

                iarproj.envs['PROJ_DIR'] = needCreateNewDir ? '..' : '.';

                for (const key in iarproj.envs) {
                    envCont.push(`${key} = ${iarproj.envs[key]}`);
                }

                envFile.Write(envCont.join(os.EOL));
            }

            // file groups
            eidePrjCfg.virtualFolder = iarproj.fileGroups;
            eidePrjCfg.outDir = 'build';
            basePrj.prjConfig.setToolchain(toolchainType);

            // targets
            let firstTargetName: string = '';
            for (const tname in iarproj.targets) {

                if (!firstTargetName)
                    firstTargetName = tname;

                const targetName = tname;
                const iarTarget = iarproj.targets[tname];

                const nEideTarget: ProjectTargetInfo = makeTargetInfo({
                    excludeList: iarTarget.excludeList,
                    toolchain: eidePrjCfg.toolchain,
                    toolchainConfig: copyObject(eidePrjCfg.toolchainConfig),
                    toolchainConfigMap: copyObject(eidePrjCfg.toolchainConfigMap),
                    uploader: eidePrjCfg.uploader,
                    uploadConfig: copyObject(eidePrjCfg.uploadConfig),
                    uploadConfigMap: copyObject(eidePrjCfg.uploadConfigMap),
                });
                eidePrjCfg.targets[targetName] = nEideTarget;

                nEideTarget.cppPreprocessAttrs.defineList = toArray(iarTarget.settings['ICCARM.CCDefines']);
                nEideTarget.cppPreprocessAttrs.incList = toArray(iarTarget.settings['ICCARM.CCIncludePath2']);

                //
                // compiler base config
                //
                const compilerMod = <ArmBaseCompileConfigModel>basePrj.prjConfig.toolchainConfigModel;
                const compilerOpt = <ArmBaseCompileData>nEideTarget.toolchainConfig;

                if (iarTarget.core) {
                    const expname = iarTarget.core;
                    const cpus = compilerMod.getValidCpus();
                    const idx = cpus.findIndex(n => expname == n || expname.toLowerCase().startsWith(n.toLowerCase()));
                    if (idx != -1) {
                        compilerOpt.cpuType = cpus[idx];
                    }
                }

                if (ArmCpuUtils.hasFpu(compilerOpt.cpuType)) {
                    if (iarTarget.settings['General.FPU2'] != '0') {
                        compilerOpt.floatingPointHardware =
                            ArmCpuUtils.hasFpu(compilerOpt.cpuType, true) ? 'double' : 'single';
                    }
                }

                compilerOpt.scatterFilePath = iarTarget.icfPath;

                //
                // builder options
                //
                const toolchain = ToolchainManager.getInstance().getToolchain(eidePrjCfg.type, eidePrjCfg.toolchain);
                const builderConfig = toolchain.getDefaultConfig();

                const iar2eideOptsMap = iarParser.IAR2EIDE_OPTS_MAP;

                // set iar compiler options
                for (const cfgGroupName in iar2eideOptsMap) {

                    const optsGrp = iar2eideOptsMap[cfgGroupName];

                    for (const iarsname in iar2eideOptsMap[cfgGroupName]) {

                        if (typeof iarTarget.settings[iarsname] != 'string')
                            continue;

                        const iarOptVal = <string>iarTarget.settings[iarsname];

                        for (const fieldname in optsGrp[iarsname]) {
                            const eideOptVal = optsGrp[iarsname][fieldname][iarOptVal];
                            if (eideOptVal) {
                                (<any>builderConfig)[cfgGroupName][fieldname] = eideOptVal;
                            }
                        }
                    }
                }

                // copy string options

                const optToString = (obj: string | string[]): string => {
                    if (Array.isArray(obj)) {
                        return obj[0];
                    } else {
                        return obj;
                    }
                };

                // linker
                {
                    builderConfig.linker['LIB_FLAGS'] = toArray(iarTarget.settings['ILINK.IlinkAdditionalLibs']);

                    if (iarTarget.settings['ILINK.IlinkOverrideProgramEntryLabel'] == '1') {
                        builderConfig.linker['program-entry'] = optToString(iarTarget.settings['ILINK.IlinkProgramEntryLabel']);
                    }

                    builderConfig.linker['config-defines'] = toArray(iarTarget.settings['ILINK.IlinkConfigDefines']);

                    const extraOpts: string[] = [];

                    toArray(iarTarget.settings['ILINK.IlinkKeepSymbols'])
                        .forEach(s => extraOpts.push(`--keep ${s}`));

                    toArray(iarTarget.settings['ILINK.IlinkDefines'])
                        .forEach(s => extraOpts.push(`--define_symbol ${s}`));

                    if (iarTarget.settings['ILINK.IlinkUseExtraOptions'] == '1') {
                        toArray(iarTarget.settings['ILINK.IlinkExtraOptions'])
                            .forEach(opt => extraOpts.push(opt));
                    }

                    builderConfig.linker['misc-controls'] = extraOpts.join(' ');
                }

                // asm
                {
                    builderConfig["asm-compiler"]['defines'] = toArray(iarTarget.settings['AARM.ADefines']);

                    if (iarTarget.settings['AARM.AExtraOptionsCheckV2'] == '1') {
                        builderConfig["asm-compiler"]['misc-controls'] =
                            toArray(iarTarget.settings['AARM.AExtraOptionsV2']);
                    }
                }

                // cpp
                {
                    const extraOpts: string[] = [];

                    toArray(iarTarget.settings['ICCARM.PreInclude'])
                        .forEach(s => extraOpts.push(`--preinclude ${s}`));

                    if (iarTarget.settings['ICCARM.IExtraOptionsCheck'] == '1') {
                        toArray(iarTarget.settings['ICCARM.IExtraOptions'])
                            .forEach(s => extraOpts.push(s));
                    }

                    builderConfig["c/cpp-compiler"]['misc-controls'] = extraOpts.join(' ');
                }

                // builder tasks
                {
                    if (iarTarget.builderActions.prebuild) {
                        builderConfig.beforeBuildTasks?.push({
                            name: 'iar prebuild',
                            command: iarTarget.builderActions.prebuild,
                            stopBuildAfterFailed: true,
                        });
                    }

                    if (iarTarget.builderActions.postbuild) {
                        builderConfig.afterBuildTasks?.push({
                            name: 'iar postbuild',
                            command: iarTarget.builderActions.postbuild
                        });
                    }
                }

                nEideTarget.builderOptions[toolchainType] = builderConfig;
            }

            // init current target

            applyTargetToConfigData(eidePrjCfg, firstTargetName);

            // save all config

            basePrj.prjConfig.Save();
        }

        // store vscode workspace
        fs.writeFileSync(vscWorkspaceFile.path, JSON.stringify(vscWorkspace, undefined, 4));

        // switch project
        const selection = await vscode.window.showInformationMessage(
            view_str$operation$import_done, continue_text, cancel_text);
        if (selection === continue_text) {
            WorkspaceManager.getInstance().openWorkspace(vscWorkspace.folders.length > 1
                ? vscWorkspaceFile
                : project0workspacefile);
        }
    }

    private async ImportEclipseProject(option: ImportOptions) {

        const ePrjInfo = await eclipseParser.parseEclipseProject(option.projectFile.path);
        const ePrjRoot = new File(option.projectFile.dir);

        let nPrjType: ProjectType = 'ANY-GCC';

        switch (ePrjInfo.type) {
            case 'arm':
                nPrjType = 'ARM';
                break;
            case 'riscv':
                nPrjType = 'RISC-V';
                break;
            case 'sdcc':
                nPrjType = 'C51';
            default:
                break;
        }

        const basePrj = AbstractProject.NewProject(getGlobalState()).createBase({
            name: ePrjInfo.name,
            projectName: ePrjInfo.name,
            type: nPrjType,
            outDir: ePrjRoot
        }, false);

        const nPrjConfig = basePrj.prjConfig.config;
        const eideFolder = File.fromArray([ePrjRoot.path, AbstractProject.EIDE_DIR]);

        nPrjConfig.virtualFolder = ePrjInfo.virtualSource;
        nPrjConfig.outDir = 'build';

        if (ePrjInfo.sourceEntries.length > 0) {
            nPrjConfig.srcDirs = ePrjInfo.sourceEntries;
        } else {
            nPrjConfig.srcDirs = File.NotMatchFilter(ePrjRoot.GetList(File.EXCLUDE_ALL_FILTER), File.EXCLUDE_ALL_FILTER,
                [/^\./, /^(build|dist|out|bin|obj|exe|debug|release|log[s]?|ipch|docs|doc|img|image[s]?)$/i])
                .map(d => ePrjRoot.ToRelativePath(d.path) || d.path);
        }

        // init source args
        const srcOptsObj = <SourceFileOptions>{ version: EIDE_FILE_OPTION_VERSION, options: {} };
        srcOptsObj.version = EIDE_FILE_OPTION_VERSION;

        // init all target
        for (const eTarget of ePrjInfo.targets) {

            const nEideTarget: ProjectTargetInfo = makeTargetInfo({
                excludeList: eTarget.excList,
                toolchain: nPrjConfig.toolchain,
                toolchainConfig: copyObject(nPrjConfig.toolchainConfig),
                toolchainConfigMap: copyObject(nPrjConfig.toolchainConfigMap),
                uploader: nPrjConfig.uploader,
                uploadConfig: copyObject(nPrjConfig.uploadConfig),
                uploadConfigMap: copyObject(nPrjConfig.uploadConfigMap),
            });

            nEideTarget.cppPreprocessAttrs.defineList = eTarget.builldArgs.cMacros;
            nEideTarget.cppPreprocessAttrs.incList = eTarget.builldArgs.cIncDirs;
            nEideTarget.cppPreprocessAttrs.libList = eTarget.builldArgs.linkerLibSearchDirs;

            // for arm gcc toolchain
            if (nEideTarget.toolchain == 'GCC') {

                var guessArmCpuType = (archName?: string): string | undefined => {
                    if (!archName)
                        return undefined;
                    // @note: this list is trimed, not full
                    const armCpuTypeMap: any = {
                        'cortex-m0plus' : 'Cortex-M0+',
                        'cortex-m0+'    : 'Cortex-M0+',
                        'cortex-m23'    : 'Cortex-M23',
                        'cortex-m33'    : 'Cortex-M33',
                        'cortex-m35p'   : 'Cortex-M35P',
                        'cortex-m55'    : 'Cortex-M55',
                        'cortex-m85'    : 'Cortex-M85',
                        'cortex-m0'     : 'Cortex-M0',
                        'cortex-m3'     : 'Cortex-M3',
                        'cortex-m4'     : 'Cortex-M4',
                        'cortex-m7'     : 'Cortex-M7'
                    };
                    return armCpuTypeMap[archName.toLowerCase()];
                };

                const compilerOpt = <ArmBaseCompileData>nEideTarget.toolchainConfig;
                compilerOpt.cpuType = guessArmCpuType(eTarget.archName) || 'Cortex-M3';
                compilerOpt.floatingPointHardware = ArmCpuUtils.hasFpu(compilerOpt.cpuType) ? 'single' : 'none';
                compilerOpt.useCustomScatterFile = true;
                compilerOpt.scatterFilePath = eTarget.linkerScriptPath || '';
            }
            // for riscv gcc toolchain
            else if (nEideTarget.toolchain == 'RISCV_GCC') {
                const compilerOpt = <RiscvCompileData>nEideTarget.toolchainConfig;
                compilerOpt.linkerScriptPath = eTarget.linkerScriptPath || '';
            }
            // for any gcc toolchain
            else if (nEideTarget.toolchain == 'ANY_GCC') {
                const compilerOpt = <AnyGccCompileData>nEideTarget.toolchainConfig;
                compilerOpt.linkerScriptPath = eTarget.linkerScriptPath || '';
            }

            // init compiler args for target
            {
                const toolchain = ToolchainManager.getInstance().getToolchain(nPrjConfig.type, nPrjConfig.toolchain);
                const toolchainDefConf = toolchain.getDefaultConfig();

                // glob
                toolchainDefConf.global['misc-control'] = eTarget.builldArgs.globalArgs.filter(a => a.trim() != '');

                // asm
                {
                    let flags: string[] = [];
                    const asmCfg = toolchainDefConf["asm-compiler"];

                    if (asmCfg['ASM_FLAGS']) flags.push(asmCfg['ASM_FLAGS']);
                    eTarget.builldArgs.sMacros.forEach(m => flags.push(`-D${m}`));
                    eTarget.builldArgs.assemblerArgs.forEach(arg => flags.push(arg));

                    flags = flags.filter(p => p.trim() != '');
                    if (asmCfg['ASM_FLAGS'] != undefined) {
                        asmCfg['ASM_FLAGS'] = flags.join(' ');
                    } else {
                        asmCfg['misc-control'] = flags.join(' ');
                    }
                }

                // c
                {
                    let flags: string[] = [];
                    let cxxFlags: string[] = [];
                    const ccCfg = toolchainDefConf["c/cpp-compiler"];

                    if (eTarget.builldArgs.optimization)
                        ccCfg['optimization'] = eTarget.builldArgs.optimization;
                    if (eTarget.builldArgs.cLanguageStd)
                        ccCfg['language-c'] = eTarget.builldArgs.cLanguageStd;
                    if (eTarget.builldArgs.cppLanguageStd)
                        ccCfg['language-cpp'] = eTarget.builldArgs.cppLanguageStd;
                    if (eTarget.builldArgs.signedChar)
                        ccCfg['signed-char'] = true;

                    if (ccCfg['C_FLAGS'])
                        flags.push(ccCfg['C_FLAGS']);
                    if (ccCfg['CXX_FLAGS'])
                        cxxFlags.push(ccCfg['CXX_FLAGS']);

                    eTarget.builldArgs.cCompilerArgs.forEach(arg => {
                        flags.push(arg);
                        //TODO not support C++ options now
                        //cxxFlags.push(arg);
                    });

                    flags = flags.filter(p => p.trim() != '');
                    cxxFlags = cxxFlags.filter(p => p.trim() != '');
                    if (ccCfg['C_FLAGS'] != undefined) {
                        ccCfg['C_FLAGS'] = flags.join(' ');
                        ccCfg['CXX_FLAGS'] = cxxFlags.join(' ');
                    } else {
                        ccCfg['misc-control'] = flags.join(' ');
                    }
                }

                // linker
                {
                    if (!toolchainDefConf.linker) toolchainDefConf.linker = {};
                    const ldCfg = toolchainDefConf.linker;

                    const flags: string[] = eTarget.builldArgs.linkerArgs.filter(a => a.trim() != '');
                    if (ldCfg['LD_FLAGS'] != undefined) {
                        ldCfg['LD_FLAGS'] = flags.join(' ');
                        const libFlags = eTarget.builldArgs.linkerLibArgs.filter(a => a.trim() != '');
                        if (ldCfg['LIB_FLAGS'] != undefined) {
                            ldCfg['LIB_FLAGS'] = libFlags.join(' ');
                        }
                    } else {
                        ldCfg['misc-control'] = flags.join(' ');
                    }

                    // setup link order
                    if (eTarget.objsOrder.length) {
                        const linkOrder: { pattern: string, order: number }[] = [];
                        eTarget.objsOrder.forEach((e, idx) => {
                            linkOrder.push({
                                pattern: e,
                                order: idx
                            });
                        });
                        ldCfg['object-order'] = linkOrder;
                    }
                }

                nEideTarget.builderOptions[toolchain.name] = toolchainDefConf;
            }

            // setup source options
            if (eTarget.sourceArgs) {
                srcOptsObj.options[eTarget.name] = { files: {} };
                const srcOptions: any = srcOptsObj.options[eTarget.name].files;
                const srcFilters = AbstractProject.getSourceFileFilter();
                for (const fpath in eTarget.sourceArgs) {
                    const flags: string[] = [];
                    const sourceArgs = eTarget.sourceArgs[fpath];
                    if (AbstractProject.asmfileFilter.test(fpath)) {
                        sourceArgs.sIncDirs.forEach(arg => flags.push(`-I${arg}`));
                        sourceArgs.sMacros.forEach(arg => flags.push(`-D${arg}`));
                        sourceArgs.assemblerArgs.forEach(arg => flags.push(arg));
                    } else {
                        sourceArgs.cIncDirs.forEach(arg => flags.push(`-I${arg}`));
                        sourceArgs.cMacros.forEach(arg => flags.push(`-D${arg}`));
                        sourceArgs.cCompilerArgs.forEach(arg => flags.push(arg));
                    }
                    if (flags.length > 0) {
                        if (srcFilters.some(r => r.test(fpath)))
                            srcOptions[fpath] = ArrayDelRepetition(flags).join(' ');
                        else
                            srcOptions[fpath + '/*'] = ArrayDelRepetition(flags).join(' ');
                    }
                }
            }

            nPrjConfig.targets[eTarget.name] = nEideTarget;
        }

        // init current target
        applyTargetToConfigData(nPrjConfig, ePrjInfo.targets[0].name);

        // save all config
        basePrj.prjConfig.Save();
        // save src options
        const optFile = File.fromArray([basePrj.rootFolder.path, AbstractProject.EIDE_DIR, `files.options.yml`]);
        optFile.Write(view_str$prompt$filesOptionsComment + yaml.stringify(srcOptsObj, { indent: 4, lineWidth: 1000 }));

        // switch project
        const selection = await vscode.window.showInformationMessage(
            view_str$operation$import_done, continue_text, cancel_text);
        if (selection === continue_text) {
            WorkspaceManager.getInstance().openWorkspace(basePrj.workspaceFile);
        }
    }

    private async ImportKeilProject(option: ImportOptions) {

        const keilPrjFile = option.projectFile;
        const keilParser = KeilParser.NewInstance(option.projectFile, <any>option.mdk_prod);
        const targets = keilParser.ParseData();

        if (targets.length == 0) {
            throw Error(`Not found any target in '${keilPrjFile.path}' !`);
        }

        const nPrjOutDir = <File>option.outDir;

        const baseInfo = AbstractProject.NewProject(getGlobalState()).createBase({
            name: nPrjOutDir.name,
            projectName: keilPrjFile.noSuffixName,
            type: targets[0].type,
            outDir: nPrjOutDir
        }, false);

        const projectInfo = baseInfo.prjConfig.config;

        // init project info
        projectInfo.virtualFolder = {
            name: VirtualSource.rootName,
            files: [],
            folders: []
        };

        const getVirtualFolder = (path: string, noCreate?: boolean): VirtualFolder | undefined => {

            if (!path.startsWith(`${VirtualSource.rootName}/`)) {
                throw Error(`'${path}' is not a virtual path`);
            }

            const pathList = path.split('/');
            pathList.splice(0, 1); // remvoe root

            // init start search folder
            let curFolder: VirtualFolder = projectInfo.virtualFolder;

            for (const name of pathList) {
                const index = curFolder.folders.findIndex((folder) => { return folder.name === name; });
                if (index === -1) {
                    if (noCreate) { return undefined; }
                    const newFolder = { name: name, files: [], folders: [] };
                    curFolder.folders.push(newFolder);
                    curFolder = newFolder;
                } else {
                    curFolder = curFolder.folders[index];
                }
            }

            return curFolder;
        };

        // init source args
        const srcOptsObj = <SourceFileOptions>{ version: EIDE_FILE_OPTION_VERSION, options: {} };
        srcOptsObj.version = EIDE_FILE_OPTION_VERSION;
        const setupSourceOpts = (vFolderPath: string, srcFilePath: string) => {
            for (const keilTarget of targets) {
                if (srcOptsObj.options[keilTarget.name] == undefined)
                    srcOptsObj.options[keilTarget.name] = { files: {}, virtualPathFiles: {} };
                const targetSrcOpts = srcOptsObj.options[keilTarget.name];
                if (keilTarget.fileOptions) {
                    const vFilePath = `${vFolderPath}/${NodePath.basename(srcFilePath)}`;
                    const fopts = keilTarget.fileOptions[vFilePath];
                    if (fopts && targetSrcOpts.virtualPathFiles) {
                        const optLi = [];
                        fopts.includes.forEach(item => {
                            if (keilTarget.type === 'C51') {
                                optLi.push(`INCDIR(${baseInfo.rootFolder.ToRelativePath(item) || item})`);
                            } else {
                                optLi.push(`-I${baseInfo.rootFolder.ToRelativePath(item) || item}`);
                            }
                        });
                        fopts.defines.forEach(item => {
                            if (keilTarget.type === 'C51') {
                                if (item.includes('='))
                                    optLi.push(`DEFINE(${item})`);
                                else
                                    optLi.push(`DEFINE(${item}=1)`);
                            } else {
                                optLi.push(`-D${item}`);
                            }
                        });
                        fopts.undefines.forEach(item => {
                            if (keilTarget.type === 'C51') {
                                //TODO: not support -U options.
                            } else {
                                optLi.push(`-U${item}`);
                            }
                        });
                        if (fopts.miscOptions)
                            optLi.push(fopts.miscOptions);
                        targetSrcOpts.virtualPathFiles[vFilePath] = optLi.join(' ');
                    }
                }
            }
        };

        // init file group
        targets[0].fileGroups.forEach((group) => {
            const vPath = `${VirtualSource.rootName}/${File.ToUnixPath(group.name)}`;
            const VFolder = <VirtualFolder>getVirtualFolder(vPath);
            group.files.forEach((fileItem) => {
                // add source file
                VFolder.files.push({
                    path: baseInfo.rootFolder.ToRelativePath(fileItem.file.path) || fileItem.file.path
                });
                // add file options for every target
                setupSourceOpts(vPath, fileItem.file.path);
            });
        });

        /* import RTE dependence */
        const rte_deps = targets[0].rte_deps;
        const unresolved_deps: KeilRteDependence[] = [];
        if (rte_deps) {

            /* import cmsis headers */
            const incs: string[] = this.importCmsisHeaders(baseInfo.rootFolder);

            /* try resolve all deps */
            const fileTypeMatchers: RegExp[] = [/source/, /header/];
            rte_deps.forEach((dep) => {

                // check category
                if (!(dep.category && fileTypeMatchers.some(reg => reg.test(dep.category || '')))) {
                    GlobalEvent.log_warn(`[Keil RTE Import] dependence '${dep.name}' is not a source file !`);
                    unresolved_deps.push(dep); /* resolve failed !, store dep */
                    return;
                }

                // check source file
                if (!dep.instance) {
                    GlobalEvent.log_warn(`[Keil RTE Import] dependence '${dep.name}' have no instances !`);
                    unresolved_deps.push(dep); /* resolve failed !, store dep */
                    return;
                }

                const srcList = dep.instance.map(p => File.ToUnixPath(p));
                const vFolder = getVirtualFolder(`${VirtualSource.rootName}/::${dep.class}`, false);

                if (!vFolder) {
                    GlobalEvent.log_warn(`[Keil RTE Import] No such folder '::${dep.class}'`);
                    unresolved_deps.push(dep); /* resolve failed !, store dep */
                    return;
                }

                /* resolve dependences */
                for (const srcPath of srcList) {

                    /* check condition */
                    if (!File.IsFile(srcPath)) {
                        GlobalEvent.log_warn(`[Keil RTE Import] No such file '${srcPath}'`);
                        continue;
                    }

                    const srcRePath = baseInfo.rootFolder.ToRelativePath(srcPath);

                    /* add to project */
                    vFolder.files.push({ path: srcRePath || srcPath });

                    /* if it's a header, add to include path */
                    if (dep.category == 'header') {
                        if (srcRePath)
                            incs.push(`${baseInfo.rootFolder.path}${File.sep}${NodePath.dirname(srcRePath)}`);
                        else
                            incs.push(NodePath.dirname(srcPath));
                    }
                }
            });

            /* add include paths for targets */
            const mdk_rte_folder = File.fromArray([`${keilPrjFile.dir}`, 'RTE']);
            targets.forEach((target) => {
                target.incList = target.incList.concat(incs);
                target.incList.push(`${mdk_rte_folder.path}${File.sep}_${target.name}`); /* add RTE_Components header */
            });

            /* log unresolved deps */
            if (unresolved_deps.length > 0) {

                const title = `!!! ${WARNING} !!!`;

                const lines: string[] = [
                    `${title}`,
                    view_str$prompt$unresolved_deps,
                    view_str$prompt$prj_location.replace('{}', baseInfo.workspaceFile.path),
                    '---'
                ];

                unresolved_deps.forEach((dep) => {

                    let locate = dep.packPath;
                    if (dep.instance) {
                        locate = baseInfo.rootFolder
                            .ToRelativePath(dep.instance[0]) || dep.instance[0]
                    }

                    const nLine: string[] = [
                        `FileName: '${dep.name}'`,
                        `\tClass:     '${dep.class}'`,
                        `\tCategory:  '${dep.category}'`,
                        `\tLocation:  '${locate}'`,
                    ];

                    lines.push(nLine.join(os.EOL));
                });

                const cont = lines.join(`${os.EOL}${os.EOL}`);
                const file = File.fromArray([baseInfo.rootFolder.path, `keil.${AbstractProject.importerWarningBaseName}`]);
                file.Write(cont); // write content to file
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.ToUri()));
                vscode.window.showTextDocument(doc, { preview: false });
                GlobalEvent.log_show();
            }
        }

        const mergeBuilderOpts = (baseOpts_: any, opts: any): any => {

            const baseOpts = copyObject(baseOpts_);

            if (opts == undefined) return baseOpts;

            for (const clasName in opts) {
                if (baseOpts[clasName] == undefined) {
                    baseOpts[clasName] = opts[clasName];
                } else {
                    for (const key in opts[clasName]) {
                        baseOpts[clasName][key] = opts[clasName][key];
                    }
                }
            }

            return baseOpts;
        }

        const replaceUserTaskTmpVar = (t: any) => {
            const reKeilPrjDir = baseInfo.rootFolder.ToRelativeLocalPath(keilPrjFile.dir) || keilPrjFile.dir;
            if (reKeilPrjDir === '.') {
                t.command = t.command.replace('$<cd:mdk-proj-dir> && ', '');
            } else {
                // 非 win32 上 `cd /D` 是 cmd 专用开关, `\` 也不是分隔符 —— 命令会被
                // /bin/bash 执行, 前缀必须用 unix 形态, 否则 POST-BUILD 任务直接失败。
                if (t.command.startsWith('bash') || osType() !== 'win32') {
                    t.command = t.command.replace('$<cd:mdk-proj-dir>', `cd ${File.ToUnixPath(reKeilPrjDir)}`);
                } else {
                    if (File.isAbsolute(reKeilPrjDir))
                        t.command = t.command.replace('$<cd:mdk-proj-dir>', `cd /D ${reKeilPrjDir}`);
                    else
                        t.command = t.command.replace('$<cd:mdk-proj-dir>', `cd .\\${reKeilPrjDir}`);
                }
            }
        }

        // project env
        const prjenv: any = {};

        // init all targets
        for (const keilTarget of targets) {

            const newTarget: ProjectTargetInfo = makeTargetInfo({
                toolchainConfig: copyObject(projectInfo.toolchainConfig),
                toolchainConfigMap: copyObject(projectInfo.toolchainConfigMap),
                uploader: projectInfo.uploader,
                uploadConfig: copyObject(projectInfo.uploadConfig),
                uploadConfigMap: copyObject(projectInfo.uploadConfigMap),
            });
            const defIncList: string[] = [];

            //
            // import specific configs
            //

            // C51 project
            if (keilTarget.type === 'C51') {
                const keilCompileConf = (<KeilC51Option>keilTarget.compileOption);
                // base config
                newTarget.toolchain = 'Keil_C51';
                const toolchain = ToolchainManager.getInstance().getToolchain('C51', 'Keil_C51');
                if (keilCompileConf.includeFolder) {
                    const absPath = [toolchain.getToolchainDir().path, 'INC', keilCompileConf.includeFolder].join(File.sep);
                    defIncList.push(baseInfo.rootFolder.ToRelativePath(absPath) || absPath);
                }
                // import builder options
                const opts: BuilderOptions = mergeBuilderOpts(
                    toolchain.getDefaultConfig(), keilCompileConf.optionsGroup[keilCompileConf.toolchain]);
                newTarget.builderOptions[toolchain.name] = opts;
            }

            // ARM project
            else {
                const keilCompileConf = <KeilARMOption>keilTarget.compileOption;
                const prjCompileOption = (<ArmBaseCompileData>newTarget.toolchainConfig);
                // base config
                newTarget.toolchain = keilCompileConf.toolchain;
                prjCompileOption.cpuType = keilCompileConf.cpuType;
                prjCompileOption.floatingPointHardware = keilCompileConf.floatingPointHardware || 'none';
                prjCompileOption.useCustomScatterFile = keilCompileConf.useCustomScatterFile;
                prjCompileOption.storageLayout = keilCompileConf.storageLayout;

                if (keilCompileConf.scatterFilePath) {
                    prjCompileOption.scatterFilePath =
                        baseInfo.rootFolder.ToRelativePath(keilCompileConf.scatterFilePath) || keilCompileConf.scatterFilePath;
                } else { // if no scatter, will use X/O Base, R/O Base options, make scatterFilePath empty
                    prjCompileOption.scatterFilePath = '';
                }

                // import builder options
                const toolchain = ToolchainManager.getInstance().getToolchain('ARM', keilCompileConf.toolchain);
                const opts: BuilderOptions = mergeBuilderOpts(
                    toolchain.getDefaultConfig(), keilCompileConf.optionsGroup[keilCompileConf.toolchain]);
                opts.beforeBuildTasks?.forEach((t) => replaceUserTaskTmpVar(t));
                opts.afterBuildTasks?.forEach((t) => replaceUserTaskTmpVar(t));
                newTarget.builderOptions[toolchain.name] = opts;
            }

            // init custom dependence after specific configs done
            newTarget.cppPreprocessAttrs = <any>{ name: 'default' };
            const incList = keilTarget.incList.map((path) => baseInfo.rootFolder.ToRelativePath(path) || path);
            newTarget.cppPreprocessAttrs.incList = defIncList.concat(incList);
            newTarget.cppPreprocessAttrs.defineList = keilTarget.defineList;
            newTarget.cppPreprocessAttrs.libList = [];

            // fill exclude list
            newTarget.excludeList = [];
            for (const group of keilTarget.fileGroups) {
                const vFolderPath = `${VirtualSource.rootName}/${File.ToUnixPath(group.name)}`;
                if (group.disabled) { newTarget.excludeList.push(vFolderPath); } // add disabled group
                for (const file of group.files) {
                    if (file.disabled) { // add disabled file
                        newTarget.excludeList.push(`${vFolderPath}/${file.file.name}`);
                    }
                }
            }

            // env
            if (keilTarget.env && Object.keys(keilTarget.env).length > 0) {
                prjenv[`${keilTarget.name}`] = copyObject(keilTarget.env);
            }

            projectInfo.targets[keilTarget.name] = newTarget;
        }

        // init current target
        applyTargetToConfigData(projectInfo, targets[0].name);

        // save all config
        baseInfo.prjConfig.Save();

        // save env
        if (Object.keys(prjenv).length > 0) {
            File.fromArray([baseInfo.rootFolder.path, AbstractProject.EIDE_DIR, 'env.ini'])
                .Write(ini.stringify(prjenv));
        }

        // save src options
        const optFile = File.fromArray([baseInfo.rootFolder.path, AbstractProject.EIDE_DIR, `files.options.yml`]);
        optFile.Write(view_str$prompt$filesOptionsComment + yaml.stringify(srcOptsObj, { indent: 4, lineWidth: 1000 }));

        // switch project
        const selection = await vscode.window.showInformationMessage(
            view_str$operation$import_done, continue_text, cancel_text);
        if (selection === continue_text) {
            WorkspaceManager.getInstance().openWorkspace(baseInfo.workspaceFile);
        }
    }

    async CreateFromTemplate(option: CreateOptions) {

        const compresser = new SevenZipper(ResManager.GetInstance().Get7zDir());
        const templateFile = <File>option.templateFile;

        const targetDir = new File(option.outDir.path + File.sep + option.name);
        const targetWorkspaceFile = File.from(targetDir.path,
            (option.projectName || option.name) + AbstractProject.workspaceSuffix);

        try {

            targetDir.CreateDir(true);

            const err = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Creating project`
            }, async (progress): Promise<Error | void> => {

                progress.report({ message: 'Unzip template', increment: 10 });

                const e = await compresser.Unzip(templateFile, targetDir);
                if (e) return e;

                progress.report({ message: 'Generating', increment: 50 });

                return new Promise((resolve) => {

                    const post_create_task = async () => {

                        try {

                            const wsFileList = targetDir.GetList([/\.code-workspace$/i], File.EXCLUDE_ALL_FILTER);
                            const wsFile: File | undefined = wsFileList.length > 0 ? wsFileList[0] : undefined;

                            if (wsFile) {

                                // rename workspace file name
                                fs.renameSync(wsFile.path, targetWorkspaceFile.path);

                                // rename project
                                if (templateFile.suffix != '.ewt') { // ignore eide workspace project

                                    // init project
                                    if (!detectProject(targetDir))
                                        throw Error(`No found any project in this workspace.`);

                                    try {
                                        await doMigration(targetDir);
                                        const pfile = File.from(targetDir.path, AbstractProject.EIDE_DIR, AbstractProject.prjConfigName);
                                        const prjConf = ProjectConfiguration.parseProjectFile(pfile.Read());
                                        prjConf.name = option.name; // set project name
                                        if (prjConf.miscInfo) prjConf.miscInfo.uid = undefined; // reset uid
                                        pfile.Write(ProjectConfiguration.dumpProjectFile(prjConf));
                                    } catch (error) {
                                        throw Error(`Init project failed !, msg: ${error.message}`);
                                    }
                                }
                            }

                            resolve();

                        } catch (error) {
                            resolve(error);
                        }
                    };

                    setTimeout(post_create_task, 400);
                });
            });

            if (err) {
                throw err;
            }

            // switch workspace if user select `yes`
            const item = await vscode.window.showInformationMessage(
                view_str$operation$create_prj_done, 'Yes', 'Later'
            );

            // switch workspace
            if (item === 'Yes') {
                const wsFile = targetWorkspaceFile;
                if (wsFile.IsFile()) {
                    WorkspaceManager.getInstance().openWorkspace(wsFile);
                }
            }

        } catch (error) {
            GlobalEvent.show_msgbox('Warning', `Create project failed !, msg: ${(<Error>error).message}`);
            GlobalEvent.show_msgbox('Hidden', error);
        }
    }

    async UninstallKeilPackage(item: ProjTreeItem) {
        const prj = this.prjList[item.val.projectIndex];
        if (prj.GetPackManager().GetPack()) {
            return prj.UninstallPack(<string>item.val.value);
        }
    }

    SaveAll() {
        this.prjList.forEach(sln => sln.Save(true));
    }

    CloseAll() {
        this.prjList.forEach(sln => sln.Close());
        this.prjList = [];
    }

    //---

    getRecords(): string[] {
        return Array.from(this.slnRecord);
    }

    clearAllRecords() {
        this.slnRecord = [];
        this.saveRecord();
    }

    removeRecord(record: string) {
        const i = this.slnRecord.findIndex(str => { return str === record; });
        if (i !== -1) {
            this.slnRecord.splice(i, 1);
        }
    }

    saveRecord() {
        if (this.slnRecord.length > ProjectDataProvider.RecMaxNum) {
            this.slnRecord.splice(0, this.slnRecord.length - ProjectDataProvider.RecMaxNum);
        }
        this.recFile.Write(JSON.stringify(this.slnRecord));
    }

    private addRecord(path: string) {
        if (!this.slnRecord.includes(path)) {
            this.slnRecord.push(path);
        }
    }

    private loadRecord() {
        if (this.recFile.IsFile()) {
            try {
                this.slnRecord = JSON.parse(this.recFile.Read());
            } catch (err) {
                this.slnRecord = [];
                GlobalEvent.show_msgbox('Hidden', err);
            }
        }
    }

    //---

    async SetDevice(index: number) {

        const prj = this.prjList[index];
        const packInfo = prj.GetPackManager().GetPack();

        if (packInfo) {
            const devList = prj.GetPackManager().GetDeviceList().map((dev) => {
                return <vscode.QuickPickItem>{ label: dev.name, description: dev.core };
            });
            const item = await vscode.window.showQuickPick(devList, {
                placeHolder: 'Found ' + devList.length + ' devices, ' + set_device_hint,
                canPickMany: false,
                matchOnDescription: true
            });
            if (item) {
                prj.GetPackManager().SetDeviceInfo(item.label, item.description);
            }
        }
    }

    private registerProject(proj: AbstractProject) {
        this.prjList.push(proj);
        proj.on('dataChanged', (type) => this.onProjectChanged(proj, type));
        proj.on('targetCreated', () => this.UpdateView());
        proj.on('targetDeleted', () => this.UpdateView());
        proj.on('targetRenamed', () => this.UpdateView());
        this.addRecord(proj.getWsPath());
        this.UpdateView();
    }

    Close(index: number): string | undefined {

        if (index < 0 || index >= this.prjList.length) {
            GlobalEvent.emit('error', new Error('Project index out of range: ' + index.toString()));
            return;
        }

        const sln = this.prjList[index];

        sln.Close();
        this.prjList.splice(index, 1);
        this.UpdateView();

        return sln.getUid();
    }

    private async SwitchProject(prj: AbstractProject, immediately?: boolean) {
        if (immediately) {
            WorkspaceManager.getInstance().openWorkspace(prj.GetWorkspaceConfig().GetFile());
        } else {
            const selection = await vscode.window.showInformationMessage(switch_workspace_hint, continue_text, cancel_text);
            if (selection === continue_text) {
                WorkspaceManager.getInstance().openWorkspace(prj.GetWorkspaceConfig().GetFile());
            }
        }
    }
}
