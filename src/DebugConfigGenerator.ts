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
 * cortex-debug 调试配置模板生成(jlink/openocd/pyocd)与工具链适配 —— 从 EIDEProjectExplorer.ts 的 ProjectExplorer 类提取的零 this 依赖方法。
 *
 * 由 scripts/extract-methods.mjs 自动生成: 原方法是零 this 依赖的私有方法,
 * 提取为纯函数后由 ProjectExplorer 直接调用(调用点已自动改写)。
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as yml from 'yaml';
import { File } from '../lib/node-utility/File';
import { AbstractProject } from './EIDEProject';
import { WARNING, getLocalLanguageType, LanguageIndexs } from './StringTable';
import { JLinkOptions, JLinkProtocolType, OpenOCDFlashOptions, PyOCDFlashOptions } from './HexUploader';
import { openocd_getConfigList, pyocd_getTargetList } from './utility';
import { WebPanelManager } from './WebPanelManager';
import { SimpleUIConfig, SimpleUIConfigData_input, SimpleUIConfigData_options } from './SimpleUIDef';

export async function genDebugConfig_internal(
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
