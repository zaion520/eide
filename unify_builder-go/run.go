package main

// 阶段 2:compilerdb(-p ... --only-dump-compilerdb)模式全链路,
// 对照 C# Main 2570-3350 行的编译数据库路径 + prepareParams/prepareSourceFiles。

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var projectRoot string
var builderDir string // unify_builder 自身目录(appBaseDir)

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

// runExeCapture:运行外部命令捕获输出(对应 C# runExe 的查询用途)。
// 阶段 3 再补按字符集解码;当前按 UTF-8 容错。
func runExeCapture(exe, args string) (string, int, error) {
	out, err := os_exec_run(exe, args)
	return out, 0, err
}

func runBuild(opts *Options) int {
	// -r 模式(2570-2581):阶段 3 移植
	if opts.RunCommandsPath != "" {
		fmt.Fprintf(os.Stderr,
			"ERROR : 'run commands json' mode is not ported yet (stage 3), see docs/unify-builder-migration.md\n")
		return codeErr
	}
	if opts.ParamsFilePath == "" {
		fmt.Fprintln(os.Stderr, "ERROR : params too less !")
		return codeErr
	}

	// ---- 装载 params / model(2589-2612) ----
	paramsData, err := os.ReadFile(opts.ParamsFilePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Load params failed !\r\n%v\n", err)
		return codeErr
	}
	paramsObj, err := ParseJVal(paramsData)
	if err != nil || paramsObj.Kind != JObject {
		fmt.Fprintf(os.Stderr, "ERROR : Load params failed !\r\n%v\n", err)
		return codeErr
	}
	params := paramsObj.Obj
	toolchainRoot := params.Str("toolchainLocation")
	modelFilePath := params.Str("toolchainCfgFile")
	modelData, err := os.ReadFile(modelFilePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Load params failed !\r\n%v\n", err)
		return codeErr
	}
	modelVal, err := ParseJVal(modelData)
	if err != nil || modelVal.Kind != JObject {
		fmt.Fprintf(os.Stderr, "ERROR : Load params failed !\r\n%v\n", err)
		return codeErr
	}
	compilerModel := modelVal.Obj

	// ---- 路径初始化(2616-2626) ----
	projectRoot = params.Str("rootDir")
	outDir := params.Str("outDir")
	if !isAbsolutePath(outDir) {
		outDir = projectRoot + localSep() + outDir
	}
	builderDir = exeBaseDir()

	// ---- sysPaths(2629-2637) ----
	for _, p := range params.ArrOr("sysPaths") {
		setEnvValue("PATH", p.AsString())
	}

	// ---- 源文件分类(prepareSourceFiles 5746-5786) ----
	srcParamsAbs := map[string]string{}
	srcList := []string{}
	libList := []string{}
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
				libList = append(libList, sourcePath)
			} else {
				srcList = append(srcList, sourcePath)
			}
		}
		if srcParamsObj != nil && srcParamsObj.Has(repath) {
			srcParamsAbs[sourcePath] = srcParamsObj.Str(repath)
		}
		_ = alwaysBuild
	}

	// ---- 其它参数(2640-2646) ----
	refJsonName := "ref.json"
	if params.Has("sourceMapName") {
		refJsonName = params.Str("sourceMapName")
	}
	_ = opts.ForceRebuild // FAST 模式移除仅影响构建,db 模式无关

	// ---- prepareModel/prepareParams(2652-2656) ----
	if err := prepareModel(compilerModel); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Init build failed !\r\n%v\n", err)
		return codeErr
	}
	// prepareParams(5746-5753):模型 defines 追加到 params.defines
	if modelDefines := compilerModel.ArrOr("defines"); len(modelDefines) > 0 {
		defines := params.ArrOr("defines")
		for _, d := range modelDefines {
			defines = append(defines, d)
		}
		params.Set("defines", &JVal{Kind: JArray, Arr: defines})
	}

	// ---- 环境变量(2750-2800 + 3080-3103) ----
	setEnvValue("PATH", builderDir)
	if envs := params.ObjOr("env"); envs != nil {
		for _, name := range envs.Keys() {
			envName := strings.TrimSpace(name)
			envValue := strings.TrimSpace(envs.Str(name))
			if !regexp.MustCompile(`^[\w\$]+$`).MatchString(envName) || strings.ToLower(envName) == "path" {
				continue
			}
			setEnvValue(envName, envValue)
		}
	}
	if err := setEnvValueChecked("TOOL_DIR", toolchainRoot); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : %v\n", err)
		return codeErr
	}
	if opts.OutputMakefile {
		compilerModel.Set("useUnixPath", &JVal{Kind: JBool, Bool: true})
	}

	// ---- 构造 CmdGenerator(2831-2843) ----
	cmdGen, err := NewCmdGenerator(compilerModel, params, GenOption{
		BindirEnvName: "%TOOL_DIR%",
		BindirAbsPath: toolchainRoot,
		OutPath:       outDir,
		Cwd:           projectRoot,
		TestMode:      opts.OnlyPrintArgs,
		CompilerPrefix: "",
		SrcParams:     srcParamsAbs,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Init build failed !\r\n%v\n", err)
		return codeErr
	}

	// ---- 环境注入(3080-3103) ----
	CC_PATH := toolchainRoot + localSep() + cmdGen.getActivedRawToolPath("c")
	setEnvValue("TargetName", cmdGen.getOutName())
	setEnvValue("ConfigName", cmdGen.getBuildConfigName())
	setEnvValue("ProjectRoot", projectRoot)
	setEnvValue("BuilderFolder", builderDir)
	setEnvValue("OutDir", outDir)
	setEnvValue("ToolchainRoot", toolchainRoot)
	setEnvValue("CompilerPrefix", cmdGen.toolPrefix)
	setEnvValue("CompilerFolder", filepath.Dir(CC_PATH))
	setEnvValue("CompilerId", strings.ToLower(cmdGen.getCompilerId()))
	setEnvValue("CompilerName", cmdGen.compilerName)
	setEnvValue("CompilerFullName", cmdGen.compilerFull)
	setEnvValue("CompilerVersion", cmdGen.compilerVersion)
	addCliVar("re:ProjectRoot", ".")
	addCliVar("re:BuilderFolder", orSelf(toRelativePath(projectRoot, builderDir, false), builderDir))
	addCliVar("re:OutDir", orSelf(toRelativePath(projectRoot, outDir, false), outDir))
	addCliVar("re:ToolchainRoot", orSelf(toRelativePath(projectRoot, toolchainRoot, false), toolchainRoot))
	addCliVar("re:CompilerFolder", orSelf(toRelativePath(projectRoot, filepath.Dir(CC_PATH), false), filepath.Dir(CC_PATH)))

	// ---- 工具链目录检查(3148-3152) ----
	if st, err := os.Stat(toolchainRoot); err != nil || !st.IsDir() {
		fmt.Fprintf(os.Stderr, "ERROR : Not found toolchain directory !, [path] : \"%s\"\n", toolchainRoot)
		return codeErr
	}

	// ---- 编译数据库模式(2732-2734) ----
	if opts.OnlyDumpCompilerDB {
		fmt.Print("start generating compiler database ...\r\n")
	}

	// ---- 源文件循环(3248-3290) ----
	sourceRefs := []kvPair{}
	compilerArgsDataBase := []CompileCommandsEntry{}
	commands := map[string]CmdInfo{}
	for _, srcPath := range srcList {
		var cmdInf CmdInfo
		switch {
		case cFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromCFile(srcPath, opts.OnlyDumpCompilerDB)
		case cppFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromCppFile(srcPath, opts.OnlyDumpCompilerDB)
		case asmFileFilter.MatchString(srcPath):
			cmdInf = cmdGen.fromAsmFile(srcPath, opts.OnlyDumpCompilerDB)
		default:
			continue
		}
		if _, dup := commands[cmdInf.SourcePath]; dup {
			fmt.Fprintf(os.Stderr, "ERROR : duplicate source '%s'\n", cmdInf.SourcePath)
			return codeErr
		}
		commands[cmdInf.SourcePath] = cmdInf
		sourceRefs = append(sourceRefs, kvPair{cmdInf.SourcePath, cmdInf.OutPath})
		compilerArgsDataBase = append(compilerArgsDataBase, CompileCommandsEntry{
			Directory: projectRoot,
			File:      cmdInf.SourcePath,
			Command:   cmdInf.ShellCommand,
		})
	}

	// ---- 写出数据库(3318-3344) ----
	refFilePath := outDir + localSep() + refJsonName
	compilerDbPath := outDir + localSep() + "compile_commands.json"
	if err := writeRefJSON(outDir, refJsonName, sourceRefs); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Failed:\n%v\n", err)
		return codeErr
	}
	if err := writeCompileCommandsJSON(outDir, compilerArgsDataBase); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR : Failed:\n%v\n", err)
		return codeErr
	}
	if opts.OnlyDumpCompilerDB {
		fmt.Print("Source Map Database Path: " + refFilePath + "\r\n")
		fmt.Print("Compiler Database Path: " + compilerDbPath + "\r\n")
		return codeDone
	}

	fmt.Fprintf(os.Stderr,
		"ERROR : full build pipeline (compile/link/output) is not ported yet (stage 3), see docs/unify-builder-migration.md\n")
	return codeErr
}

// ---- helpers ----

type kvPair struct{ k, v string }
