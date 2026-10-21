#!/usr/bin/env node
/**
 * fix-vsix-nls.js — 给 vsix 补齐「小写 locale」的 package.nls 文件。
 *
 * 为什么需要:
 *   VSCode 的 findMessageBundles() 用 **精确大小写** 拼文件名:
 *       `<ext>/package.nls.${language}.json`
 *   其中 language 已被 toLowerCase() 规范化(zh-cn)。找不到时按 '-' 逐级截断
 *   (zh-cn → zh), 再找不到就回退 package.nls.json(英文)。
 *
 *   Windows 文件系统大小写不敏感, 仓库里叫 package.nls.zh-CN.json 也能命中;
 *   但 Linux/macOS 大小写敏感 —— `package.nls.zh-cn.json` 找不到 → 剥成 zh
 *   也找不到 → 整个扩展回退英文。表现就是「运行时提示是中文, 但右键菜单/命令
 *   标题是英文」(菜单标题来自 package.json 的 %key% → package.nls.*.json)。
 *
 *   而 Windows 上又没法直接建两个只差大小写的文件(NTFS 查询不敏感, readdir 只
 *   返回一个), 所以只能在打包产物里注入 —— vsix 是 zip, 条目名区分大小写。
 *
 * 用法:
 *   node scripts/fix-vsix-nls.js <path-to.vsix>
 *
 * 行为:
 *   - 扫描 zip 里所有 extension/package.nls.<locale>.json
 *   - 为每个 locale 补齐全小写与首字母大写两种写法(zh-cn 与 zh-CN)
 *   - 已存在则跳过(幂等); 无缺失则不动
 *   - 原地重写 vsix(先写临时文件再 rename, 避免中途失败破坏原包)
 *
 * 依赖: 只用 Node 内置 zlib, 自实现 zip 读写(仓库已有该实现, 见下方)。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- 最小 zip 读取(中央目录解析) ----

/** 定位 EOCD(End Of Central Directory)。zip 尾部可能带注释, 故从后往前扫。 */
function findEocd(buf) {
    const sig = 0x06054b50;
    const min = Math.max(0, buf.length - 0xffff - 22);
    for (let i = buf.length - 22; i >= min; i--) {
        if (buf.readUInt32LE(i) === sig) return i;
    }
    return -1;
}

/** 解析 zip, 返回 [{name, method, compressedSize, uncompressedSize, localOffset, crc}] */
function readCentralDirectory(buf) {
    const eocd = findEocd(buf);
    if (eocd < 0) throw new Error('not a zip file (EOCD not found)');
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central dir entry at ${p}`);
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const compressedSize = buf.readUInt32LE(p + 20);
        const uncompressedSize = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset, flags });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, cdOffset, cdSize, eocd, count };
}

/** 读单个条目的原始(解压后)数据 */
function readEntryData(buf, entry) {
    const p = entry.localOffset;
    if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const dataStart = p + 30 + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

// ---- 最小 zip 写出 ----

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/**
 * 写 zip。entries: [{name, data}] 或 [{name, method, data}]。
 * 统一用 deflate(与 vsce 产物一致); 空文件也用 deflate 以免解压侧差异。
 */
function writeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf8');
        const data = e.data;
        const crc = crc32(data);
        const compressed = zlib.deflateRawSync(data, { level: 9 });
        const method = 8;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);           // version needed
        local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 name
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);           // mod time
        local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);           // extra len

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);         // version made by
        central.writeUInt16LE(20, 6);         // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);         // extra
        central.writeUInt16LE(0, 32);         // comment
        central.writeUInt16LE(0, 34);         // disk start
        central.writeUInt16LE(0, 36);         // internal attrs
        // external attrs: 高 16 位是 Unix mode。用 >>> 保证无符号(0o100644<<16 会溢出成负数)
        central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);

        locals.push(local, nameBuf, compressed);
        centrals.push(central, nameBuf);
        offset += local.length + nameBuf.length + compressed.length;
    }

    const cdBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, cdBuf, eocd]);
}

// ---- 主逻辑 ----

/** 匹配 extension/package.nls.<locale>.json 及 extension/l10n/bundle.l10n.<locale>.json */
const NLS_RE = /^(.*\/)?(package\.nls|bundle\.l10n)\.([A-Za-z0-9-]+)\.json$/;

function main() {
    const vsix = process.argv[2];
    if (!vsix) {
        console.error('用法: node scripts/fix-vsix-nls.js <path-to.vsix>');
        process.exit(1);
    }
    if (!fs.existsSync(vsix)) {
        console.error(`vsix 不存在: ${vsix}`);
        process.exit(1);
    }

    const buf = fs.readFileSync(vsix);
    const { entries } = readCentralDirectory(buf);

    const byName = new Map();
    for (const e of entries) byName.set(e.name, e);

    // 找出需要补别名的条目。
    //
    // 两个方向都要补:
    //   - 只有 zh-CN -> 补 zh-cn (Linux/macOS 需要)
    //   - 只有 zh-cn -> 补 zh-CN (Windows 打包时 readdir 只返回一个, 大小写随机)
    // 已存在则跳过, 因此幂等。
    const additions = [];
    for (const e of entries) {
        const m = NLS_RE.exec(e.name);
        if (!m) continue;
        const [, dir = '', prefix, locale] = m;
        const lower = locale.toLowerCase();
        // 全小写 + 标准 BCP 47 写法(语言小写 / 地区大写): zh-cn -> zh-CN
        const canonical = lower.replace(/-([a-z]{2})$/, (_, r) => '-' + r.toUpperCase());
        const variants = new Set([lower, canonical]);
        for (const v of variants) {
            if (v === locale) continue;                  // 与自身同名
            const aliasName = `${dir}${prefix}.${v}.json`;
            if (byName.has(aliasName)) continue;         // 已存在, 幂等跳过
            if (additions.some(a => a.name === aliasName)) continue;
            additions.push({ name: aliasName, data: readEntryData(buf, e), from: e.name });
        }
    }

    if (additions.length === 0) {
        console.log('无需修补: 每个 locale 的大小写变体都已存在');
        return;
    }

    // 重建 zip: 原条目原样复制数据, 追加新条目
    const out = [];
    for (const e of entries) out.push({ name: e.name, data: readEntryData(buf, e) });
    for (const a of additions) out.push({ name: a.name, data: a.data });

    const tmp = `${vsix}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, writeZip(out));
    fs.renameSync(tmp, vsix);

    for (const a of additions) console.log(`+ ${a.name}  (复制自 ${a.from})`);
    console.log(`已修补 ${additions.length} 个条目 -> ${path.basename(vsix)}`);
}

if (require.main === module) main();

module.exports = { readCentralDirectory, readEntryData, writeZip, crc32 };
