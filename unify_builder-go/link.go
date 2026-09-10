package main

// 链接命令生成:对照 C# genLinkCommand(908-1260)、genLinkerExtraCommand(1308-1338)、
// getLinkerLibFlags(884-890)、getMapMatcher/getRamSizeMatcher/getRomSizeMatcher(863-882)、
// isDisableOutputTask/getOutputTaskExcludes(1444-1459)、toAbsToolPath/getOtherUtilToolFullPath(1361-1388)。

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ---- glob(DotNet.Glob 近似:* 不跨目录段,** 跨段,? 单字符,[..] 字符类) ----

func globToRegexp(pattern string) (*regexp.Regexp, error) {
	var b strings.Builder
	b.WriteString("(?s)^")
	i := 0
	for i < len(pattern) {
		c := pattern[i]
		switch c {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				b.WriteString(".*")
				i += 2
			} else {
				b.WriteString("[^/\\\\]*")
				i++
			}
		case '?':
			b.WriteString("[^/\\\\]")
			i++
		case '[':
			end := strings.IndexByte(pattern[i:], ']')
			if end < 0 {
				b.WriteString(regexp.QuoteMeta(string(c)))
				i++
				break
			}
			inner := pattern[i+1 : i+end]
			neg := false
			if strings.HasPrefix(inner, "!") {
				neg = true
				inner = inner[1:]
			}
			b.WriteString("[")
			if neg {
				b.WriteString("^")
			}
			b.WriteString(regexp.QuoteMeta(inner))
			b.WriteString("]")
			i += end + 1
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
			i++
		}
	}
	b.WriteString("$")
	return regexp.Compile(b.String())
}

// globMatch: DotNet.Glob.IsMatch 语义(默认区分大小写)
func globMatch(pattern, s string) bool {
	re, err := globToRegexp(pattern)
	if err != nil {
		return false
	}
	return re.MatchString(strings.ReplaceAll(s, "\"", ""))
}

// userObjOrderGlob(C# 2283-2287 附近定义)
type userObjOrderGlob struct {
	pattern *regexp.Regexp
	order   int
}

// ---- CmdGenerator 扩展方法 ----

// getMapMatcher(863-868)
func (g *CmdGenerator) getMapMatcher() []*regexp.Regexp {
	linkerModel := g.models["linker"]
	var list []*regexp.Regexp
	for _, s := range linkerModel.Get("$matcher").ValuesOfString() {
		if re, err := regexp.Compile("(?i)" + s); err == nil {
			list = append(list, re)
		}
	}
	return list
}

func (g *CmdGenerator) getRamSizeMatcher() *regexp.Regexp {
	if g.models["linker"].Has("$ramMatcher") {
		if re, err := regexp.Compile("(?i)" + g.models["linker"].Str("$ramMatcher")); err == nil {
			return re
		}
	}
	return nil
}

func (g *CmdGenerator) getRomSizeMatcher() *regexp.Regexp {
	if g.models["linker"].Has("$romMatcher") {
		if re, err := regexp.Compile("(?i)" + g.models["linker"].Str("$romMatcher")); err == nil {
			return re
		}
	}
	return nil
}

// getLinkerLibFlags(884-890)
func (g *CmdGenerator) getLinkerLibFlags() string {
	linkerModel := g.models["linker"]
	linkerParams := g.paramObj["linker"]
	if linkerModel.Has("$LIB_FLAGS") && linkerParams.Has("LIB_FLAGS") {
		return g.getCommandValue(linkerModel.Get("$LIB_FLAGS").Obj, anyOfJVal(linkerParams.Get("LIB_FLAGS")))
	}
	return ""
}

// anyOfJVal: Utility.getJObjectVal(177-202)
func anyOfJVal(v *JVal) any {
	if v == nil {
		return nil
	}
	switch v.Kind {
	case JString:
		return v.Str
	case JBool:
		if v.Bool {
			return "true"
		}
		return "false"
	case JNumber:
		return v.AsString()
	case JArray:
		return v.ValuesOfString()
	}
	return nil
}

// toAbsToolPath(1361-1364)
func (g *CmdGenerator) toAbsToolPath(repath string) string {
	return g.binDir + strings.ReplaceAll(repath, "${toolPrefix}", g.toolPrefix)
}

// getOtherUtilToolFullPath(1372-1377)
func (g *CmdGenerator) getOtherUtilToolFullPath(name string) string {
	path := ""
	if grp := g.model.ObjOr("groups").ObjOr(name); grp != nil && grp.Has("$path") {
		path = grp.Str("$path")
	}
	path = strings.ReplaceAll(path, "${toolPrefix}", g.toolPrefix)
	return replaceEnvVariable(g.binDir+path, false)
}

// hasOtherUtilTool(1385-1388)
func (g *CmdGenerator) hasOtherUtilTool(name string) bool {
	return g.model.ObjOr("groups").Has(name)
}

// isDisableOutputTask(1444-1449)
func (g *CmdGenerator) isDisableOutputTask() bool {
	lp := g.paramObj["linker"]
	return lp.Has("$disableOutputTask") && lp.Get("$disableOutputTask").Kind == JBool && lp.BoolOr("$disableOutputTask", false)
}

// getOutputTaskExcludes(1451-1459)
func (g *CmdGenerator) getOutputTaskExcludes() []string {
	lp := g.paramObj["linker"]
	if v := lp.Get("$outputTaskExcludes"); v != nil && v.Kind == JArray {
		return v.ValuesOfString()
	}
	return nil
}

// linkerExCmdInfo(C# 327 LinkerExCmdInfo)
type linkerExCmdInfo struct {
	CmdInfo
	Type string
}

// genLinkerExtraCommand(1308-1338)
func (g *CmdGenerator) genLinkerExtraCommand(linkerOutputFile string) []linkerExCmdInfo {
	linkerModel := g.models["linker"]
	var commandList []linkerExCmdInfo

	if !linkerModel.Has("$extraCommand") {
		return commandList
	}
	for _, item := range linkerModel.ArrOr("$extraCommand") {
		m := item.Obj
		if m == nil {
			continue
		}
		exePath := g.toAbsToolPath(m.Str("toolPath"))
		command := g.cmdPrefix + strings.ReplaceAll(m.Str("command"),
			"${linkerOutput}", g.toRelativePathForCompilerArgs(linkerOutputFile, true, true))
		command = replaceEnvVariable(command, true)
		ci := linkerExCmdInfo{}
		ci.Title = orSelf2(m.Has("name"), m.Str("name"), exePath)
		ci.Type = orSelf2(m.Has("type"), m.Str("type"), "")
		ci.ExePath = exePath
		ci.CommandLine = command
		ci.SourcePath = linkerOutputFile
		ci.OutPath = ""
		commandList = append(commandList, ci)
	}
	return commandList
}

func orSelf2(cond bool, val, def string) string {
	if cond && val != "" {
		return val
	}
	return def
}

// genLinkCommand(908-1260)
func (g *CmdGenerator) genLinkCommand(objListIn []string, cliTestMode bool, opts *Options) (CmdInfo, error) {
	linkerModel := g.models["linker"]
	linkerParams := g.paramObj["linker"]
	iFormat := g.invokeFormats["linker"]
	sep := " "
	if iFormat.UseFile && !cliTestMode {
		sep = "\r\n"
	}

	outSuffix := ".axf"
	if linkerModel.Has("$outputSuffix") {
		outSuffix = linkerModel.Str("$outputSuffix")
	}
	mapSuffix := ".map"
	if linkerModel.Has("$mapSuffix") {
		mapSuffix = linkerModel.Str("$mapSuffix")
	}
	cmdLocation := "start"
	if linkerModel.Has("$commandLocation") {
		cmdLocation = linkerModel.Str("$commandLocation")
	}
	objSep := "\r\n"
	if linkerModel.Has("$objPathSep") {
		objSep = linkerModel.Str("$objPathSep")
	}
	checkEntryOrderForSdcc := linkerModel.BoolOr("$mainFirst", false)

	libFlags := g.getLinkerLibFlags()
	outElfName := g.getOutName()
	compilerId := g.getCompilerId()

	// SDCC bundle(C# 941-1009)
	sdccBundleLibArgs := ""
	objList := append([]string{}, objListIn...)
	if !cliTestMode && compilerId == "SDCC" {
		sourcesObjs := append([]string{}, objList...)
		var finalObjsLi []string    // absolute paths
		var bundledList []string    // relative paths

		if checkEntryOrderForSdcc {
			mainName := "main"
			if linkerParams.Has("$mainFileName") {
				mainName = linkerParams.Str("$mainFileName")
			}
			index := -1
			for i, fName := range sourcesObjs {
				if strings.TrimSuffix(filepath.Base(fName), filepath.Ext(fName)) == mainName {
					index = i
					break
				}
			}
			if index != -1 {
				finalObjsLi = append(finalObjsLi, sourcesObjs[index])
				sourcesObjs = append(sourcesObjs[:index], sourcesObjs[index+1:]...)
			} else {
				return CmdInfo{}, fmt.Errorf("Not found '%s.rel' object file in output list, the '%s.rel' object file must be the first object file !", mainName, mainName)
			}
		}

		for _, objPath := range sourcesObjs {
			if strings.HasSuffix(objPath, ".lib") || strings.HasSuffix(objPath, ".a") || opts.SdccNotBundleRel {
				finalObjsLi = append(finalObjsLi, objPath)
			} else {
				bundledList = append(bundledList, g.toRelativePathForCompilerArgs(objPath, true, true))
			}
		}

		if len(bundledList) > 0 {
			bundledFullOutPath := outDir + localSep() + "no_entry_bundled.lib"
			bundledOutPath := g.toRelativePathForCompilerArgs(bundledFullOutPath, true, true)

			cliStr := strings.ReplaceAll("-rc ${out} ${in}", "${out}", bundledOutPath)
			cliStr = strings.ReplaceAll(cliStr, "${in}", strings.Join(bundledList, " "))

			cliArgsPath := strings.TrimSuffix(bundledFullOutPath, filepath.Ext(bundledFullOutPath)) + ".args.txt"
			if cliArgsPath == "" {
				return CmdInfo{}, fmt.Errorf("cannot generate '.args.txt' for: %s", bundledFullOutPath)
			}
			if err := os.WriteFile(cliArgsPath, encodeBytes(cliStr, g.encodings["linker"]), 0o644); err != nil {
				return CmdInfo{}, err
			}
			// del old .lib file
			_ = os.Remove(bundledFullOutPath)

			sdccBundleLibArgs = cliStr
			exitCode := runExeNoCapture(g.getOtherUtilToolFullPath("linker-lib"), cliStr, opts.DryRun)
			if exitCode != codeDone {
				return CmdInfo{}, fmt.Errorf("bundled lib file failed, exit code: %d", exitCode)
			}
			finalObjsLi = append(finalObjsLi, bundledFullOutPath)
		}

		objList = finalObjsLi
	}

	outName := outDir + localSep() + outElfName
	outPath := outName + outSuffix
	mapPath := outName + mapSuffix
	stableCommand := strings.Join(append(append([]string{}, g.baseOpts["linker"]...), g.userOpts["linker"]...), " ")
	cmdLine := g.cmdPrefix

	// ARM Compiler 6 on macOS only(C# 1019-1024)
	if compilerId == "AC6" && runtimeOsType() == "osx" {
		cmdLine += " --lto_liblto_location=%TOOL_DIR%/bin/libLTO.dylib "
	}

	if cmdLocation == "start" {
		cmdLine += stableCommand
		if linkerModel.Has("$linkMap") {
			cmdLine += sep + strings.ReplaceAll(
				g.getCommandValue(linkerModel.Get("$linkMap").Obj, ""),
				"${mapPath}", g.toRelativePathForCompilerArgs(mapPath, true, true))
		}
	}

	for i := range objList {
		objList[i] = g.toRelativePathForCompilerArgs(objList[i], true, true)
	}

	if !cliTestMode {
		cmdLine += sep + strings.ReplaceAll(
			strings.ReplaceAll(
				strings.ReplaceAll(linkerModel.Str("$output"),
					"${out}", g.toRelativePathForCompilerArgs(outPath, true, true)),
				"${in}", strings.Join(objList, objSep)),
			"${lib_flags}", libFlags)
	}

	if cmdLocation == "end" {
		if linkerModel.Has("$linkMap") {
			cmdLine += sep + strings.ReplaceAll(
				g.getCommandValue(linkerModel.Get("$linkMap").Obj, ""),
				"${mapPath}", g.toRelativePathForCompilerArgs(mapPath, true, true))
		}
		cmdLine += " " + stableCommand
	}

	// expand args in files
	cmdLine = g.expandArgs(cmdLine)

	// replace eide cmd vars
	reOutDir := g.toRelativePathForCompilerArgs(outDir, false, false)
	cmdLine = strings.ReplaceAll(cmdLine, "${OutName}", outElfName)
	cmdLine = strings.ReplaceAll(cmdLine, "${OutDir}", reOutDir)
	cmdLine = strings.ReplaceAll(cmdLine, "${outName}", outElfName)
	cmdLine = strings.ReplaceAll(cmdLine, "${outDir}", reOutDir)

	// replace system env
	cmdLine = replaceEnvVariable(cmdLine, false)

	// COSMIC STM8 lkf(C# 1076-1193)
	if compilerId == "COSMIC_STM8" && g.getUserSpecifiedModelName("linker") == "linker" {
		var usrLkfPath string
		if linkerParams.Has("linker-script") {
			jv := linkerParams.Get("linker-script")
			if jv.Kind == JArray {
				if arr := jv.ValuesOfString(); len(arr) > 0 {
					usrLkfPath = arr[0]
				}
			} else {
				usrLkfPath = jv.AsString()
			}
		} else if linkerParams.Has("$lkfPath") {
			usrLkfPath = linkerParams.Str("$lkfPath")
		}
		if strings.TrimSpace(usrLkfPath) == "" {
			return CmdInfo{}, fmt.Errorf("Missing *.lkf file for COSMIC linker(clnk)")
		}

		outLkfPath := outDir + localSep() + strings.TrimSuffix(filepath.Base(usrLkfPath), filepath.Ext(usrLkfPath)) + ".lkf"

		objFiles := append([]string{}, objList...)
		libFiles := reWhitespace.Split(libFlags, -1)

		// set CXLIB=C:\COSMIC\LIB
		setEnvValue("CXLIB", g.binDir+localSep()+"Lib")

		var lkfLines []string
		lkfLines = append(lkfLines,
			"############################################",
			"# Auto generated by EIDE (unify_builder)   #",
			"############################################",
			"")

		rePattern := regexp.MustCompile(`(?i)\$<(\w+):(.*?)>`)
		data, err := os.ReadFile(toAbsolutePath(usrLkfPath))
		if err != nil {
			return CmdInfo{}, err
		}
		for _, inputLine := range splitLines(decodeBytes(data, "ANSI")) {
			input := replaceEnvVariable(inputLine, false)
			for {
				m := rePattern.FindStringSubmatch(input)
				if m == nil {
					break
				}
				var sources []string
				switch m[1] {
				case "objs":
					sources = objFiles
				case "libs":
					sources = libFiles
				default:
					return CmdInfo{}, fmt.Errorf("Not support this pattern in lkf, pattern class: '%s'", m[1])
				}

				var results []string
				if m[2] != "" {
					var rmList []string
					for _, fpath := range sources {
						if globMatch(m[2], fpath) {
							results = append(results, fpath)
							rmList = append(rmList, fpath)
						}
					}
					// RemoveAll
					remaining := sources[:0]
					for _, p := range sources {
						removed := false
						for _, rm := range rmList {
							if p == rm {
								removed = true
								break
							}
						}
						if !removed {
							remaining = append(remaining, p)
						}
					}
					if m[1] == "objs" {
						objFiles = remaining
					} else {
						libFiles = remaining
					}
				}
				input = strings.Replace(input, m[0], strings.Join(results, crlf()), 1)
			}
			lkfLines = append(lkfLines, input)
		}

		content := strings.Join(lkfLines, crlf()) + crlf()
		if err := os.WriteFile(outLkfPath, encodeBytes(content, g.encodings["linker"]), 0o644); err != nil {
			return CmdInfo{}, err
		}
		cmdLine += " " + g.toRelativePathForCompilerArgs(outLkfPath, true, true)
	}

	// --
	linkerRealArgs := strings.ReplaceAll(strings.ReplaceAll(cmdLine, "\r\n", " "), "\n", " ")
	paramFile := outName + ".lnp"

	if !cliTestMode {
		objliFile := outName + ".objlist"
		if err := os.WriteFile(objliFile, encodeBytes(strings.Join(objList, objSep), g.encodings["linker"]), 0o644); err != nil {
			return CmdInfo{}, err
		}
		if err := os.WriteFile(paramFile, encodeBytes(cmdLine, g.encodings["linker"]), 0o644); err != nil {
			return CmdInfo{}, err
		}
	}

	var commandLine string
	if iFormat.UseFile {
		commandLine = strings.ReplaceAll(iFormat.Body, "${value}", "\""+paramFile+"\"")
	} else {
		commandLine = cmdLine
	}

	// rename old map file(C# 1214-1227)
	if data, err := os.ReadFile(mapPath); err == nil {
		_ = os.WriteFile(mapPath+".old", data, 0o644)
	}

	// gen .map.view for eide (yaml format)(C# 1229-1246)
	{
		cont := strings.Join([]string{
			"tool: " + g.toolID,
			"fileName: '" + filepath.Base(mapPath) + "'",
			"elfName: '" + filepath.Base(outPath) + "'",
			"compilerName: '" + g.compilerName + "'",
			"compilerFullName: '" + g.compilerFull + "'",
			"compilerPath: '" + replaceEnvVariable(g.getActivedToolFullPath("c"), false) + "'",
		}, "\r\n")
		_ = os.WriteFile(outName+".map.view", []byte(cont), 0o644)
	}

	return CmdInfo{
		CompilerID:        strings.ToLower(compilerId),
		CompilerModel:     "linker",
		ExePath:           g.getActivedToolFullPath("linker"),
		CommandLine:       commandLine,
		SourcePath:        mapPath,
		SourceType:        "other",
		SourceArgs:        linkerRealArgs,
		OutPath:           outPath,
		OutputEncoding:    g.encodings["linker"],
		SdccBundleLibArgs: sdccBundleLibArgs,
	}, nil
}

// genOutputCommand(1262-1306)
func (g *CmdGenerator) genOutputCommand(linkerOutputFile string, excludes []string) []CmdInfo {
	linkerModel := g.models["linker"]
	var commandsList []CmdInfo

	if !linkerModel.Has("$outputBin") {
		return commandsList
	}
	outFileName := outDir + localSep() + g.getOutName()

	for _, item := range linkerModel.ArrOr("$outputBin") {
		m := item.Obj
		if m == nil {
			continue
		}
		outFilePath := outFileName

		outFileSuffix := ""
		if m.Has("outputSuffix") {
			outFileSuffix = m.Str("outputSuffix")
		}
		// don't generate some specific files
		skip := false
		for _, ex := range excludes {
			if ex == outFileSuffix {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		outFilePath += outFileSuffix

		command := strings.ReplaceAll(m.Str("command"),
			"${linkerOutput}", g.toRelativePathForCompilerArgs(linkerOutputFile, true, true))
		command = strings.ReplaceAll(command,
			"${output}", g.toRelativePathForCompilerArgs(outFilePath, true, true))
		command = replaceEnvVariable(command, true)

		commandsList = append(commandsList, CmdInfo{
			Title:          m.Str("name"),
			ExePath:        g.toAbsToolPath(m.Str("toolPath")),
			CommandLine:    command,
			SourcePath:     linkerOutputFile,
			SourceType:     "other",
			OutPath:        outFilePath,
			OutputEncoding: g.encodings["linker"],
		})
	}
	return commandsList
}

var reWhitespace = regexp.MustCompile(`\s+`)

func runtimeOsType() string {
	if osWin32 {
		return "win32"
	}
	if isMacOS() {
		return "osx"
	}
	return "linux"
}

func crlf() string {
	if osWin32 {
		return "\r\n"
	}
	return "\n"
}
