package main

// 并行编译与任务运行:对照 C# compileByMulThread(5055-5176)、calcuThreads(4675-4702)、
// runTasks(5192-5390)、executeCommands(4818-4869)、RunCommandsJson(4077-4141)。

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// calcuThreads(C# 4675-4702)
func calcuThreads(threads, cmdCount int) int {
	if threads < 2 {
		return 4
	}
	minThread := 2
	if threads >= 8 {
		minThread = threads / 4
	}
	maxThread := threads
	expactThread := 4
	if threads >= 4 {
		expactThread = threads / 2
	}
	if cmdCount/maxThread >= 2 {
		return maxThread
	}
	if cmdCount/expactThread >= 2 {
		return expactThread
	}
	if cmdCount/minThread >= 2 {
		return minThread
	}
	return 8
}

type compileLogData struct {
	logTxt  string
	srcInfo CmdInfo
}

// compileByMulThread(C# 5055-5176):goroutine 池 + 单独 logger 协程按完成序打印。
func compileByMulThread(thrNum int, cmds []CmdInfo, errLogs *[]string, opts *Options, errLevel int) error {
	info("start compiling (jobs: "+itoa(thrNum)+") ...", true)
	if len(cmds) > 0 {
		logOut("", true)
	}

	var mu sync.Mutex
	var compileErr error


	ccLogQueue := make(chan compileLogData, 256)
	cmdQueue := make(chan CmdInfo, len(cmds))
	for _, item := range cmds {
		cmdQueue <- item
	}
	close(cmdQueue)

	// logger goroutine(C# 5073-5103)
	loggerDone := make(chan struct{})
	go func() {
		defer close(loggerDone)
		curProgress := 0
		tolProgress := len(cmds)
		for logData := range ccLogQueue {
			curProgress++
			compilerTag := getCompileLogTag(logData.srcInfo.SourceType)
			humanRdPath := toHumanReadablePath(logData.srcInfo.SourcePath)
			progressLog := ">> " + genProgressTag(curProgress, tolProgress) + " " + compilerTag + " '" + humanRdPath + "'"
			fmt.Println(progressLog)

			if strings.TrimSpace(logData.logTxt) != "" {
				fmt.Print(renderCompilerOutput(logData.logTxt, false))
				storeCompileOutput(logData.logTxt, false)
			}
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < thrNum; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ccArgs := range cmdQueue {
				mu.Lock()
				failed := compileErr != nil
				mu.Unlock()
				if failed {
					return
				}

				output, exitCode := runExe(ccArgs.ExePath, ccArgs.CommandLine, ccArgs.OutputEncoding, opts.DryRun)
				cclog := strings.TrimSpace(output)

				isLogEn := enableNormalOut || exitCode != codeDone

				logTxt := ""
				if isLogEn {
					logTxt = cclog
				}
				ccLogQueue <- compileLogData{srcInfo: ccArgs, logTxt: logTxt}

				if exitCode > errLevel {
					mu.Lock()
					*errLogs = append(*errLogs, cclog)
					compileErr = fmt.Errorf("compilation failed at : \"%s\", exit code: %d\ncommand: \n  %s",
						ccArgs.SourcePath, exitCode, ccArgs.ShellCommand)
					mu.Unlock()
					return
				}
				if !opts.DryRun {
					tablePut(ccArgs.OutPath, ccArgs.ShellCommand)
				}
			}
		}()
	}

	wg.Wait()
	// notify logger the builder is end (channel close)
	close(ccLogQueue)
	<-loggerDone

	return compileErr
}

// runTasks(C# 5192-5390):beforeBuildTasks / afterBuildTasks。
// 返回 (exitCode, logs)
func runTasks(label, fieldName string, opts *Options, params *JObj) (int, string) {
	vars := map[string]string{}
	for k, v := range curEnvs {
		if _, dup := vars[k]; !dup {
			vars[k] = v
		}
	}
	for k, v := range cliVars {
		if _, dup := vars[k]; !dup {
			vars[k] = v
		}
	}

	options := params.ObjOr("options")
	if options == nil || !options.Has(fieldName) {
		return codeDone, ""
	}

	logs := ""
	taskList := options.ArrOr(fieldName)

	if opts.OutputMakefile {
		if fieldName == "beforeBuildTasks" {
			makefileOutput.WriteString("prebuild:\r\n")
			makefileOutput.WriteString("\t@printf \"$(COLOR_INF)prebuild ...$(COLOR_END)\\n\"\r\n")
		} else {
			makefileOutput.WriteString("postbuild: bin\r\n")
			makefileOutput.WriteString("\t@printf \"$(COLOR_INF)postbuild ...$(COLOR_END)\\n\"\r\n")
		}
	}

	if len(taskList) == 0 {
		if fieldName == "beforeBuildTasks" {
			makefileOutput.WriteString("\t@echo nothing to prebuild.\r\n\r\n")
		} else {
			makefileOutput.WriteString("\t@echo nothing to postbuild.\r\n\r\n")
		}
		return codeDone, logs
	}

	// check available task numbers
	availableCount := 0
	for _, item := range taskList {
		m := item.Obj
		if m != nil && m.Has("disable") && m.Get("disable").Kind == JBool && m.BoolOr("disable", false) {
			continue
		}
		availableCount++
	}
	if availableCount == 0 {
		return codeDone, logs
	}

	infoWithLable("", false, "")
	info(strings.ToLower(label) + " ...", true)

	maxLen := -1
	for _, item := range taskList {
		if m := item.Obj; m != nil && m.Has("name") {
			if n := len(m.Str("name")); n > maxLen {
				maxLen = n
			}
		}
	}

	reBashInCmd := regexp.MustCompile(`(?i)^(?:.+\b)?bash(?:\.exe)?(?:\s|")`)
	reVarName := regexp.MustCompile(`^[\w]+$`)
	reMakefileTarget := regexp.MustCompile(`%(\w+)%`)

	for _, item := range taskList {
		m := item.Obj
		if m == nil {
			continue
		}
		if m.Has("disable") && m.Get("disable").Kind == JBool && m.BoolOr("disable", false) {
			continue
		}
		if !m.Has("command") {
			continue
		}
		command := strings.TrimSpace(m.Str("command"))
		if command == "" {
			continue
		}

		taskName := command
		if m.Has("name") {
			if n := strings.TrimSpace(m.Str("name")); n != "" {
				taskName = n
			}
		}

		logOut("\r\n>> " + taskName + getBlanks(maxLen-len(taskName)) + "\t\t", false)

		makefileTargetCmd := reMakefileTarget.ReplaceAllString(command, "$($1)")
		makefileTargetCmd = strings.ReplaceAll(makefileTargetCmd, toolchainRoot, "$(COMPILER_DIR)")

		useBashInCmd := osWin32 && reBashInCmd.MatchString(command)
		for i := 0; i < 5; i++ {
			if !strings.Contains(command, "${") {
				break
			}
			// C# 遍历 Dictionary 无固定顺序;此处按键名长度降序,保证长变量名先替换
			keys := make([]string, 0, len(vars))
			for k := range vars {
				keys = append(keys, k)
			}
			sort.Slice(keys, func(a, b int) bool { return len(keys[a]) > len(keys[b]) })
			for _, k := range keys {
				if !reVarName.MatchString(k) {
					continue
				}
				value := vars[k]
				if useBashInCmd {
					value = toUnixPath(value)
				}
				command = replaceVarIgnoreCase(command, k, value)
				if opts.OutputMakefile {
					replaceValue := value
					if osWin32 {
						path := replaceValue
						if isAbsolutePath(path) {
							if rp := toRelativePath(projectRoot, path, false); rp != "" {
								path = rp
							}
						}
						if regexp.MustCompile(`(?i)path|dir\b|directory|folder|root\b`).MatchString(k) {
							path = toUnixPath(path)
						}
						if k == "ToolchainRoot" {
							path = "$(COMPILER_DIR)"
						} else if strings.HasPrefix(toUnixPath(path), toUnixPath(toolchainRoot)) {
							path = strings.ReplaceAll(toUnixPath(path), toUnixPath(toolchainRoot), "$(COMPILER_DIR)")
						}
						replaceValue = path
					}
					makefileTargetCmd = replaceVarIgnoreCase(makefileTargetCmd, k, replaceValue)
				}
			}
		}

		if opts.OutputMakefile {
			makefileOutput.WriteString("\t" + makefileTargetCmd + "\r\n")
		}

		// run command
		out, code := runShellCommand(command, "", opts.DryRun)
		logs = out
		if code == codeDone {
			success("[done]", true)
			if strings.TrimSpace(logs) != "" {
				logOut("\r\n"+logs, false)
			}
		} else {
			errOut("[failed]", true)
			logOut("\r\n"+command, true)
			if strings.TrimSpace(logs) != "" {
				errOut("\r\n"+logs, false)
			}
			if m.Has("stopBuildAfterFailed") && m.Get("stopBuildAfterFailed").Kind == JBool && m.BoolOr("stopBuildAfterFailed", false) {
				return codeErr, logs
			}
			if m.Has("abortAfterFailed") && m.Get("abortAfterFailed").Kind == JBool && m.BoolOr("abortAfterFailed", false) {
				break
			}
		}
	}

	if opts.OutputMakefile {
		makefileOutput.WriteString("\r\n")
	}
	logOut("", true)
	return codeDone, logs
}

// replaceVarIgnoreCase: Regex.Replace(command, "\$\{KEY\}", value, IgnoreCase)
func replaceVarIgnoreCase(s, key, value string) string {
	re, err := regexp.Compile(`(?i)\$\{` + regexp.QuoteMeta(key) + `\}`)
	if err != nil {
		return s
	}
	return re.ReplaceAllString(s, strings.ReplaceAll(value, "$", "$$"))
}

// commandInfo(C# 4809-4816)
type commandInfo struct {
	title       string
	program     string
	command     string
	order       int
	ignoreFailed bool
}

// executeCommands(C# 4818-4869): -r 模式的命令运行器
func executeCommands(cmds []commandInfo) int {
	titleMaxLen := 0
	for _, cmd := range cmds {
		if len(cmd.title) > titleMaxLen {
			titleMaxLen = len(cmd.title)
		}
	}

	hasFailed := false
	for idx, cmd := range cmds {
		logOut(">> "+cmd.title+getBlanks(titleMaxLen-len(cmd.title))+" ...\t", false)

		cmdOutput, exitCode := runExe(cmd.program, cmd.command, "", false)

		if exitCode == codeDone {
			success("[done]", true)
		} else {
			errOut("[failed]", true)
		}

		if exitCode != codeDone {
			hasFailed = true
			logOut("", true)
			logTxt := "   " + cmdOutput
			// 缩进每一行(C# Regex.Replace(logTxt, "(?<enter>\n)", "${enter}   "))
			fmt.Print(strings.ReplaceAll(logTxt, "\n", "\n   "))

			if !cmd.ignoreFailed {
				return exitCode
			}
			if idx != len(cmds)-1 {
				logOut("", true)
			}
		}
	}
	if hasFailed {
		return codeErr
	}
	return codeDone
}

// runCommandsJson(C# 4077-4141): -r 模式入口
func runCommandsJson(opts *Options) int {
	data, err := os.ReadFile(opts.RunCommandsPath)
	if err != nil {
		errorWithLable("Load commands json failed !\r\n"+err.Error(), true, "")
		return codeErr
	}
	jv, err := ParseJVal(data)
	if err != nil || jv.Kind != JArray {
		errorWithLable("Load commands json failed !\r\n"+err.Error(), true, "")
		return codeErr
	}

	var cmds []commandInfo
	for _, item := range jv.Arr {
		m := item.Obj
		if m == nil {
			continue
		}
		program := ""
		if m.Has("program") {
			program = m.Str("program")
		}
		command := m.Str("command")
		if program == "" {
			if osWin32 {
				program = "cmd"
				command = "/C \"" + command + "\""
			} else {
				program = "/bin/bash"
				command = "-c \"" + command + "\""
			}
		}
		ci := commandInfo{
			title:    m.Str("title"),
			program:  program,
			command:  command,
			order:    100,
		}
		if m.Has("order") {
			ci.order = int(m.Get("order").Num)
		}
		if m.Has("ignoreFailed") {
			ci.ignoreFailed = m.BoolOr("ignoreFailed", false)
		}
		cmds = append(cmds, ci)
	}

	sort.SliceStable(cmds, func(a, b int) bool { return cmds[a].order < cmds[b].order })

	infoWithLable("", false, "")
	info("start building at "+currentTimeStr()+"\r\n", true)

	exitCode := executeCommands(cmds)

	logOut("", true)
	doneWithLable("", false, "")
	if exitCode == codeDone {
		success("build successfully !, elapsed time "+elapsedStr(), false)
	} else {
		errOut("build failed !, elapsed time "+elapsedStr(), false)
	}
	logOut("", true)
	logOut("", true)
	return exitCode
}
