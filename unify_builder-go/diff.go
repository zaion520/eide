package main

// 增量编译:对照 C# checkDiff(5426-5552)、parseRefFile(5572-5657)、
// loadBuilderDatabase/saveBuilderCommands(3984-4076)。
//
// Go 版以 JSON 指纹库(outDir/.obj/objs.db.json)替代 SQLite:
//   - 格式与 C# 同步写出的 objs.db.json 完全一致([{file,command,directory} 数组]);
//   - 历史遗留的 objs.db(SQLite)不读取 → 首次运行全量重建,属预期(见施工图四)。
//   - table_compilerCmds 语义不变:记录"上次编译成功的 shellCommand",
//     fromModel 生成命令后与旧值比对 → sourceArgsChanged。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var (
	compilerCmdsMu sync.RWMutex
	// table_compilerCmds: objPath → 上次构建的 shellCommand(C# ConcurrentDictionary)
	tableCompilerCmds = map[string]string{}
)

func tableGet(objPath string) (string, bool) {
	compilerCmdsMu.RLock()
	defer compilerCmdsMu.RUnlock()
	v, ok := tableCompilerCmds[objPath]
	return v, ok
}

func tablePut(objPath, shellCmd string) {
	compilerCmdsMu.Lock()
	defer compilerCmdsMu.Unlock()
	tableCompilerCmds[objPath] = shellCmd
}

func tableClear() {
	compilerCmdsMu.Lock()
	defer compilerCmdsMu.Unlock()
	tableCompilerCmds = map[string]string{}
}

func tableCount() int {
	compilerCmdsMu.RLock()
	defer compilerCmdsMu.RUnlock()
	return len(tableCompilerCmds)
}

// ---- 指纹库(JSON 版 builder.db) ----

type dbEntry struct {
	File      string `json:"file"`
	Command   string `json:"command"`
	Directory string `json:"directory"`
}

func loadBuilderDatabase(dbpath string) {
	data, err := os.ReadFile(dbpath + ".json")
	if err != nil {
		return // 首次构建或旧 SQLite 库 → 全量重建
	}
	var entries []dbEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		warnWithLable("builder database is invalid, will rebuild all: "+err.Error()+"\r\n", true, "")
		return
	}
	compilerCmdsMu.Lock()
	defer compilerCmdsMu.Unlock()
	for _, e := range entries {
		if _, dup := tableCompilerCmds[e.File]; !dup {
			tableCompilerCmds[e.File] = e.Command
		}
	}
}

func saveBuilderCommands(dbpath string) {
	dir := filepath.Dir(dbpath)
	if dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	compilerCmdsMu.RLock()
	entries := make([]dbEntry, 0, len(tableCompilerCmds))
	for k, v := range tableCompilerCmds {
		entries = append(entries, dbEntry{File: k, Command: v, Directory: projectRoot})
	}
	compilerCmdsMu.RUnlock()
	data, err := json.Marshal(entries)
	if err != nil {
		return
	}
	_ = os.WriteFile(dbpath+".json", data, 0o644)
}

// ---- checkDiff(C# 5426-5552) ----

type checkDiffRes struct {
	cCount    int
	cppCount  int
	asmCount  int
	totalCmds []cmdEntry // 保持 C# Dictionary.Values 的插入序
}

type cmdEntry struct {
	srcPath string
	info    CmdInfo
}

func (r *checkDiffRes) addToChangeList(cmd CmdInfo) {
	switch cmd.SourceType {
	case "c":
		r.cCount++
	case "cpp":
		r.cppCount++
	case "asm":
		r.asmCount++
	}
	r.totalCmds = append(r.totalCmds, cmdEntry{srcPath: cmd.SourcePath, info: cmd})
}

var srcRefMtimeCacheMu sync.Mutex
var srcRefMtimeCache = map[string]int64{}

func getSrcRefLastModifyTime(fpath string) (int64, error) {
	srcRefMtimeCacheMu.Lock()
	defer srcRefMtimeCacheMu.Unlock()
	if t, ok := srcRefMtimeCache[fpath]; ok {
		return t, nil
	}
	st, err := os.Stat(fpath)
	if err != nil {
		return 0, err // C# FileNotFoundException
	}
	srcRefMtimeCache[fpath] = st.ModTime().UnixNano()
	return st.ModTime().UnixNano(), nil
}

// checkDiff 差异判定。diffLogs 收集原因;出错时回退 rebuild。
func checkDiff(modelID string, cmds []cmdEntry) (res *checkDiffRes, diffLogs []string, err error) {
	res = &checkDiffRes{totalCmds: make([]cmdEntry, 0, 512)}

	addLog := func(cmd CmdInfo, why string) {
		diffLogs = append(diffLogs, "'"+cmd.SourcePath+"': "+why)
	}

	for _, entry := range cmds {
		cmd := entry.info

		if st, err := os.Stat(cmd.OutPath); err != nil || st.IsDir() { // not compiled
			res.addToChangeList(cmd)
			addLog(cmd, "object (.o) file not exist")
			continue
		}
		objStat, _ := os.Stat(cmd.OutPath)
		objMtime := objStat.ModTime().UnixNano()
		srcStat, err := os.Stat(cmd.SourcePath)
		if err != nil {
			res.addToChangeList(cmd)
			addLog(cmd, "source file is missing")
			continue
		}
		srcMtime := srcStat.ModTime().UnixNano()

		// source always in build
		if alwaysInBuildSources[cmd.SourcePath] {
			res.addToChangeList(cmd)
			addLog(cmd, "source file is always in build.")
			continue
		}
		// src file is newer than obj file
		if srcMtime > objMtime {
			res.addToChangeList(cmd)
			addLog(cmd, "source file has been changed.")
			continue
		}
		// source args is changed
		if cmd.SourceArgsChanged {
			res.addToChangeList(cmd)
			addLog(cmd, "compiler options has been changed.")
			continue
		}
		// reference is changed ?
		{
			refFilePath := filepath.Dir(cmd.OutPath) + localSep() +
				strings.TrimSuffix(filepath.Base(cmd.OutPath), filepath.Ext(cmd.OutPath)) + ".d"
			if _, err := os.Stat(refFilePath); err != nil {
				res.addToChangeList(cmd)
				addLog(cmd, "dependence (.d) file not exist")
				continue
			}
			refList, err := parseRefFile(refFilePath, modelID)
			if err != nil {
				// 对齐 C#:外层异常 → 调用方回退 rebuild
				return nil, nil, err
			}
			for _, refpath := range refList {
				if refpath == cmd.OutPath || refpath == cmd.SourcePath {
					continue
				}
				mt, err := getSrcRefLastModifyTime(refpath)
				if err != nil {
					res.addToChangeList(cmd)
					addLog(cmd, "check dependence failed, msg: no such file '"+refpath+"'")
					break
				}
				if mt > objMtime {
					res.addToChangeList(cmd)
					addLog(cmd, "dependence '"+refpath+"' has been changed.")
					break
				}
			}
		}
	}
	return res, diffLogs, nil
}

// ---- parseRefFile(C# 5572-5657) ----

// splitWhitespaceEx: 对齐正则 `(?<![\\:]) ` 的分割 —— 按空格分割,
// 但前一个字符是 '\' 或 ':' 时不分割(Go regexp 无 lookbehind,手写状态机)。
func splitWhitespaceEx(line string) []string {
	var out []string
	var cur strings.Builder
	for i := 0; i < len(line); i++ {
		c := line[i]
		if c == ' ' && i > 0 && line[i-1] != '\\' && line[i-1] != ':' {
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteByte(c)
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

var mdTrimEndChars = func(r rune) bool {
	switch r {
	case '\\', ' ', '\t', '\v', '\r', '\n':
		return true
	}
	return false
}

// gnuParseRefLines(C# 5582-5619)
func gnuParseRefLines(lines []string) []string {
	seen := map[string]bool{}
	var resultList []string
	resultCnt := 0

	for lineIndex, raw := range lines {
		line := strings.TrimRight(strings.TrimSpace(raw), "\\\\\t\v\r\n ")
		// C# TrimEnd(md_trimEndChars) 去掉行尾 '\' 等
		line = strings.Trim(line, "\\ \t\v\r\n")

		if lineIndex == 0 { // '<obj>: <deps>'
			sepIndex := strings.Index(line, ": ")
			if sepIndex > 0 {
				line = strings.TrimSpace(line[sepIndex+1:])
			} else {
				continue
			}
		}

		for _, subLine := range splitWhitespaceEx(line) {
			if strings.TrimSpace(subLine) == "" {
				continue
			}
			resultCnt++
			if resultCnt == 1 {
				continue // skip first ref, it's src self
			}
			p := strings.ReplaceAll(subLine, "\\ ", " ")
			p = strings.ReplaceAll(p, "\\:", ":")
			p = strings.Trim(p, "\\ \t\v\r\n")
			abs := toAbsolutePath(p)
			if !seen[abs] {
				seen[abs] = true
				resultList = append(resultList, abs)
			}
		}
	}
	return resultList
}

// ac5ParseRefLines(C# 5621-5642)
func ac5ParseRefLines(lines []string) []string {
	seen := map[string]bool{}
	var resultList []string
	for i := 1; i < len(lines); i++ {
		sepIndex := strings.Index(lines[i], ": ")
		if sepIndex > 0 {
			line := lines[i][sepIndex+1:]
			line = strings.ReplaceAll(line, "\\ ", " ")
			line = strings.ReplaceAll(line, "\\:", ":")
			line = strings.Trim(line, "\\ \t\v\r\n")
			if strings.TrimSpace(line) == "" {
				continue
			}
			abs := toAbsolutePath(line)
			if !seen[abs] {
				seen[abs] = true
				resultList = append(resultList, abs)
			}
		}
	}
	return resultList
}

func parseRefFile(fpath, modeID string) ([]string, error) {
	data, err := os.ReadFile(fpath)
	if err != nil {
		return nil, err
	}
	text := decodeBytes(data, "ANSI")
	lines := splitLines(text)
	switch modeID {
	case "AC5", "IAR_STM8", "IAR_ARM":
		return ac5ParseRefLines(lines), nil
	default:
		return gnuParseRefLines(lines), nil
	}
}

func splitLines(s string) []string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	return lines
}

var _ = regexp.MustCompile // keep import
