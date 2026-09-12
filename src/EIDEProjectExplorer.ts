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
import { ProjectDataProvider } from './ProjectDataProvider';
export { ProjectDataProvider };
import { getTreeItemTypeName } from './ProjectDataProvider';
export { getTreeItemTypeName };
import { PathCompletionItem } from './ExplorerSmallItems';
export { PathCompletionItem };
import { ProjectItemCache } from './ExplorerSmallItems';
export { ProjectItemCache };
import { ItemCache } from './ExplorerSmallItems';
export { ItemCache };
import type { VirtualFileInfo, VirtualFolderInfo, ImporterProjectInfo } from './types/ExplorerTypes';
export type { ImporterProjectInfo };
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
    rewriteEmbeddedAbsolutePaths,
} from './ProjectRootTool';
import { EIDE_DIR as EIDE_DIR_CONST, PROJECT_CONFIG_FILE_NAME } from './ProjectConsts';
import {
    isV42Skeleton, assembleFromSkeleton, splitIntoSkeleton, packTargetForDisk, exportProjectAsV41,
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
import { modifyExtraCompilerArgs_forFile, modifyExtraCompilerArgs_forFolder } from './ExtraCompilerArgs';
import { genDebugConfig_internal } from './DebugConfigGenerator';
import { ShowProjectVariables, RemoveSrcDir, Virtual_folderAddFile, Virtual_removeFolder, ModifyCompileConfig_openFile, ImportSourceFromExtProject, AddIncludeDir, AddDefine, AddLibDir, showIncludeDir, showLibDir, showDefine, ExcludeSourceFile, UnexcludeSourceFile, ExcludeFolder, UnexcludeFolder, editDependenceItem, RemoveDependenceItem, onSwitchCompileTools, onSetupToolchain, switchUploader, fetchShellFlasher, genDebugConfigTemplate } from './ProjectExplorerCommands';

interface ItemClickInfo {
    name: string;
    time: number;
}

interface BuildCommandInfo {
    title: string;
    command: string;
    program?: string;
    order?: number;
    ignoreFailed?: boolean;
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

    /** 命令处理器(已提取到 ProjectExplorerCommands.ts)经此获取数据提供器 */
    getDataProvider(): ProjectDataProvider {
        return this.dataProvider;
    }

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
        if (fs.existsSync(NodePath.join(newRoot, EIDE_DIR_CONST))) {
            GlobalEvent.show_msgbox('Warning', `Target directory already contains an '${EIDE_DIR_CONST}' folder !`);
            return;
        }

        // 前置校验:必须已是 v4.2 布局(打开旧项目时会先自动迁移)
        const oldEideDir = NodePath.join(oldRoot, EIDE_DIR_CONST);
        const oldCfgText = fs.readFileSync(NodePath.join(oldEideDir, PROJECT_CONFIG_FILE_NAME), 'utf8');
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
            moveDir(oldEideDir, NodePath.join(newRoot, EIDE_DIR_CONST));
            moveDir(NodePath.join(oldRoot, AbstractProject.vsCodeDir), NodePath.join(newRoot, AbstractProject.vsCodeDir));
            for (const ws of wsFiles) {
                try { fs.renameSync(NodePath.join(oldRoot, ws), NodePath.join(newRoot, ws)); } catch { /* ignore */ }
            }

            // 3. mechanically rewrite relative paths in the v4.2 layout
            const newEideDir = NodePath.join(newRoot, EIDE_DIR_CONST);

            // 3a. rewrite absolute paths embedded in JSON/JSONC configs
            // (.code-workspace 内嵌 settings、.vscode/settings.json):这些文件里
            // 的绝对路径(如 clangd --query-driver=<abs>)不随目录搬迁自动更新,
            // 而 folders 里的相对路径('.')无需改动。
            const embeddedRewrites: string[] = [];
            const rewriteJsoncFile = (filePath: string): void => {
                if (!fs.existsSync(filePath)) { return; }
                try {
                    const original = fs.readFileSync(filePath, 'utf8');
                    const { content, rewritten } = rewriteEmbeddedAbsolutePaths(original, oldRoot, newRoot);
                    if (rewritten.length === 0 || content === original) { return; }
                    fs.writeFileSync(filePath, content, 'utf8');
                    for (const item of rewritten) {
                        embeddedRewrites.push(`${NodePath.basename(filePath)}: ${item.path}: ${item.before} -> ${item.after}`);
                    }
                } catch (error) {
                    GlobalEvent.log_error(error);
                }
            };
            for (const ws of wsFiles) { rewriteJsoncFile(NodePath.join(newRoot, ws)); }
            rewriteJsoncFile(NodePath.join(newRoot, AbstractProject.vsCodeDir, 'settings.json'));

            if (embeddedRewrites.length > 0) {
                GlobalEvent.log_info(`--- Embedded absolute paths rewritten for '${newRoot}' ---`);
                for (const line of embeddedRewrites) { GlobalEvent.log_info(line); }
            }

            const skeleton = yaml.parse(fs.readFileSync(NodePath.join(newEideDir, PROJECT_CONFIG_FILE_NAME), 'utf8'));
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
            fs.writeFileSync(NodePath.join(newEideDir, PROJECT_CONFIG_FILE_NAME), yaml.stringify(newSkeleton, { indent: 2, lineWidth: 1000 }));
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
                `Project root relocated. External refs: ${report.length}, broken: ${brokenCount}.` +
                (embeddedRewrites.length > 0 ? ` Embedded paths rewritten: ${embeddedRewrites.length}.` : '') +
                ` See 'root-audit.report.txt'.`
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

    /**
     * 导出为 v4.1 单文件工程(降级导出,供官方版 EIDE 打开或回馈上游)。
     *
     * 产出附加文件,不改动当前 v4.2 工程:`.eide/eide.4.1.yml` 单文件 +
     * `.eide/` 根下按目标名平铺的旁路文件副本。回退到官方版时用导出文件
     * 替换 eide.yml 即可;当前项目仍以 v4.2 继续运行。
     */
    public async onExportProjectAsV41(item?: ProjTreeItem) {

        const prj = this.resolveTargetOperationProject(item);
        if (!prj) {
            GlobalEvent.show_msgbox('Info', `No active project !`);
            return;
        }

        const eideDir = prj.getEideDir().path;
        const cfgFile = NodePath.join(eideDir, PROJECT_CONFIG_FILE_NAME);
        if (!fs.existsSync(cfgFile) || !isV42Skeleton(yaml.parse(fs.readFileSync(cfgFile, 'utf8')))) {
            GlobalEvent.show_msgbox('Warning',
                `This project is not in the v4.2 layout, no need to export.`);
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Export this project as a v4.1 single-file config for the official EIDE ?\n\n` +
            `Output: .eide/eide.4.1.yml (+ flat sidecar copies)\n` +
            `The current v4.2 project files are NOT modified.`,
            { modal: true }, 'Yes', 'No'
        );
        if (confirm !== 'Yes') { return; }

        if (this._opLock.isLocked(OpLockKeys.Export)) {
            GlobalEvent.show_msgbox('Warning', 'Busy, please try again later !');
            return;
        }
        this._opLock.tryAcquire(OpLockKeys.Export);

        try {
            // 先落盘,保证导出内容包含最新编辑(导出读取的是磁盘文件)
            prj.Save();

            const result = exportProjectAsV41(eideDir);

            GlobalEvent.show_msgbox('Info',
                `Exported to '${result.cfgFilePath}'` +
                (result.sidecarFiles.length > 0 ? ` (+${result.sidecarFiles.length} sidecar file(s))` : '') +
                `.\n\nTo use it with the official EIDE: replace '.eide/eide.yml' with this file.`);
        } catch (error) {
            GlobalEvent.log_error(error);
            GlobalEvent.show_msgbox('Error', `Export failed: ${(error as Error).message}`);
        } finally {
            this._opLock.release(OpLockKeys.Export);
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

            defExcludeList.push('clangd'); // clangd 配置生成器常开,导出时排除 CDB 目录(含机器相关路径)

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

    

    

    async modifyExtraCompilerArgs(type: 'file' | 'folder', item: ProjTreeItem) {

        const project = this.getProjectByTreeItem(item);
        if (!project)
            return;

        if (type == 'file') {
            modifyExtraCompilerArgs_forFile(project, item);
        }
        else { // folder
            modifyExtraCompilerArgs_forFolder(project, item);
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

