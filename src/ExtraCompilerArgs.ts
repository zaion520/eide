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
 * 编译器附加参数(--cc.../as... 之类)的编辑器交互与落盘逻辑 —— 从 EIDEProjectExplorer.ts 的 ProjectExplorer 类提取的零 this 依赖方法。
 *
 * 由 scripts/extract-methods.mjs 自动生成: 原方法是零 this 依赖的私有方法,
 * 提取为纯函数后由 ProjectExplorer 直接调用(调用点已自动改写)。
 */
import * as fs from 'fs';
import * as NodePath from 'path';
import * as os from 'os';
import * as yml from 'yaml';
import { TreeItemType } from './types/ExplorerTypes';
import type { VirtualFileInfo } from './types/ExplorerTypes';
import { ProjTreeItem } from './ProjTreeItem';
import { File } from '../lib/node-utility/File';
import { AbstractProject, VirtualSource } from './EIDEProject';
import { VirtualFile } from './EIDETypeDefine';
import { ArmBaseCompileData, getRamRomName, getRamRomRange } from './EIDEProjectModules';
import { getLocalLanguageType, LanguageIndexs } from './StringTable';
import { ArrayDelRepetition } from '../lib/node-utility/Utility';
import { WebPanelManager } from './WebPanelManager';
import { SimpleUIConfig, SimpleUIConfigData_input, SimpleUIConfigData_options, SimpleUIConfigData_text, SimpleUIConfigData_boolean, SimpleUIConfigData_divider } from './SimpleUIDef';

export async function modifyExtraCompilerArgs_forFile(project: AbstractProject, item: ProjTreeItem) {
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

export async function modifyExtraCompilerArgs_forFolder(project: AbstractProject, item: ProjTreeItem) {

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
