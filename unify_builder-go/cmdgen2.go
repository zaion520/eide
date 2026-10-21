package main

// CmdGenerator 命令生成核心,对照 C# 764-2251 行。

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// formatVarInCompilerOptions(764-795):注意 C# 只替换每个字符串中"第一个" ${KEY}。
func (g *CmdGenerator) formatVarInCompilerOptions(model *JObj, opts []string, userParams []*JObj) {
	for i := 0; i < len(opts); i++ {
		m := reVarExpr.FindStringSubmatch(opts[i])
		if m == nil || len(m) < 2 {
			continue
		}
		key := m[1]
		if !model.Has(key) {
			continue
		}
		field := model.Get(key).Obj
		if field == nil {
			continue
		}
		paramsVal := g.mergeParamsList(userParams, key, field.Str("type"))
		cmdStr := g.getCommandValue(field, paramsVal)
		opts[i] = strings.Replace(opts[i], "${"+key+"}", cmdStr, 1)
	}
}

// isArmGnuAsmFile(796-834)
func isArmGnuAsmFile(fpath string) bool {
	lineLimit := 200
	data, err := os.ReadFile(fpath)
	if err != nil {
		return false
	}
	var reLabel = regexp.MustCompile(`^\s*\.(?:syntax|arch|section|global)\s+`)
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, ";") {
			return false
		}
		if strings.HasPrefix(line, "/*") || strings.HasPrefix(line, "//") {
			return true
		}
		if reLabel.MatchString(line) {
			return true
		}
		lineLimit--
		if lineLimit <= 0 {
			break
		}
	}
	return false
}

// fromCFile/fromCppFile/fromAsmFile(835-862)
func (g *CmdGenerator) fromCFile(fpath string, onlyDumpArgs bool) CmdInfo {
	return g.fromModel("c", "language-c", fpath, onlyDumpArgs)
}
func (g *CmdGenerator) fromCppFile(fpath string, onlyDumpArgs bool) CmdInfo {
	return g.fromModel("cpp", "language-cpp", fpath, onlyDumpArgs)
}
func (g *CmdGenerator) fromAsmFile(fpath string, onlyDumpArgs bool) CmdInfo {
	asmType := "asm"
	if g.asmCompilerName == "asm-auto" && g.toolID == "AC6" && isArmGnuAsmFile(fpath) {
		asmType = "asm-clang"
	}
	return g.fromModel(asmType, "", fpath, onlyDumpArgs)
}

// getUserSpecifiedModelName 见 cmdgen.go

// getOutName/getBuildConfigName(1340-1349)
func (g *CmdGenerator) getOutName() string {
	if g.params.Has("name") {
		return g.params.Str("name")
	}
	return "main"
}
func (g *CmdGenerator) getBuildConfigName() string {
	if g.params.Has("target") {
		return g.params.Str("target")
	}
	return "Debug"
}

// toAbsPathByProjectRoot(1350-1360)
func (g *CmdGenerator) toAbsPathByProjectRoot(p string) string {
	if isAbsolutePath(p) {
		return p
	}
	return g.cwd + localSep() + p
}

// getActivedRawToolPath / getActivedToolFullPath(1395-1413)
func (g *CmdGenerator) getActivedRawToolPath(name string) string {
	return g.models[name].Str("$path")
}
func (g *CmdGenerator) getActivedToolFullPath(name string) string {
	if cached, ok := g.toolPathCache[name]; ok {
		return cached
	}
	resolved := g.resolveToolPath(g.binDir + g.getActivedRawToolPath(name))
	if g.toolPathCache == nil {
		g.toolPathCache = make(map[string]string)
	}
	g.toolPathCache[name] = resolved
	return resolved
}

// resolveToolPath: 把"模型里声明的工具路径"解析成磁盘上真实存在的文件。
//
// 背景(实测): Windows 专用工具链(AC5/AC6/IAR/Keil C51 等)的模型里 "$path" 不带
// 后缀(如 "bin/armclang"), 因为 prepareModel 只在 osWin32 时补 ".exe"。但在
// Linux/macOS 上用 Wine 安装这些工具链时, 目录里只有 armclang.exe, 于是
// checkTool 的 os.Stat 失败, 报 "Not found 'C Compiler'"。
//
// 这里做一次惰性回退: 原路径不存在且不是 Windows 时, 尝试追加 ".exe"。
// 只在文件确实存在时才替换, 因此对 Linux 原生工具链(GCC 等)零影响。
func (g *CmdGenerator) resolveToolPath(path string) string {
	if osWin32 || path == "" {
		return path
	}
	// binDir 是 "%TOOL_DIR%\" 形态(环境变量在运行时设置), 必须先展开才能 stat
	probe := replaceEnvVariable(path, false)
	if st, err := os.Stat(probe); err == nil && !st.IsDir() {
		return path
	}
	if strings.HasSuffix(strings.ToLower(path), ".exe") {
		return path
	}
	// Wine 装的 Windows 工具链: 模型里无 .exe 后缀, 但目录里只有 xxx.exe
	if st, err := os.Stat(probe + ".exe"); err == nil && !st.IsDir() {
		return path + ".exe"
	}
	return path
}
func (g *CmdGenerator) getModelName() string {
	if g.model.Has("name") {
		return g.model.Str("name")
	}
	return "null"
}
func (g *CmdGenerator) getToolchainVersionMatcher() *JObj { return g.model.ObjOr("version") }
func (g *CmdGenerator) getCompilerId() string {
	if g.model.Has("id") {
		return g.model.Str("id")
	}
	return g.getModelName()
}

// toRelativePathForCompilerArgs(1973-1996)
func (g *CmdGenerator) toRelativePathForCompilerArgs(path string, quote bool, addDotPrefix bool) string {
	// Wine 工具链(PE 程序)只认 Windows 路径: 绝对路径一律转成盘符形态。
	// 相对路径不动(工具按 cwd 解析, 而 cwd 已由 EIDE 设在项目根)。
	if g.wineToolchain {
		path = toWinePath(path, g.wineDriveMaps)
	}

	if g.cwd != "" {
		if rePath := toRelativePath(g.cwd, path, false); rePath != "" {
			path = rePath
			if addDotPrefix {
				path = "." + g.argDirSep() + path
			}
		}
	}
	if g.useUnixPath {
		path = toUnixPath(path)
	}
	if quote && strings.Contains(path, " ") {
		return "\"" + path + "\""
	}
	return path
}

// argDirSep: 传给工具链的路径分隔符。
// Wine 工具链要用 "\\"(它按 Windows 语义解析), 其余用平台默认。
func (g *CmdGenerator) argDirSep() string {
	if g.wineToolchain {
		return "\\"
	}
	return localSep()
}

// getUniqueName(1998-2013)
func (g *CmdGenerator) getUniqueName(expectedName string) string {
	lower := strings.ToLower(expectedName)
	if cnt, ok := g.objNameMap[lower]; ok {
		g.objNameMap[lower] = cnt + 1
		return expectedName + "_" + itoa(g.objNameMap[lower])
	}
	g.objNameMap[lower] = 0
	return expectedName
}

func itoa(n int) string { return fmt.Sprintf("%d", n) }

// fromModel(1702-1971):单文件编译命令生成核心。
func (g *CmdGenerator) fromModel(modelName, langName, fpath string, onlyDumpArgs bool) CmdInfo {
	cModel := g.models[modelName]
	cParams := g.paramObj[modelName]
	iFormat := g.invokeFormats[modelName]

	outputSuffix := ".o"
	paramsSuffix := ".args.txt"
	isQuote := true
	if cModel.Has("$outputSuffix") {
		outputSuffix = cModel.Str("$outputSuffix")
	}
	if cModel.Has("$quotePath") {
		isQuote = cModel.BoolOr("$quotePath", true)
	}

	srcPath := toRelativePath(g.cwd, fpath, false)
	if srcPath == "" {
		srcPath = fpath
	}
	srcDir := filepath.Dir(srcPath)
	if strings.TrimSpace(srcDir) == "" {
		srcDir = "."
	}
	srcName := strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath))

	_objRootDir := g.outDir + localSep() + ".obj"
	var _outFileName string
	{
		if !onlyDumpArgs {
			_ = os.MkdirAll(_objRootDir, 0o755)
		}
		if !isAbsolutePath(srcPath) {
			pList := strings.Split(toUnixPath(srcPath), "/")
			for idx, seg := range pList {
				if seg == ".." {
					pList[idx] = "__"
				}
			}
			path := strings.Join(pList, localSep())
			fDir := filepath.Dir(path)
			if strings.TrimSpace(fDir) != "" && fDir != "." {
				if !onlyDumpArgs {
					_ = os.MkdirAll(_objRootDir+localSep()+fDir, 0o755)
				}
				_outFileName = fDir + localSep() + srcName
			} else {
				_outFileName = srcName
			}
		} else {
			fmtSrcDir := strings.Trim(toUnixPath(srcDir), "/")
			fDir := toLocalPath(reDrvLetter.ReplaceAllString(fmtSrcDir, "${drv}/"))
			if !onlyDumpArgs {
				_ = os.MkdirAll(_objRootDir+localSep()+fDir, 0o755)
			}
			_outFileName = fDir + localSep() + srcName
		}
	}
	outName := g.getUniqueName(_objRootDir + localSep() + _outFileName)
	outPath := outName + outputSuffix
	refPath := outName + ".d"
	listPath := outName + ".lst"

	compilerCmds := append([]string{}, g.baseOpts[modelName]...)

	if langName != "" && cModel.Has("$"+langName) && cParams.Has(langName) {
		langOption := cParams.Str(langName)
		if strings.TrimSpace(langOption) != "" {
			compilerCmds = append(compilerCmds,
				g.getCommandValue(cModel.Get("$"+langName).Obj, langOption))
		}
	}

	// 源文件独立参数(1843-1917)
	if sp, ok := g.srcParams[fpath]; ok && strings.TrimSpace(sp) != "" {
		srcOpts := strings.TrimSpace(sp)
		overrided := false
		for {
			m := reOverrideExpr.FindStringSubmatch(srcOpts)
			if m == nil || len(m) < 2 {
				break
			}
			srcOpts = strings.TrimSpace(m[1])
			overrided = true
		}
		if !overrided {
			compilerCmds = append(compilerCmds, g.userOpts[modelName]...)
		}
		for {
			m := reReplaceExpr.FindStringSubmatch(srcOpts)
			if m == nil {
				break
			}
			oldVal := strings.TrimSpace(m[reReplaceExpr.SubexpIndex("old")])
			newVal := ""
			if idx := reReplaceExpr.SubexpIndex("new"); idx >= 0 && idx < len(m) {
				newVal = strings.TrimSpace(m[idx])
			}
			srcOpts = srcOpts[:strings.Index(srcOpts, m[0])] + srcOpts[strings.Index(srcOpts, m[0])+len(m[0]):]
			if oldVal != "" {
				for i := range compilerCmds {
					compilerCmds[i] = strings.ReplaceAll(compilerCmds[i], oldVal, newVal)
				}
			}
		}
		if strings.TrimSpace(srcOpts) != "" {
			compilerCmds = append(compilerCmds, srcOpts)
		}
	} else {
		compilerCmds = append(compilerCmds, g.userOpts[modelName]...)
	}

	commands := append([]string{}, compilerCmds...)
	commands = filterBlank(commands)

	fOutDir := filepath.Dir(outName)
	fOutNam := filepath.Base(outName)
	reOutDir := g.toRelativePathForCompilerArgs(fOutDir, false, false)
	reSrcDir := g.toRelativePathForCompilerArgs(srcDir, false, false)
	resolveVariables := func(cmd string) string {
		t := g.expandArgs(cmd)
		t = strings.ReplaceAll(t, "${OutName}", fOutNam)
		t = strings.ReplaceAll(t, "${OutDir}", reOutDir)
		t = strings.ReplaceAll(t, "${FileName}", srcName)
		t = strings.ReplaceAll(t, "${FileDir}", reSrcDir)
		t = strings.ReplaceAll(t, "${outName}", fOutNam)
		t = strings.ReplaceAll(t, "${outDir}", reOutDir)
		t = strings.ReplaceAll(t, "${fileName}", srcName)
		t = strings.ReplaceAll(t, "${fileDir}", reSrcDir)
		return replaceEnvVariable(t, false)
	}
	for i := range commands {
		commands[i] = resolveVariables(commands[i])
	}
	sourceBaseArgs := g.cmdPrefix + strings.Join(commands, " ")

	// 输出参数拼接(1920-1952)
	{
		if cModel.Has("$listPath") {
			val := g.getCommandValue(cModel.Get("$listPath").Obj, "")
			val = strings.ReplaceAll(val, "${listPath}",
				g.toRelativePathForCompilerArgs(listPath, isQuote, true))
			if strings.TrimSpace(val) != "" {
				commands = append(commands, resolveVariables(val))
			}
		}
		outputFormat := cModel.Str("$output")
		if strings.Contains(outputFormat, "${in}") {
			outputFormat = strings.ReplaceAll(outputFormat, "${out}",
				g.toRelativePathForCompilerArgs(outPath, isQuote, true))
			outputFormat = strings.ReplaceAll(outputFormat, "${in}",
				g.toRelativePathForCompilerArgs(fpath, isQuote, true))
		} else {
			commands = append([]string{g.toRelativePathForCompilerArgs(fpath, true, true)}, commands...)
			outputFormat = strings.ReplaceAll(outputFormat, "${out}",
				g.toRelativePathForCompilerArgs(outPath, isQuote, true))
		}
		outputCmd := strings.ReplaceAll(outputFormat, "${refPath}",
			g.toRelativePathForCompilerArgs(refPath, isQuote, true))
		commands = append(commands, resolveVariables(outputCmd))
	}

	commandLines := g.cmdPrefix + strings.Join(commands, " ")
	compilerArgs := commandLines
	exeFullPath := g.getActivedToolFullPath(modelName)

	// 响应文件(1956-1964):db 模式 onlyDumpArgs=true 时跳过
	sysCmdMaxLen := sysCmdLenLimit - 1024
	if iFormat.UseFile && !onlyDumpArgs && len(compilerArgs) > sysCmdMaxLen {
		paramFile := outName + paramsSuffix
		_ = os.WriteFile(paramFile, []byte(compilerArgs), 0o644)
		commandLines = strings.ReplaceAll(iFormat.Body, "${value}", "\""+paramFile+"\"")
	}

	buildArgs := CmdInfo{
		CompilerID:        strings.ToLower(g.getCompilerId()),
		CompilerModel:     modelName,
		ExePath:           exeFullPath,
		CommandLine:       commandLines,
		SourcePath:        fpath,
		SourceType:        "other",
		SourceArgs:        compilerArgs,
		OutPath:           outPath,
		OutputEncoding:    g.encodings[modelName],
		SourceArgsChanged: true,
		BaseArgs:          sourceBaseArgs,
	}
	if strings.HasPrefix(modelName, "asm") {
		buildArgs.SourceType = "asm"
	} else {
		buildArgs.SourceType = modelName
	}
	buildArgs.ShellCommand = "\"" + replaceEnvVariable(exeFullPath, false) + "\" " +
		replaceEnvVariable(compilerArgs, false)

	// check cmd to determine source file need recompile(C# 1964-1968)
	if oldCmd, ok := tableGet(buildArgs.OutPath); ok {
		buildArgs.SourceArgsChanged = oldCmd != buildArgs.ShellCommand
	}
	return buildArgs
}

func filterBlank(list []string) []string {
	out := make([]string, 0, len(list))
	for _, s := range list {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

// toAbsolutePath(Main 5553-5563)
func toAbsolutePath(repath string) string {
	if isAbsolutePath(repath) {
		return repath
	}
	return projectRoot + localSep() + repath
}

// mergeParamsList(1613-1690)
func (g *CmdGenerator) mergeParamsList(pList []*JObj, key, paramsType string) any {
	var objList []*JVal
	for _, param := range pList {
		if param == nil || !param.Has(key) {
			continue
		}
		jv := param.Get(key)
		if len(objList) > 0 && objList[0].Kind != jv.Kind {
			objList = nil
		}
		objList = append(objList, jv)
	}
	if len(objList) == 0 {
		return nil
	}
	switch objList[0].Kind {
	case JBool:
		if objList[len(objList)-1].Bool {
			return "true"
		}
		return "false"
	case JNumber:
		return objList[len(objList)-1].AsString()
	case JString:
		if paramsType == "selectable" || paramsType == "keyValue" {
			return objList[len(objList)-1].Str
		}
		var result string
		for _, jv := range objList {
			if result == "" {
				result = jv.Str
			} else {
				result += " " + jv.Str
			}
		}
		return result
	case JArray:
		var list []string
		for _, jv := range objList {
			list = append(list, jv.ValuesOfString()...)
		}
		return list
	}
	return nil
}

// getCommandValue(2027-2125)
func (g *CmdGenerator) getCommandValue(option *JObj, value any) string {
	optType := option.Str("type")

	if optType == "list" {
		if value != nil {
			switch value.(type) {
			case string, []string:
			default:
				return ""
			}
		}
	} else if value != nil {
		if _, ok := value.(string); !ok {
			return ""
		}
	}

	prefix, suffix := "", ""
	if option.Has("prefix") {
		prefix = option.Str("prefix")
	}
	if option.Has("suffix") {
		suffix = option.Str("suffix")
	}
	var command string

	switch optType {
	case "selectable":
		cmdObj := option.ObjOr("command")
		sv, _ := value.(string)
		if value != nil && cmdObj.Has(sv) {
			command = cmdObj.Str(sv)
		} else {
			command = cmdObj.Str("false")
		}
	case "keyValue":
		enumObj := option.ObjOr("enum")
		sv, _ := value.(string)
		if value != nil && enumObj.Has(sv) {
			command = option.Str("command") + enumObj.Str(sv)
		} else {
			command = option.Str("command") + enumObj.Str("default")
		}
	case "value":
		if value != nil {
			command = option.Str("command") + value.(string)
		}
	case "list":
		var cmdList, valList []string
		cmd := option.Str("command")
		if value != nil {
			switch v := value.(type) {
			case string:
				valList = append(valList, v)
			case []string:
				valList = append(valList, v...)
			}
			var valueMapper *JObj
			if option.Has("mapper") {
				valueMapper = option.ObjOr("mapper")
			}
			for _, item := range valList {
				val := item
				// Wine 工具链: list 型选项(如 linker 的 --scatter)是绝对路径且原样透传,
				// 必须在这里转换, 否则 PE 程序收到 POSIX 路径会报 L6031U。
				if g.wineToolchain {
					val = toWinePath(val, g.wineDriveMaps)
				}
				if valueMapper != nil {
					for _, mk := range valueMapper.Keys() {
						re, err := regexp.Compile(mk)
						if err != nil {
							continue
						}
						val = re.ReplaceAllString(val, valueMapper.Str(mk))
					}
				}
				cmdList = append(cmdList, cmd+val)
			}
			command = strings.Join(cmdList, " ")
		}
	default:
		return ""
	}
	if command == "" {
		return ""
	}
	return prefix + command + suffix
}

// getIncludesCmdLine(2126-2140)
func (g *CmdGenerator) getIncludesCmdLine(modelName string, incList []string) string {
	fm, ok := g.formats[modelName]["$includes"]
	if !ok {
		return ""
	}
	var cmds []string
	for _, inc := range incList {
		cmds = append(cmds, strings.ReplaceAll(fm.Body, "${value}",
			g.toRelativePathForCompilerArgs(inc, !fm.NoQuotes, false)))
	}
	return fm.Prefix + strings.Join(cmds, fm.Sep) + fm.Suffix
}

// getdefinesCmdLine(2141-2232)
func (g *CmdGenerator) getdefinesCmdLine(modelName string, defList []string) string {
	fm, ok := g.formats[modelName]["$defines"]
	if !ok {
		return ""
	}
	var cmds []string
	reQuotedSingle := regexp.MustCompile(`^'(?<val>.*)'$`)
	reQuotedDouble := regexp.MustCompile(`^"(?<val>.*)"$`)
	reEscapeDouble := regexp.MustCompile(`^"(?<val>.*)"$`)
	for _, define := range defList {
		var macro, value string
		if idx := strings.Index(define, "="); idx >= 0 {
			macro = strings.TrimSpace(define[:idx])
			value = strings.TrimSpace(define[idx+1:])
		}
		if strings.TrimSpace(macro) != "" && strings.TrimSpace(value) != "" {
			if g.getCompilerId() == "KEIL_C51" {
				escapeChar := "'"
				if reQuotedSingle.MatchString(value) {
					escapeChar = "\""
				} else if reQuotedDouble.MatchString(value) {
					escapeChar = "'"
				}
				value = escapeChar + value + escapeChar
			} else {
				value = reEscapeDouble.ReplaceAllString(value, "\\\"${val}\\\"")
			}
			s := strings.ReplaceAll(fm.Body, "${key}", macro)
			s = strings.ReplaceAll(s, "${value}", value)
			cmds = append(cmds, s)
		} else {
			macro = strings.TrimSpace(define)
			if macro == "" {
				continue
			}
			var macroStr string
			if modelName == "asm" {
				macroStr = strings.ReplaceAll(strings.ReplaceAll(fm.Body, "${key}", macro), "${value}", "1")
			} else if fm.BodyNoVal != nil {
				macroStr = strings.ReplaceAll(*fm.BodyNoVal, "${key}", macro)
			} else {
				macroStr = strings.ReplaceAll(strings.ReplaceAll(fm.Body, "${key}", macro), "${value}", "1")
			}
			cmds = append(cmds, macroStr)
		}
	}
	return fm.Prefix + strings.Join(cmds, fm.Sep) + fm.Suffix
}

// getLibSearchFolders(2233-2251)
func (g *CmdGenerator) getLibSearchFolders(modelName string, libList []string) string {
	fm, ok := g.formats[modelName]["$libs"]
	if !ok {
		return ""
	}
	var cmds []string
	for _, dir := range libList {
		cmds = append(cmds, strings.ReplaceAll(fm.Body, "${value}",
			g.toRelativePathForCompilerArgs(dir, !fm.NoQuotes, false)))
	}
	return fm.Prefix + strings.Join(cmds, fm.Sep) + fm.Suffix
}

// expandArgs(1465-1509)
func (g *CmdGenerator) expandArgs(str_ string) string {
	str := strings.TrimSpace(str_)
	var repList []struct{ key, val string }
	for _, m := range reArgsFileVar.FindAllStringSubmatch(str, -1) {
		if len(m) < 2 {
			continue
		}
		fpath := g.toAbsPathByProjectRoot(m[1])
		data, err := os.ReadFile(fpath)
		if err != nil {
			data = nil
		}
		fcont := trimComment(string(data))
		var argLi []string
		for _, line := range splitCRLF(fcont) {
			if strings.TrimSpace(line) == "" {
				continue
			}
			argLi = append(argLi, strings.TrimSpace(line))
		}
		repList = append(repList, struct{ key, val string }{m[0], strings.TrimSpace(strings.Join(argLi, " "))})
	}
	for _, kv := range repList {
		str = strings.ReplaceAll(str, kv.key, kv.val)
	}
	return str
}

// trimComment(1511-1612):状态机去注释(/* */ // #),保留字符串。
func trimComment(txt string) string {
	var b strings.Builder
	type stkEntry string
	var stk []stkEntry
	inString := func() bool { return len(stk) > 0 && stk[len(stk)-1] == "\"" }
	inComment := func() bool { return len(stk) > 0 }
	inSingleLine := func() bool {
		return len(stk) > 0 && (stk[len(stk)-1] == "//" || stk[len(stk)-1] == "#")
	}
	chrPrev := rune(0)
	rs := []rune(txt)
	for i := 0; i < len(rs); i++ {
		chr := rs[i]
		var chrNext rune
		if i+1 < len(rs) {
			chrNext = rs[i+1]
		}
		switch {
		case inString():
			b.WriteRune(chr)
			if chr == '"' && chrPrev != '\\' {
				stk = stk[:len(stk)-1]
			}
		case inComment():
			if inSingleLine() {
				if chr == '\n' {
					b.WriteRune(chr)
					stk = stk[:len(stk)-1]
				}
			} else if chrPrev == '*' && chr == '/' {
				stk = stk[:len(stk)-1]
			}
		default:
			if chr == '#' && chrPrev != '\'' && chrNext != '\'' {
				stk = append(stk, "#")
			} else if chr == '/' && (chrNext == '/' || chrNext == '*') {
				stk = append(stk, stkEntry(string(chr)+string(chrNext)))
				chrPrev = chrNext
				i++
				continue
			} else {
				if chr == '"' && chrPrev != '\\' {
					stk = append(stk, "\"")
				}
				b.WriteRune(chr)
			}
		}
		chrPrev = chr
	}
	return b.String()
}

func splitCRLF(s string) []string { return strings.FieldsFunc(s, func(r rune) bool { return r == '\n' || r == '\r' }) }
