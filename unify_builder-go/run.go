package main

// 构建编排主流程,对照 C# Main(2476-3983)。
// 阶段 3:完整构建管线(compile → link → extra → map → outputs → tasks → db save)。
// compilerdb(--only-dump-compilerdb)路径与 C# 逐字节一致(阶段 2 已验收,不可破坏)。

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sort"
	"time"
)

var projectRoot string
var builderDir string // unify_builder 自身目录(appBaseDir)
var toolchainRoot string
var dumpPath string
var outDir string
var refJsonName = "ref.json"

var (
	reqThreadsNum int
	ramMaxSize    = -1
	romMaxSize    = -1
	errLevel      = codeDone
	isRebuild     = false
	modeList      = map[string]bool{} // NORMAL/FAST/MULthread(BuilderMode)
)

// 源文件分类结果(C# srcList/libList HashSet + srcParams + alwaysInBuildSources)
var (
	srcListAbs          []string
	libList             []string
	srcParamsAbs        map[string]string
	alwaysInBuildSources = map[string]bool{}
	srcSeen             = map[string]bool{}
	libSeen             = map[string]bool{}
)

// obj order(C# 2285-2287)
const orderNumberBase = 100
var objOrder   = map[string]int{}
var objOrderUsr []userObjOrderGlob

// makefile
var makefileOutput   strings.Builder
var makefileCompilers = map[string]string{}

// GenOption(292-301)
type GenOption struct {
	BindirEnvName  string
	BindirAbsPath  string
	OutPath        string
	Cwd            string
	TestMode       bool
	CompilerPrefix string
	SrcParams      map[string]string
}

func checkMode(mode string) bool { return modeList[mode] }

const minFilesNumsForMultiThread = 8

// elapsedStr: "H:MM:SS" 格式(C# string.Format("{0}:{1}:{2}"))
func elapsedStr() string {
	d := time.Since(buildStartTime)
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	return fmt.Sprintf("%d:%d:%d", h, m, s)
}

var buildStartTime = time.Now()

// runExeCapture:编译器版本查询用(阶段 2 埋点,现在真实现)。
func runExeCapture(exe, args string) (string, int, error) {
	out, code := runExe(exe, args, "ANSI", false)
	if code != codeDone && out == "" {
		return out, code, fmt.Errorf("exit code %d", code)
	}
	return out, code, nil
}

func runBuild(opts *Options) int {
	// -r 模式(C# 2562-2573)
	if opts.RunCommandsPath != "" {
		return runCommandsJson(opts)
	}
	if opts.ParamsFilePath == "" {
		fmt.Fprintln(os.Stderr, "ERROR : params too less !")
		return codeErr
	}

	// ---- 装载 params / model(2589-2612) ----
	paramsData, err := os.ReadFile(opts.ParamsFilePath)
	if err != nil {
		errorWithLable("Load params failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	paramsObj, err := ParseJVal(paramsData)
	if err != nil || paramsObj.Kind != JObject {
		errorWithLable("Load params failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	params := paramsObj.Obj
	toolchainRoot = params.Str("toolchainLocation")
	modelFilePath := params.Str("toolchainCfgFile")
	modelData, err := os.ReadFile(modelFilePath)
	if err != nil {
		errorWithLable("Load params failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	modelVal, err := ParseJVal(modelData)
	if err != nil || modelVal.Kind != JObject {
		errorWithLable("Load params failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	compilerModel := modelVal.Obj

	// ---- 路径初始化(2608-2626) ----
	projectRoot = params.Str("rootDir")
	dumpPath = params.Str("dumpPath")
	outDir = params.Str("outDir")
	if !isAbsolutePath(dumpPath) {
		dumpPath = projectRoot + localSep() + dumpPath
	}
	if !isAbsolutePath(outDir) {
		outDir = projectRoot + localSep() + outDir
	}
	builderDir = exeBaseDir()

	// ---- sysPaths(2615-2622) ----
	for _, p := range params.ArrOr("sysPaths") {
		setEnvValue("PATH", p.AsString())
	}

	// ---- prepareSourceFiles(2634 + 5746-5785) ----
	srcParamsAbs = map[string]string{}
	srcListAbs = nil
	libList = nil
	srcSeen = map[string]bool{}
	libSeen = map[string]bool{}
	alwaysInBuildSources = map[string]bool{}
	srcParamsObj := params.ObjOr("sourceParams")
	alwaysBuild := map[string]bool{}
	for _, item := range params.ArrOr("alwaysInBuildSources") {
		alwaysBuild[item.AsString()] = true
	}
	for _, repath := range jvals2str(params.ArrOr("sourceList")) {
		sourcePath := repath
		if !isAbsolutePath(repath) {
			sourcePath = projectRoot + localSep() + repath
		}
		sourcePath = filepath.Clean(sourcePath) // 对齐 C# FileInfo.FullName 的分隔符规范化
		if st, err := os.Stat(sourcePath); err == nil && !st.IsDir() {
			base := filepath.Base(sourcePath)
			if libFileFilter.MatchString(base) {
				if !libSeen[sourcePath] {
					libSeen[sourcePath] = true
					libList = append(libList, sourcePath)
				}
			} else {
				if !srcSeen[sourcePath] {
					srcSeen[sourcePath] = true
					srcListAbs = append(srcListAbs, sourcePath)
				}
			}
		}
		if srcParamsObj != nil && srcParamsObj.Has(repath) {
			srcParamsAbs[sourcePath] = srcParamsObj.Str(repath)
		}
		if alwaysBuild[repath] {
			alwaysInBuildSources[sourcePath] = true
		}
	}

	// ---- 其它参数(2637-2642) ----
	modeList = map[string]bool{"NORMAL": true}
	reqThreadsNum = 0
	if v := params.Get("threadNum"); v != nil && v.Kind == JNumber {
		reqThreadsNum = int(v.Num)
	}
	if v := params.Get("ram"); v != nil && v.Kind == JNumber {
		ramMaxSize = int(v.Num)
	}
	if v := params.Get("rom"); v != nil && v.Kind == JNumber {
		romMaxSize = int(v.Num)
	}
	showRelativePathOnLog = params.BoolOr("showRepathOnLog", false)
	refJsonName = "ref.json"
	if params.Has("sourceMapName") {
		refJsonName = params.Str("sourceMapName")
	}

	// ---- load builder database(2644-2646) ----
	builderDatabasePath := outDir + localSep() + ".obj" + localSep() + "objs.db"
	loadBuilderDatabase(builderDatabasePath)

	// ---- ERR_LEVEL / prepareModel / prepareParams(2649-2651) ----
	if v := compilerModel.Get("ERR_LEVEL"); v != nil && v.Kind == JNumber {
		errLevel = int(v.Num)
	}
	if err := prepareModel(compilerModel); err != nil {
		errorWithLable("Init build failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	// prepareParams(5735-5744):模型 defines 追加到 params.defines
	if modelDefines := compilerModel.ArrOr("defines"); len(modelDefines) > 0 {
		defines := params.ArrOr("defines")
		for _, d := range modelDefines {
			defines = append(defines, d)
		}
		params.Set("defines", &JVal{Kind: JArray, Arr: defines})
	}

	// ---- 颜色开关(2654-2656) ----
	colorRendererEnabled = !opts.NotUseColor || opts.ForceUseColor

	// ---- builder mode(2659-2674) ----
	if params.Has("buildMode") {
		for _, modeStr := range strings.Split(params.Str("buildMode"), "|") {
			modeList[strings.ToUpper(strings.TrimSpace(modeStr))] = true
		}
	}

	// ---- user object order(2677-2716) ----
	objOrderUsr = nil
	if options := params.ObjOr("options"); options != nil {
		if linker := options.ObjOr("linker"); linker != nil {
			if orderList := linker.ArrOr("object-order"); len(orderList) > 0 {
				for _, item := range orderList {
					m := item.Obj
					if m == nil {
						continue
					}
					pattern := m.Str("pattern")
					if strings.TrimSpace(pattern) == "" {
						continue
					}
					order := 0
					switch m.Get("order").Kind {
					case JNumber:
						order = int(m.Get("order").Num)
					case JString:
						if n, err := fmt.Sscanf(strings.TrimSpace(m.Str("order")), "%d", &order); err != nil || n != 1 {
							warn("\r\nIgnored invalid 'objOrder' item\r\n", true)
							continue
						}
					default:
						continue
					}
					if re, err := globToRegexp(strings.TrimSpace(pattern)); err == nil {
						objOrderUsr = append(objOrderUsr, userObjOrderGlob{pattern: re, order: order})
					}
				}
			}
		}
	}

	// --rebuild → 移除 FAST(2718-2721)
	if opts.ForceRebuild {
		delete(modeList, "FAST")
	}

	buildStartTime = time.Now()

	if opts.OnlyDumpCompilerDB {
		fmt.Print("start generating compiler database ...\r\n") // C# log(): WriteLine 契约行
	} else if opts.OnlyPrintArgs {
		// nothing todo
	} else {
		infoWithLable("", false, "")
		info(fmt.Sprintf("start building at %s%s\r\n", buildStartTime.Format("2006-01-02 15:04:05"), dryRunSuffix(opts)), true)
	}

	// lock build(2747)
	lockBuild(opts, dumpPath)

	compilerCmdPrefix := ""

	// ---- 环境注入(2769-2792) ----
	_ = os.MkdirAll(outDir, 0o755)
	setEnvValue("PATH", builderDir)
	if envs := params.ObjOr("env"); envs != nil {
		for _, name := range envs.Keys() {
			envName := strings.TrimSpace(name)
			envValue := strings.TrimSpace(envs.Str(name))
			if !regexp.MustCompile(`^[\w\$]+$`).MatchString(envName) || strings.ToLower(envName) == "path" {
				warn(fmt.Sprintf("\r\nignore incorrect env: '%s'\r\n", envName), true)
				continue
			}
			setEnvValue(envName, envValue)
			if envName == "COMPILER_CMD_PREFIX" && strings.TrimSpace(envValue) != "" {
				compilerCmdPrefix = envValue + " "
			}
		}
	}
	if err := setEnvValueChecked("TOOL_DIR", toolchainRoot); err != nil {
		errorWithLable("Set Environment Failed !, [path] : \""+toolchainRoot+"\"", true, "")
		unlockBuild()
		return codeErr
	}
	if opts.OutputMakefile {
		compilerModel.Set("useUnixPath", &JVal{Kind: JBool, Bool: true})
	}

	// ---- 构造 CmdGenerator(2831-2843) ----
	cmdGen, err := NewCmdGenerator(compilerModel, params, GenOption{
		BindirEnvName:  "%TOOL_DIR%",
		BindirAbsPath:  toolchainRoot,
		OutPath:        outDir,
		Cwd:            projectRoot,
		TestMode:       opts.OnlyPrintArgs,
		CompilerPrefix: compilerCmdPrefix,
		SrcParams:      srcParamsAbs,
	})
	if err != nil {
		errorWithLable("Init build failed !\r\n"+err.Error(), true, "")
		unlockBuild()
		return codeErr
	}

	// ignore keil c51 normal output(2842-2846)
	ccID := strings.ToLower(cmdGen.getCompilerId())
	if cmdGen.getCompilerId() == "KEIL_C51" || cmdGen.getCompilerId() == "COSMIC_STM8" {
		enableNormalOut = false
	}

	// output render(2848-3035)
	if colorRendererEnabled {
		initOutputRender(ccID)
	}

	// ---- compiler path / env(3037-3092) ----
	CC_PATH := toolchainRoot + localSep() + cmdGen.getActivedRawToolPath("c")
	AS_PATH := toolchainRoot + localSep() + cmdGen.getActivedRawToolPath("asm")
	CXX_PATH := toolchainRoot + localSep() + cmdGen.getActivedRawToolPath("cpp")
	LD_PATH := cmdGen.getOtherUtilToolFullPath("linker")

	CC_DIR := filepath.Dir(CC_PATH)
	setEnvValue("PATH", CC_DIR)

	setEnvValue("EIDE_CUR_OS_TYPE", runtimeOsType())
	setEnvValue("EIDE_CUR_COMPILER_ID", ccID)
	setEnvValue("EIDE_CUR_COMPILER_NAME", cmdGen.compilerName)
	setEnvValue("EIDE_CUR_COMPILER_NAME_FULL", cmdGen.compilerFull)
	setEnvValue("EIDE_CUR_COMPILER_VERSION", cmdGen.compilerVersion)
	setEnvValue("EIDE_CUR_COMPILER_PREFIX", cmdGen.toolPrefix)
	setEnvValue("EIDE_CUR_COMPILER_CC_PATH", CC_PATH)
	setEnvValue("EIDE_CUR_COMPILER_AS_PATH", AS_PATH)
	setEnvValue("EIDE_CUR_COMPILER_LD_PATH", LD_PATH)
	setEnvValue("EIDE_CUR_COMPILER_CXX_PATH", CXX_PATH)

	setEnvValue("EIDE_CUR_COMPILER_CC_BASE_ARGS", cmdGen.fromCFile("<c_file>", true).BaseArgs)
	setEnvValue("EIDE_CUR_COMPILER_CXX_BASE_ARGS", cmdGen.fromCppFile("<cxx_file>", true).BaseArgs)
	setEnvValue("EIDE_CUR_COMPILER_AS_BASE_ARGS", cmdGen.fromAsmFile("<asm_file>", true).BaseArgs)

	setEnvValue("TargetName", cmdGen.getOutName())
	setEnvValue("ConfigName", cmdGen.getBuildConfigName())
	setEnvValue("ProjectRoot", projectRoot)
	setEnvValue("BuilderFolder", builderDir)
	setEnvValue("OutDir", outDir)
	setEnvValue("ToolchainRoot", toolchainRoot)
	setEnvValue("CompilerPrefix", cmdGen.toolPrefix)
	setEnvValue("CompilerFolder", CC_DIR)
	setEnvValue("CompilerId", ccID)
	setEnvValue("CompilerName", cmdGen.compilerName)
	setEnvValue("CompilerFullName", cmdGen.compilerFull)
	setEnvValue("CompilerVersion", cmdGen.compilerVersion)

	addCliVar("re:ProjectRoot", ".")
	addCliVar("re:BuilderFolder", orSelf(toRelativePath(projectRoot, builderDir, false), builderDir))
	addCliVar("re:OutDir", orSelf(toRelativePath(projectRoot, outDir, false), outDir))
	addCliVar("re:ToolchainRoot", orSelf(toRelativePath(projectRoot, toolchainRoot, false), toolchainRoot))
	addCliVar("re:CompilerFolder", orSelf(toRelativePath(projectRoot, CC_DIR, false), CC_DIR))

	appendBuildInfo("Compiler Full Name: " + cmdGen.compilerFull)
	appendBuildInfo("Compiler Version: " + cmdGen.compilerVersion)

	// ---- --only-dump-args(3104-3139) ----
	if opts.OnlyPrintArgs {
		info("App Info:\r\n", true)
		printAppInfo()

		cmdInf := cmdGen.fromCFile("${c}", true)
		warn("\r\nC command line ("+trimExt(filepath.Base(cmdInf.ExePath))+"): \r\n", true)
		logOut(cmdInf.CommandLine, true)

		cmdInf = cmdGen.fromCppFile("${cpp}", true)
		warn("\r\nCPP command line ("+trimExt(filepath.Base(cmdInf.ExePath))+"): \r\n", true)
		logOut(cmdInf.CommandLine, true)

		cmdInf = cmdGen.fromAsmFile("${asm}", true)
		warn("\r\nASM command line ("+trimExt(filepath.Base(cmdInf.ExePath))+"): \r\n", true)
		logOut(cmdInf.CommandLine, true)

		cmdInf, lerr := cmdGen.genLinkCommand([]string{"${obj1}", "${obj2}"}, true, opts)
		if lerr == nil {
			warn("\r\nLinker command line ("+trimExt(filepath.Base(cmdInf.ExePath))+"): \r\n", true)
			logOut(cmdInf.CommandLine, true)

			warn("\r\nOutput file command line: \r\n", true)
			cmdInfoList := cmdGen.genOutputCommand(cmdInf.OutPath, nil)
			for _, oc := range cmdInfoList {
				logOut("\t"+oc.Title+": ", true)
				logOut("\t\t"+oc.ExePath+" "+oc.CommandLine, true)
				logOut("", true)
			}
		} else {
			warn("\r\nLinker command line generate failed: "+lerr.Error()+"\r\n", true)
		}

		unlockBuild()
		return codeDone
	}

	// ---- toolchain dir check(3142-3145) ----
	if st, err := os.Stat(toolchainRoot); err != nil || !st.IsDir() {
		errMsg := fmt.Sprintf("Not found toolchain directory !, [path] : \"%s\"", toolchainRoot)
		errorWithLable(errMsg+"\r\n", true, "")
		errorWithLable("build failed !, elapsed time "+elapsedStr(), true, "")
		logOut("", true)
		unlockBuild()
		return codeErr
	}

	// ---- makefile header(3148-3250) ----
	if opts.OutputMakefile {
		genMakefileHeader(cmdGen, CC_PATH, AS_PATH, CXX_PATH, LD_PATH)
	}

	// ---- prebuild tasks(3252-3260) ----
	if !opts.OnlyDumpCompilerDB {
		switchWorkDir(projectRoot)
		if code, _ := runTasks("PRE-BUILD TASKS", "beforeBuildTasks", opts, params); code != codeDone {
			switchWorkDir(builderDir)
			unlockBuild()
			buildFailedExit(opts, "Run Tasks Failed !, Stop Build !", nil)
			return codeErr
		}
		switchWorkDir(builderDir)
	}
	if !opts.OnlyDumpCompilerDB {
		infoWithLable(cmdGen.compilerFull+"\r\n", true, "TOOL")
	}

	// ---- 源文件循环(3267-3322) ----
	sourceRefs := []kvPair{}
	compilerArgsDataBase := []CompileCommandsEntry{}
	linkerObjs := []linkerObjGroup{}
	objOrder = map[string]int{}

	pushLinkerObjs := func(ccArgs CmdInfo) {
		linkerObjs = append(linkerObjs, linkerObjGroup{src: ccArgs.SourcePath, objs: []string{ccArgs.OutPath}})
		order := orderNumberBase + len(objOrder)
		objOrder[ccArgs.OutPath] = order
	}

	commands := make([]cmdEntry, 0, 512)
	commandIndex := map[string]int{}
	srcCountC, srcCountCpp, srcCountAsm := 0, 0, 0

	for _, srcPath := range srcListAbs {
		var cmdInf CmdInfo
		switch {
		case cFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromCFile(srcPath, opts.OnlyDumpCompilerDB)
			srcCountC++
		case cppFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromCppFile(srcPath, opts.OnlyDumpCompilerDB)
			srcCountCpp++
		case asmFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromAsmFile(srcPath, opts.OnlyDumpCompilerDB)
			srcCountAsm++
		default:
			continue
		}
		if _, dup := commandIndex[cmdInf.SourcePath]; dup {
			errMsg := fmt.Sprintf("An item with the same key has already been added: '%s'", cmdInf.SourcePath)
			unlockBuild()
			buildFailedExit(opts, errMsg, nil)
			return codeErr
		}
		commandIndex[cmdInf.SourcePath] = len(commands)
		commands = append(commands, cmdEntry{srcPath: cmdInf.SourcePath, info: cmdInf})
		pushLinkerObjs(cmdInf)

		sourceRefs = append(sourceRefs, kvPair{cmdInf.SourcePath, cmdInf.OutPath})
		compilerArgsDataBase = append(compilerArgsDataBase, CompileCommandsEntry{
			Directory: projectRoot,
			File:      cmdInf.SourcePath,
			Command:   cmdInf.ShellCommand,
		})
	}

	// ---- 写出数据库(3324-3350) ----
	refFilePath := outDir + localSep() + refJsonName
	compilerDbPath := outDir + localSep() + "compile_commands.json"
	if err := writeRefJSON(outDir, refJsonName, sourceRefs); err != nil {
		if opts.OnlyDumpCompilerDB {
			errOut("Failed:\n"+err.Error()+"\n", true)
			unlockBuild()
			return codeErr
		}
		unlockBuild()
		buildFailedExit(opts, err.Error(), nil)
		return codeErr
	}
	if err := writeCompileCommandsJSON(outDir, compilerArgsDataBase); err != nil {
		if opts.OnlyDumpCompilerDB {
			errOut("Failed:\n"+err.Error()+"\n", true)
			unlockBuild()
			return codeErr
		}
		unlockBuild()
		buildFailedExit(opts, err.Error(), nil)
		return codeErr
	}
	if opts.OnlyDumpCompilerDB {
		fmt.Print("Source Map Database Path: " + refFilePath + "\r\n")
		fmt.Print("Compiler Database Path: " + compilerDbPath + "\r\n")
		unlockBuild()
		return codeDone
	}

	// =============== 以下为完整构建模式(3353-3982) ===============

	errLogs := make([]string, 0, 512)

	// check source file count(3353-3357)
	if srcCountC+srcCountCpp+srcCountAsm == 0 {
		unlockBuild()
		buildFailedExit(opts, "Not found any source files !, please add some source files !", errLogs)
		return codeErr
	}

	// check compiler(3359-3399)
	checkTool := func(kind, name string) bool {
		absPath := replaceEnvVariable(cmdGen.getActivedToolFullPath(kind), false)
		if st, err := os.Stat(absPath); err != nil || st.IsDir() {
			unlockBuild()
			buildFailedExit(opts, fmt.Sprintf("Not found '%s' !, [path]: \"%s\"", name, absPath), errLogs)
			return false
		}
		return true
	}
	if srcCountC > 0 && !checkTool("c", "C Compiler") {
		return codeErr
	}
	if srcCountCpp > 0 && !checkTool("cpp", "C++ Compiler") {
		return codeErr
	}
	if srcCountAsm > 0 && !checkTool("asm", "Assembler") {
		return codeErr
	}
	if !checkTool("linker", "Linker") {
		return codeErr
	}

	// makefile obj rules(3401-3430)
	if opts.OutputMakefile {
		genMakefileObjRules(cmdGen, commands)
	}

	// 增量 / 重建(3432-3496)
	var buildCmds []cmdEntry
	if checkMode("FAST") {
		if opts.UseCcache && ccID == "gcc" {
			infoWithLable("file statistics (ccache enabled)\r\n", true, "")
			setEnvValue("CCACHE_DIR", outDir+localSep()+".ccache")
			setEnvValue("CCACHE_LOGFILE", outDir+localSep()+"ccache.log")
			specsMatcher := regexp.MustCompile(`specs=([\w][^ \\\/]+)`)
			for i := range commands {
				ci := &commands[i].info
				_srcArgs := specsMatcher.ReplaceAllString(ci.SourceArgs, "specs=\"%TOOL_DIR%/arm-none-eabi/lib/$1\"")
				ci.CommandLine = "\"" + ci.ExePath + "\" " + _srcArgs
				ci.ExePath = "ccache"
			}
			buildCmds = commands
			appendBuildInfo("Builder Mode: Incremental")
		} else if opts.UseCcache && ccID == "ac6" {
			infoWithLable("file statistics (ccache enabled)\r\n", true, "")
			setEnvValue("CCACHE_DIR", outDir+localSep()+".ccache")
			setEnvValue("CCACHE_LOGFILE", outDir+localSep()+"ccache.log")
			for i := range commands {
				ci := &commands[i].info
				if ci.CompilerModel == "asm" {
					continue // skip ccache for armasm.exe
				}
				ci.CommandLine = "\"" + ci.ExePath + "\" " + ci.SourceArgs
				ci.ExePath = "ccache"
			}
			buildCmds = commands
			appendBuildInfo("Builder Mode: Incremental")
		} else {
			res, diffLogs, derr := checkDiff(cmdGen.getCompilerId(), commands)
			if derr != nil {
				logOut("", true)
				warn(derr.Error(), true)
				logOut("", true)
				warnWithLable("Check difference failed !, will rollback to rebuild mode.\r\n", true, "")
				logOut("", true)
				isRebuild = true
				buildCmds = commands
				appendLogs("[warn] incremental build: check difference failed, rollback to rebuild mode.", derr.Error(), nil)
			} else {
				// 覆盖 commands 为需要重编的集合(C# commands = res.totalCmds)
				commands = res.totalCmds
				buildCmds = res.totalCmds
				srcCountC, srcCountCpp, srcCountAsm = res.cCount, res.cppCount, res.asmCount
				infoWithLable("file statistics (incremental mode)\r\n", true, "")
				appendBuildInfo("Builder Mode: Incremental")
				if len(diffLogs) > 0 {
					appendLogs(fmt.Sprintf("[info] incremental build: %d source files changed", len(diffLogs)),
						"These source files will be recompiled", diffLogs)
				}
			}
		}
	} else {
		isRebuild = true
		infoWithLable("file statistics (rebuild mode)\r\n", true, "")
		appendBuildInfo("Builder Mode: Rebuild")
		buildCmds = commands
	}

	// rebuild 模式清空旧 commands(3495-3496)
	if isRebuild {
		tableClear()
	}

	// 文件统计表(3498-3513)
	totalFilesCount := srcCountC + srcCountCpp + srcCountAsm + len(libList)
	fmt.Print(renderTableAlternative(
		[]string{"C Files", "Cpp Files", "Asm Files", "Lib/Obj Files", "Totals"},
		[][]string{{itoa(srcCountC), itoa(srcCountCpp), itoa(srcCountAsm), itoa(len(libList)), itoa(totalFilesCount)}}))
	appendBuildInfo(fmt.Sprintf("The amount of C files: %d", srcCountC))
	appendBuildInfo(fmt.Sprintf("The amount of C++ files: %d", srcCountCpp))
	appendBuildInfo(fmt.Sprintf("The amount of Asm files: %d", srcCountAsm))

	// build start(3515-3518)
	switchWorkDir(projectRoot)
	logOut("", true)
	infoWithLable("", false, "")

	// 并行/串行编译(3520-3575)
	if !checkMode("MULTHREAD") || len(buildCmds) < minFilesNumsForMultiThread {
		info("start compiling ...", true)
		if len(buildCmds) > 0 {
			logOut("", true)
		}
		total := len(buildCmds)
		for curCnt, entry := range buildCmds {
			cmdInfo := entry.info
			curCnt++
			compilerTag := getCompileLogTag(cmdInfo.SourceType)
			progressTag := genProgressTag(curCnt, total)
			logOut(">> "+progressTag+" "+compilerTag+" '"+toHumanReadablePath(cmdInfo.SourcePath)+"'", true)

			ccOut, exitCode := runExe(cmdInfo.ExePath, cmdInfo.CommandLine, cmdInfo.OutputEncoding, opts.DryRun)
			ccLog := strings.TrimSpace(ccOut)

			if enableNormalOut || exitCode != codeDone {
				printCompileOutput(ccLog, false)
				storeCompileOutput(ccLog, false)
			}

			if exitCode > errLevel {
				errLogs = append(errLogs, ccLog)
				unlockBuild()
				buildFailedExit(opts,
					fmt.Sprintf("compilation failed at : \"%s\", exit code: %d\ncommand: \n  %s",
						cmdInfo.SourcePath, exitCode, cmdInfo.ShellCommand),
					errLogs)
				return codeErr
			}
			if !opts.DryRun {
				tablePut(cmdInfo.OutPath, cmdInfo.ShellCommand)
			}
		}
	} else {
		threads := calcuThreads(reqThreadsNum, len(buildCmds))
		cmdList := make([]CmdInfo, len(buildCmds))
		for i, e := range buildCmds {
			cmdList[i] = e.info
		}
		if cerr := compileByMulThread(threads, cmdList, &errLogs, opts, errLevel); cerr != nil {
			unlockBuild()
			buildFailedExit(opts, cerr.Error(), errLogs)
			return codeErr
		}
	}

	// update objs list if source file have more than one objs(3577-3592)
	for _, buildArgs := range commands {
		ci := buildArgs.info
		if len(ci.Outputs) > 0 {
			objLi := make([]string, 0, len(ci.Outputs))
			for _, p := range ci.Outputs {
				if isAbsolutePath(p) {
					objLi = append(objLi, p)
				} else {
					objLi = append(objLi, projectRoot+localSep()+p)
				}
			}
			for gi := range linkerObjs {
				if linkerObjs[gi].src == ci.SourcePath {
					linkerObjs[gi].objs = objLi
					break
				}
			}
		}
	}

	// add all static libs(3594-3595)
	linkerObjs = append(linkerObjs, linkerObjGroup{src: "<global>/libs", objs: libList})

	logOut("", true)
	infoWithLable("", false, "")
	info("start linking ...", true)

	if len(libList) > 0 {
		logOut("", true)
		for _, lib := range libList {
			if strings.HasSuffix(lib, ".lib") || strings.HasSuffix(lib, ".a") {
				logOut("add lib '"+toHumanReadablePath(lib)+"'", true)
			} else {
				logOut("add obj '"+toHumanReadablePath(lib)+"'", true)
			}
		}
	}

	// all objs + user obj order(3614-3644)
	var allObjs []string
	for _, grp := range linkerObjs {
		allObjs = append(allObjs, grp.objs...)
	}
	for _, orderInf := range objOrderUsr {
		for _, objPath := range allObjs {
			repath := toRelativePath(projectRoot, objPath, true)
			if repath == "" {
				repath = toUnixPath(objPath)
			}
			if orderInf.pattern.MatchString(repath) {
				objOrder[objPath] = orderInf.order
			}
		}
	}
	sort.SliceStable(allObjs, func(i, j int) bool {
		o1, ok1 := objOrder[allObjs[i]]
		if !ok1 {
			o1 = int(^uint(0) >> 1) // Int32.MaxValue
		}
		o2, ok2 := objOrder[allObjs[j]]
		if !ok2 {
			o2 = int(^uint(0) >> 1)
		}
		return o1 < o2
	})

	linkInfo, lerr := cmdGen.genLinkCommand(allObjs, false, opts)
	if lerr != nil {
		unlockBuild()
		buildFailedExit(opts, lerr.Error(), errLogs)
		return codeErr
	}

	linkerOut, linkerExitCode := runExe(linkInfo.ExePath, linkInfo.CommandLine, linkInfo.OutputEncoding, opts.DryRun)
	if strings.TrimSpace(linkerOut) != "" {
		logOut("", true)
		printCompileOutput(linkerOut, true)
		storeCompileOutput(linkerOut, true)
	}
	if linkerExitCode > errLevel {
		errLogs = append(errLogs, linkerOut)
		unlockBuild()
		buildFailedExit(opts, fmt.Sprintf("link failed !, exit code: %d", linkerExitCode), errLogs)
		return codeErr
	}

	// extra link commands(3664-3679)
	extraLinkCmds := cmdGen.genLinkerExtraCommand(linkInfo.OutPath)
	for _, extraCmd := range extraLinkCmds {
		if out, code := runExe(extraCmd.ExePath, extraCmd.CommandLine, extraCmd.OutputEncoding, opts.DryRun); code == codeDone {
			logOut("\r\n>> "+extraCmd.Title, true)
			if out == "" {
				continue
			}
			logOut("\r\n"+out, false)
		}
	}

	// makefile link section(3681-3714)
	if opts.OutputMakefile {
		genMakefileLink(cmdGen, linkInfo, allObjs, extraLinkCmds)
	}

	// map file(3716-3828)
	mapFileFullPath := linkInfo.SourcePath
	if mapFileFullPath != "" && fileExists(mapFileFullPath) {
		printMapInfo(cmdGen, mapFileFullPath)
	}

	// output commands(3830-3893)
	var commandList []CmdInfo
	if !cmdGen.isDisableOutputTask() {
		commandList = cmdGen.genOutputCommand(linkInfo.OutPath, cmdGen.getOutputTaskExcludes())
	}
	if len(commandList) > 0 {
		logOut("", true)
		infoWithLable("", false, "")
		info("start outputting files ...", true)

		for _, outputCmdInfo := range commandList {
			logOut("\r\n>> "+outputCmdInfo.Title, false)
			exeLog := ""
			taskCommand := "\"" + outputCmdInfo.ExePath + "\" " + outputCmdInfo.CommandLine

			exeAbsPath := replaceEnvVariable(outputCmdInfo.ExePath, false)
			if !fileExists(exeAbsPath) {
				errOut("\t\t[failed]", true)
				errOut("\r\ncommand: "+taskCommand, true)
				errOut("\r\nnot found "+filepath.Base(exeAbsPath)+" !, [path] : \""+exeAbsPath+"\"", true)
				continue
			}

			// must use 'cmd', because SDCC has '>' command
			var eCode int
			exeLog, eCode = runShellCommand(taskCommand, outputCmdInfo.OutputEncoding, opts.DryRun)

			if eCode > errLevel {
				errOut("\t\t[failed]", true)
				errOut("\r\ncommand: "+taskCommand, true)
				if strings.TrimSpace(exeLog) != "" {
					logOut("\r\n"+exeLog, false)
				}
				errOut(fmt.Sprintf("\r\nexecute command failed !, exit code: %d", eCode), true)
				continue
			}

			success("\t\t[done]", true)
			if strings.TrimSpace(exeLog) != "" {
				logOut("\r\n"+exeLog, false)
			}
			outPath := toRelativePath(projectRoot, outputCmdInfo.OutPath, true)
			if outPath == "" {
				outPath = outputCmdInfo.OutPath
			}
			logOut("\r\nfile path: \""+outPath+"\"", true)
		}
	}

	// makefile bin section(3895-3911)
	if opts.OutputMakefile {
		genMakefileBin(commandList)
	}

	// reset work dir(3913-3921)
	switchWorkDir(builderDir)
	logOut("", true)
	doneWithLable("", false, "")
	success("build successfully !, elapsed time "+elapsedStr(), false)
	logOut("", true)
	logOut("", true)

	// save db(3923-3925)
	if !opts.DryRun {
		saveBuilderCommands(builderDatabasePath)
	}

	// dump log(3927-3929)
	appendLogs("[done]", "\tbuild successfully !", nil)
	dumpCompilerLog()
	unlockBuild()

	// postbuild tasks(3961-3970):C# 在 projectRoot 下执行
	switchWorkDir(projectRoot)
	if code, _ := runTasks("POST-BUILD TASKS", "afterBuildTasks", opts, params); code != codeDone {
		errorWithLable("postbuild failed\r\n", true, "")
	}
	switchWorkDir(builderDir)

	if opts.OutputMakefile {
		_ = os.WriteFile(projectRoot+localSep()+"Makefile", []byte(makefileOutput.String()), 0o644)
	}

	unlockBuild()
	return codeDone
}

// ---- 构建失败统一出口(3931-3953) ----

func buildFailedExit(opts *Options, msg string, errLogs []string) {
	logOut("", true)
	errorWithLable(msg+"\r\n", true, "")
	errorWithLable("build failed !, elapsed time "+elapsedStr(), true, "")
	logOut("", true)

	if !opts.DryRun {
		saveBuilderCommands(outDir + localSep() + ".obj" + localSep() + "objs.db")
	}
	stack := ""
	if len(errLogs) > 0 {
		stack = strings.Join(errLogs, "\r\n")
	}
	appendLogs(msg, stack, errLogs)
	dumpCompilerLog()
	unlockBuild()
}

// ---- 辅助 ----

type linkerObjGroup struct {
	src  string
	objs []string
}

func dryRunSuffix(opts *Options) string {
	if opts.DryRun {
		return "(dry-run)"
	}
	return ""
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func trimExt(name string) string {
	return strings.TrimSuffix(name, filepath.Ext(name))
}

func switchWorkDir(path string) {
	_ = os.Chdir(path) // 编译命令里的相对路径依赖 cwd
}
