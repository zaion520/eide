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

import * as vscode from 'vscode';
import { PathCompletionItem } from './ExplorerSmallItems';
export { PathCompletionItem };
import { ProjectItemCache } from './ExplorerSmallItems';
export { ProjectItemCache };
import { ItemCache } from './ExplorerSmallItems';
export { ItemCache };
import type { VirtualFileInfo, VirtualFolderInfo } from './types/ExplorerTypes';
export type { VirtualFileInfo, VirtualFolderInfo };
import { ProjectExcSourceModifier } from './ExplorerYamlModifiers';
export { ProjectExcSourceModifier };
import { ProjectAttrModifier } from './ExplorerYamlModifiers';
export { ProjectAttrModifier };
import { VFolderSourcePathsModifier } from './ExplorerYamlModifiers';
export { VFolderSourcePathsModifier };
import { ModifiableYamlConfigProvider } from './ExplorerYamlModifiers';
export { ModifiableYamlConfigProvider };
import { ProjTreeItem } from './ProjTreeItem';
export { ProjTreeItem };
import { ModifiableDepInfo } from './ProjTreeItem';
export { ModifiableDepInfo };
import { ModifiableDepType } from './ProjTreeItem';
export { ModifiableDepType };
import { TreeItemValue } from './ProjTreeItem';
export { TreeItemValue };
import { GroupRegion } from './ProjTreeItem';
export { GroupRegion };
import { TreeItemType } from './types/ExplorerTypes';
export { TreeItemType };
import * as events from 'events';
import * as fs from 'fs';
import * as NodePath from 'path';
import * as child_process from 'child_process';
import * as os from 'os';
import * as yaml from 'yaml';
import * as ini from 'ini';
import * as jsonc_parser from 'jsonc-parser';

import { File } from '../lib/node-utility/File';
import { OperationLock, OpLockKeys } from './OperationLock';
import { ResManager } from './ResManager';
import { GlobalEvent } from './GlobalEvents';
import { AbstractProject, CheckError, DataChangeType, VirtualSource, SourceFileOptions, EIDE_FILE_OPTION_VERSION } from './EIDEProject';
import { ToolchainManager } from './ToolchainManager';
import type { ToolchainName } from './types/ToolchainTypes';
import {
    BuilderOptions, CreateOptions, VirtualFolder, VirtualFile, ImportOptions, ProjectTargetInfo, ProjectConfigData, ProjectType, ProjectBaseApi } from './EIDETypeDefine';
import { ProjectConfiguration } from './ProjectConfiguration';
import { applyTargetToConfigData, makeTargetInfo, formatBuildAllSummary, BuildTargetResult } from './TargetManager';
import { BuildAllStatus } from './BuildAllStatus';
import {
    computeLevelDelta, findProjectRootsUnder, rewriteConfigRelativePaths, auditExternalReferences,
} from './ProjectRootTool';
import {
    isV42Skeleton, assembleFromSkeleton, splitIntoSkeleton, packTargetForDisk,
} from './ProjectStorageV42';
import {
    rebuildClangdCache,
} from './clangdIntegration';
import {
    PackInfo, ComponentFileItem, DeviceInfo,
    getComponentKeyDescription, ArmBaseCompileData, ArmBaseCompileConfigModel,
    RiscvCompileData, AnyGccCompileData,
    getRamRomName,
    getRamRomRange
} from "./EIDEProjectModules";
import { WorkspaceManager } from './WorkspaceManager';
import {
    can_not_close_project, project_is_opened, project_load_failed,
    continue_text, cancel_text, project_exist_txt,
    project_record_read_failed, pack_info, compile_config, set_device_hint,
    switch_workspace_hint, add_include_path, add_define, project_dependence,
    view_str$pack$installed_component, not_support_no_arm_project,
    install_this_pack, export_keil_xml_ok, export_keil_xml_failed,
    invalid_project_path,
    uploadConfig_desc, add_lib_path, view_str$pack$components,
    view_str$project$title, view_str$project$excludeFolder, view_str$project$excludeFile,
    view_str$pack$install_component_failed, view_str$pack$remove_component_failed,
    view_str$compile$selectToolchain, view_str$compile$selectFlasher, view_str$project$needRefresh, view_str$project$fileNotExisted,
    WARNING, view_str$project$cmsis_components, view_str$project$other_settings, view_str$settings$outFolderName,
    view_str$dialog$add_to_source_folder, view_str$project$sel_target, view_str$project$folder_type_fs,
    view_str$project$folder_type_virtual, view_str$project$sel_folder_type,
    view_str$project$add_source,
    view_str$settings$prj_name,
    view_str$operation$import_done,
    view_str$operation$import_failed,
    view_str$operation$create_prj_done,
    view_str$settings$prjEnv,
    view_str$prompt$unresolved_deps,
    view_str$prompt$prj_location,
    view_str$prompt$src_folder_must_be_a_child_of_root,
    view_str$prompt$removeSrcDir,
    view_str$project$folder_type_virtual_desc,
    view_str$project$folder_type_fs_desc,
    view_str$msg$err_ewt_hash,
    view_str$msg$err_ept_hash,
    view_str$prompt$eclipse_imp_warning,
    view_str$prompt$need_reload_project,
    view_str$prompt$needReloadToUpdateEnv,
    getLocalLanguageType,
    LanguageIndexs,
    txt_yes,
    txt_no,
    remove_this_item,
    view_str$prompt$filesOptionsComment,
    view_str$virual_doc_provider_banner,
    view_str$missed_stubs_added,
    view_str$keil_export_path_warning,
    view_str$settings$debugger
} from './StringTable';
import { CodeBuilder, BuildOptions } from './CodeBuilder';
import { ExceptionToMessage, newMessage } from './Message';
import { SettingManager } from './SettingManager';
import { FlashCommandResult, HexUploaderManager, JLinkOptions, JLinkProtocolType, OpenOCDFlashOptions, PyOCDFlashOptions } from './HexUploader';
import type { HexUploaderType } from './types/UploadTypes';
import { SevenZipper, CompressOption } from './Compress';
import { DependenceManager } from './DependenceManager';
import { ArrayDelRepetition } from '../lib/node-utility/Utility';
import {
    copyObject, downloadFileWithProgress,
    sendCommandToTerminal, redirectHost, readGithubRepoFolder, FileCache,
    genGithubHash, md5, toArray, newMarkdownString, newFileTooltipString,
    readGithubRepoTxtFile, downloadFile, notifyReloadWindow, formatPath, execInternalCommand,
    copyAndMakeObjectKeysToLowerCase,
    sortPaths,
    getGccBinutilsVersion,
    compareVersion,
    getGccSystemSearchList,
    openocd_getConfigList,
    pyocd_getTargetList,
    isGccFamilyToolchain,
    cxxDemangle,
    DEBUGGER_MAPS
} from './utility';
import { DeleteDir, exeSuffix, kill, osType, DeleteAllChildren, userhome, getGlobalState } from './Platform';
import { KeilARMOption, KeilC51Option, KeilParser, KeilRteDependence } from './KeilXmlParser';
import { VirtualDocument } from './VirtualDocsProvider';
import { ExeCmd } from '../lib/node-utility/Executable';
import { CmdLineHandler } from './CmdLineHandler';
import { WebPanelManager } from './WebPanelManager';
import * as yml from 'yaml';
import { GitFileInfo } from './WebInterface/GithubInterface';
import {
    CppToolsApi, Version, CustomConfigurationProvider, getCppToolsApi,
    SourceFileConfigurationItem, WorkspaceBrowseConfiguration
} from 'vscode-cpptools';
import * as eclipseParser from './EclipseProjectParser';
import {
    parseIarCompilerLog, 
    CompilerDiagnostics, parseGccCompilerLog, parseArmccCompilerLog, 
    parseKeilc51CompilerLog, parseSdccCompilerLog, parseCosmicStm8CompilerLog, 
    EideDiagnosticCode
} from './ProblemMatcher';
import * as iarParser from './IarProjectParser';
import * as ArmCpuUtils from './ArmCpuUtils';
import { ShellFlasherIndexItem } from './WebInterface/WebInterface';
import { jsonc } from 'jsonc';
import { SimpleUIConfig, SimpleUIConfigData_input, SimpleUIConfigData_options, SimpleUIConfigData_text, SimpleUIConfigData_table, SimpleUIConfigData_boolean, SimpleUIConfigData_divider, SimpleUIConfigData_tag } from "./SimpleUIDef";
import { StatusBarManager } from './StatusBarManager';
import { doMigration, detectProject } from './EIDEProjectMigration';
import * as hooks from './Hooks';



function getTreeItemTypeName(typ: TreeItemType): string {
    return TreeItemType[typ];
}













interface ItemClickInfo {
    name: string;
    time: number;
}







class ProjectDataProvider implements vscode.TreeDataProvider<ProjTreeItem>, vscode.TreeDragAndDropController<ProjTreeItem> {

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
                if (t.command.startsWith('bash')) {
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

interface BuildCommandInfo {
    title: string;
    command: string;
    program?: string;
    order?: number;
    ignoreFailed?: boolean;
}

interface ImporterProjectInfo {
    name: string;
    target?: string;
    incList: string[];
    defineList: string[];
    files: VirtualFolder;
    excludeList?: string[] | { [targetName: string]: string[] };
}



export class ProjectExplorer implements CustomConfigurationProvider {

    private readonly vFolderNameMatcher = /^\w[\w\t \-:@\.]*$/;

    private view: vscode.TreeView<ProjTreeItem>;
    private dataProvider: ProjectDataProvider;

    private _event: events.EventEmitter;

    private cppToolsApi: CppToolsApi | undefined;
    private cppToolsOut: vscode.OutputChannel;

    private compiler_diags: Map<string, vscode.DiagnosticCollection>;

    private autosaveTimer: NodeJS.Timeout | undefined;

    private isRevealed: boolean = false; // 用于标记，初始化后是否已触发了展开首个树视图的操作

    // reload project
    private autosaveDisableTimeoutTimer: NodeJS.Timeout | undefined;
    /** null = reload UI shown; function = waiting yes/later (progress bar) */
    private reloadPrompts = new Map<string, ((action: 'yes' | 'later') => void) | null>();

    constructor(context: vscode.ExtensionContext) {

        this._event = new events.EventEmitter();
        this.compiler_diags = new Map();

        this.dataProvider = new ProjectDataProvider(context);
        this.dataProvider.bindReloadChecker(
            (uid) => this.reloadPrompts.has(uid),
            () => this.reloadPrompts.size > 0
        );

        this.view = vscode.window.createTreeView('cl.eide.view.projects', {
            treeDataProvider: this.dataProvider,
            dragAndDropController: this.dataProvider,
            canSelectMany: true,
        });
        context.subscriptions.push(this.view);

        // 当主要的几个根视图初始化后，触发展开树视图
        this.dataProvider.on('rootItems_inited', () => {
            if (this.isRevealed == false) {
                this.isRevealed = true;
                const proj = this.dataProvider.getActiveProject();
                // 当工作区有多个项目的时候，不进行展开操作
                if (proj && this.dataProvider.getProjectCount() == 1) {
                    const item = this.dataProvider.treeCache.getTreeItem(proj, TreeItemType.PROJECT);
                    if (item) {
                        this.view.reveal(item, {
                            select: false,
                            focus: false,
                            expand: false
                        });
                    }
                }
            }
        });

        // item click event
        context.subscriptions.push(vscode.commands.registerCommand(ProjTreeItem.ITEM_CLICK_EVENT, (item) => this.OnTreeItemClick(item)));

        // create vsc output channel
        this.cppToolsOut = vscode.window.createOutputChannel('eide-cpptools-log');

        // register doc event
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            this.YamlConfigProvider_notifyDocSaved(doc);
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => {
            this.YamlConfigProvider_notifyDocClosed(doc);
        }));

        // register yaml config provider
        {
            const providerList: ModifiableYamlConfigProvider[] = [
                new VFolderSourcePathsModifier(),
                new ProjectAttrModifier(),
                new ProjectExcSourceModifier()
            ];

            for (const provider of providerList) {
                this.registerModifiableYamlConfigProvider(provider.id, provider);
            }
        }

        // register path completion item provider
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider({ scheme: 'file', pattern: '**/*.eide.*.{yml,yaml}' }, this.newPathStringCompletionItemProvider(), '/', '\\'));

        // register task end event callback
        context.subscriptions.push(
            vscode.tasks.onDidEndTask((t) => {
                if (['eide.flasher', 'eide.builder'].includes(t.execution.task.source)) {
                    this.dataProvider.updateStatusBarForActiveProjects();
                }
            }));

        // register project hook
        GlobalEvent.on('project.opened', (prj) => this.onProjectOpened(<AbstractProject>prj));
        GlobalEvent.on('project.closed', (uid) => this.onProjectClosed(uid));
        GlobalEvent.on('project.activeStatusChanged', (uid) => this.notifyCpptoolsRefresh());

        this.on('request_open_project', (fsPath: string) => this.dataProvider.OpenProject(fsPath));
        this.on('request_create_project', (option: CreateOptions) => this.dataProvider.CreateProject(option));
        this.on('request_create_from_template', (option) => this.dataProvider.CreateFromTemplate(option));
        this.on('request_import_project', (option) => this.dataProvider.ImportProject(option));
    }

    onDispose() {
        for (const uid of this.reloadPrompts.keys()) {
            this.finishReloadPrompt(uid, 'later');
            this.cleanReloadPrompt(uid);
        }
        this.dataProvider.onDispose();
    }

    loadWorkspace(workspaceState: vscode.Memento) {
        this.dataProvider.LoadWorkspaceProject(workspaceState);
    }

    enableAutoSave(enable: boolean) {
        if (enable) {
            if (this.autosaveTimer) {
                this.autosaveTimer.refresh();
            } else {
                this.autosaveTimer = setInterval(() => this.SaveAll(), 3 * 60 * 1000);
            }
        } else {
            if (this.autosaveTimer) {
                clearInterval(this.autosaveTimer);
                this.autosaveTimer = undefined;
            }
        }
    }

    newPathStringCompletionItemProvider(): vscode.CompletionItemProvider<PathCompletionItem> {
        return {
            provideCompletionItems: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext):
                vscode.ProviderResult<PathCompletionItem[] | vscode.CompletionList<PathCompletionItem>> => {

                let proj: AbstractProject | undefined;

                for (const provider of this.yamlCfgProviderList.values()) {
                    proj = provider.getSourceProjectByFileName(NodePath.basename(document.fileName));
                    if (proj) {
                        break;
                    }
                }

                if (proj == undefined) {
                    return;
                }

                const fullrange = document.getWordRangeAtPosition(position, /[^\s"]+|"[^"]+"/);
                if (fullrange) {

                    let txt = document.getText(new vscode.Range(fullrange.start, position)).trim()
                        .replace(/^(\/|\\)+/, '')
                        .replace(/(\/|\\)+$/, '');

                    let p = new File(proj.toAbsolutePath(txt));
                    if (p.IsDir()) {
                        return p.GetList(undefined, undefined).map(f => new PathCompletionItem(f));
                    }
                }
            }
        };
    }

    // -----------------------------------------
    //  cpptools intellisense provider
    // -----------------------------------------

    name: string = 'eide';

    extensionId: string = 'cl.eide';

    private isRegisteredCpptoolsProvider: boolean = false;

    private async registerCpptoolsProvider(prj: AbstractProject) {

        // notify cpptools update when project config changed
        prj.on('cppConfigChanged', () => {
            if (this.cppToolsApi) {
                if (this.cppToolsApi.notifyReady) {
                    this.cppToolsApi.notifyReady(this);
                } else {
                    this.cppToolsApi.didChangeCustomConfiguration(this);
                    this.cppToolsApi.didChangeCustomBrowseConfiguration(this);
                }
            }
        });

        // active cpptools
        {
            const cpptoolsId = "ms-vscode.cpptools";
            const extension = vscode.extensions.getExtension(cpptoolsId);
            if (extension) {
                if (!extension.isActive) {
                    try {
                        GlobalEvent.log_info(`Active extension: '${cpptoolsId}'`);
                        await extension.activate();
                    } catch (error) {
                        GlobalEvent.log_warn(error);
                    }
                }
            } else {
                GlobalEvent.log_warn(`The extension '${cpptoolsId}' is not enabled or installed !`);
            }
        }

        // get cpptools api if we have not get
        if (!this.cppToolsApi) {
            this.cppToolsApi = await getCppToolsApi(Version.v5);
            if (!this.cppToolsApi) {
                const msg = `Can't get cpptools api, please active c/c++ extension, otherwise, the c/c++ intellisence config cannot be provided !`;
                this.cppToolsOut.appendLine(`[error] ${msg}`);
                return;
            }
        }

        // register cpptools provider, skip if already registered
        if (this.cppToolsApi && !this.isRegisteredCpptoolsProvider) {

            this.cppToolsApi.registerCustomConfigurationProvider(this);
            this.cppToolsOut.appendLine(`[init] register CustomConfigurationProvider done !\r\n`);

            // update cppConfig now
            prj.forceUpdateCpptoolsConfig();

            // set flag
            this.isRegisteredCpptoolsProvider = true;
        }
    }

    notifyCpptoolsRefresh() {

        if (this.cppToolsApi) {
            if (this.cppToolsApi.notifyReady) {
                this.cppToolsApi.notifyReady(this);
            } else {
                this.cppToolsApi.didChangeCustomConfiguration(this);
                this.cppToolsApi.didChangeCustomBrowseConfiguration(this);
            }
        }
    }

    // Map<sourePath, ProjectUid[]>
    private _sourceWhereFroms: Map<string, string[]> = new Map();

    canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken | undefined): Thenable<boolean> {

        this.cppToolsOut.appendLine(`[source] cpptools request provideConfigurations for '${uri.fsPath}'`);

        return new Promise(async (resolve) => {

            const providerList: string[] = [];

            await this.dataProvider.traverseProjectsAsync(async (prj) => {

                const result = await prj.canProvideConfiguration(uri, token);
                if (result) {
                    providerList.push(prj.getUid());
                }

                return false; // don't break loop
            });

            if (providerList.length > 0) {
                this._sourceWhereFroms.set(uri.fsPath, providerList);
                resolve(true);
            } else {
                this._sourceWhereFroms.delete(uri.fsPath);
                resolve(false);
            }
        });
    }

    provideConfigurations(uris: vscode.Uri[], token?: vscode.CancellationToken | undefined): Thenable<SourceFileConfigurationItem[]> {

        return new Promise(async (resolve) => {

            let result: SourceFileConfigurationItem[] = [];

            const activePrjUid = this.getActiveProject()?.getUid();

            for (const uri of uris) {

                const prjList = this._sourceWhereFroms.get(uri.fsPath);
                if (prjList == undefined || prjList.length == 0) continue;

                let proj: AbstractProject | undefined;
                if (activePrjUid) {
                    const pidx = prjList.findIndex(uid => uid == activePrjUid);
                    if (pidx != -1) {
                        proj = this.dataProvider.getProjectByUid(prjList[pidx]);
                    }
                } else {
                    proj = this.dataProvider.getProjectByUid(prjList[0]);
                }

                if (proj) {
                    result = result.concat(await proj.provideConfigurations([uri], token));
                }
            }

            resolve(result);

            this.cppToolsOut.appendLine(`[source] provideConfigurations`);
            this.cppToolsOut.appendLine(yml.stringify(result));
        });
    }

    canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken | undefined): Thenable<boolean> {
        return new Promise(async (resolve) => {
            let result = false;
            await this.dataProvider.traverseProjectsAsync(async (prj) => {
                result = await prj.canProvideBrowseConfigurationsPerFolder(token);
                return result;
            });
            resolve(result);
        });
    }

    provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null> {
        return new Promise(async (resolve) => {
            let result: WorkspaceBrowseConfiguration | null = null;
            await this.dataProvider.traverseProjectsAsync(async (prj) => {
                result = await prj.provideFolderBrowseConfiguration(uri, token);
                return result !== null;
            });
            resolve(result);
            this.cppToolsOut.appendLine(`[folder] provideFolderBrowseConfiguration for '${uri.fsPath}'`);
            this.cppToolsOut.appendLine(yml.stringify(result));
        });
    }

    /**
     * @note we not support
    */
    canProvideBrowseConfiguration(token?: vscode.CancellationToken | undefined): Thenable<boolean> {
        return new Promise((resolve) => {
            resolve(false);
        });
    }

    /**
     * @note we not support
    */
    provideBrowseConfiguration(token?: vscode.CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null> {
        return new Promise((resolve) => {
            resolve(null);
        });
    }

    dispose() {
        this.dataProvider.traverseProjects((prj) => {
            prj.dispose();
            return undefined;
        });
    }

    // ----------------------------------------
    //  clangd config provider
    // ----------------------------------------

    private async registerClangdProvider(prj: AbstractProject) {

        // clangd 与 cpptools 不再互斥:clangd 集成管线读写的是
        // <root>/compile_commands.json(根目录单文件库) + 用户级 config.yaml + clangd.arguments,
        // 与 cpptools 的 CustomConfigurationProvider 互不干扰。
        // clangd 集成管线始终开启,更新由 UpdateCppConfig 主链的 doUpdateClangdSupport 统一触发
        // (cppConfigChanged 监听器路径已移除:它会在 doUpdateCpptoolsConfig 阶段提前跑一遍,
        //  此时 builder.params 尚未刷新,读到旧参数,且与主链重复执行、EISDIR 噪音翻倍)。
        prj.forceUpdateCpptoolsConfig();
    }

    // -----------------------------------------
    //  Project Explorer 
    // -----------------------------------------

    private on(event: 'request_open_project', listener: (fsPath: string) => void): void;
    private on(event: 'request_create_project', listener: (option: CreateOptions) => void): void;
    private on(event: 'request_create_from_template', listener: (option: CreateOptions) => void): void;
    private on(event: 'request_import_project', listener: (option: ImportOptions) => void): void;
    private on(event: any, listener: (arg?: any) => void): void {
        this._event.on(event, listener);
    }

    emit(event: 'request_open_project', fsPath: string): void;
    emit(event: 'request_create_project', option: CreateOptions): void;
    emit(event: 'request_create_from_template', option: CreateOptions): void;
    emit(event: 'request_import_project', option: ImportOptions): void;
    emit(event: any, arg?: any): void {
        this._event.emit(event, arg);
    }

    /**
     * 
     * @param callbk return true to break foreach
     */
    foreachProjects(callbk: (val: AbstractProject, index: number) => boolean | undefined) {
        this.dataProvider.traverseProjects((prj, idx) => {
            return callbk(prj, idx);
        });
    }

    getProjectByTreeItem(prjItem?: ProjTreeItem): AbstractProject | undefined {
        return prjItem instanceof ProjTreeItem ?
            this.dataProvider.GetProjectByIndex(prjItem.val.projectIndex) :
            this.getActiveProject();
    }

    getProjectByUid(uid: string): AbstractProject | undefined {
        return this.dataProvider.getProjectByUid(uid);
    }

    getActiveProject(): AbstractProject | undefined {
        return this.dataProvider.getActiveProject();
    }

    getProjectCount(): number {
        return this.dataProvider.getProjectCount();
    }

    Refresh() {
        this.dataProvider.clearTreeViewCache();
        this.dataProvider.UpdateView();
    }

    /**
     * 重定位项目根目录:把 .eide/.vscode/*.code-workspace 移到新目录(沿目录链上移/下移),
     * 机械重写全部相对路径,并输出外部引用体检报告(公用目录/断链)。
     */
    public async onRelocateProjectRoot(item?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(item);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        const oldRoot = NodePath.resolve(prj.getRootDir().path);

        const targetUri = await vscode.window.showOpenDialog({
            openLabel: 'Relocate project root here',
            defaultUri: vscode.Uri.file(NodePath.dirname(oldRoot)),
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false
        });
        if (!targetUri || targetUri.length === 0) { return; }

        const newRoot = NodePath.resolve(targetUri[0].fsPath);
        if (newRoot === oldRoot) { return; }

        const delta = computeLevelDelta(oldRoot, newRoot);
        if (delta === undefined) {
            GlobalEvent.show_msgbox('Warning', `Relocate only supports moving the project root up or down along its own directory chain !`);
            return;
        }
        if (fs.existsSync(NodePath.join(newRoot, '.eide'))) {
            GlobalEvent.show_msgbox('Warning', `Target directory already contains an '.eide' folder !`);
            return;
        }

        // 前置校验:必须已是 v4.2 布局(打开旧项目时会先自动迁移)
        const oldEideDir = NodePath.join(oldRoot, '.eide');
        const oldCfgText = fs.readFileSync(NodePath.join(oldEideDir, 'eide.yml'), 'utf8');
        if (!isV42Skeleton(yaml.parse(oldCfgText))) {
            GlobalEvent.show_msgbox('Warning', `Project file is not v4.2 layout, please reload the project and try again !`);
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Project root will be moved:\n${oldRoot}\n-> ${newRoot}\n\nAll relative paths will be rewritten mechanically. Continue ?`,
            { modal: true }, 'Yes', 'No'
        );
        if (confirm !== 'Yes') { return; }

        try {
            // 1. flush + close the project (releases file watchers)
            prj.Save();
            for (let i = 0; i < this.dataProvider.getProjectCount(); i++) {
                if (this.dataProvider.GetProjectByIndex(i) === prj) {
                    this.dataProvider.Close(i);
                    break;
                }
            }

            // 2. move directories (same-volume rename, cross-volume copy fallback)
            const moveDir = (from: string, to: string) => {
                if (!fs.existsSync(from)) { return; }
                try { fs.renameSync(from, to); }
                catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
            };
            const wsFiles = fs.readdirSync(oldRoot).filter((f) => f.endsWith('.code-workspace'));
            moveDir(oldEideDir, NodePath.join(newRoot, '.eide'));
            moveDir(NodePath.join(oldRoot, '.vscode'), NodePath.join(newRoot, '.vscode'));
            for (const ws of wsFiles) {
                try { fs.renameSync(NodePath.join(oldRoot, ws), NodePath.join(newRoot, ws)); } catch { /* ignore */ }
            }

            // 3. mechanically rewrite relative paths in the v4.2 layout
            const newEideDir = NodePath.join(newRoot, '.eide');
            const skeleton = yaml.parse(fs.readFileSync(NodePath.join(newEideDir, 'eide.yml'), 'utf8'));
            const targetFiles: { name: string; data: any }[] = [];
            for (const name of <string[]>(<unknown>skeleton.targets)) {
                targetFiles.push({
                    name,
                    data: yaml.parse(fs.readFileSync(NodePath.join(newEideDir, 'targets', name, `${name}.yml`), 'utf8'))
                });
            }
            const config = assembleFromSkeleton(skeleton, targetFiles);
            const { unrewritten } = rewriteConfigRelativePaths(config, delta);
            const packedTargets: any = {};
            for (const name in config.targets) {
                packedTargets[name] = packTargetForDisk(config.targets[name]);
            }
            config.targets = packedTargets;
            const { skeleton: newSkeleton, targetFiles: newTargetFiles } = splitIntoSkeleton(config);
            fs.writeFileSync(NodePath.join(newEideDir, 'eide.yml'), yaml.stringify(newSkeleton, { indent: 2, lineWidth: 1000 }));
            for (const t of newTargetFiles) {
                const f = NodePath.join(newEideDir, 'targets', t.name, `${t.name}.yml`);
                fs.writeFileSync(f, yaml.stringify(t.data, { indent: 2, lineWidth: 1000 }));
            }

            // 4. audit external references (shared dirs / broken links)
            const report = auditExternalReferences(config, newRoot, (abs) => fs.existsSync(abs));
            const brokenCount = report.filter((r) => !r.exists).length;
            const reportLines = report.map((r) =>
                `[${r.exists ? 'OK' : 'BROKEN'}] ${r.rawPath} -> ${r.resolvedPath}  (${r.field})`);
            GlobalEvent.log_info(`--- External reference audit for '${newRoot}' ---`);
            for (const line of reportLines) { GlobalEvent.log_info(line); }
            try {
                fs.writeFileSync(NodePath.join(newEideDir, 'root-audit.report.txt'),
                    [`# external reference audit (generated by EIDE)`, ...reportLines].join('\n'), 'utf8');
            } catch { /* ignore */ }

            GlobalEvent.show_msgbox(
                brokenCount > 0 ? 'Warning' : 'Info',
                `Project root relocated. External refs: ${report.length}, broken: ${brokenCount}. See 'root-audit.report.txt'.`
            );
            if (unrewritten.length > 0) {
                GlobalEvent.show_msgbox('Warning',
                    `${unrewritten.length} path(s) could not be rewritten mechanically, please check them: ${unrewritten.join(', ')}`);
            }

            // 5. reopen the project from its new root
            const reopenedWs = wsFiles.length > 0 ? NodePath.join(newRoot, wsFiles[0]) : undefined;
            if (reopenedWs && fs.existsSync(reopenedWs)) {
                await this.dataProvider.OpenProject(reopenedWs, true);
            } else {
                GlobalEvent.show_msgbox('Info', `Please open the project workspace at '${newRoot}' manually.`);
            }
        } catch (error) {
            GlobalEvent.log_error(error);
            GlobalEvent.show_msgbox('Error', `Relocate project root failed: ${(error as Error).message}`);
        }
    }

    Close(item: ProjTreeItem) {
        const prj = this.dataProvider.getProjectByIndex(item.val.projectIndex);
        if (prj) {
            const uid = prj.getUid();
            this.finishReloadPrompt(uid, 'later');
            this.cleanReloadPrompt(uid);
            const closedUid = this.dataProvider.Close(item.val.projectIndex);
            GlobalEvent.emit('project.closed', closedUid);
        }
    }

    SaveAll() {
        this.dataProvider.SaveAll();
    }

    // -------

    createSysStubs(prjuid: string | undefined) {

        const prj = prjuid 
            ? this.dataProvider.getProjectByUid(prjuid)
            : this.dataProvider.getActiveProject();
        if (!prj)
            return; // no project

        const tarFile = File.from(prj.getRootDir().path, 'sys_stubs.c');
        for (const grp of prj.getFileGroups()) {
            for (const e of grp.files) {
                if (tarFile.path === e.file.path)
                    return; // it's existed, abort.
            }
        }

        try {
            const srcFile = File.from(ResManager.instance().getAppDataDir().path, 'gcc_posix_stubs.c');
            tarFile.Write(srcFile.Read());
            const vSrcManger = prj.getVirtualSourceManager();
            vSrcManger.addFile(VirtualSource.rootName, tarFile.path);
            // clear diags
            const uri = vscode.Uri.file(File.from(prj.getOutputFolder().path, 'compiler.log').path);
            this.compiler_diags.get(prj.getUid())?.delete(uri);
            GlobalEvent.show_msgbox('Info', view_str$missed_stubs_added.replace('{}', tarFile.name));
        } catch (error) {
            GlobalEvent.show_msgbox('Error', error);
        }
    }

    openLibsGeneratorConfig(prjItem?: ProjTreeItem) {

        const proj = this.getProjectByTreeItem(prjItem);
        if (proj == undefined) {
            GlobalEvent.show_msgbox('Warning', 'No activated project !');
            return;
        }

        const optFile = proj.getLibsGeneratorCfgFile();
        vscode.window.showTextDocument(vscode.Uri.parse(optFile.ToUri()), { preview: true });
    }

    private async onProjectOpened(prj: AbstractProject) {

        await this.registerCpptoolsProvider(prj);

        await this.registerClangdProvider(prj);

        this.updateCompilerDiagsAfterBuild(prj);

        prj.on('projectFileChanged', () => this.noticeUserReloadProject(prj));
    }

    private finishReloadPrompt(uid: string, action: 'yes' | 'later') {
        const resolve = this.reloadPrompts.get(uid);
        if (typeof resolve === 'function') {
            resolve(action);
        }
    }

    private cleanReloadPrompt(uid: string) {
        this.reloadPrompts.delete(uid);
        this.dataProvider.syncReloadPendingContext();
        this.dataProvider.UpdateView();
        this.clearAutosaveDisableTimer();
        this.enableAutoSave(true);
    }

    private async noticeUserReloadProject(prj: AbstractProject) {

        const uid = prj.getUid();

        if (this.reloadPrompts.has(uid)) {
            if (typeof this.reloadPrompts.get(uid) === 'function') {
                this.dataProvider.UpdateView();
            }
            return;
        }

        prj.clearPendingSave();
        this.enableAutoSave(false);

        if (this.autosaveDisableTimeoutTimer) {
            this.autosaveDisableTimeoutTimer.refresh();
        } else {
            this.autosaveDisableTimeoutTimer = setTimeout((_this: ProjectExplorer) => {
                _this.autosaveDisableTimeoutTimer = undefined;
                _this.enableAutoSave(true);
            }, 5 * 60 * 1000, this);
        }

        this.reloadPrompts.set(uid, null);
        this.dataProvider.syncReloadPendingContext();
        this.dataProvider.UpdateView();

        try {
            await vscode.window.withProgress({
                location: { viewId: 'cl.eide.view.projects' },
                title: view_str$prompt$need_reload_project.replace('{}', prj.getProjectName()),
                cancellable: true,
            }, async (_progress, token) => {

                await new Promise(r => setTimeout(r, 300));

                // show reload prompt for user
                const rootItem = this.dataProvider.treeCache.getRootTreeItem(prj);
                if (rootItem)
                    await this.view.reveal(rootItem, { select: false, focus: false, expand: true });
                const okItem = this.dataProvider.treeCache.getTreeItem(prj, TreeItemType.RELOAD_YES_ITEM);
                if (okItem)
                    await this.view.reveal(okItem, { select: false, focus: true, expand: true });

                const action = await new Promise<'yes' | 'later'>((resolve) => {
                    const cancelListener = token.onCancellationRequested(() => {
                        cancelListener.dispose();
                        resolve('later');
                    });
                    this.reloadPrompts.set(uid, (act) => {
                        cancelListener.dispose();
                        resolve(act);
                    });
                });

                if (action === 'later') {
                    this.cleanReloadPrompt(uid);
                    return;
                }

                this.clearAutosaveDisableTimer();
                this.enableAutoSave(true);
                this.reloadPrompts.set(uid, null);
                await this.reloadProject(uid, false);
            });
        } finally {
            this.cleanReloadPrompt(uid);
        }
    }

    private clearAutosaveDisableTimer() {
        if (this.autosaveDisableTimeoutTimer) {
            clearTimeout(this.autosaveDisableTimeoutTimer);
            this.autosaveDisableTimeoutTimer = undefined;
        }
    }

    async reloadProject(uid: string, restartWorkspace: boolean): Promise<boolean> {

        const idx = this.dataProvider.getIndexByProjectUid(uid);
        if (idx == -1) {
            GlobalEvent.show_msgbox('Error', `Project '${uid}' is not actived !`);
            return false;
        }

        this.finishReloadPrompt(uid, 'later');

        try {
            const workspaceFile = this.dataProvider.getProjectByIndex(idx).getWorkspaceFile();
            this.dataProvider.Close(idx);

            return await new Promise<boolean>((resolve) => {
                setTimeout(async () => {
                    try {
                        let p: AbstractProject | undefined;
                        if (restartWorkspace) {
                            p = await this.dataProvider.OpenProject(workspaceFile.path, true);
                        } else {
                            p = await this.dataProvider._OpenProject(workspaceFile.path, getGlobalState());
                        }
                        this.Refresh();
                        resolve(p !== undefined);
                    } catch (error) {
                        GlobalEvent.emit('error', error);
                        resolve(false);
                    } finally {
                        this.reloadPrompts.delete(uid);
                        this.dataProvider.syncReloadPendingContext();
                    }
                }, 500);
            });
        } catch (error) {
            this.reloadPrompts.delete(uid);
            this.dataProvider.syncReloadPendingContext();
            GlobalEvent.emit('error', error);
            return false;
        }
    }

    private async onProjectClosed(uid: string | undefined) {

        if (!uid) return;

        this.finishReloadPrompt(uid, 'later');
        this.cleanReloadPrompt(uid);

        // clear vscode diags
        if (this.compiler_diags.has(uid)) {
            this.compiler_diags.get(uid)?.clear();
        }
    }

    private resolveTargetOperationProject(prjItem?: ProjTreeItem): AbstractProject | undefined {
        const prj = prjItem
            ? this.dataProvider.GetProjectByIndex(prjItem.val.projectIndex)
            : undefined;
        return prj || this.getActiveProject();
    }

    private showTargetOperationError(error: any): void {
        const msg = error instanceof Error ? error.message : String(error);
        GlobalEvent.show_msgbox('Error', msg);
    }

    private async pickTargetName(prj: AbstractProject, placeHolder: string, initialValue?: string, ignoreInitialValue?: boolean): Promise<string | undefined> {
        const manager = prj.getTargetManager();
        return await vscode.window.showInputBox({
            placeHolder,
            value: initialValue,
            ignoreFocusOut: true,
            validateInput: (val: string) => {
                if (ignoreInitialValue && val === initialValue) { return undefined; }
                return manager.validateName(val);
            }
        });
    }

    private static readonly EMPTY_TARGET_ITEM_LABEL = '$(circle-slash) Empty Target';

    public async onCreateTarget(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        await this.createTargetIn(prj);
    }

    private async createTargetIn(prj: AbstractProject) {

        const manager = prj.getTargetManager();

        const targetName = await this.pickTargetName(prj, 'Input a target name');
        if (!targetName) { return; }

        // pick a clone source: all existing targets or an empty one
        const items: vscode.QuickPickItem[] = this.sortedTargetNames(manager.getNames()).map((name) => ({
            label: name,
            description: name === prj.getCurrentTarget() ? 'current' : undefined
        }));
        items.push({ label: ProjectExplorer.EMPTY_TARGET_ITEM_LABEL, description: 'create a blank target' });

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: `Select a target to clone settings from`,
            ignoreFocusOut: true
        });
        if (!picked) { return; }

        try {
            if (picked.label === ProjectExplorer.EMPTY_TARGET_ITEM_LABEL) {
                prj.createTarget(targetName, { blank: true });
            } else {
                prj.createTarget(targetName, { cloneFrom: picked.label });
            }
        } catch (error) {
            this.showTargetOperationError(error);
        }
    }

    public async onRenameTarget(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        await this.renameTargetIn(prj);
    }

    private async renameTargetIn(prj: AbstractProject) {

        const manager = prj.getTargetManager();

        const oldName = await vscode.window.showQuickPick(this.sortedTargetNames(manager.getNames()), {
            placeHolder: 'Select a target to rename',
            ignoreFocusOut: true
        });
        if (!oldName) { return; }

        const newName = await this.pickTargetName(prj, 'Input a new target name', oldName, true);
        if (!newName || newName === oldName) { return; }

        try {
            prj.renameTarget(oldName, newName);
        } catch (error) {
            this.showTargetOperationError(error);
        }
    }

    public async onDuplicateTarget(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        await this.duplicateTargetIn(prj);
    }

    private async duplicateTargetIn(prj: AbstractProject) {

        const manager = prj.getTargetManager();

        const sourceName = await vscode.window.showQuickPick(this.sortedTargetNames(manager.getNames()), {
            placeHolder: 'Select a target to duplicate',
            ignoreFocusOut: true
        });
        if (!sourceName) { return; }

        const newName = await this.pickTargetName(prj, 'Input a target name', `${sourceName}_copy`, true);
        if (!newName) { return; }

        try {
            prj.duplicateTarget(sourceName, newName);
        } catch (error) {
            this.showTargetOperationError(error);
        }
    }

    /**
     * 删除目标(多选):QuickPick 勾选多个 target(激活目标标注且不可删),
     * 模态确认后逐个走删除链路(配置项 + 旁路文件清理 + 保存);
     * 单项失败不影响其余,结束汇总。
     */
    public async onDeleteTarget(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        await this.deleteTargetsIn(prj);
    }

    /**
     * target 名展示排序:基础名 + 变体分组(A8, A8_A, A8_B, B7, B7_A, B7_B)。
     * numeric:true 让数字后缀按数值比较(A8 < A10);ASCII 序兜底保证结果稳定。
     */
    private sortedTargetNames(names: string[]): string[] {
        return [...names].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true }) ||
            (a < b ? -1 : a > b ? 1 : 0));
    }

    private async deleteTargetsIn(prj: AbstractProject) {

        const manager = prj.getTargetManager();
        const activeName = manager.getCurrentName();

        const items: vscode.QuickPickItem[] = this.sortedTargetNames(manager.getNames()).map((name) => ({
            label: name,
            description: name === activeName ? vscode.l10n.t('$(lock) active') : undefined
        }));

        const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: vscode.l10n.t('Select targets to delete (the active target cannot be deleted)'),
            ignoreFocusOut: true
        });
        if (picked === undefined || picked.length === 0) { return; }

        const names = picked.map((item) => item.label).filter((name) => name !== activeName);
        if (names.length === 0) {
            GlobalEvent.show_msgbox('Info',
                vscode.l10n.t("The active target '{0}' cannot be deleted.", activeName || ''));
            return;
        }

        const btnYes = vscode.l10n.t('Yes');
        const opt_str = await vscode.window.showWarningMessage(
            vscode.l10n.t('Delete {0} target(s): {1} ? Their per-target config files will be deleted !',
                names.length, names.join(', ')),
            { modal: true },
            btnYes, vscode.l10n.t('No')
        );

        /* if user canceled, exit */
        if (opt_str !== btnYes) { return; }

        let deletedCount = 0;
        const failed: string[] = [];
        for (const name of names) {
            try {
                prj.deleteTarget(name);
                deletedCount++;
            } catch (error) {
                failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (failed.length > 0) {
            this.showTargetOperationError(new Error(failed.join('\n')));
        }
        if (deletedCount > 0) {
            GlobalEvent.show_msgbox('Info', vscode.l10n.t('{0} target(s) deleted.', deletedCount));
        }
    }

    /**
     * 重建 clangd 缓存(维修通道):删根目录编译数据库 + 索引残留,
     * 走重生全链路并唤醒 clangd。日常增删文件走自动管线,不需要它。
     */
    public async onRebuildClangdCache(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        try {
            const result = rebuildClangdCache(prj);
            GlobalEvent.show_msgbox('Info',
                vscode.l10n.t("Clangd cache rebuilt for target '{0}': {1} files{2} !",
                    result.targetName, result.entries,
                    result.cacheCleared ? '' : vscode.l10n.t(' (nothing cached)')));
        } catch (error) {
            this.showTargetOperationError(error);
        }
    }

    /** Build All 防重入锁(统一走 OperationLock):运行期间全局锁死,避免并发触发互相干扰 */
    private static readonly __buildAllTargetsLock = new OperationLock();

    /**
     * 构建所有 target:按顺序逐个切换并构建,单个失败只记账不中断,
     * 全部跑完后切回原 target 并汇总报告(✓/✗ 清单)。
     * 全程在 `build-all:<project>` 状态终端输出高层进度
     * (准备参数/启动/完成/失败),不输出编译过程。
     * 运行期间重复触发直接拒绝(终端 + 通知提示)。
     */
    public async onBuildAllTargets(prjItem?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(prjItem);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        // 防重入:上一轮还没跑完,直接拒绝
        if (ProjectExplorer.__buildAllTargetsLock.isLocked(OpLockKeys.BuildAllTargets)) {
            const busyStatus = BuildAllStatus.Get(prj.getProjectName());
            busyStatus.Show();
            busyStatus.Warn('Build all is already running, please wait !');
            GlobalEvent.show_msgbox('Warning', `Build all is already running, please wait !`);
            return;
        }
        ProjectExplorer.__buildAllTargetsLock.tryAcquire(OpLockKeys.BuildAllTargets);

        try {
            await this.runBuildAllTargets(prj);
        } finally {
            ProjectExplorer.__buildAllTargetsLock.release(OpLockKeys.BuildAllTargets);
        }
    }

    /** onBuildAllTargets 主体(已持防重入锁) */
    private async runBuildAllTargets(prj: AbstractProject) {

        // 立即在状态终端宣告开工(点击后先有反馈),再进入 target 解析与参数准备
        const status = BuildAllStatus.Get(prj.getProjectName());
        status.Show();
        status.Step('Build all starting ...');

        let names: string[] = [];
        try {
            names = prj.getTargetManager().getNames();
        } catch (error) {
            this.showTargetOperationError(error);
            return;
        }
        if (!names.length) {
            status.Fail('No targets to build !');
            GlobalEvent.show_msgbox('Info', `No targets to build !`);
            return;
        }

        const originalTarget = prj.getCurrentTarget();
        const results: BuildTargetResult[] = [];

        const buildAllStart = Date.now();

        // 与 clangd/cpptools 刷新解耦:Build All 期间连续切换 target,
        // 每次切换原本都会触发 UpdateCppConfig 防抖刷新(生成编译库+唤醒 clangd),
        // 中间 target 的刷新毫无意义;挂起,恢复激活态后统一补刷一次
        prj.suspendCppConfigUpdate();

        try {
            if (SettingManager.GetInstance().isParallelBuildAll() && names.length > 1) {
                await this.buildAllTargetsParallel(prj, names, results, status);
            } else {
                await this.buildAllTargetsSerial(prj, names, results, status);
            }

            // restore original active target whichever path taken
            try {
                if (prj.getCurrentTarget() !== originalTarget) {
                    status.Step(`restoring active target '${originalTarget}' ...`);
                    await prj.switchTarget(originalTarget);
                }
            } catch (error) {
                GlobalEvent.log_error(error);
            }
        } finally {
            // 恢复后补一次完整刷新(cpptools + 编译数据库 + clangd),只针对最终激活的 target
            prj.resumeCppConfigUpdate(true);
        }

        // summary to terminal (per-target lines from formatBuildAllSummary)
        const elapsedS = ((Date.now() - buildAllStart) / 1000).toFixed(1);
        const summaryLines = formatBuildAllSummary(results).text.split('\n');
        const headLine = `${summaryLines[0]} (elapsed ${elapsedS}s)`;
        if (summaryLines[0] !== 'No targets to build.') {
            if (results.some((r) => !r.success)) { status.Fail(headLine); }
            else { status.Ok(headLine); }
        }
        for (const line of summaryLines.slice(1)) {
            if (line.startsWith('✓')) { status.Ok(`  ${line}`); }
            else if (line.startsWith('✗')) { status.Fail(`  ${line}`); }
        }

        const summary = formatBuildAllSummary(results);
        GlobalEvent.log_info(`--- Build all targets: ${prj.getProjectName()} ---\n${summary.text}`);
        GlobalEvent.show_msgbox(summary.hasFailure ? 'Warning' : 'Info', summary.text);
    }

    /** 原串行路径:逐个 switchTarget + buildProject(开关关闭/单 target 时使用) */
    private async buildAllTargetsSerial(prj: AbstractProject, names: string[], results: BuildTargetResult[], status: BuildAllStatus) {
        status.Header(`Build all targets: ${prj.getProjectName()} (${names.length} target(s), serial)`);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building all targets (${names.length})`,
            cancellable: false
        }, async (progress) => {
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                progress.report({ message: `Building '${name}' ...` });
                status.Step(`[${i + 1}/${names.length}] building '${name}' ...`);
                const targetStart = Date.now();
                try {
                    await prj.switchTarget(name);
                    const res = await this.buildProject(prj, { notRebuild: true });
                    const targetElapsed = ((Date.now() - targetStart) / 1000).toFixed(1);
                    results.push({ target: name, success: res.success, message: res.success ? undefined : res.message });
                    if (res.success) {
                        status.Ok(`✓ '${name}' done (${targetElapsed}s)`);
                    } else {
                        status.Fail(`✗ '${name}' failed (${targetElapsed}s)`);
                        status.FailReason(res.message);
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    results.push({
                        target: name,
                        success: false,
                        message
                    });
                    status.Fail(`✗ '${name}' failed`);
                    status.FailReason(message);
                }
            }
        });
    }

    /**
     * 并行路径(默认):三阶段构建所有 target。
     * 1. 串行切换 target 并生成各 target 构建命令(写出各自 `build/<target>/builder.params`,互不覆盖)
     * 2. worker pool 并发上限跑 Go builder(各 outDir 独立:obj/.lock/objs.db 无共享状态),
     *    cap = min(target数, max(4, cores/2)),threadNum = cores/cap 均分保持 CPU 满载不过载
     * 3. 恢复激活态后统一刷新 diagnostics/输出目录/状态栏
     * 冷构建 N 个 target 时 wall time 约为串行的 1/N ~ 1/2(受 CPU 总核数约束)。
     * 三阶段全程在状态终端输出进度。
     */
    private async buildAllTargetsParallel(prj: AbstractProject, names: string[], results: BuildTargetResult[], status: BuildAllStatus) {

        const cores = os.cpus().length || 4;
        // 真正的并发上限(worker pool):实测 51 target 齐发时上百编译线程过载,
        // 尾部轻 target 挤到最后 1s 才冲线;cap 与核数挂钩,threadNum 相应放大保持 CPU 满载
        const parallelism = Math.min(names.length, Math.max(4, Math.floor(cores / 2)));
        const threadNum = Math.max(2, Math.floor(cores / parallelism));

        status.Header(`Build all targets: ${prj.getProjectName()} (${names.length} targets, ${parallelism} parallel, ${threadNum} jobs each)`);

        // ---- Phase 1: generate command line + params for each target ----
        const jobs: { target: string, commandLine: string, index: number }[] = [];
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const index = results.length;
            const prepareStart = Date.now();
            status.Step(`[${i + 1}/${names.length}] preparing '${name}' (switch target + builder.params) ...`);
            try {
                await prj.switchTarget(name);
                prj.Save(true);
                const builder = CodeBuilder.NewBuilder(prj);
                const commandLine = builder.genBuildCommand({
                    notRebuild: true,
                    threadNumOverride: threadNum
                });
                if (!commandLine) {
                    throw new Error('generate build command failed');
                }
                jobs.push({ target: name, commandLine, index });
                results.push({ target: name, success: false, message: 'building...' }); // placeholder
                status.Ok(`[${i + 1}/${names.length}] '${name}' ready (${((Date.now() - prepareStart) / 1000).toFixed(1)}s)`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                results.push({
                    target: name,
                    success: false,
                    message
                });
                status.Fail(`[${i + 1}/${names.length}] '${name}' prepare failed`);
                status.FailReason(message);
            }
        }

        if (!jobs.length) { return; }

        const startTime = Date.now();
        const cwd = prj.getProjectRoot().path;
        let finished = 0;

        // ---- Phase 2: launch builders via worker pool (concurrency capped) ----
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building all targets (${jobs.length} targets, ${parallelism} parallel, ${threadNum} jobs each)`,
            cancellable: false
        }, async (progress) => {
            const runJob = (job: { target: string, commandLine: string, index: number }) => new Promise<void>((resolve) => {
                status.Step(`building '${job.target}' ...`);
                const jobStart = Date.now();
                child_process.exec(job.commandLine, {
                    cwd: cwd,
                    env: process.env,
                    maxBuffer: 64 * 1024 * 1024
                }, (error, stdout) => {
                    finished++;
                    progress.report({ message: `'${job.target}' done (${finished}/${jobs.length})` });
                    const jobElapsed = ((Date.now() - jobStart) / 1000).toFixed(1);
                    if (error) {
                        results[job.index] = {
                            target: job.target,
                            success: false,
                            message: `Failed.\n${stdout.toString().slice(-4000)}`
                        };
                        status.Fail(`✗ '${job.target}' failed (${jobElapsed}s)`);
                        status.ErrorExcerpt(stdout.toString());
                    } else {
                        results[job.index] = { target: job.target, success: true };
                        status.Ok(`✓ '${job.target}' built (${jobElapsed}s)`);
                    }
                    resolve();
                });
            });

            // cap 个 worker 依次从队列取 target,完成一个补一个,批间无空转
            let nextJob = 0;
            const worker = async () => {
                while (nextJob < jobs.length) {
                    await runJob(jobs[nextJob++]);
                }
            };
            await Promise.all(Array.from({ length: parallelism }, () => worker()));
        });

        GlobalEvent.log_info(`Build all targets: ${jobs.length} targets in parallel,` +
            ` elapsed ${(Date.now() - startTime) / 1000}s`);

        // ---- Phase 3: refresh project states once ----
        prj.notifyUpdateSourceRefs(prj.getToolchain().name);
        this.notifyUpdateOutputFolder(prj);
        this.updateCompilerDiagsAfterBuild(prj);
        this.dataProvider.updateStatusBarForActiveProjects();
        hooks.onProjectBuildFinished(prj, results.every((r) => r.success));
    }

    switchTarget(prjItem?: ProjTreeItem) {

        const prj = prjItem 
            ? this.dataProvider.GetProjectByIndex(prjItem.val.projectIndex)
            : this.getActiveProject();
        if (!prj) { // not active project
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        const resManager = ResManager.GetInstance();
        const pickBox = vscode.window.createQuickPick();
        pickBox.title = view_str$project$sel_target;
        pickBox.placeholder = view_str$project$sel_target;
        pickBox.items = this.sortedTargetNames(prj.getTargets()).map<vscode.QuickPickItem>((name: string) => { return { label: name }; });
        pickBox.buttons = [
            {
                iconPath: {
                    dark: vscode.Uri.parse(resManager.GetIconByName('Add_16xMD.svg').ToUri()),
                    light: vscode.Uri.parse(resManager.GetIconByName('Add_16xMD.svg').ToUri())
                },
                tooltip: 'Create Target'
            },
            {
                iconPath: {
                    dark: vscode.Uri.parse(resManager.GetIconByName('trash_dark.svg').ToUri()),
                    light: vscode.Uri.parse(resManager.GetIconByName('trash_light.svg').ToUri())
                },
                tooltip: 'Delete Target'
            }
        ];

        pickBox.onDidTriggerButton((e) => {

            // create target
            if (e.tooltip === pickBox.buttons[0].tooltip) {
                this.createTargetIn(prj);
            }

            // delete target
            if (e.tooltip === pickBox.buttons[1].tooltip) {
                this.deleteTargetsIn(prj);
            }

            pickBox.hide();
            pickBox.dispose();
        });

        let curItem: vscode.QuickPickItem | undefined;

        pickBox.onDidChangeSelection((items: readonly vscode.QuickPickItem[]) => {
            curItem = items.length > 0 ? items[0] : undefined;
        });

        pickBox.onDidAccept(() => {

            if (curItem !== undefined) {
                const targetName = curItem.label;
                // switch target
                if (targetName) {
                    prj.switchTarget(targetName);
                }
            }

            pickBox.hide();
            pickBox.dispose();
        });

        pickBox.show();
    }

    async showQuickPickAndSwitchActiveProject() {

        const selections: vscode.QuickPickItem[] = [];

        this.dataProvider.foreachProject((proj) => {
            selections.push(<any>{
                uid: proj.getUid(),
                label: proj.getProjectName(),
                description: `uid: ${proj.getUid()}`,
                detail: `loc: ${proj.getWorkspaceFile().path}`
            });
        });

        if (selections.length > 0) {

            const result: any = await vscode.window.showQuickPick(selections, {
                title: `Switch Active Project`,
                canPickMany: false,
            });

            if (result) {
                const idx = this.dataProvider.getIndexByProjectUid(result.uid);
                if (idx != -1) {
                    const acvtiveProj = this.dataProvider.getActiveProject();
                    if (acvtiveProj && result.uid == acvtiveProj.getUid()) return;
                    this.dataProvider.setActiveProject(idx);
                }
            }
        }
    }

    openHistoryRecords() {

        const records: vscode.QuickPickItem[] = this.dataProvider
            .getRecords()
            .map((record) => {
                return <vscode.QuickPickItem>{
                    label: NodePath.basename(record, '.code-workspace'),
                    detail: record
                };
            });

        vscode.window.showQuickPick(records.reverse(), {
            canPickMany: false,
            placeHolder: `Found ${records.length} results, select one to open`,
            matchOnDescription: false,
            matchOnDetail: true,
            ignoreFocusOut: false
        }).then((item: vscode.QuickPickItem | undefined) => {
            if (item !== undefined && item.detail) {
                this.dataProvider.OpenProject(item.detail);
            }
        });
    }

    clearAllHistoryRecords() {
        this.dataProvider.clearAllRecords();
    }

    notifyUpdateOutputFolder(prj: AbstractProject) {
        const item = this.dataProvider.treeCache.getTreeItem(prj, TreeItemType.OUTPUT_FOLDER);
        if (item) {
            this.dataProvider.UpdateView(item);
        }
    }

    saveProject(prjItem?: ProjTreeItem) {

        const prj = this.getProjectByTreeItem(prjItem);

        if (prj === undefined) {
            GlobalEvent.show_msgbox('Warning', 'No active project !');
            return;
        }

        prj.Save();
    }

    /** 统一的操作互斥锁: 取代原先 6 处各自为政的布尔标志(_builderLock/_uploadLock/installLocked/exportLocked/install_lock) */
    private readonly _opLock = new OperationLock();
    async buildProject(prj?: AbstractProject, options?: BuildOptions, noTerminal?: boolean): Promise<{ success: boolean; message: string; }> {

        if (prj === undefined) {
            GlobalEvent.show_msgbox('Warning', 'No active project !');
            return {
                success: false,
                message: 'No active project !'
            };
        }

        if (this._opLock.isLocked(OpLockKeys.Build)) {
            GlobalEvent.show_msgbox('Warning', 'Builder busy ! Please wait !');
            return {
                success: false,
                message: 'Builder busy ! Please wait !'
            };
        }

        try {
            this._opLock.tryAcquire(OpLockKeys.Build);

            // save project before build
            prj.Save(true);

            const builder = CodeBuilder.NewBuilder(prj);
            const toolchain = prj.getToolchain().name;

            const res = await new Promise<{ success: boolean; message: string; }>((resolve) => {
                if (noTerminal) {
                    const commandLine = builder.genBuildCommand(options);
                    if (commandLine) {
                        // launched
                        if (this.compiler_diags.has(prj.getUid())) {
                            this.compiler_diags.get(prj.getUid())?.clear();
                        }
                        const buildbar = StatusBarManager.getInstance().get('build');
                        if (buildbar) {
                            buildbar.text = `$(loading~spin) Building`;
                        }
                        child_process.exec(commandLine, { cwd: prj.getProjectRoot().path }, (error, stdout, stderr) => {
                            prj.notifyUpdateSourceRefs(toolchain);
                            this.notifyUpdateOutputFolder(prj);
                            this.updateCompilerDiagsAfterBuild(prj);
                            this.dataProvider.updateStatusBarForActiveProjects();
                            hooks.onProjectBuildFinished(prj, error ? false : true);
                            if (error) {
                                resolve({
                                    success: false,
                                    message: `Failed.\n\nError: ${error.message}\n\nBuilder log:\n\n${stdout.toString()}`
                                });
                            } else {
                                resolve({
                                    success: true,
                                    message: `Succeed.\n\nBuilder log:\n\n${stdout.toString()}`
                                });
                            }
                        });
                    } else {
                        resolve({
                            success: false,
                            message: 'Error: builder.genBuildCommand return null.'
                        });
                    }
                } else {
                    // build launched event
                    builder.on('launched', () => {
                        if (this.compiler_diags.has(prj.getUid())) {
                            this.compiler_diags.get(prj.getUid())?.clear();
                        }
                        const buildbar = StatusBarManager.getInstance().get('build');
                        if (buildbar) {
                            buildbar.text = `$(loading~spin) Building`;
                        }
                    });

                    // build finish event
                    builder.on('finished', (done) => {
                        prj.notifyUpdateSourceRefs(toolchain);
                        this.notifyUpdateOutputFolder(prj);
                        this.updateCompilerDiagsAfterBuild(prj);
                        if (options?.flashAfterBuild && done)
                            this.programFlashProject(prj);
                        this.dataProvider.updateStatusBarForActiveProjects();
                        hooks.onProjectBuildFinished(prj, done);
                        if (done) {
                            resolve({
                                success: true,
                                message: 'Succeed.'
                            });
                        } else {
                            resolve({
                                success: false,
                                message: 'Failed.'
                            });
                        }
                    });

                    // start build
                    builder.build(options);

                    this._opLock.release(OpLockKeys.Build);
                }
            });

            this._opLock.release(OpLockKeys.Build);
            return res;

        } catch (error) {
            this._opLock.release(OpLockKeys.Build);
            GlobalEvent.emit('error', error);
            return {
                success: false,
                message: `${ExceptionToMessage(error).type}:${ExceptionToMessage(error).content}`
            };
        }
    }

    private parseLdLogs(file: File): {content: string, idx: number}[] {

        const logLines: {content: string, idx: number}[] = [];

        try {

            const fileLines = file.Read().split(/\r\n|\n/);

            let logStarted = false;
            let logEnd = false;

            fileLines.forEach((line, idx) => {

                if (logEnd)
                    return;

                if (!logStarted) {
                    if (line.startsWith('>>> ld')) {
                        logStarted = true;
                    }
                } else {
                    if (line.startsWith('>>>')) {
                        logEnd = true;
                    } else {
                        logLines.push({
                            content: line,
                            idx
                        });
                    }
                }
            });

        } catch (error) {
            // nothing todo
        }

        return logLines;
    }

    private updateCompilerDiagsAfterBuild(prj: AbstractProject) {

        let diag_res: CompilerDiagnostics | undefined;

        const logFile = File.from(prj.getOutputFolder().path, 'compiler.log');

        try {

            switch (prj.getToolchain().name) {
                case 'IAR_ARM':
                case 'IAR_STM8':
                    diag_res = parseIarCompilerLog(prj, logFile);
                    break;
                case 'Keil_C51':
                    diag_res = parseKeilc51CompilerLog(prj, logFile);
                    break;
                case 'AC5':
                    diag_res = parseArmccCompilerLog(prj, logFile);
                    break;
                case 'SDCC':
                case 'GNU_SDCC_MCS51':
                    diag_res = parseSdccCompilerLog(prj, logFile);
                    break;
                case 'COSMIC_STM8':
                    diag_res = parseCosmicStm8CompilerLog(prj, logFile);
                    break;
                default:
                    diag_res = parseGccCompilerLog(prj, logFile);
                    break;
            }

        } catch (error) {
            GlobalEvent.log_warn(error);
        }

        if (isGccFamilyToolchain(prj.toolchainName())) {
            // examples:
            //  >>> ld
            //  ....
            //  warning: _getpid is not implemented and will always fail
            const allStubs = [
                '_chown', '_execve', '_fork', '_fstat', '_getpid',
                '_gettimeofday', '_isatty', '_kill', '_link', '_lseek',
                '_open', '_close', '_read', '_readlink', '_stat', '_symlink', '_times', '_unlink', '_wait', '_write',
            ];
            const missedStubs: {name: string, lineIdx: number}[] = [];

            this.parseLdLogs(logFile).forEach(line => {
                const m = /warning: (\w+) is not implemented and will always fail/.exec(line.content);
                if (m && m.length > 1) {
                    const name = m[1];
                    if (allStubs.includes(name))
                        missedStubs.push({ name, lineIdx: line.idx });
                }
            });

            if (missedStubs.length > 0) {
                if (diag_res == undefined)
                    diag_res = {};
                const diags: vscode.Diagnostic[] = [];
                for (const ele of missedStubs) {
                    const range = new vscode.Range(
                        new vscode.Position(ele.lineIdx, 0),
                        new vscode.Position(ele.lineIdx, 54));
                    const diag = new vscode.Diagnostic(range,
                        `warning: ${ele.name} is not implemented and will always fail`, 
                        vscode.DiagnosticSeverity.Warning);
                    diag.source = "eide";
                    diag.code = EideDiagnosticCode.GCC_SYS_STUB_MISSED;
                    diags.push(diag);
                }
                diag_res[logFile.path] = diags;
            }
        }

        if (diag_res) {

            const uid = prj.getUid();

            let cc_diags: vscode.DiagnosticCollection;

            if (this.compiler_diags.has(uid)) {
                cc_diags = <any>this.compiler_diags.get(uid);
            } else {
                cc_diags = vscode.languages.createDiagnosticCollection(prj.getProjectName());
                this.compiler_diags.set(uid, cc_diags);
            }

            for (const path in diag_res) {
                const uri = vscode.Uri.file(path);
                cc_diags.set(uri, diag_res[path]);
            }
        }
    }

    buildWorkspace(rebuild?: boolean) {

        if (this.dataProvider.getProjectCount() == 0) {
            GlobalEvent.show_msgbox('Warning', 'No project is opened !');
            return;
        }

        const cmdList: BuildCommandInfo[] = [];

        this.dataProvider.foreachProject((project, index) => {

            const projectName = project.GetConfiguration().config.name;

            const buildCfg: BuildCommandInfo = {
                title: `build '${projectName}'`,
                command: ''
            };

            /* get project order */
            const envConfig = project.getProjectRawEnv();
            const targetName = project.getCurrentTarget().toLowerCase();
            if (envConfig) {
                /////////////////////////////
                // prj build order
                let cfgName = 'EIDE_BUILD_ORDER';
                // parse global config
                if (envConfig[cfgName]) {
                    buildCfg.order = parseInt(envConfig[cfgName]);
                }
                // parse target config
                if (envConfig[targetName] &&
                    envConfig[targetName][cfgName]) {
                    buildCfg.order = parseInt(envConfig[targetName][cfgName]);
                }
                /////////////////////////////
                // ignore if failed ?
                cfgName = 'EIDE_BUILD_SKIP_IF_FAILED';
                // parse global config
                if (envConfig[cfgName]) {
                    buildCfg.ignoreFailed = (parseInt(envConfig[cfgName])) === 1;
                }
                // parse target config
                if (envConfig[targetName] &&
                    envConfig[targetName][cfgName]) {
                    buildCfg.ignoreFailed = (parseInt(envConfig[targetName][cfgName])) === 1;
                }
            }

            // make default order is 100
            if (buildCfg.order == undefined ||
                buildCfg.order == null ||
                Number.isNaN(buildCfg.order)) {
                buildCfg.order = 100;
            }

            /* gen command */
            const builder = CodeBuilder.NewBuilder(project);
            const cmdLine = builder.genBuildCommand({ notRebuild: !rebuild });
            if (cmdLine) {
                buildCfg.command = cmdLine || '';
                cmdList.push(buildCfg);
            }
        });

        /* gen params file */
        const paramsFile = File.fromArray([os.tmpdir(), `eide-ws-params.tmp`]);
        paramsFile.Write(JSON.stringify(cmdList));

        /* launch: Go 版构建器的 -r 命令运行器模式(原生 exe,直接调用) */
        const goBuilderExe = ResManager.instance().getGoUnifyBuilderExe();
        if (!goBuilderExe.IsFile()) {
            GlobalEvent.show_msgbox('Error',
                `unify_builder-go not found: ${goBuilderExe.path} (extension res damaged, please reinstall)`);
            return;
        }
        const commandLine = CmdLineHandler.getCommandLine(goBuilderExe.path, ['-r', paramsFile.path]);
        sendCommandToTerminal('build workspace', commandLine);
    }

    openWorkspaceConfig() {
        try {
            const wsFile = WorkspaceManager.getInstance().getWorkspaceFile();
            if (wsFile == undefined) { throw new Error('No workspace opened !'); }
            const uri = vscode.Uri.parse(wsFile.ToUri());
            vscode.window.showTextDocument(uri, { preview: true });
        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }
    }

    async cleanProject(prj?: AbstractProject, noTerminal?: boolean): Promise<{ success: boolean; message: string; }> {

        if (prj === undefined) {
            GlobalEvent.show_msgbox('Warning', 'No active project !');
            return {
                success: false,
                message: 'No active project !'
            }
        }

        return new Promise((resolve) => {

            if (noTerminal) {
                const outDir = prj.ToAbsolutePath(prj.getOutputDir());
                let commandLine: string;
                if (os.platform() == 'win32') {
                    commandLine = `cmd /E:ON /C del /S /Q "${outDir}"`;
                } else {
                    if (outDir == '/' || outDir == userhome()) {
                        resolve({
                            success: false,
                            message: `Cannot delete ${outDir} !`
                        });
                        return;
                    } else {
                        commandLine = `rm -rf -v "${outDir}"`;
                    }
                }
                child_process.exec(commandLine, { cwd: prj.getProjectRoot().path }, (error, stdout, stderr) => {
                    this.notifyUpdateOutputFolder(prj);
                    if (error) {
                        resolve({
                            success: false,
                            message: `Failed.\n\nError: ${error.message}\n\n${stdout.toString()}\n${stderr.toString()}`
                        });
                    } else {
                        resolve({
                            success: true,
                            message: `Succeed.\n\n${stdout.toString()}`
                        });
                    }
                });
            } else {
                const outDir = prj.ToAbsolutePath(prj.getOutputDir());
                if (os.platform() == 'win32') {
                    sendCommandToTerminal('clean', `cmd /E:ON /C del /S /Q "${outDir}"`);
                } else {
                    if (outDir == '/' || outDir == userhome()) {
                        GlobalEvent.show_msgbox('Error', `Cannot delete ${outDir} !`);
                    } else {
                        sendCommandToTerminal('clean', `rm -rf -v "${outDir}"`);
                    }
                }
                setTimeout(() => {
                    this.notifyUpdateOutputFolder(prj);
                    resolve({
                        success: true,
                        message: ''
                    });
                }, 1500);
            }
        });
    }

    async programFlashProject(prj?: AbstractProject, eraseAll?: boolean, noTerminal?: boolean): Promise<FlashCommandResult | void> {

        if (prj === undefined) {
            GlobalEvent.show_msgbox('Warning', 'No active project !');
            return {
                success: false,
                message: 'No active project !'
            }
        }

        if (this._opLock.isLocked(OpLockKeys.Upload)) {
            GlobalEvent.show_msgbox('Warning', 'Busy ! Please wait.');
            return {
                success: false,
                message: 'Busy ! Please wait.'
            }
        }

        this._opLock.tryAcquire(OpLockKeys.Upload);

        let result: FlashCommandResult | void;
        try {
            const uploader = HexUploaderManager.getInstance().createUploader(prj);
            if (noTerminal)
                uploader.disableTerminal();
            result = await uploader.upload(eraseAll);
        } catch (error) {
            GlobalEvent.emit('error', error);
            result = {
                success: false,
                message: (<Error>error).message,
                error
            };
        }

        this._opLock.release(OpLockKeys.Upload);

        return result;
    }

    compileSingleFile(item: ProjTreeItem) {

        const project = this.getProjectByTreeItem(item);
        if (!project)
            return;
        if (!(item.val.value instanceof File))
            return;

        try {
            const srcPath = item.val.value.path;
            const dbinfo = project.getSourceCompileDatabase(srcPath);
            if (dbinfo) {
                sendCommandToTerminal(`compile: ${NodePath.basename(srcPath)}`, dbinfo.command, {
                    useTerminal: true,
                    cwd: dbinfo.directory
                });
            } else {
                throw Error(`No compile commands for this file: ${srcPath}`);
            }
        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }
    }

    async ExportKeilXml(prjItem: ProjTreeItem) {
        try {
            const prj = this.getProjectByTreeItem(prjItem);
            if (!prj)
                return;

            const matchList: ToolchainName[] = [];

            ToolchainManager.getInstance().getToolchainNameList('ARM')
                .forEach(n => matchList.push(n)); // for Keil Arm
            matchList.push(`Keil_C51`); // for keil C51

            // limit toolchain
            if (!matchList.includes(prj.getToolchain().name)) {
                GlobalEvent.show_msgbox('Warning', `Not support for toolchain '${prj.getToolchain().name}' !`);
                return;
            }

            const prjConfig = prj.GetConfiguration().config;
            const keilSuffix = prjConfig.type === 'C51' ? 'uvproj' : 'uvprojx';
            const defaultUri = vscode.Uri.file(NodePath.join(prj.GetRootDir().path, `${prjConfig.name}.${keilSuffix}`));

            const uri = await vscode.window.showSaveDialog({
                defaultUri: defaultUri,
                filters: { 'Keil Project': [keilSuffix] }
            });
            if (!uri) return;

            // warn if the chosen save path is on a different drive from the project root;
            // in that case, cross-drive paths cannot be made relative and will be written as absolute paths
            const saveDrive = NodePath.parse(uri.fsPath).root.toLowerCase();
            const prjDrive = NodePath.parse(prj.GetRootDir().path).root.toLowerCase();
            if (saveDrive !== prjDrive) {
                GlobalEvent.show_msgbox('Warning', view_str$keil_export_path_warning
                    .replace('{0}', saveDrive)
                    .replace('{1}', prjDrive));
            }

            const xmlFile = prj.ExportToKeilProject(new File(uri.fsPath));

            if (xmlFile) {
                GlobalEvent.show_msgbox('Info', export_keil_xml_ok + prj.toRelativePath(xmlFile.path));
            } else {
                GlobalEvent.show_msgbox('Warning', export_keil_xml_failed);
            }
        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }
    }

    InstallKeilPackage(prjIndex: number) {

        if (this._opLock.isLocked(OpLockKeys.InstallPackage)) {
            GlobalEvent.show_msgbox('Warning', 'Busy !, Please wait for the current operation to complete !');
            return;
        }

        this._opLock.tryAcquire(OpLockKeys.InstallPackage);
        const prj = this.dataProvider.GetProjectByIndex(prjIndex);

        if (prj.GetConfiguration().config.type !== 'ARM') { // only for ARM project
            GlobalEvent.show_msgbox('Warning', not_support_no_arm_project);
            this._opLock.release(OpLockKeys.InstallPackage);
            return;
        }

        if (prj.GetPackManager().GetPack()) {
            GlobalEvent.show_msgbox('Warning', 'You should uninstall old package before install a new one !');
            this._opLock.release(OpLockKeys.InstallPackage);
            return;
        }

        vscode.window.withProgress<void>({
            location: vscode.ProgressLocation.Notification,
            title: `Installing cmsis package`
        }, (progress) => {
            return new Promise(async (resolve_) => {

                const resolve = () => {
                    this._opLock.release(OpLockKeys.InstallPackage);
                    resolve_();
                };

                try {

                    progress.report({ message: 'preparing ...' });

                    let packFile: File;

                    const insType = await vscode.window.showQuickPick<vscode.QuickPickItem>([
                        {
                            label: 'From Repo',
                            detail: 'Download cmsis pack from the repository and install'
                        },
                        {
                            label: 'From Disk',
                            detail: 'Select cmsis pack file from your computer and install'
                        }
                    ], {
                        placeHolder: `Select an installation type. Press 'Esc' to exit`,
                        canPickMany: false,
                        ignoreFocusOut: true
                    });

                    if (insType === undefined) { // canceled, exit
                        resolve();
                        return;
                    }

                    // download from internet
                    if (insType.label == 'From Repo') {

                        progress.report({ message: 'waiting download task done ...' });

                        const res = await this.startDownloadCmsisPack();

                        if (res === undefined) { // canceled, exit
                            resolve();
                            return;
                        }

                        if (res instanceof Error) {
                            GlobalEvent.show_msgbox('Warning', res);
                            resolve();
                            return;
                        }

                        packFile = res;
                    }

                    // from disk
                    else {
                        const urls = await vscode.window.showOpenDialog({
                            defaultUri: vscode.Uri.file(prj.GetRootDir().path),
                            canSelectFolders: false,
                            canSelectFiles: true,
                            openLabel: install_this_pack,
                            filters: {
                                'Cmsis Package': ['pack']
                            }
                        });

                        if (urls === undefined) { // canceled, exit
                            resolve();
                            return;
                        }

                        packFile = new File(urls[0].fsPath);
                    }

                    await prj.InstallPack(packFile, (_progress, msg) => {
                        progress.report({
                            increment: _progress ? 12 : undefined,
                            message: msg
                        });
                    });

                    resolve();

                } catch (error) {
                    GlobalEvent.show_msgbox('Warning', error);
                    resolve();
                }
            });
        });
    }

    private async startDownloadCmsisPack(): Promise<File | Error | undefined> {

        // URL: https://api.github.com/repos/github0null/eide-cmsis-pack/contents/packages
        const repoUrl = redirectHost('api.github.com/repos/' + SettingManager.GetInstance().getCmsisPackRepositoryUrl());

        return await vscode.window.withProgress<File | Error | undefined>({
            location: vscode.ProgressLocation.Notification,
            title: `Download cmsis package`
        }, async (progress, cancelToken) => {

            progress.report({ message: `reading package list ...` });

            const pkgList = await readGithubRepoFolder(repoUrl);
            if (pkgList instanceof Error) {
                return pkgList;
            }

            progress.report({ message: `waiting cmsis package selection ...` });

            const itemList: vscode.QuickPickItem[] = pkgList
                .filter((inf) => inf.type == 'file')
                .map((fileInfo) => {
                    return {
                        label: fileInfo.name,
                        detail: `Size: ${(fileInfo.size / 1000000).toFixed(1)} MB, Sha: ${fileInfo.sha}`,
                        val: fileInfo
                    };
                });

            const item: any = await vscode.window.showQuickPick(itemList, {
                placeHolder: `Found ${pkgList.length} packages, select one to install. Press 'Esc' to exit`,
                canPickMany: false,
                ignoreFocusOut: true,
                matchOnDescription: true
            });

            if (item == undefined) { // user canceled
                return undefined;
            }

            try {

                const gitFileInfo: GitFileInfo = item.val;
                let packageFile: File | undefined;

                const resManager = ResManager.GetInstance();
                const packDir = File.fromArray([resManager.getEideHomeFolder().path, 'pack', 'cmsis']);
                packDir.CreateDir(true);

                // read cache
                const cache = new FileCache(packDir);
                packageFile = cache.get(gitFileInfo.name, gitFileInfo.sha);
                if (packageFile) { // found cache, use it
                    return packageFile;
                }

                // download it
                progress.report({ message: `initializing download '${gitFileInfo.name}' ...` });

                if (gitFileInfo.download_url == undefined) {
                    return new Error(`Can't download '${gitFileInfo.name}', not download url found !`);
                }

                const url = redirectHost(gitFileInfo.download_url);
                const buff = await downloadFileWithProgress(url, gitFileInfo.name, progress, cancelToken);

                if (buff == undefined) { // canceled
                    return undefined;
                }

                if (buff instanceof Error) {
                    return buff;
                }

                // save file
                packageFile = File.fromArray([packDir.path, gitFileInfo.name]);
                fs.writeFileSync(packageFile.path, buff);

                // add to cache
                const sha = genGithubHash(buff);
                cache.add(packageFile.name, sha);
                cache.save();

                return packageFile;

            } catch (error) {
                return error;
            }
        });
    }

    async ExportMakefile(prjItem?: ProjTreeItem) {

        const prj = this.getProjectByTreeItem(prjItem);

        if (prj === undefined) {
            GlobalEvent.show_msgbox('Error', 'No active project !');
            return;
        }
        if (this._opLock.isLocked(OpLockKeys.Build)) {
            GlobalEvent.show_msgbox('Error', 'builder busy !, please wait !');
            return;
        }

        // gen command line
        prj.Save(true);
        const builder = CodeBuilder.NewBuilder(prj);
        const cmdLine = builder.genBuildCommand({ otherArgs: ['--out-makefile', '--dry-run'] });
        if (cmdLine === undefined) {
            GlobalEvent.show_msgbox('Error', `Fail to generate build command`);
            return;
        }

        // do export

        vscode.window.withProgress({
            title: `Export Makefile`,
            location: vscode.ProgressLocation.Notification
        }, (progress, cancel) => {
            return new Promise<boolean>((resolve) => {
                const proc = new ExeCmd();
                let errLines: string[] = [`Execute: ${cmdLine}`];
                proc.on('launch', () => {
                    progress.report({ message: 'Running ...' });
                    GlobalEvent.log_info(`Export Makefile: ${cmdLine}`);
                });
                proc.on('line', str => {
                    errLines.push(str);
                    progress.report({ message: str });
                });
                proc.on('close', exitInfo => {
                    if (exitInfo.code == 0) {
                        progress.report({ message: 'All Done.' });
                        setTimeout(() => resolve(true), 1000);
                    } else {
                        resolve(false);
                        GlobalEvent.show_msgbox('Error', `Fail to export Makefile, code=${exitInfo.code}`);
                        if (errLines.length > 0) {
                            GlobalEvent.log_warn(errLines.slice(-100).join(os.EOL));
                        }
                    }
                });
                cancel?.onCancellationRequested(_ => {
                    if (!kill(<number>proc.pid())) {
                        GlobalEvent.show_msgbox('Error', `Can not kill process: ${proc.pid()} !`);
                    }
                });
                proc.Run(<string>cmdLine, undefined, { cwd: prj.getProjectRoot().path });
            });
        });
    }

    async ExportProjectTemplate(prjItem?: ProjTreeItem, isWorkspace?: boolean) {

        if (this._opLock.isLocked(OpLockKeys.Export)) {
            GlobalEvent.show_msgbox('Warning', 'Busy, please try again later !');
            return;
        }

        this._opLock.tryAcquire(OpLockKeys.Export);

        try {
            let templateName = isWorkspace ? WorkspaceManager.getInstance().getWorkspaceRoot()?.name : undefined;
            let rootDir = isWorkspace ? WorkspaceManager.getInstance().getWorkspaceRoot() : undefined;
            let tmp_suffix = isWorkspace ? 'ewt' : 'ept';
            let resIgnoreList: string[] = [];

            const defExcludeList: string[] = [
                '*.eide-template',
                '*.log',
                '*.ept',
                `${AbstractProject.EIDE_DIR}${File.sep}*.db3`,
                `${AbstractProject.EIDE_DIR}${File.sep}*.dat`,
            ];

            defExcludeList.push('.clangd'); // clangd 配置生成器常开,导出时排除其配置目录

            // if this is a project, prehandle it
            let prj: AbstractProject | undefined;
            if (prjItem && isWorkspace == undefined) {
                prj = this.dataProvider.GetProjectByIndex(prjItem.val.projectIndex);
                const prjConfig = prj.GetConfiguration().config;
                rootDir = prj.GetRootDir();
                templateName = prjConfig.name;
                tmp_suffix = 'ept';
                const prjOutFolder = File.normalize(prj.GetConfiguration().config.outDir);
                defExcludeList.push(`${prjOutFolder}`, `${prjOutFolder}${File.sep}*`);
                resIgnoreList = prj.readIgnoreList();
            }

            /* invalid root folder, exit */
            if (rootDir == undefined) {
                this._opLock.release(OpLockKeys.Export);
                return;
            }

            const prjRootDir = <File>rootDir;
            const distDir = <File>rootDir;
            const tFile: File = File.fromArray([distDir.path, `${templateName}.${tmp_suffix}`]);

            // delete old template file
            if (tFile.IsFile()) {
                fs.unlinkSync(tFile.path);
            }

            const option: CompressOption = {
                zipType: '7z',
                fileName: tFile.name,
                excludeList: ArrayDelRepetition(defExcludeList.concat(resIgnoreList))
            };

            const compresser = new SevenZipper(ResManager.GetInstance().Get7zDir());

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: isWorkspace ? `Packing workspace` : `Packing project`,
                cancellable: false
            }, (progress, __): Thenable<Error | void> => {
                return new Promise(async (resolve) => {

                    progress.report({ message: 'zipping ...' });

                    const err = await compresser.Zip(prjRootDir, option, distDir);
                    if (err) {
                        GlobalEvent.show_msgbox('Warning', err);
                    } else {
                        progress.report({ message: 'export done !' });
                    }

                    setTimeout(() => resolve(err), 1500);
                });
            });

            if (prj) { // save prj
                prj.Save();
            }

        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }

        this._opLock.release(OpLockKeys.Export);
    }

    async ShowProjectVariables(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async AddSrcDir(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);

        const folderType = await vscode.window.showQuickPick<vscode.QuickPickItem>(
            [
                {
                    label: view_str$project$folder_type_virtual,
                    detail: view_str$project$folder_type_virtual_desc
                },
                {
                    label: view_str$project$folder_type_fs,
                    detail: view_str$project$folder_type_fs_desc
                }
            ],
            {
                placeHolder: view_str$project$sel_folder_type
            });

        if (folderType === undefined) {
            return;
        }

        // add folder from filesystem
        if (folderType.label === view_str$project$folder_type_fs) {

            const folderList = await vscode.window.showOpenDialog({
                canSelectMany: true,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: view_str$dialog$add_to_source_folder,
                defaultUri: vscode.Uri.file(prj.GetRootDir().path),
            });

            if (folderList && folderList.length > 0) {
                for (const folderUri of folderList) {
                    const res = prj.getNormalSourceManager().verify(folderUri.fsPath);
                    if (!res.valid) {
                        GlobalEvent.show_msgbox(`Warning`, res.message);
                        continue;
                    }
                    prj.GetConfiguration().AddSrcDir(folderUri.fsPath);
                }
            }
        }

        // add root virtual folder
        else {

            const folderName = await vscode.window.showInputBox({
                placeHolder: 'Input a folder name',
                ignoreFocusOut: true,
                validateInput: (input) => {
                    if (!this.vFolderNameMatcher.test(input)) {
                        return `must match '${this.vFolderNameMatcher.source}'`;
                    }
                }
            });

            if (folderName) {
                prj.getVirtualSourceManager().addFolder(folderName);
            }
        }
    }

    async RemoveSrcDir(item: ProjTreeItem) {

        if (!(item.val.obj instanceof File)) {
            return;
        }

        const srcDir = item.val.obj;

        const answer = await vscode.window.showInformationMessage(view_str$prompt$removeSrcDir.replace('{}', srcDir.path), txt_yes, txt_no);
        if (answer == txt_yes) {
            const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
            prj.GetConfiguration().RemoveSrcDir(srcDir.path);
        }
    }

    async refreshSrcRoot(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);

        switch (item.type) {
            case TreeItemType.OUTPUT_FOLDER:
                this.notifyUpdateOutputFolder(prj);
                break;
            case TreeItemType.V_FOLDER_ROOT:
                prj.refreshSourceRoot((<VirtualFolderInfo>item.val.obj).path);
                break;
            default:
                if (typeof item.val.value === 'string') {
                    prj.refreshSourceRoot(<string>item.val.value);
                }
                break;
        }
    }

    // virtual source

    async Virtual_folderAddFile(item: ProjTreeItem) {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async Virtual_folderAdd(item: ProjTreeItem) {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const curFolder = <VirtualFolderInfo>item.val.obj;

        const folderName = await vscode.window.showInputBox({
            placeHolder: 'Input a folder name',
            ignoreFocusOut: true,
            validateInput: (input) => {
                if (!this.vFolderNameMatcher.test(input)) {
                    return `must match '${this.vFolderNameMatcher.source}'`;
                }
            }
        });

        if (folderName) {
            project.getVirtualSourceManager().addFolder(folderName, curFolder.path);
        }
    }

    async Virtual_removeFolder(item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const project = this.dataProvider.GetProjectByIndex(folderItem.val.projectIndex);
            const curFolder = <VirtualFolderInfo>folderItem.val.obj;

            const answer = await vscode.window.showInformationMessage(view_str$prompt$removeSrcDir.replace('{}', curFolder.path), txt_yes, txt_no);
            if (answer == txt_yes) {
                project.getVirtualSourceManager().removeFolder(curFolder.path);
            }
        }
    }

    async Virtual_renameFolder(item: ProjTreeItem) {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const curFolder = <VirtualFolderInfo>item.val.obj;

        const folderName = await vscode.window.showInputBox({
            prompt: 'Input the new name',
            ignoreFocusOut: true,
            value: curFolder.vFolder.name,
            validateInput: (input) => {
                if (!this.vFolderNameMatcher.test(input)) { return `must match '${this.vFolderNameMatcher.source}'`; }
                return undefined;
            }
        });

        if (folderName) {
            project.getVirtualSourceManager().renameFolder(curFolder.path, folderName);
        }
    }

    async Virtual_removeFile(item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const fileItem of items) {
            const project = this.dataProvider.GetProjectByIndex(fileItem.val.projectIndex);
            const curFile = <VirtualFileInfo>fileItem.val.obj;
            project.getVirtualSourceManager().removeFile(curFile.path);
        }
    }

    // filesystem folder

    async fs_folderAddFile(item: ProjTreeItem) {

        const folderPath = item.val.obj.path;

        const fName = await vscode.window.showInputBox({
            placeHolder: 'Input a file name',
            ignoreFocusOut: true
        });

        if (fName) {
            try {
                const filePath = folderPath + File.sep + fName;
                if (!File.IsFile(filePath)) { fs.writeFileSync(filePath, ''); }
            } catch (error) {
                GlobalEvent.show_msgbox('Warning', error);
            }
        }
    }

    async fs_folderAdd(item: ProjTreeItem) {

        const folderPath = item.val.obj.path;

        const folderName = await vscode.window.showInputBox({
            placeHolder: 'Input a folder name',
            ignoreFocusOut: true
        });

        if (folderName) {
            try {
                fs.mkdirSync(folderPath + File.sep + folderName);
            } catch (error) {
                GlobalEvent.show_msgbox('Warning', error);
            }
        }
    }

    private async modifyExtraCompilerArgs_forFile(project: AbstractProject, item: ProjTreeItem) {
        const isChinese = getLocalLanguageType() == LanguageIndexs.Chinese;

        let fspath: string | undefined;
        let virtpath: string | undefined;

        if (item.type === TreeItemType.V_FILE_ITEM) {
            virtpath = (<VirtualFileInfo>item.val.obj).path;
        }

        if (item.val.value instanceof File) { // if value is a file, use it
            fspath = project.toRelativePath(item.val.value.path);
        }

        if (!fspath)
            return;

        const extraArgs = project.getSourceExtraArgsCfg();
        if (!extraArgs)
            return;

        const argsMap    = project.getExtraArgsForSource(fspath, virtpath, extraArgs);
        const absPattern = project.getExtraArgsAbsPatternForSource(fspath, virtpath, extraArgs);
        const ccOptions  = absPattern ? (argsMap[absPattern] || '') : '';

        // merge all inherited args
        let inheritedArgs: string = '';
        for (const key in argsMap) {
            const val = argsMap[key]?.trim();
            if (key != absPattern && val) {
                inheritedArgs = `${inheritedArgs} ${val}`;
            }
        }
        inheritedArgs = inheritedArgs.trim();

        const ui_cfg: SimpleUIConfig = {
            ref_id: `<file-options>:${fspath}`,
            title: isChinese 
                ? `修改编译选项（文件：${NodePath.basename(fspath)}）`
                : `Modify Compiler Options (file: ${NodePath.basename(fspath)})`,
            items: {},
        };

        // option: isAlwaysInBuild
        let isAlwaysInBuild = false;
        if (extraArgs.alwaysBuildSourceFiles)
            isAlwaysInBuild = extraArgs.alwaysBuildSourceFiles
                .findIndex(p => project.comparePath(p, <string>fspath)) !== -1;
        ui_cfg.items['always_in_build'] = {
            type: 'bool',
            attrs: {},
            name: isChinese ? '总是编译该文件' : 'Always In Build',
            data: <SimpleUIConfigData_boolean>{
                value: isAlwaysInBuild,
                default: isAlwaysInBuild,
            }
        };

        if (inheritedArgs) { // 继承于其他匹配模式
            ui_cfg.items['inherit'] = {
                type: 'input',
                attrs: { readonly: true },
                name: isChinese 
                    ? `继承于其他匹配模式的选项（详见 'files.options.yml' 文件）` 
                    : `Inherited Options (from other pattern, check your 'files.options.yml' file for details !)`,
                data: <SimpleUIConfigData_input>{
                    value: inheritedArgs,
                    default: inheritedArgs
                }
            };
        }

        ui_cfg.items['args'] = {
            type: 'input',
            attrs: {},
            name: isChinese ? '附加编译选项' : 'Append Compiler Options',
            data: <SimpleUIConfigData_input>{
                placeHolder: [
                    `For Append   Options. e.g. " -Os -flto " ...`,
                    `For Replace  Options. e.g. " $<replace:-O1/-O2> " ...`,
                    `For Override Options. e.g. " $<override:-I./include -g -O2 -flto> " ...`,
                ].join(os.EOL),
                value: ccOptions,
                default: ccOptions,
            },
        };

        try {
            const db = project.getSourceCompileDatabase(fspath);
            if (db) {
                ui_cfg.items['current_commands'] = {
                    type: 'input',
                    attrs: { readonly: true },
                    name: isChinese ? `当前编译命令` : `Current Compiler Commands`,
                    data: <SimpleUIConfigData_input>{
                        value: db.command,
                        default: db.command
                    }
                };
            }
        } catch (error) {
            // nothing todo
        }

        // option: memoryAssign
        //   Only for AC5 and AC6 Compiler
        const supportMemeoryAssignment = project.supportArmccMemeoryAssignment();
        if (supportMemeoryAssignment) {

            ui_cfg.items['mem_assign_divider'] = {
                type: 'divider',
                attrs: {},
                name: '',
                data: <SimpleUIConfigData_divider>{}
            };

            ui_cfg.items['mem_assign_tag'] = {
                type: 'text',
                attrs: { style: 'font-weight: bold;' },
                name: '',
                data: <SimpleUIConfigData_text>{
                    subType: 'raw',
                    value: isChinese ? `存储器分配` : `Memory Assignment`
                }
            };

            const toolchainName = project.getToolchain().name;
            if (toolchainName === 'AC6') {
                ui_cfg.items['lto_tip'] = {
                    type: 'text',
                    attrs: {},
                    name: 'LTO_note',
                    data: <SimpleUIConfigData_text>{
                        value: isChinese 
                            ? '请注意：如果启用了LTO，则存储器分配选项会失效。' 
                            : 'Notice: The memory assignment options will not take effect if you enable the LTO. '
                    }
                }
            }

            const toolchainConfig = project.GetConfiguration<ArmBaseCompileData>().config.toolchainConfig;
            const ramLayout = toolchainConfig.storageLayout.RAM;
            const romLayout = toolchainConfig.storageLayout.ROM;

            // Use for config enum. 
            let roList: string[] = ['default'];
            let rwList: string[] = ['default'];

            // Use for config enum Description. 
            let roListDesc: string[] = ['default'];
            let rwListDesc: string[] = ['default'];
            romLayout.forEach((value) => {
                roList.push(getRamRomName(value));
                roListDesc.push(`${getRamRomName(value)} (${getRamRomRange(value)})`);
            });

            ramLayout.forEach((value) => {
                roList.push(getRamRomName(value));
                roListDesc.push(`${getRamRomName(value)} (${getRamRomRange(value)})`);

                rwList.push(getRamRomName(value));
                rwListDesc.push(`${getRamRomName(value)} (${getRamRomRange(value)})`);
            });

            // Find file memory assignment.
            let memoryAssign = undefined;
            if (extraArgs.memoryAssign) {
                for (const filePath in extraArgs.memoryAssign) {
                    if (virtpath && project.comparePath(filePath, <string>virtpath)) {
                        // If item is virtual path, compare with virtual path first.
                        memoryAssign = extraArgs.memoryAssign[filePath];
                        break;
                    } else if (project.comparePath(filePath, <string>fspath)) {
                        // Don't have virtual path, compare with real file path.
                        memoryAssign = extraArgs.memoryAssign[filePath];
                        break;
                    }
                }
            }

            // Show in GUI config. 
            let roValue = 0;
            let rwValue = 0;
            let ziValue = 0;

            if (memoryAssign) {
                if (memoryAssign.RO) {
                    // Assign the RO memory.
                    roValue = roList.indexOf(memoryAssign.RO);
                    // No found, may it contains illegal vaule. Set it default.
                    roValue = roValue === -1 ? 0 : roValue;
                }
                if (memoryAssign.RW) {
                    rwValue = rwList.indexOf(memoryAssign.RW);
                    // No found, may it contains illegal vaule. Set it default.
                    rwValue = rwValue === -1 ? 0 : rwValue;
                }
                if (memoryAssign.ZI) {
                    ziValue = rwList.indexOf(memoryAssign.ZI);
                    // No found, may it contains illegal vaule. Set it default.
                    ziValue = ziValue === -1 ? 0 : ziValue;
                }
            }


            ui_cfg.items['ro_data_assign'] = {
                type: 'options',
                attrs: { style: 'width: 300px;' },
                name: isChinese ? '常量/代码分配' : 'Code / Const Data Assignment',
                data: <SimpleUIConfigData_options>{
                    value: roValue,
                    default: 0,
                    enum: roList,
                    enumDescriptions: roListDesc,
                }
            };

            ui_cfg.items['zi_data_assign'] = {
                type: 'options',
                attrs: { style: 'width: 300px;' },
                name: isChinese ? 'ZI数据分配' : 'Zero Initialized Data Assignment',
                data: <SimpleUIConfigData_options>{
                    value: ziValue,
                    default: 0,
                    enum: rwList,
                    enumDescriptions: rwListDesc,
                }
            };

            ui_cfg.items['rw_data_assign'] = {
                type: 'options',
                attrs: { style: 'width: 300px;' },
                name: isChinese ? '其他数据分配' : 'Other Data Assignment',
                data: <SimpleUIConfigData_options>{
                    value: rwValue,
                    default: 0,
                    enum: rwList,
                    enumDescriptions: rwListDesc,
                }
            };
        }

        WebPanelManager.instance().showSimpleConfigUI(ui_cfg, async (new_cfg) => {

            const nArgs = (<SimpleUIConfigData_input>new_cfg.items['args'].data).value.replace(/\r\n|\n/g, ' ').trim();

            let pattern: string;

            if (virtpath) {
                pattern = virtpath;
            } else {
                pattern = project.toRelativePath(<string>fspath)
                    .replace(/\.\.\//g, '')
                    .replace(/\.\//g, '');
            }

            let category: string = 'files';
            let fileOptions: any = extraArgs;

            if (virtpath) {
                category = 'virtualPathFiles';
            }

            if (!fileOptions[category])
                fileOptions[category] = {};

            if (nArgs) {
                fileOptions[category][pattern] = nArgs;
            } else {
                if (fileOptions[category][pattern] != undefined)
                    delete fileOptions[category][pattern];
            }

            // option: always in build
            const isAlwaysInBuild = (<SimpleUIConfigData_boolean>new_cfg.items['always_in_build'].data).value;
            let alwaysBuildSourceFiles: string[] = fileOptions.alwaysBuildSourceFiles || [];
            if (isAlwaysInBuild) {
                alwaysBuildSourceFiles.push(<string>fspath);
            } else {
                const idx = alwaysBuildSourceFiles.findIndex(p => project.comparePath(p, <string>fspath));
                if (idx !== -1) {
                    alwaysBuildSourceFiles.splice(idx, 1);
                }
            }
            alwaysBuildSourceFiles = ArrayDelRepetition(alwaysBuildSourceFiles);
            fileOptions.alwaysBuildSourceFiles = alwaysBuildSourceFiles.length > 0 ? alwaysBuildSourceFiles : undefined;

            // option: memoryAssign
            //   Only for AC5 and AC6 Compiler
            if (supportMemeoryAssignment) {
                let memoryAssign = extraArgs.memoryAssign || {};

                let new_cfg_item = <SimpleUIConfigData_options>new_cfg.items['ro_data_assign'].data;
                const roAssign = new_cfg_item.value;
                if (roAssign) {
                    // Create item when it not exist. 
                    memoryAssign[pattern] = memoryAssign[pattern] || {};
                    memoryAssign[pattern].RO = new_cfg_item.enum[roAssign];
                } else {
                    // If RO assign is empty, remove it.
                    if (memoryAssign[pattern] && memoryAssign[pattern].RO) {
                        delete memoryAssign[pattern].RO;
                    }
                }

                new_cfg_item = <SimpleUIConfigData_options>new_cfg.items['zi_data_assign'].data;
                const ziAssign = new_cfg_item.value;
                if (ziAssign) {
                    // Create item when it not exist. 
                    memoryAssign[pattern] = memoryAssign[pattern] || {};
                    memoryAssign[pattern].ZI = new_cfg_item.enum[ziAssign];
                } else {
                    // If ZI assign is empty, remove it.
                    if (memoryAssign[pattern] && memoryAssign[pattern].ZI) {
                        delete memoryAssign[pattern].ZI;
                    }
                }

                new_cfg_item = <SimpleUIConfigData_options>new_cfg.items['rw_data_assign'].data;
                const rwAssign = new_cfg_item.value;
                if (rwAssign) {
                    // Create item when it not exist. 
                    memoryAssign[pattern] = memoryAssign[pattern] || {};
                    memoryAssign[pattern].RW = new_cfg_item.enum[rwAssign];
                } else {
                    // If RW assign is empty, remove it.
                    if (memoryAssign[pattern] && memoryAssign[pattern].RW) {
                        delete memoryAssign[pattern].RW;
                    }
                }

                if (memoryAssign[pattern] && Object.keys(memoryAssign[pattern]).length === 0) {
                    delete memoryAssign[pattern]; // remove empty assign
                }

                if (extraArgs.memoryAssign === undefined && Object.keys(memoryAssign).length > 0) {
                    // Create memoryAssign when it not exist and has assigned memory.
                    extraArgs.memoryAssign = memoryAssign;
                }

                if (extraArgs.memoryAssign && Object.keys(extraArgs.memoryAssign).length === 0) {
                    // Remove memoryAssign when it is empty.
                    delete extraArgs.memoryAssign;
                }
            }

            project.setSourceExtraArgsCfg(extraArgs);
            project.onSourceCompilerOptionsChanged();

            // update explorer
            if (virtpath) {
                project.getVirtualSourceManager().notifyUpdateFile(<string>virtpath);
            } else {
                project.getNormalSourceManager().notifyUpdateFile(project.toAbsolutePath(<string>fspath));
            }
        });
    }

    private async modifyExtraCompilerArgs_forFolder(project: AbstractProject, item: ProjTreeItem) {

        let folderpath: string | undefined;
        let isVirtpath: boolean | undefined;
        const isChinese = getLocalLanguageType() == LanguageIndexs.Chinese;

        if (item.type == TreeItemType.V_FOLDER ||
            item.type == TreeItemType.V_FOLDER_ROOT) {
            folderpath = (<VirtualFileInfo>item.val.obj).path;
            isVirtpath = true;
        }

        if (item.val.obj instanceof File) { // if value is a file, use it
            folderpath = project.toRelativePath(item.val.obj.path);
        }

        if (!folderpath)
            return;

        const extraArgs = project.getSourceExtraArgsCfg();
        if (!extraArgs)
            return;

        const argsMap    = project.getExtraArgsForFolder(folderpath, isVirtpath, extraArgs);
        const absPattern = project.getExtraArgsAbsPatternForFolder(folderpath, isVirtpath, extraArgs);
        const ccOptions  = absPattern ? (argsMap[absPattern] || '') : '';

        // merge all inherited args
        let inheritedOptions: string = '';
        for (const key in argsMap) {
            const val = argsMap[key]?.trim();
            if (key != absPattern && val) {
                inheritedOptions = `${inheritedOptions} ${val}`;
            }
        }
        inheritedOptions = inheritedOptions.trim();

        const ui_cfg: SimpleUIConfig = {
            ref_id: `<folder-options>:${folderpath}`,
            title: isChinese 
                ? `修改编译选项（目录：${NodePath.basename(folderpath)}）`
                : `Modify Compiler Options (dir: ${NodePath.basename(folderpath)})`,
            items: {},
        };

        if (inheritedOptions) { // 继承于其他匹配模式
            ui_cfg.items['inherit'] = {
                type: 'input',
                attrs: { readonly: true },
                name: isChinese 
                    ? `继承于其他匹配模式的选项（详见 'files.options.yml' 文件）`
                    : `Inherited Options (from other pattern, check your 'files.options.yml' file for details !)`,
                data: <SimpleUIConfigData_input>{
                    value: inheritedOptions,
                    default: inheritedOptions
                }
            };
        }

        ui_cfg.items['args'] = {
            type: 'input',
            attrs: {},
            name: isChinese ? '附加编译选项' : 'Append Compiler Options',
            data: <SimpleUIConfigData_input>{
                placeHolder: [
                    `For Append   Options. e.g. " -Os -flto " ...`,
                    `For Replace  Options. e.g. " $<replace:-O1/-O2> " ...`,
                    `For Override Options. e.g. " $<override:-I./include -g -O2 -flto> " ...`,
                ].join(os.EOL),
                value: ccOptions,
                default: ccOptions,
            },
        };

        const isRecursived = absPattern ? absPattern.endsWith('/**') : false;

        ui_cfg.items['recursive'] = {
            type: 'bool',
            attrs: {},
            name: isChinese ? '递归应用到所有子目录和文件' : 'Recurse All Children',
            data: <SimpleUIConfigData_boolean>{
                value: isRecursived,
                default: isRecursived,
            },
        };

        WebPanelManager.instance().showSimpleConfigUI(ui_cfg, async (new_cfg) => {

            const nArgs = (<SimpleUIConfigData_input>new_cfg.items['args'].data).value.replace(/\r\n|\n/g, ' ').trim();
            const isRecursive = (<SimpleUIConfigData_boolean>new_cfg.items['recursive'].data).value;

            let pattern: string;

            if (isVirtpath) {
                pattern = <string>folderpath;
            } else {
                pattern = project.toRelativePath(<string>folderpath).replace(/\.\.\//g, '').replace(/\.\//g, '');
            }

            let category: string = 'files';
            let argsConf: any = extraArgs;

            if (isVirtpath) {
                category = 'virtualPathFiles';
            }

            if (!argsConf[category])
                argsConf[category] = {};

            if (absPattern)
                delete argsConf[category][absPattern];

            if (nArgs) {
                argsConf[category][pattern + (isRecursive ? '/**' : '/*')] = nArgs;
            } else {
                for (const suffix of ['', '/*', '/**']) { // clear all
                    if (argsConf[category][pattern + suffix] != undefined)
                        delete argsConf[category][pattern + suffix];
                }
            }

            project.setSourceExtraArgsCfg(extraArgs);
            project.onSourceCompilerOptionsChanged();

            // update explorer
            if (isVirtpath) {
                project.getVirtualSourceManager().notifyUpdateFolder(<string>folderpath);
            } else {
                project.getNormalSourceManager().notifyUpdateFolder(project.toAbsolutePath(<string>folderpath));
            }
        });
    }

    async modifyExtraCompilerArgs(type: 'file' | 'folder', item: ProjTreeItem) {

        const project = this.getProjectByTreeItem(item);
        if (!project)
            return;

        if (type == 'file') {
            this.modifyExtraCompilerArgs_forFile(project, item);
        }
        else { // folder
            this.modifyExtraCompilerArgs_forFolder(project, item);
        }
    }

    async copyPath(type: 'abs' | 'relative', item: ProjTreeItem) {

        const project = this.getProjectByTreeItem(item);
        let copiedPath: string | undefined;

        if (item.type === TreeItemType.FOLDER || 
            item.type === TreeItemType.FOLDER_ROOT ||
            item.type === TreeItemType.EXCFOLDER) {
            const dir = <File>item.val.obj;
            if (type === 'abs') {
                copiedPath = dir.path;
            } else {
                copiedPath = project?.toRelativePath(dir.path) || dir.path;
            }
        }
        else if (item.type === TreeItemType.V_FOLDER || 
            item.type === TreeItemType.V_FOLDER_ROOT ||
            item.type === TreeItemType.V_EXCFOLDER) {
            const vinfo = <VirtualFolderInfo>item.val.obj;
            copiedPath = vinfo.path;
        }
        else if (item.type === TreeItemType.V_FILE_ITEM || 
            item.type === TreeItemType.V_EXCFILE_ITEM) {
            const vinfo = <VirtualFileInfo>item.val.obj;
            if (type === 'abs') {
                copiedPath = project?.toAbsolutePath(vinfo.vFile.path) || vinfo.vFile.path;
            } else {
                copiedPath = vinfo.path;
            }
        } 
        else if (item.val.value instanceof File) { // if value is a file, use it
            if (type === 'abs') {
                copiedPath = item.val.value.path;
            } else {
                copiedPath = project?.toRelativePath(item.val.value.path) || item.val.value.path;
            }
        }

        if (copiedPath)
            vscode.env.clipboard.writeText(copiedPath);
    }

    private async showDisassemblyForElf(elfPath: string, prj: AbstractProject) {

        try {

            const toolchainName = prj.getToolchain().name;

            // prepare command
            let exeFile: File;
            let cmds: string[];

            const dasmFile = File.fromArray([prj.getOutputFolder().path, `${NodePath.basename(elfPath)}.edasm`]);
            if (dasmFile.IsFile()) { // force del tmp file
                try { fs.unlinkSync(dasmFile.path); } catch (error) { }
            }

            if (isGccFamilyToolchain(toolchainName)) { // gcc
                const toolchain = ToolchainManager.getInstance().getToolchainByName(toolchainName);
                if (!toolchain) throw Error(`Can't get toolchain '${toolchainName}'`);
                const toolPrefix = toolchain.getToolchainPrefix ? toolchain.getToolchainPrefix() : '';
                exeFile = File.fromArray([prj.getToolchain().getToolchainDir().path, 'bin', `${toolPrefix}objdump${exeSuffix()}`]);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-S', '-l', elfPath, '>', dasmFile.path];
                // https://interrupt.memfault.com/blog/gnu-binutils#new-feature-visualize-jumps
                const binutilsVer = getGccBinutilsVersion(exeFile.dir, toolPrefix, 'objdump');
                // if (binutilsVer && compareVersion(binutilsVer, '2.34') > 0) {
                //     cmds = ['--visualize-jumps'].concat(cmds);
                // }
            }
            else if (toolchainName.startsWith('AC')) { // armcc
                exeFile = File.fromArray([prj.getToolchain().getToolchainDir().path, 'bin', `fromelf${exeSuffix()}`]);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-c', elfPath, '--output', dasmFile.path];
            }
            else if (toolchainName == 'LLVM_ARM') {
                exeFile = File.from(prj.getToolchain().getToolchainDir().path, 'bin', `llvm-objdump${exeSuffix()}`);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-S', '-l', elfPath, '>', dasmFile.path];
            }
            else if (toolchainName == 'GNU_SDCC_MCS51') {
                exeFile = File.from(prj.getToolchain().getToolchainDir().path, 'bin', `i51-elf-objdump${exeSuffix()}`);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-S', '-l', elfPath, '>', dasmFile.path];
            }
            else {
                throw new Error(`Not support showDisassemblyForElf for toolchain: '${toolchainName}' !`);
            }

            // do disassembly code
            const err = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Disassemble program',
                cancellable: false,
            }, async (progress): Promise<Error | void> => {
                try {
                    progress.report({ message: elfPath });
                    await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });

                    // run
                    const cmdLine = CmdLineHandler.getCommandLine(exeFile.path, cmds, false);
                    child_process.execSync(cmdLine, { encoding: 'ascii' });

                    progress.report({ message: 'Done !' });
                    await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });
                } catch (error) {
                    return error;
                }
            });

            if (err) { throw err }

            // check result file
            if (!dasmFile.IsFile()) {
                throw new Error(`Not found disassembly result file: '${dasmFile.path}' !`);
            }

            // show
            vscode.window.showTextDocument(vscode.Uri.file(dasmFile.path), {
                preview: true,
                viewColumn: vscode.ViewColumn.Two
            });

        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }
    }

    async showDisassembly(uri: vscode.Uri, prj?: AbstractProject) {

        try {

            // check condition
            const activePrj = prj || this.dataProvider.getActiveProject();
            if (!activePrj)
                throw new Error('Not found active project !');

            let srcPath = uri.fsPath;

            // prehandle src name
            if (/\.(?:elf|axf)\.info$/i.test(srcPath)) { // it's axf.info readonly doc
                srcPath = NodePath.dirname(srcPath) + NodePath.sep + NodePath.basename(srcPath, '.info');
            }

            if (/\.(?:elf|axf)$/i.test(srcPath)) { // it's an executable file, use it
                await this.showDisassemblyForElf(srcPath, activePrj);
                return;
            }

            // get obj file
            const objPath = activePrj.getSourceObjectPath(srcPath);

            if (typeof objPath != 'string') {
                throw new Error(`Not found any reference for this source file !, [path]: '${srcPath}'`);
            }

            if (!File.IsFile(objPath)) {
                throw new Error(`Object file is not existed !, [path]: '${objPath}'`);
            }

            // prepare command
            let exeFile: File;
            let cmds: string[];

            const tmpFile = File.fromArray([os.tmpdir(), `${NodePath.basename(srcPath)}.edasm`]);
            if (tmpFile.IsFile()) { // force del tmp file
                try { fs.unlinkSync(tmpFile.path); } catch (error) { }
            }

            const toolchainName = activePrj.getToolchain().name;

            if (isGccFamilyToolchain(toolchainName)) { // gcc
                const toolchain = ToolchainManager.getInstance().getToolchainByName(toolchainName);
                if (!toolchain) throw new Error(`Can't get toolchain '${toolchainName}'`);
                const toolPrefix = toolchain.getToolchainPrefix ? toolchain.getToolchainPrefix() : '';
                exeFile = File.fromArray([activePrj.getToolchain().getToolchainDir().path, 'bin', `${toolPrefix}objdump${exeSuffix()}`]);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-S', '-l', objPath, '>', tmpFile.path];
                // https://interrupt.memfault.com/blog/gnu-binutils#new-feature-visualize-jumps
                const binutilsVer = getGccBinutilsVersion(exeFile.dir, toolPrefix, 'objdump');
                // if (binutilsVer && compareVersion(binutilsVer, '2.34') > 0) {
                //     cmds = ['--visualize-jumps'].concat(cmds);
                // }
            }
            else if (toolchainName.startsWith('AC')) { // armcc
                exeFile = File.fromArray([activePrj.getToolchain().getToolchainDir().path, 'bin', `fromelf${exeSuffix()}`]);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-c', objPath, '--output', tmpFile.path];
            }
            else if (toolchainName == 'LLVM_ARM') {
                exeFile = File.from(activePrj.getToolchain().getToolchainDir().path, 'bin', `llvm-objdump${exeSuffix()}`);
                if (!exeFile.IsFile()) throw Error(`Not found '${exeFile.name}' !`);
                cmds = ['-S', '-l', objPath, '>', tmpFile.path];
            }
            else if (toolchainName.includes('SDCC')) {
                const objFile = File.from(objPath);
                const outAsmPath = NodePath.join(objFile.dir, objFile.noSuffixName + '.asm');
                vscode.window.showTextDocument(vscode.Uri.file(outAsmPath), { preview: true });
                return;
            }
            else { // Not support
                throw new Error(`Not support showDisassembly for toolchain: '${toolchainName}' !`);
            }

            // do disassembly code
            const cmdLine = CmdLineHandler.getCommandLine(exeFile.path, cmds, false);
            child_process.execSync(cmdLine, { encoding: 'ascii' });

            // check result file
            if (!tmpFile.IsFile()) {
                throw new Error(`Not found disassembly result file: '${tmpFile.path}' !`);
            }

            // parse result
            const asmLines = tmpFile.Read().split(/\r\n|\n/);
            const asmFile = `${srcPath}.edasm`;
            const asmFileUri = vscode.Uri.parse(VirtualDocument.instance().getUriByPath(asmFile));

            if (tmpFile.IsFile()) { // del tmp file
                try { fs.unlinkSync(tmpFile.path); } catch (error) { }
            }

            // try jump to target line in asm
            let selection: vscode.Range | undefined;

            if (vscode.window.activeTextEditor &&
                vscode.window.activeTextEditor.document.uri.toString() == uri.toString()) {

                // for gcc toolchain
                // jump to example: 
                //          c:/xxx/xxx\sourceName.c:123
                //
                if (isGccFamilyToolchain(toolchainName) || toolchainName == 'LLVM_ARM') {

                    const activeTextEditor = vscode.window.activeTextEditor;
                    const curLine = activeTextEditor.selection.start.line;

                    const safeName = NodePath.basename(srcPath)
                        .replace(/\./g, String.raw`\.`)
                        .replace(/\(/g, String.raw`\(`).replace(/\)/g, String.raw`\)`)
                        .replace(/\[/g, String.raw`\[`).replace(/\]/g, String.raw`\]`)
                        .replace(/\{/g, String.raw`\{`).replace(/\}/g, String.raw`\}`)
                        .replace(/\^/g, String.raw`\^`).replace(/\$/g, String.raw`\$`)
                        .replace(/\*/g, String.raw`\*`)
                        .replace(/\+/g, String.raw`\+`)
                        .replace(/\?/g, String.raw`\?`)
                        .replace(/\|/g, String.raw`\|`);

                    const lmatcher = new RegExp(`.+\\b${safeName}:\\d+\\b`);
                    const tMatcher = new RegExp(`.+\\b${safeName}:${curLine + 1}\\b`);

                    for (let idx = 0; idx < asmLines.length; idx++) {
                        const line = asmLines[idx];
                        if (lmatcher.test(line)) {
                            // found target line
                            if (selection == undefined && tMatcher.test(line)) {
                                const pos = new vscode.Position(idx + 1, 0);
                                selection = new vscode.Range(pos, pos);
                            }
                            // clear line number content
                            asmLines[idx] = '';
                        }
                    }
                }

                // for armcc toolchain
                // jump to example: 
                //          ** Section #4 'i.delay' (SHT_PROGBITS) [SHF_ALLOC + SHF_EXECINSTR]
                //
                else if (toolchainName.startsWith('AC')) {
                    const matcher = /^\s*\*\* Section #\d+ 'i\./;
                    for (let idx = 0; idx < asmLines.length; idx++) {
                        const line = asmLines[idx];
                        if (matcher.test(line)) {
                            const pos = new vscode.Position(idx, 0);
                            selection = new vscode.Range(pos, pos);
                            break; // found it, exit
                        }
                    }
                }
            }

            // show
            VirtualDocument.instance().updateDocument(asmFile, asmLines.join('\n'));
            vscode.window.showTextDocument(asmFileUri, {
                preview: true,
                viewColumn: vscode.ViewColumn.Two,
                selection: selection
            });

        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }
    }

    async showCmsisConfigWizard(uri: vscode.Uri) {
        WebPanelManager.instance().showCmsisConfigWizard(uri);
    }

    async installCmsisSourcePack(item: ProjTreeItem, type: 'header' | 'lib' | 'idrv') {

        if (this._opLock.isLocked(OpLockKeys.InstallPackage)) {
            GlobalEvent.show_msgbox('Warning', 'Operation is in pending !');
            return;
        }

        this._opLock.tryAcquire(OpLockKeys.InstallPackage); // lock op

        try {

            const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
            if (prj) {
                switch (type) {
                    case 'header':
                        prj.installCmsisSourceCodePack(ResManager.GetInstance().getCMSISHeaderPacks());
                        break;
                    case 'lib':
                        prj.installCmsisLibs();
                        break;
                    case 'idrv':
                        prj.installCmsisSourceCodePack([
                            {
                                name: 'driver',
                                zippath: [ResManager.instance().GetAppDataDir().path, 'cmsis_driver_interface_v5_9_0.7z'].join(File.sep),
                                exportIncs: [
                                    'Include',
                                    'VIO/Include'
                                ]
                            }
                        ]);
                        break;
                    default:
                        break;
                }
            }

        } catch (error) {
            GlobalEvent.show_msgbox('Warning', error);
        }

        this._opLock.release(OpLockKeys.InstallPackage); // unlock op
    }

    setActiveProject(item: ProjTreeItem) {
        this.dataProvider.setActiveProject(item.val.projectIndex);
    }

    async UninstallKeilPackage(item: ProjTreeItem) {

        if (this._opLock.isLocked(OpLockKeys.InstallPackage)) {
            GlobalEvent.show_msgbox('Warning', `Busy !, Please wait for the current operation to complete !`);
            return;
        }

        const result = await vscode.window.showInformationMessage(
            `Do you really want to uninstall this package: '${item.val.value}' ?`,
            'Yes', 'No'
        );

        try {
            if (result === 'Yes') {
                this._opLock.tryAcquire(OpLockKeys.InstallPackage);
                await this.dataProvider.UninstallKeilPackage(item);
                GlobalEvent.show_msgbox('Info', `package '${<string>item.val.value}' has been uninstalled`);
            }
        } catch (error) {
            GlobalEvent.emit('error', error);
        }

        this._opLock.release(OpLockKeys.InstallPackage);
    }

    SetDevice(prjIndex: number) {
        this.dataProvider.SetDevice(prjIndex);
    }

    ModifyCompileConfig(item: ProjTreeItem) {
        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        prj.GetConfiguration().toolchainConfigModel.ShowModifyWindow(<string>item.val.key, prj.GetRootDir());
    }

    async ModifyCompileConfig_openFile(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    ModifyUploadConfig(item: ProjTreeItem) {
        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const key = <string>item.val.key;
        prj.GetConfiguration().uploadConfigModel.ShowModifyWindow(key, prj.GetRootDir());
    }

    private updateSettingsView(prj: AbstractProject) {
        this.dataProvider.UpdateView(this.dataProvider.treeCache.getTreeItem(prj, TreeItemType.SETTINGS));
    }

    async ModifyOtherSettings(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const key = <string>item.val.key;

        switch (key) {
            // output folder
            case 'outDir':
                {
                    const prjConfig = prj.GetConfiguration().config;
                    const oldFolderName = File.normalize(prjConfig.outDir);

                    const newName = await vscode.window.showInputBox({
                        value: oldFolderName,
                        ignoreFocusOut: true,
                        validateInput: (input: string): string | undefined => {
                            return !/^[\w-]+$/.test(input) ? `not match RegExp: /^[\\w-]+$/` : undefined;
                        }
                    });

                    if (newName && newName !== oldFolderName) {
                        prjConfig.outDir = newName;
                        this.updateSettingsView(prj);
                        prj.Save();
                    }
                }
                break;
            // project name
            case 'name':
                {
                    const prjConfig = prj.GetConfiguration().config;

                    const newName = await vscode.window.showInputBox({
                        value: prjConfig.name,
                        ignoreFocusOut: true,
                        placeHolder: 'Input new project name',
                        validateInput: (name) => AbstractProject.validateProjectName(name)
                    });

                    if (newName && newName !== prjConfig.name) {
                        prjConfig.name = newName; // update project name
                        this.dataProvider.UpdateView(); // udpate all view
                        prj.Save(true);
                        // rename workspace file
                        const wsFile = prj.getWorkspaceFile();
                        const newWsFile = File.from(wsFile.dir, `${newName}${wsFile.suffix}`);
                        fs.renameSync(wsFile.path, newWsFile.path);
                        WorkspaceManager.getInstance().openWorkspace(newWsFile);
                    }
                }
                break;
            case 'debugger':
                {
                    const selections: any[] = [];

                    if (prj.getProjectType() !== 'C51') {

                        selections.push({
                            value: 'cortex-debug',
                            label: DEBUGGER_MAPS['cortex-debug'].name,
                            detail: `extension id: ${DEBUGGER_MAPS['cortex-debug'].extension_id}`
                        });

                        selections.push({
                            value: 'cdt-gdb-debug',
                            label: DEBUGGER_MAPS['cdt-gdb-debug'].name,
                            detail: `extension id: ${DEBUGGER_MAPS['cdt-gdb-debug'].extension_id}`
                        });
                    }

                    const res = await vscode.window.showQuickPick(selections, {placeHolder: 'Select debugger type'});
                    if (res) {
                        const targetInfo = prj.getTargetInfo();
                        if (targetInfo.settings.debugger !== res.value) {
                            targetInfo.settings.debugger = res.value;
                            this.updateSettingsView(prj);
                            prj.Save(true);
                        }
                    }
                }
                break;
            // 'project.env'
            case 'project.env':
                {
                    vscode.window.showTextDocument(
                        vscode.Uri.parse(prj.getEnvFile().ToUri()), { preview: true });
                }
                break;
            default:
                break;
        }
    }

    async ImportSourceFromExtProject(treeItem: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(treeItem.val.projectIndex);

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

    async AddIncludeDir(prjIndex: number) {

        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    async AddDefine(prjIndex: number) {
        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    async AddLibDir(prjIndex: number) {
        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    async showIncludeDir(prjIndex: number) {

        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    async showLibDir(prjIndex: number) {

        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    async showDefine(prjIndex: number) {

        const prj = this.dataProvider.GetProjectByIndex(prjIndex);
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

    ExcludeSourceFile(item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const sourceItem of items) {
            const prj = this.dataProvider.GetProjectByIndex(sourceItem.val.projectIndex);

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

    UnexcludeSourceFile(item: ProjTreeItem, items: ProjTreeItem[]) {
        if (items == undefined) items = [item];

        for (const sourceItem of items) {
            const prj = this.dataProvider.GetProjectByIndex(sourceItem.val.projectIndex);

            if (sourceItem.type === TreeItemType.V_EXCFILE_ITEM) {
                prj.unexcludeSourceFile((<VirtualFileInfo>sourceItem.val.obj).path);
            }
            else if (sourceItem.val.value instanceof File) {
                prj.unexcludeSourceFile(sourceItem.val.value.path);
            }
        }
    }

    ExcludeFolder(item: ProjTreeItem, items: ProjTreeItem[], onlyChildren?: boolean) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const prj = this.dataProvider.GetProjectByIndex(folderItem.val.projectIndex);

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

    UnexcludeFolder(item: ProjTreeItem, items: ProjTreeItem[], onlyChildren?: boolean) {
        if (items == undefined) items = [item];

        for (const folderItem of items) {
            const prj = this.dataProvider.GetProjectByIndex(folderItem.val.projectIndex);

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

    async showFileInExplorer(item: ProjTreeItem) {

        let file: File | undefined;

        if (item.val.value instanceof File) { // if value is a file, use it
            file = new File(File.normalize(item.val.value.path));
        }

        if (file) {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file.path));
        }
    }

    ////////////////////////////////// modifiable yaml config implements ////////////////////////////////////////

    private yamlCfgProviderList: Map<string, ModifiableYamlConfigProvider> = new Map();

    registerModifiableYamlConfigProvider(id: string, provider: ModifiableYamlConfigProvider) {
        this.yamlCfgProviderList.set(id, provider);
    }

    private YamlConfigProvider_notifyDocSaved(doc: vscode.TextDocument) {

        const docName = NodePath.basename(doc.uri.fsPath);

        this.yamlCfgProviderList.forEach((val, key) => {
            if (docName.endsWith(`eide.${key}.yaml`)) {
                val.onYamlDocSaved(doc);
            }
        });
    }

    private YamlConfigProvider_notifyDocClosed(doc: vscode.TextDocument) {

        const docName = NodePath.basename(doc.uri.fsPath);

        this.yamlCfgProviderList.forEach((val, key) => {
            if (docName.endsWith(`eide.${key}.yaml`)) {
                val.onYamlDocClosed(doc);
            }
        });
    }

    async openYamlConfig(item: ProjTreeItem, id: string) {

        const provider = this.yamlCfgProviderList.get(id);
        if (provider == undefined) {
            throw new Error(`not found any registed config provider: '${id}'`);
        }

        // provide file
        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const defFileName = `${prj.getUid()}.eide.${id}.yaml`;
        const res = await provider.provideYamlDocument(prj, item, defFileName);
        if (res instanceof Error) {
            GlobalEvent.show_msgbox('Warning', res);
            return;
        }

        // show file if we need
        if (res) {
            vscode.window.showTextDocument(
                vscode.Uri.file(res.path), { preview: false }
            );
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    CopyItemValue(item: ProjTreeItem) {
        if (item.val.value instanceof File) {
            vscode.env.clipboard.writeText(item.val.value.path);
        } else if (typeof item.val.value == 'string') {
            vscode.env.clipboard.writeText(item.val.value);
        }
    }

    async showFilesOptions(item: ProjTreeItem) {
        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const optFile = prj.getSourceExtraArgsCfgFile();
        vscode.window.showTextDocument(vscode.Uri.parse(optFile.ToUri()), { preview: true });
    }

    ///////////////////////////////////////////////////////////////////////////////

    async editDependenceItem(item: ProjTreeItem) {

        if (item.val.value instanceof File)
            throw new Error('editDependenceItem: Invalid context item');

        const itype = (<ModifiableDepInfo>item.val.obj).type;

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async RemoveDependenceItem(item: ProjTreeItem) {

        if (item.val.value instanceof File)
            throw new Error('RemoveDependenceItem: Invalid context item');

        const msg = `${WARNING}: ${remove_this_item.replace('{}', item.val.value)}`;
        const choice = await vscode.window.showWarningMessage(msg, 'Yes', 'No');
        if (choice === undefined || choice === 'No')
            return undefined;

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    ImportPackageDependence(item: ProjTreeItem): void {
        let prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        try {
            prj.InstallComponent(<string>item.val.value);
        } catch (err) {
            GlobalEvent.show_msgbox('Warning', view_str$pack$install_component_failed);
            GlobalEvent.show_msgbox('Hidden', err);
        }
    }

    RemovePackageDependence(item: ProjTreeItem): void {
        let prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        try {
            prj.UninstallComponent(<string>item.val.value);
        } catch (err) {
            GlobalEvent.show_msgbox('Warning', view_str$pack$remove_component_failed);
            GlobalEvent.show_msgbox('Hidden', err);
        }
    }

    async onSwitchCompileTools(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async onSetupToolchain(item: ProjTreeItem) {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async switchUploader(item: ProjTreeItem) {

        const prj = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    async fetchShellFlasher(item: ProjTreeItem) {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
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

    private async genDebugConfig_internal(
        type: 'jlink' | 'openocd' | 'pyocd',
        prj: AbstractProject, old_cfgs: any[]): Promise<{ debug_config: any, override_idx: number } | undefined> {

        const _outFullName = File.ToUnixPath(prj.getOutputDir()) + '/' + `${prj.getProjectName()}`
        const _elfPath = `${_outFullName}.elf`;
        const _debugConfigTemplates = {
            'jlink': {
                cwd: '${workspaceRoot}',
                type: 'cortex-debug',
                request: 'launch',
                name: `${prj.getProjectCurrentTargetName()}: JLINK`,
                servertype: 'jlink',
                interface: 'swd',
                executable: _elfPath,
                runToEntryPoint: "main",
                device: ''
            },
            'openocd': {
                cwd: '${workspaceRoot}',
                type: 'cortex-debug',
                request: 'launch',
                name: `${prj.getProjectCurrentTargetName()}: OpenOCD`,
                servertype: 'openocd',
                executable: _elfPath,
                runToEntryPoint: "main",
                configFiles: [
                ]
            },
            'pyocd': {
                cwd: '${workspaceRoot}',
                type: 'cortex-debug',
                request: 'launch',
                name: `${prj.getProjectCurrentTargetName()}: pyOCD`,
                servertype: 'pyocd',
                executable: _elfPath,
                runToEntryPoint: "main",
                targetId: '<mcu-name>',
                // pyocd gdbserver 启动输出与 cortex-debug 内置检测文本不一致时,
                // 用宽松关键字 "port" 兜底判定服务器已启动
                overrideGDBServerStartedRegex: 'port',
                serverArgs: []
            }
        };

        const debugConfig: any = _debugConfigTemplates[type];
        const toolchain = prj.getToolchain();

        if (toolchain.name == 'AC5' || toolchain.name == 'AC6') {
            // pyocd 模板保留 executable 指向 .axf(cortex-debug 以它加载符号),
            // jlink/openocd 模板维持旧行为(仅 loadFiles/symbolFiles)
            debugConfig['executable'] = type == 'pyocd' ? `${_outFullName}.axf` : undefined;
            debugConfig['loadFiles'] = [ `${_outFullName}.hex` ];
            debugConfig['symbolFiles'] = [ `${_outFullName}.axf` ];
        }

        /* set gdb toolchain */
        if (toolchain.getToolchainPrefix) {
            debugConfig.toolchainPrefix = toolchain.getToolchainPrefix().trim().replace(/-$/, '');
        } else if (debugConfig.toolchainPrefix) {
            debugConfig.toolchainPrefix = undefined;
        }

        /* set svd file */
        const device = prj.GetPackManager().getCurrentDevInfo();
        if (device && device.svdPath && debugConfig.svdFile == undefined) {
            debugConfig.svdFile = prj.ToRelativePath(device.svdPath) || device.svdPath;
        }

        const isChinese = getLocalLanguageType() == LanguageIndexs.Chinese;
        const ui: SimpleUIConfig = {
            title: (isChinese 
                ? '创建 Cortex-Debug ({}) 调试配置模板' 
                : 'Create Cortex-Debug ({}) Configuration Template').replace('{}', type.toUpperCase()),
            viewColumn: vscode.ViewColumn.One,
            notTakeFocus: false,
            btns: {
                'submit': {
                    title: isChinese ? '新建' : 'Create',
                    hidden: false
                },
                'reset': {
                    title: '',
                    hidden: true
                }
            },
            items: {
                'name': {
                    type: 'input',
                    name: isChinese ? '名称' : 'Name',
                    attrs: { 'singleLine': true, 'size': 60 },
                    data: <SimpleUIConfigData_input>{
                        value: debugConfig.name
                    }
                },
                'request': {
                    type: 'options',
                    name: isChinese ? '调试模式' : 'Request',
                    attrs: {},
                    data: <SimpleUIConfigData_options>{
                        value: 0,
                        default: 0,
                        enum: ['launch', 'attach'],
                        enumDescriptions: isChinese ? ['启动', '附加'] : ['launch', 'attach'],
                    }
                }
            }
        };

        let uiResultConv: (data: SimpleUIConfig, debugConfig: any) => void = (a, b) => {
            throw new Error('uiResultConv NOT IMPLEMENT !');
        };

        /* For JLink */
        if (type == 'jlink') {

            if (prj.getUploaderType() == 'JLink') {
                const jlinkUploadConf = <JLinkOptions>prj.GetConfiguration().config.uploadConfig;
                debugConfig.interface = JLinkProtocolType[jlinkUploadConf.proType].toLowerCase();
                debugConfig.device    = jlinkUploadConf.cpuInfo.cpuName;
            }

            /* setup ui */
            ui.items['interface'] = {
                type: 'options',
                name: isChinese ? '接口类型' : 'Interface',
                attrs: {},
                data: <SimpleUIConfigData_options>{
                    value: debugConfig.interface == 'swd' ? 0 : 1,
                    default: 0,
                    enum: ['swd', 'jtag'],
                    enumDescriptions: ['SWD', 'JTAG'],
                }
            };
            ui.items['device'] = {
                type: 'input',
                name: isChinese ? '芯片型号' : 'Device Name',
                attrs: { 'singleLine': true, size: 30 },
                data: <SimpleUIConfigData_input>{
                    value: debugConfig.device,
                    placeHolder: 'STM32F103C8'
                },
            };
            uiResultConv = (data, outConfig) => {
                outConfig.interface = ['swd', 'jtag'][data.items['interface'].data.value];
                outConfig.device = data.items['device'].data.value;
            };
        }

        /* For OPENOCD */
        else if (type == 'openocd') {

            const toCfgPath = (typ: 'interface' | 'target', cfgname: string): string => {
                if (cfgname.trim() != '') {
                    let fpath: string = cfgname.startsWith('${workspaceFolder}/')
                        ? cfgname.replace('${workspaceFolder}/', '')
                        : `${typ}/${cfgname}`;
                    if (!fpath.endsWith('.cfg'))
                        fpath += '.cfg';
                    return fpath;
                }
                return '';
            };

            const interface_enums = [''].concat(
                openocd_getConfigList('interface', prj.getRootDir()).map(c => c.name).sort());
            const target_enums = [''].concat(
                openocd_getConfigList('target', prj.getRootDir()).map(c => c.name).sort());

            let inferface_default = 0;
            let target_default = 0;

            if (prj.getUploaderType() == 'OpenOCD') {
                const flasherConf = <OpenOCDFlashOptions>prj.GetConfiguration().config.uploadConfig;
                if (flasherConf.interface) {
                    (<any[]>debugConfig.configFiles).push(toCfgPath('interface', flasherConf.interface));
                    let idx = interface_enums.findIndex(n => n == flasherConf.interface);
                    if (idx != -1)
                        inferface_default = idx;
                }
                if (flasherConf.target) {
                    (<any[]>debugConfig.configFiles).push(toCfgPath('target', flasherConf.target));
                    let idx = target_enums.findIndex(n => n == flasherConf.target);
                    if (idx != -1)
                        target_default = idx;
                }
            }

            /* setup ui */
            ui.items['interface'] = {
                type: 'options',
                name: isChinese ? '接口' : 'Interface',
                attrs: { style: 'width: 260px;' },
                data: <SimpleUIConfigData_options>{
                    value: inferface_default,
                    default: inferface_default,
                    enum: interface_enums,
                    enumDescriptions: interface_enums.map(n => n == '' ? 'None' : n),
                }
            };
            ui.items['target'] = {
                type: 'options',
                name: isChinese ? '目标' : 'Target',
                attrs: { style: 'width: 260px;' },
                data: <SimpleUIConfigData_options>{
                    value: target_default,
                    default: target_default,
                    enum: target_enums,
                    enumDescriptions: target_enums.map(n => n == '' ? 'None' : n),
                }
            };
            uiResultConv = (data, outConfig) => {
                const cfgFiles: string[] = [];
                const i_idx = (<SimpleUIConfigData_options>data.items['interface'].data).value;
                const i_path = interface_enums[i_idx];
                if (i_path)
                    cfgFiles.push(toCfgPath('interface', i_path));
                const t_idx = (<SimpleUIConfigData_options>data.items['target'].data).value;
                const t_path = target_enums[t_idx];
                if (t_path)
                    cfgFiles.push(toCfgPath('target', t_path));
                outConfig.configFiles = cfgFiles;
            };
        }

        /* For PYOCD */
        else if (type == 'pyocd') {

            let target_idx_default = 0;
            let pyocd_config_path: string | undefined;

            if (prj.getUploaderType() == 'pyOCD') {
                const flasherConf = <PyOCDFlashOptions>prj.GetConfiguration().config.uploadConfig;
                debugConfig.targetId = flasherConf.targetName;
                if (flasherConf.config) {
                    pyocd_config_path = prj.toAbsolutePath(flasherConf.config);
                    if (File.IsFile(pyocd_config_path)) {
                        debugConfig.serverArgs = [
                            '--config', pyocd_config_path
                        ];
                    }
                }
            }

            const pyocd_targets = await vscode.window.withProgress<string[] | Error>({
                location: vscode.ProgressLocation.Notification,
                title: 'Get pyOCD Targets List'
            }, () => {
                return new Promise((resolve) => {
                    try {
                        const r = pyocd_getTargetList(prj.getRootDir(), pyocd_config_path).map(t => <string>t['name']);
                        resolve(r);
                    } catch (error) {
                        resolve(error);
                    }
                });
            });

            if (pyocd_targets instanceof Error)
                throw pyocd_targets;
            if (pyocd_targets == undefined)
                throw new Error(`pyocd_getTargetList -> target_enums is undefined`);

            const target_enums = pyocd_targets.sort();
            const idx = target_enums.findIndex(t => t == debugConfig.targetId);
            if (idx != -1)
                target_idx_default = idx;

            /* setup ui */
            ui.items['target'] = {
                type: 'options',
                name: isChinese ? '目标' : 'Target',
                attrs: { style: 'width: 260px;' },
                data: <SimpleUIConfigData_options>{
                    value: target_idx_default,
                    default: target_idx_default,
                    enum: target_enums,
                    enumDescriptions: target_enums,
                }
            };
            if (prj.getUploaderType() != 'pyOCD') {
                ui.items['config'] = {
                    type: 'input',
                    name: isChinese ? 'pyocd.yml 配置文件路径' : 'pyocd.yml Path',
                    attrs: { 'singleLine': true },
                    data: <SimpleUIConfigData_input>{
                        value: '',
                        placeHolder: './pyocd.yml'
                    },
                };
            }
            uiResultConv = (data, outConfig) => {
                const t_idx = (<SimpleUIConfigData_options>data.items['target'].data).value;
                const targetId = target_enums[t_idx];
                if (targetId)
                    outConfig.targetId = targetId;
                else
                    throw new Error(`targetId is null ! idx=${t_idx}`);
                if (data.items['config']) {
                    const _cfgPath = (<SimpleUIConfigData_input>data.items['config'].data).value;
                    if (_cfgPath) {
                        const absPath = prj.toAbsolutePath(_cfgPath);
                        outConfig.serverArgs = [
                            '--config', absPath
                        ];
                    }
                }
            };
        }

        return new Promise((resolve) => {

            WebPanelManager.instance().showSimpleConfigUI(ui,
                // on submited
                async (data, panel) => {

                    /* update configs */
                    debugConfig.name = data.items['name'].data.value;
                    debugConfig.request = ['launch', 'attach'][data.items['request'].data.value];
                    if (debugConfig.request == 'attach')
                        debugConfig.runToEntryPoint = undefined;
                    uiResultConv(data, debugConfig);

                    /* check override ? */
                    const idx = old_cfgs.findIndex(cfg => cfg.name == debugConfig.name);
                    if (idx != -1) {
                        const item = await vscode.window.showWarningMessage(
                            isChinese
                                ? `${WARNING}: 名称为 '${debugConfig.name}' 的调试配置已经存在，需要覆盖它吗？`
                                : `${WARNING}: Debugger Configuration '${debugConfig.name}' is already existed ! Override It ?`,
                            'Yes', 'No');
                        if (item === undefined || item === 'No') {
                            return 'canceled';
                        }
                    }

                    resolve({ debug_config: debugConfig, override_idx: idx });
                    setTimeout(() => panel.dispose(), 100);
                },
                // on msg
                (msg) => {
                });
        });
    }

    async genDebugConfigTemplate(item: ProjTreeItem, type: 'jlink' | 'openocd' | 'pyocd') {

        const project = this.dataProvider.GetProjectByIndex(item.val.projectIndex);
        const cfgfile = File.from(project.GetWorkspaceConfig().GetFile().dir, AbstractProject.vsCodeDir, 'launch.json');

        try {

            let cur_cfgs;
            if (cfgfile.IsFile())
                cur_cfgs = <any[]>jsonc_parser.parse(cfgfile.Read(), undefined, { allowTrailingComma: true }).configurations;
            else
                cur_cfgs = [];

            const result = await this.genDebugConfig_internal(type, project, cur_cfgs);
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

    private prev_click_info: ItemClickInfo | undefined = undefined;

    private async OnTreeItemClick(item: ProjTreeItem) {

        if (item.type === TreeItemType.RELOAD_YES_ITEM) {
            const prj = this.getProjectByTreeItem(item);
            if (prj) {
                this.finishReloadPrompt(prj.getUid(), 'yes');
            }
            return;
        }

        if (item.type === TreeItemType.RELOAD_NO_ITEM) {
            const prj = this.getProjectByTreeItem(item);
            if (prj) {
                this.finishReloadPrompt(prj.getUid(), 'later');
            }
            return;
        }

        if (ProjTreeItem.isFileItem(item.type)) {

            const file = <File>item.val.value;

            let isPreview = true;

            if (this.prev_click_info &&
                this.prev_click_info.name === file.path &&
                this.prev_click_info.time + 260 > Date.now()) {
                isPreview = false;
            }

            // reset it
            this.prev_click_info = {
                name: file.path,
                time: Date.now()
            };

            try {

                // try to show it by eide, if failed, show it 
                // by vscode default api
                if (this.showBinaryFiles(file, isPreview))
                    return;

                const vdoc = VirtualDocument.instance();
                if (item.label == 'Symbol Table') {
                    const prj = this.getProjectByTreeItem(item);
                    if (prj)
                        WebPanelManager.instance().showSymbolTable(prj);
                } else if (item.label == 'Callgraph View') {
                    const prj = this.getProjectByTreeItem(item);
                    if (prj)
                        WebPanelManager.instance().showCallgraphView(prj);
                } else if (item.val.isVirtualFile && vdoc.hasDocument(file.path)) {
                    const uri = vscode.Uri.parse(vdoc.getUriByPath(file.path));
                    vdoc.updateDocument(file.path);
                    vscode.window.showTextDocument(uri, { preview: isPreview });
                } else {
                    /* We need use 'vscode.open' command, not 'showTextDocument' API, 
                     * because API can't open bin file */
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file.path), { preview: isPreview });
                }

            } catch (error) {
                GlobalEvent.show_msgbox('Warning', error);
            }
        }
    }

    private showBinaryFiles(binFile: File, isPreview?: boolean): boolean | undefined {

        try {

            // if not found, exited
            if (!binFile.IsExist()) return undefined;

            const suffix = binFile.suffix.toLowerCase();

            // show armcc axf file
            if (suffix == '.axf') {

                let fromelf = File.from(`fromelf${exeSuffix()}`);
                if (SettingManager.GetInstance().getArmcc5Dir().IsDir()) {
                    fromelf = File.from(SettingManager.GetInstance().getArmcc5Dir().path, 'bin', `fromelf${exeSuffix()}`);
                } else if (SettingManager.GetInstance().getArmcc6Dir().IsDir()) {
                    fromelf = File.from(SettingManager.GetInstance().getArmcc6Dir().path, 'bin', `fromelf${exeSuffix()}`);
                }

                let cont: string;

                try {
                    if (!fromelf.IsFile())
                        throw new Error(`Not found '${fromelf.path}' !`);
                    cont = child_process
                        .execFileSync(fromelf.path, ['--text', '-v', binFile.path], { maxBuffer: 50 * 1024 * 1024 })
                        .toString();
                } catch (error) {
                    const err = <Error>error;
                    cont = `${err.name}: ${err.message}\n${err.stack}`;
                }

                const vDoc = VirtualDocument.instance();
                const docName = `${binFile.path}.info`;
                vDoc.updateDocument(docName, cont);

                const uri = vscode.Uri.parse(vDoc.getUriByPath(docName));
                vscode.window.showTextDocument(uri, { preview: isPreview });

                return true;
            }

            // show gnu elf file
            else if (suffix == '.elf') {

                let readelf: string = 'arm-none-eabi-readelf';
                let elfsize: string = 'arm-none-eabi-size';

                const activePrj = this.getActiveProject();
                if (activePrj) {
                    const toolchain = activePrj.getToolchain();
                    if (isGccFamilyToolchain(toolchain.name) && toolchain.getToolchainPrefix) {
                        readelf = [toolchain.getToolchainDir().path, 'bin', `${toolchain.getToolchainPrefix()}readelf`].join(File.sep);
                        elfsize = [toolchain.getToolchainDir().path, 'bin', `${toolchain.getToolchainPrefix()}size`].join(File.sep);
                    }
                    else if (toolchain.name == 'LLVM_ARM') {
                        readelf = [toolchain.getToolchainDir().path, 'bin', `llvm-readelf`].join(File.sep);
                        elfsize = [toolchain.getToolchainDir().path, 'bin', `llvm-size`].join(File.sep);
                    }
                    else if (toolchain.name == 'GNU_SDCC_MCS51') {
                        readelf = [toolchain.getToolchainDir().path, 'bin', `i51-elf-readelf`].join(File.sep);
                        elfsize = [toolchain.getToolchainDir().path, 'bin', `i51-elf-size`].join(File.sep);
                    }
                }

                let cont: string;

                try {
                    cont = child_process
                        .execFileSync(`${readelf}${exeSuffix()}`, ['-e', binFile.path], { maxBuffer: 50 * 1024 * 1024 })
                        .toString();
                } catch (error) {
                    const err = <Error>error;
                    cont = `${err.name}: ${err.message}\n${err.stack}`;
                }

                // show elf size
                try {
                    let tLines = child_process
                        .execFileSync(`${elfsize}${exeSuffix()}`, ['-A', binFile.path])
                        .toString().split(/\r\n|\n/g);
                    tLines = tLines.filter(s => s.trim() != '').map(s => `  ${s}`);
                    tLines.push(os.EOL);
                    tLines = [os.EOL + 'ELF Size:'].concat(tLines);
                    cont += tLines.join(os.EOL);
                } catch (error) {
                    // do nothing
                }

                const vDoc = VirtualDocument.instance();
                const docName = `${binFile.path}.info`;
                vDoc.updateDocument(docName, cont);

                const uri = vscode.Uri.parse(vDoc.getUriByPath(docName));
                vscode.window.showTextDocument(uri, { preview: isPreview });

                return true;
            }

        } catch (error) {
            GlobalEvent.show_msgbox('Hidden', error);
        }
    }
}








