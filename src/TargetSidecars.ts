/**
 * Per-target sidecar file helpers.
 *
 * EIDE 会在 `.eide/` 下以 target 名为键存储一些旁路数据:
 *  - `env.ini` 中以 `[<targetName>]` 段落覆盖项目环境变量(段名匹配大小写不敏感)
 *  - `<target>.libs.yml`(文件名小写)
 *  - `files.options.yml` 中以 target 名为键的源文件额外编译参数
 *  - `<target>.st.option.bytes.ini`(文件名小写)
 *
 * 本模块提供这些旁路数据的纯文本/命名规则处理,文件读写由调用方完成。
 */

function normalizeSectionName(name: string): string {
    return String(name || '').trim().toLowerCase();
}

export interface IniSection {
    /** 段名(不含方括号,保留原始大小写) */
    name: string;
    /** 段头行在原文中的行号(0-based) */
    headerLine: number;
    /** 段体结束行号(不含段头;若段为空则等于 headerLine) */
    endLine: number;
}

/** 解析 ini 文本中的段落布局(全局区视为一个 name 为 undefined 的段落) */
export function parseIniSections(text: string): IniSection[] {
    const lines = String(text || '').split(/\r\n|\n|\r/);
    const sections: IniSection[] = [];
    let current: IniSection | undefined;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*\[(.+)\]\s*$/);
        if (match) {
            if (current) { current.endLine = i - 1; }
            current = { name: match[1], headerLine: i, endLine: i };
            sections.push(current);
        }
    }
    if (current) { current.endLine = lines.length - 1; }

    return sections;
}

export function hasIniSection(text: string, name: string): boolean {
    const wanted = normalizeSectionName(name);
    return parseIniSections(text).some((section) => normalizeSectionName(section.name) === wanted);
}

/**
 * 删除指定段落(大小写不敏感);段名不存在时原样返回。
 * 段体范围内(含段内空行)一并删除,段落之外的内容保持不变。
 */
export function removeIniSection(text: string, name: string): string {
    const wanted = normalizeSectionName(name);
    if (!wanted) { return text; }

    const eolMatch = String(text || '').match(/\r\n|\n|\r/);
    const eol = eolMatch ? eolMatch[0] : '\n';
    const lines = String(text || '').split(/\r\n|\n|\r/);

    const sections = parseIniSections(text)
        .filter((section) => normalizeSectionName(section.name) === wanted)
        .sort((a, b) => b.headerLine - a.headerLine); // 从后往前删,避免行号偏移

    if (!sections.length) { return text; }

    for (const section of sections) {
        lines.splice(section.headerLine, section.endLine - section.headerLine + 1);
    }

    return lines.join(eol);
}

/** 将段落 `oldName` 改名为 `newName`(大小写不敏感匹配,内容与位置保持不变) */
export function renameIniSection(text: string, oldName: string, newName: string): string {
    const wanted = normalizeSectionName(oldName);
    if (!wanted) { return text; }

    const lines = String(text || '').split(/\r\n|\n|\r/);
    const sections = parseIniSections(text).filter((section) => normalizeSectionName(section.name) === wanted);
    if (!sections.length) { return text; }

    for (const section of sections) {
        lines[section.headerLine] = `[${newName}]`;
    }

    // 保持原文的行尾风格
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return lines.join(eol);
}

/**
 * 将段落 `fromName` 复制为 `toName`(大小写不敏感匹配)。
 * 源段落不存在、或目标段落已存在时原样返回。
 */
export function copyIniSection(text: string, fromName: string, toName: string): string {
    const wanted = normalizeSectionName(fromName);
    if (!wanted) { return text; }
    if (hasIniSection(text, toName)) { return text; }

    const lines = String(text || '').split(/\r\n|\n|\r/);
    const section = parseIniSections(text)
        .filter((item) => normalizeSectionName(item.name) === wanted)
        .pop();
    if (!section) { return text; }

    const cloned = lines
        .slice(section.headerLine, section.endLine + 1)
        .map((line, index) => (index === 0 ? `[${toName}]` : line));

    lines.splice(section.endLine + 1, 0, ...cloned);

    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return lines.join(eol);
}

/** `<target>.libs.yml` 文件名(与历史行为一致:target 名小写) */
export function getTargetLibsFileName(targetName: string): string {
    return `${targetName.toLowerCase()}.libs.yml`;
}

/** `<target>.st.option.bytes.ini` 文件名(与历史行为一致:target 名小写) */
export function getTargetOptionBytesFileName(targetName: string): string {
    return `${targetName.toLowerCase()}.st.option.bytes.ini`;
}
