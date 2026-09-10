package main

// --out-makefile 支持,对照 C# 3148-3250(头部)、3401-3430(obj 规则)、
// 3681-3714(link)、3895-3911(bin)、5794-5810(aliasMakefileCompiler/quotePath)。
// 以及 map 信息打印(3716-3828)。

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

func quotePath(path string) string {
	if strings.Contains(path, " ") && !strings.HasPrefix(path, "\"") {
		return "\"" + path + "\""
	}
	return path
}

// aliasMakefileCompiler(C# 5794-5810)
func aliasMakefileCompiler(compilerFullPath string) string {
	compilerFullPath = strings.Trim(compilerFullPath, "\"")
	for k, v := range makefileCompilers {
		if v == compilerFullPath {
			return "$(" + k + ")"
		}
	}
	res := regexp.MustCompile(`(?i)\.exe$`).ReplaceAllString(compilerFullPath, "$(EXE)")
	res = strings.ReplaceAll(res, toolchainRoot, "$(COMPILER_DIR)")
	res = strings.ReplaceAll(res, toUnixPath(toolchainRoot), "$(COMPILER_DIR)")
	return quotePath(res)
}

// genMakefileHeader(C# 3148-3250)
func genMakefileHeader(cmdGen *CmdGenerator, CC_PATH, AS_PATH, CXX_PATH, LD_PATH string) {
	mo := &makefileOutput
	mo.WriteString("#################################################################\r\n")
	mo.WriteString("# AUTO GENERATE BY unify_builder v" + appVersion + "\r\n")
	mo.WriteString("#################################################################\r\n\r\n")

	outpath := toRelativePath(projectRoot, outDir, true)

	mo.WriteString("# Usage:\r\n")
	mo.WriteString("#  - Build:\tmake prebuild && make COMPILER_DIR=<dir path>\r\n")
	mo.WriteString("#  - Clean:\tmake clean\r\n\r\n")
	mo.WriteString("# Targets Dependences Chain:\r\n")
	mo.WriteString("#  prebuild\r\n")
	mo.WriteString("#  all -> postbuild -> bin -> elf -> *.o\r\n\r\n")

	mo.WriteString("# Use 'make V=1' to see the full commands\r\n")
	mo.WriteString("ifdef V\r\n\tQ = \r\nelse\r\n\tQ = @\r\nendif\r\n\r\n")

	makefileCompilers["CC"] = toUnixPath(CC_PATH)
	makefileCompilers["AS"] = toUnixPath(AS_PATH)
	makefileCompilers["CXX"] = toUnixPath(CXX_PATH)
	makefileCompilers["LD"] = toUnixPath(LD_PATH)
	if cmdGen.hasOtherUtilTool("linker-lib") {
		makefileCompilers["AR"] = toUnixPath(cmdGen.getOtherUtilToolFullPath("linker-lib"))
	}

	dirvarValue := toUnixPath(toolchainRoot)
	if osWin32 {
		dirvarValue = regexp.MustCompile(`^([a-zA-Z]):/`).ReplaceAllString(dirvarValue, "/$1/")
	}
	if strings.Contains(dirvarValue, " ") {
		dirvarValue = "\"" + dirvarValue + "\""
	}
	mo.WriteString("COMPILER_DIR ?= " + dirvarValue + "\r\n")
	mo.WriteString("ifneq ($(COMPILER_DIR),)\r\n\t_PATH_TMP:=$(COMPILER_DIR)/bin:$(PATH)\r\n\texport PATH=$(_PATH_TMP)\r\nendif\r\n\r\n")
	mo.WriteString("EXE?=\r\n")
	for _, k := range sortedKeys(makefileCompilers) {
		val := regexp.MustCompile(`(?i)\.exe$`).ReplaceAllString(makefileCompilers[k], "$(EXE)")
		val = strings.ReplaceAll(val, toolchainRoot, "$(COMPILER_DIR)")
		val = strings.ReplaceAll(val, toUnixPath(toolchainRoot), "$(COMPILER_DIR)")
		mo.WriteString(k + "=" + quotePath(val) + "\r\n")
	}
	mo.WriteString("\r\n")

	mo.WriteString("###########################\r\n# targets\r\n###########################\r\n\r\n")
	mo.WriteString("COLOR_END=\\033[0m\r\nCOLOR_ERR=\\033[31;1m\r\nCOLOR_WRN=\\033[33;1m\r\nCOLOR_SUC=\\033[32;1m\r\nCOLOR_INF=\\033[34;1m\r\n\r\n")
	mo.WriteString(".PHONY : all postbuild bin elf prebuild clean\r\n\r\n")
	mo.WriteString("all: postbuild\r\n\t@echo ==========\r\n\t@printf \"$(COLOR_SUC)ALL DONE.$(COLOR_END)\\n\"\r\n\t@echo ==========\r\n\r\n")
	mo.WriteString("clean:\r\n")
	mo.WriteString("\t-rm -fv ./" + outpath + "/*.elf ./" + outpath + "/*.axf ./" + outpath + "/*.out\r\n")
	mo.WriteString("\t-rm -fv ./" + outpath + "/*.hex ./" + outpath + "/*.bin ./" + outpath + "/*.s19\r\n")
	mo.WriteString("\t-rm -rfv ./" + outpath + "/.obj\r\n\r\n")

	_ = os.Getwd
}

// genMakefileObjRules(C# 3401-3430)
func genMakefileObjRules(cmdGen *CmdGenerator, commands []cmdEntry) {
	dirRules := map[string]bool{}
	mo := &makefileOutput
	for _, entry := range commands {
		source := cmdGen.toRelativePathForCompilerArgs(entry.srcPath, true, true)
		mkinfo := entry.info
		target := cmdGen.toRelativePathForCompilerArgs(mkinfo.OutPath, true, true)
		targetDir := toUnixPath(filepathDir(target))
		if !dirRules[targetDir] {
			dirRules[targetDir] = true
			mo.WriteString(targetDir + ":\r\n\t$(Q)mkdir -p $@\r\n")
		}
		dep := changeExt(target, ".d")
		CC := quotePath(toUnixPath(replaceEnvVariable(mkinfo.ExePath, false)))
		title := "compiling"
		if strings.HasPrefix(mkinfo.SourceType, "asm") {
			title = "assembling"
		}
		mo.WriteString("-include " + dep + "\r\n")
		mo.WriteString(target + ": " + source + " Makefile | " + targetDir + "\r\n")
		mo.WriteString("\t@echo " + title + " $< ...\r\n")
		mo.WriteString("\t$(Q)" + aliasMakefileCompiler(CC) + " " + mkinfo.SourceArgs + "\r\n\r\n")
	}
}

// genMakefileLink(C# 3681-3714)
func genMakefileLink(cmdGen *CmdGenerator, linkInfo CmdInfo, allObjs []string, extraLinkCmds []linkerExCmdInfo) {
	mo := &makefileOutput
	var objdeps []string
	for _, p := range allObjs {
		objdeps = append(objdeps, cmdGen.toRelativePathForCompilerArgs(p, true, true))
	}
	elfpath := cmdGen.toRelativePathForCompilerArgs(linkInfo.OutPath, true, true)

	LD := quotePath(toUnixPath(replaceEnvVariable(linkInfo.ExePath, false)))
	mo.WriteString("objs = " + strings.Join(objdeps, " ") + "\r\n")
	mo.WriteString("elf: $(objs) Makefile\r\n")
	mo.WriteString("\t@printf \"$(COLOR_INF)linking " + elfpath + " ...$(COLOR_END)\\n\"\r\n")

	if cmdGen.getCompilerId() == "SDCC" && linkInfo.SdccBundleLibArgs != "" {
		mo.WriteString("\t$(AR) " + linkInfo.SdccBundleLibArgs + "\r\n")
	}
	mo.WriteString("\t" + aliasMakefileCompiler(LD) + " " + linkInfo.SourceArgs + "\r\n")

	if len(extraLinkCmds) > 0 {
		mo.WriteString("\t@printf \"$(COLOR_INF)execute extra link command ...$(COLOR_END)\\n\"\r\n")
		for _, cmd := range extraLinkCmds {
			exePath := quotePath(toUnixPath(replaceEnvVariable(cmd.ExePath, false)))
			mo.WriteString("\t" + exePath + " " + cmd.CommandLine + "\r\n")
		}
	}
	mo.WriteString("\r\n")
}

// genMakefileBin(C# 3895-3911)
func genMakefileBin(commandList []CmdInfo) {
	mo := &makefileOutput
	mo.WriteString("bin: elf Makefile\r\n")
	if len(commandList) > 0 {
		mo.WriteString("\t@printf \"$(COLOR_INF)output binary files ...$(COLOR_END)\\n\"\r\n")
		for _, cmd := range commandList {
			exePath := quotePath(toUnixPath(replaceEnvVariable(cmd.ExePath, false)))
			mo.WriteString("\t" + aliasMakefileCompiler(exePath) + " " + cmd.CommandLine + "\r\n")
		}
		mo.WriteString("\r\n")
	}
}

// printMapInfo(C# 3716-3828):map 解析 + RAM/ROM + armlink 区域树
func printMapInfo(cmdGen *CmdGenerator, mapFileFullPath string) {
	defer func() {
		if r := recover(); r != nil {
			warn("\r\ncan't read information from '.map' file !, "+fmt.Sprint(r), true)
		}
	}()

	ccID := strings.ToLower(cmdGen.getCompilerId())

	var ramSize, romSize int
	var mapLog string
	switch ccID {
	case "sdcc":
		ramSize, romSize, mapLog = parseMapFileForSdcc(mapFileFullPath)
	case "iar_stm8", "iar_arm":
		ramSize, romSize, mapLog = parseMapFileForIar(mapFileFullPath)
	default:
		ramSize, romSize, mapLog = parseMapFileForDef(mapFileFullPath, cmdGen)
	}

	if ramSize == 0 {
		ramSize = -1
	}
	if romSize == 0 {
		romSize = -1
	}
	if strings.TrimSpace(mapLog) != "" {
		logOut("\r\n"+strings.TrimRight(mapLog, "\r\n \t"), true)
	}

	if (ramSize >= 0 || romSize >= 0) && (ramMaxSize > 0 && romMaxSize > 0) {
		logOut("", true)
		logOut("Total Memory Usage:", true)
		logOut("", true)
		if ramSize >= 0 {
			s := memorysize2str(uint32(ramSize)) + "/" + memorysize2str(uint32(ramMaxSize))
			printProgress("  RAM: ", float32(ramSize)/float32(ramMaxSize), s)
		}
		if romSize >= 0 {
			s := memorysize2str(uint32(romSize)) + "/" + memorysize2str(uint32(romMaxSize))
			printProgress("  ROM: ", float32(romSize)/float32(romMaxSize), s)
		}
	}

	if ccID == "ac5" || ccID == "ac6" {
		mapinfo := parseMapRegionInfoForArmlink(mapFileFullPath)
		if len(mapinfo.loadRegions) > 0 {
			logOut("", true)
			logOut("Section Memory Usage:", true)

			makeRegionDespStr := func(region mapRegion) string {
				return fmt.Sprintf("%s (0x%08X)", region.name, region.addr)
			}
			printRegion := func(region mapRegion, despMaxLen, depth int, prefix string) {
				s := memorysize2str(region.size) + "/" + memorysize2str(region.maxSize)
				n := makeRegionDespStr(region)
				if despMaxLen > 0 {
					n = padRight(n, despMaxLen)
				}
				printProgress(strings.Repeat(" ", depth*2)+prefix+n+": ",
					float32(region.size)/float32(region.maxSize), s)
			}

			for _, region := range mapinfo.loadRegions {
				logOut("", true)
				printRegion(region.attr, 0, 1, "")
				if len(region.children) > 0 {
					maxLen := 0
					for _, child := range region.children {
						if n := len(makeRegionDespStr(child)); n > maxLen {
							maxLen = n
						}
					}
					for _, child := range region.children {
						printRegion(child, maxLen, 2, "- ")
					}
				} else {
					logOut("    " + "  " + "** This load region have no execution regions. **", true)
				}
			}
		}
	}
}

// filepathDir: filepath.Dir 但保持本地分隔符语义
func filepathDir(p string) string {
	idx := strings.LastIndexAny(p, "\\/")
	if idx < 0 {
		return "."
	}
	if idx == 0 {
		return p[:1]
	}
	return p[:idx]
}

// changeExt: Path.ChangeExtension
func changeExt(p, ext string) string {
	dot := strings.LastIndexByte(p, '.')
	sep := strings.LastIndexAny(p, "\\/")
	if dot > sep && dot >= 0 {
		return p[:dot] + ext
	}
	return p + ext
}
