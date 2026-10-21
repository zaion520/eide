// Package main: unify_builder 的 Go 移植(阶段 1:契约层)。
//
// 上游:C# 单文件实现(6,068 行),见 docs/unify-builder-migration.md 的分区表。
// 本文件保持与原版一致的 CLI 契约:
//
//	unify_builder [-v] [-r commands.json] [-p builder.params]
//	              [--rebuild] [--dry-run] [--only-dump-args]
//	              [--only-dump-compilerdb] [--use-ccache]
//	              [--out-makefile] [--no-color] [--force-color]
//	              [--sdcc-not-bundle-rel]
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
)

const (
	appVersion = "3.11.1-go.1" // 对应上游 C# v3.11.1 的 Go 移植版本
	codeDone   = 0
	codeErr    = 1
)

// Options 对应 C# Options(2428-2468 行,CommandLineParser 定义),长选项名逐一对齐。
type Options struct {
	PrintVersion       bool
	RunCommandsPath    string // -r, --run
	ParamsFilePath     string // -p, --params-file
	NotUseColor        bool   // --no-color
	ForceUseColor      bool   // --force-color
	ForceRebuild       bool   // --rebuild
	OnlyPrintArgs      bool   // --only-dump-args
	OnlyDumpCompilerDB bool   // --only-dump-compilerdb
	UseCcache          bool   // --use-ccache
	OutputMakefile     bool   // --out-makefile
	DryRun             bool   // --dry-run
	SdccNotBundleRel   bool   // --sdcc-not-bundle-rel
}

func printAppInfo() {
	fmt.Printf("unify_builder (go) %s (%s/%s)\n", appVersion, runtime.GOOS, runtime.GOARCH)
	fmt.Println("unify code builder for embedded ide, em-ide.com, MIT license")
}

func main() {
	os.Exit(realMain(os.Args[1:]))
}

func realMain(args []string) int {
	opts := &Options{}
	fs := flag.NewFlagSet("unify_builder", flag.ContinueOnError)
	fs.BoolVar(&opts.PrintVersion, "v", false, "print app version")
	fs.StringVar(&opts.RunCommandsPath, "r", "", "run commands json file path")
	fs.StringVar(&opts.RunCommandsPath, "run", "", "run commands json file path")
	fs.StringVar(&opts.ParamsFilePath, "p", "", "builder params file path")
	fs.StringVar(&opts.ParamsFilePath, "params-file", "", "builder params file path")
	fs.BoolVar(&opts.NotUseColor, "no-color", false, "close color render for output")
	fs.BoolVar(&opts.ForceUseColor, "force-color", false, "force apply color render for output")
	fs.BoolVar(&opts.ForceRebuild, "rebuild", false, "force rebuild project")
	fs.BoolVar(&opts.OnlyPrintArgs, "only-dump-args", false, "just only print compiler args")
	fs.BoolVar(&opts.OnlyDumpCompilerDB, "only-dump-compilerdb", false, "just only dump compile_commands.json")
	fs.BoolVar(&opts.UseCcache, "use-ccache", false, "use ccache speed up compilation")
	fs.BoolVar(&opts.OutputMakefile, "out-makefile", false, "generate GNU Makefile when build")
	fs.BoolVar(&opts.DryRun, "dry-run", false, "dry run mode. Don't realy do compile")
	fs.BoolVar(&opts.SdccNotBundleRel, "sdcc-not-bundle-rel", false, "do not bundle *.rel for sdcc")
	// 与原版一致:未知参数报错并打印帮助
	fs.Usage = func() { printAppInfo(); fmt.Println(); fs.PrintDefaults() }
	if err := fs.Parse(args); err != nil {
		return codeErr
	}

	if opts.PrintVersion {
		printAppInfo()
		return codeDone
	}
	if opts.RunCommandsPath == "" && opts.ParamsFilePath == "" {
		fmt.Fprintln(os.Stderr, "ERROR : params too less !, we need 'builder.params' or 'commands.json' file path !")
		fs.Usage()
		return codeErr
	}

	// 阶段 2/3 待移植(对照 C# Program.cs):
	//   -r 模式        → RunCommandsJson()      (4077 行)
	//   -p 构建模式    → Main 2476-3983(params 装载 → checkDiff → CmdGenerator →
	//                    compileByMulThread → link → genOutputCommand → ref.json/
	//                    compile_commands.json → saveBuilderCommands)
	return runBuild(opts)
}
