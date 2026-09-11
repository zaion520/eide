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
 * 虚拟源(virtual source)实现 —— 从 EIDEProject.ts 下沉而来。
 *
 * 为什么单独成模块: 这类原先住在上帝文件 \`EIDEProject.ts\` 里, 而配置模块
 * \`EIDETypeDefine.ts\` 需要反向 import 它(值, 非类型) —— 于是形成
 * \`EIDEProject ↔ EIDETypeDefine\` 的运行时环。下沉后:
 *   - 本模块对本仓模块**只有 type-only 依赖**(AbstractProject 仅作类型, 类内无静态调用)
 *   - EIDEProject.ts 保留 \`export { VirtualSource } from './VirtualSource'\` 兼容既有引用点
 *   - EIDETypeDefine.ts 改为从本模块导入 → 运行时环即断开
 *
 * 约束: 新增对本仓模块的**值**导入会重新引入环, 请保持 type-only。
 */

import { File } from '../lib/node-utility/File';
import * as events from 'events';
import * as NodePath from 'path';

import type { AbstractProject, SourceProvider, SourceChangedEvent } from './EIDEProject';
import type { VirtualFolder, VirtualFile, ProjectConfigData, FileGroup } from './EIDETypeDefine';

export class VirtualSource implements SourceProvider {

    public static rootName = '<virtual_root>';

    private project: AbstractProject;
    private config: ProjectConfigData<any>;
    private _event: events.EventEmitter;

    on(event: 'dataChanged', listener: (event: SourceChangedEvent) => void): void;
    on(event: any, listener: (arg: any) => void): void {
        this._event.on(event, listener);
    }

    private emit(event: 'dataChanged', e: SourceChangedEvent): void;
    private emit(event: any, arg?: any): void {
        this._event.emit(event, arg);
    }

    constructor(prj: AbstractProject) {
        this.project = prj;
        this.config = <any>null;
        this._event = new events.EventEmitter();
    }

    public static isVirtualPath(path: string): boolean {
        return path.startsWith(VirtualSource.rootName);
    }

    public static toAbsPath(...paths: string[]): string {
        if (paths.length == 0) return VirtualSource.rootName;
        return VirtualSource.rootName + '/' + paths.join('/');
    }

    public getRoot(): VirtualFolder {
        return this.config.virtualFolder;
    }

    private getFolderByName(vFolder: VirtualFolder, name: string): VirtualFolder | undefined {
        for (const folder of vFolder.folders) {
            if (folder.name === name) {
                return folder;
            }
        }
    }

    traverse(func: (folderInfo: { path: string, folder: VirtualFolder }) => void) {

        const folderStack: { path: string, folder: VirtualFolder }[] = [];

        // put root folders
        const rootFolder = this.getFolder();
        if (rootFolder) {
            folderStack.push({
                path: rootFolder.name,
                folder: rootFolder
            });
        }

        let curFolder: { path: string, folder: VirtualFolder };

        while (folderStack.length > 0) {
            curFolder = <any>folderStack.pop();
            func(curFolder);
            for (const vFolder of curFolder.folder.folders) {
                folderStack.push({
                    path: `${curFolder.path}/${vFolder.name}`,
                    folder: vFolder
                });
            }
        }
    }

    // load

    load(notEmitEvt?: boolean) {
        this.config = this.project.GetConfiguration().config;
        // refresh all
        if (!notEmitEvt) { this.forceUpdateAllFolders(); }
    }

    // get

    getFolder(vpath?: string): VirtualFolder | undefined {
        if (vpath === undefined || vpath === VirtualSource.rootName) {
            return this.getRoot();
        } else {
            const nameList = vpath.split('/');
            let cur_folder: VirtualFolder = {
                name: '/',
                files: [],
                folders: [this.getRoot()]
            };
            for (const name of nameList) {
                const next = this.getFolderByName(cur_folder, name);
                if (next) {
                    cur_folder = next;
                } else {
                    return undefined;
                }
            }
            return cur_folder;
        }
    }

    getFile(vpath: string): VirtualFile | undefined {
        const vFolder = this.getFolder(NodePath.dirname(vpath));
        if (vFolder) {
            const fileName = NodePath.basename(vpath);
            const index = vFolder.files.findIndex((file) => NodePath.basename(file.path) == fileName);
            if (index !== -1) {
                return vFolder.files[index];
            }
        }
    }

    // implement

    getFileGroups(): FileGroup[] {

        const result: FileGroup[] = [];

        this.traverse((folderInfo) => {
            result.push({
                name: folderInfo.path,
                disabled: this.project.isExcluded(folderInfo.path) || undefined,
                files: folderInfo.folder.files.map((vFile) => {
                    const file = new File(this.project.ToAbsolutePath(vFile.path));
                    const vFilePath = `${folderInfo.path}/${file.name}`;
                    return {
                        file: file,
                        disabled: this.project.isExcluded(vFilePath) || undefined
                    };
                })
            });
        });

        return result;
    }

    notifyUpdateFile(virtualPath: string): void {

        if (!virtualPath.startsWith(VirtualSource.rootName)) {
            return; // if it's not a virtual file, exit
        }

        this.emit('dataChanged', 'fileStatusChanged');
    }

    notifyUpdateFolder(virtualPath: string): void {

        if (!virtualPath.startsWith(VirtualSource.rootName)) {
            return; // if it's not a virtual folder, exit
        }

        const vFolder = this.getFolder(virtualPath);
        if (vFolder) {
            this.emit('dataChanged', 'folderStatusChanged');
        }
    }

    forceUpdateAllFolders(): void {
        this.emit('dataChanged', 'folderStatusChanged');
    }

    // set

    addFile(vfolder_path: string, fspath: string): VirtualFile | undefined {
        const folder = this.getFolder(vfolder_path);
        if (folder) {
            const vFilePath = `${vfolder_path}/${NodePath.basename(fspath)}`;
            if (this.getFile(vFilePath) === undefined) { // file is not existed, add it
                const vFile: VirtualFile = { path: this.project.toRelativePath(fspath) };
                folder.files.push(vFile);
                this.emit('dataChanged', 'folderChanged');
                return vFile;
            }
        }
    }

    addFiles(folder_path: string, pathList: string[]): VirtualFile[] | undefined {

        const folder = this.getFolder(folder_path);
        if (folder) {

            const doneList: VirtualFile[] = [];

            for (const abspath of pathList) {
                const vFilePath = `${folder_path}/${NodePath.basename(abspath)}`;
                if (this.getFile(vFilePath) === undefined) { // file is not existed, add it
                    const vFile: VirtualFile = { path: this.project.toRelativePath(abspath) };
                    folder.files.push(vFile);
                    doneList.push(vFile);
                }
            }

            if (doneList.length > 0) {
                this.emit('dataChanged', 'folderChanged');
            }

            return doneList;
        }
    }

    removeFile(vpath: string): VirtualFile | undefined {
        const basename = NodePath.basename(vpath);
        const vFolder = this.getFolder(NodePath.dirname(vpath));
        if (vFolder) {
            const index = vFolder.files.findIndex((f) => NodePath.basename(f.path) == basename);
            if (index !== -1) {
                const rmFile = vFolder.files.splice(index, 1)[0];
                this.emit('dataChanged', 'folderChanged');
                return rmFile;
            }
        }
    }

    addFolder(name: string, parent_path?: string): VirtualFolder | undefined {
        const vFolder = this.getFolder(parent_path);
        if (vFolder) {
            const index = vFolder.folders.findIndex((f) => { return f.name === name; });
            if (index === -1) {
                //const vFolderPath = `${parent_path || VirtualSource.rootName}/${name}`;
                const nFolder: VirtualFolder = { name: name, files: [], folders: [] };
                vFolder.folders.push(nFolder);
                this.emit('dataChanged', 'folderChanged');
                return nFolder;
            }
        }
    }

    insertFolder(parentvPath: string, nFolder: VirtualFolder): string | undefined {
        const vFolder = this.getFolder(parentvPath);
        if (vFolder) {
            const index = vFolder.folders.findIndex((f) => f.name == nFolder.name);
            if (index === -1) {
                vFolder.folders.push(nFolder);
                this.emit('dataChanged', 'folderChanged');
                return `${parentvPath}/${nFolder.name}`;
            }
        }
    }

    removeFolder(path: string): VirtualFolder | undefined {
        const name = NodePath.basename(path);
        const vFolder = this.getFolder(NodePath.dirname(path));
        if (vFolder) {
            const index = vFolder.folders
                .findIndex((f) => { return f.name === name; });
            if (index !== -1) {
                const rmFolder = vFolder.folders.splice(index, 1)[0];
                this.emit('dataChanged', 'folderChanged');
                return rmFolder;
            }
        }
    }

    isFolder(path: string): boolean {
        return this.getFolder(path) !== undefined;
    }

    renameFolder(vpath: string, newName: string): VirtualFolder | undefined {
        const vFolder = this.getFolder(vpath);
        if (vFolder) {
            vFolder.name = newName;
            this.emit('dataChanged', 'folderChanged');
            return vFolder;
        }
    }
}
