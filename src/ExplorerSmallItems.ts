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
