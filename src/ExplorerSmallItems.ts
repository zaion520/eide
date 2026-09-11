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
 * 资源树的小型配套类型: ItemCache / ProjectItemCache / PathCompletionItem。
 *
 * 从 EIDEProjectExplorer.ts(8753 行)拆出。
 *
 */

import { File } from '../lib/node-utility/File';
import * as vscode from 'vscode';
import { AbstractProject } from './EIDEProject';
import { ProjTreeItem } from './ProjTreeItem';
import { TreeItemType } from './types/ExplorerTypes';

export interface ItemCache {
    root: ProjTreeItem;
    [name: string]: ProjTreeItem;
}

export class ProjectItemCache {

    // <projectPath, {root: TreeItem, itemList: TreeItem[]}>
    private itemCache: Map<string, ItemCache> = new Map();

    clear() {
        this.itemCache.clear();
    }

    getRootTreeItem(prj: AbstractProject): ProjTreeItem | undefined {
        const cache = this.itemCache.get(prj.getWsPath());
        if (cache) {
            return cache.root;
        }
    }

    getTreeItem(prj: AbstractProject, itemType: TreeItemType): ProjTreeItem | undefined {
        const cache = this.itemCache.get(prj.getWsPath());
        if (cache) {
            return cache[TreeItemType[itemType]];
        }
    }

    setTreeItem(prj: AbstractProject, item: ProjTreeItem, isRoot?: boolean) {
        const cache = this.itemCache.get(prj.getWsPath());
        if (cache) {
            if (isRoot) {
                cache.root = item;
            } else {
                cache[TreeItemType[item.type]] = item;
            }
        } else if (isRoot) { // if not found and type is root, set it
            this.itemCache.set(prj.getWsPath(), { root: item });
        }
    }

    delTreeItem(prj: AbstractProject, itemType?: TreeItemType): ProjTreeItem | undefined {
        const cache = this.itemCache.get(prj.getWsPath());
        if (cache) {
            if (itemType) {
                const key = TreeItemType[itemType];
                const deleted = cache[key];
                cache[key] = <any>undefined; // del item
                return deleted;
            } else { // del all
                this.itemCache.delete(prj.getWsPath());
            }
        }
    }
}

export class PathCompletionItem extends vscode.CompletionItem {

    file: File;

    constructor(f: File) {

        super(f.name);

        this.file = f;

        if (f.IsExist()) {
            this.kind = f.IsDir() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File;
        }

        this.detail = f.path;
        this.insertText = f.name;
    }
}
