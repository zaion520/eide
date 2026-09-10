package main

// 日志渲染,对照 C# log/info/warn/error/success(5970-6066)、printProgress(4640-4673)、
// renderCompilerOutput(4569-4638)、渲染表初始化(2848-3035)。
// Windows 控制台用 ANSI 序列(VSCode/Cursor 输出面板原生支持)。

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// ---- ANSI render targets(C# 2270-2273) ----
const (
	warnRender = "\x1b[33;22m$1\x1b[0m"
	erroRender = "\x1b[31;22m$1\x1b[0m"
	noteRender = "\x1b[36;22m$1\x1b[0m"
	hintRender = "\x1b[35;22m$1\x1b[0m"
)

var (
	ccOutputRender []renderRule
	lkOutputRender []renderRule
)

type renderRule struct {
	re  *regexp.Regexp
	rep string
}

var (
	colorRendererEnabled  = true
	enableNormalOut       = true
	showRelativePathOnLog = false
)

func logOut(line string, newLine bool) {
	if newLine {
		fmt.Println(line)
	} else {
		fmt.Print(line)
	}
}

func colorize(color, txt string, newLine bool) {
	logOut(color+txt+"\x1b[0m", newLine)
}

func success(txt string, newLine bool) { colorize("\x1b[32;22m", txt, newLine) } // green
func info(txt string, newLine bool)    { colorize("\x1b[36;22m", txt, newLine) } // cyan
func warn(txt string, newLine bool)    { colorize("\x1b[33;22m", txt, newLine) } // yellow
func errOut(txt string, newLine bool)  { colorize("\x1b[31;22m", txt, newLine) } // red

func infoWithLable(txt string, newLine bool, label string) {
	if label == "" {
		label = "INFO"
	}
	fmt.Print("[\x1b[34;22m " + label + " \x1b[0m] " + txt)
	if newLine {
		fmt.Print("\r\n")
	}
}

func warnWithLable(txt string, newLine bool, label string) {
	if label == "" {
		label = "WARNING"
	}
	fmt.Print("\x1b[43;30m " + label + " \x1b[0m " + txt)
	if newLine {
		fmt.Print("\r\n")
	}
}

func errorWithLable(txt string, newLine bool, label string) {
	if label == "" {
		label = "ERROR"
	}
	fmt.Print("\x1b[41;97m " + label + " \x1b[0m " + txt)
	if newLine {
		fmt.Print("\r\n")
	}
}

func doneWithLable(txt string, newLine bool, label string) {
	if label == "" {
		label = "DONE"
	}
	fmt.Print("[\x1b[32;22m " + label + " \x1b[0m] " + txt)
	if newLine {
		fmt.Print("\r\n")
	}
}

// printProgress(C# 4640-4673)
func printProgress(label string, progress float32, suffix string) {
	const barMaxLen = 20
	barTxt := make([]rune, barMaxLen)
	for i := range barTxt {
		barTxt[i] = ' '
	}
	num := int(progress*barMaxLen + 0.45)
	if num > barMaxLen {
		num = barMaxLen
	}
	if num < 0 {
		num = 0
	}
	for i := 0; i < num; i++ {
		barTxt[i] = '#'
	}
	progTxt := fmt.Sprintf("%s[%s] %s %s", label, string(barTxt),
		padRight(fmt.Sprintf("%.1f", progress*100)+"%", 9),
		suffix)
	if progress > 1.0 {
		errOut(progTxt, true)
	} else if progress >= 0.95 {
		warn(progTxt, true)
	} else {
		logOut(progTxt, true)
	}
}

func padLeft(s string, n int, pad string) string {
	if len(s) >= n {
		return s
	}
	return strings.Repeat(pad, n-len(s)) + s
}

func padRight(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

// genProgressTag(C# 4876-4887)
func genProgressTag(curVal, total int) string {
	if curVal >= total {
		return "[100%]"
	}
	progress := fmt.Sprintf("%d", curVal*100/total)
	for len(progress) < 3 {
		progress = " " + progress
	}
	return "[" + progress + "%]"
}

func getCompileLogTag(sourceType string) string {
	switch sourceType {
	case "c":
		return "CC"
	case "asm":
		return "AS"
	case "cpp":
		return "CXX"
	default:
		return "CC"
	}
}

func toHumanReadablePath(absPath string) string {
	if showRelativePathOnLog {
		if rp := toRelativePath(projectRoot, absPath, true); rp != "" {
			return rp
		}
	}
	return baseName(absPath)
}

// addRenderRule: C# ccOutputRender.Add(new Regex(...), RENDER)
func addRenderRule(list *[]renderRule, pattern, rep string) {
	re, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		return
	}
	*list = append(*list, renderRule{re: re, rep: rep})
}

// initOutputRender(C# 2848-3035):按编译器 ID 安装输出着色规则。
func initOutputRender(ccID string) {
	ccOutputRender = nil
	lkOutputRender = nil
	switch ccID {
	case "keil_c51":
		addRenderRule(&ccOutputRender, `(\bwarning\s[A-Z][0-9]+(?::\s.+)?)`, warnRender)
		addRenderRule(&ccOutputRender, `(\berror\s[A-Z][0-9]+(?::\s.+)?)`, erroRender)
		addRenderRule(&lkOutputRender, `(\bwarning\s[A-Z][0-9]+(?::\s.+)?)`, warnRender)
		addRenderRule(&lkOutputRender, `(\berror\s[A-Z][0-9]+(?::\s.+)?)`, erroRender)
	case "sdcc":
		addRenderRule(&ccOutputRender, `(SyntaxError:)`, erroRender)
		addRenderRule(&ccOutputRender, `(warning \d+:|\swarning:\s|^warning:\s)`, warnRender)
		addRenderRule(&ccOutputRender, `(error \d+:|\serror:\s|^error:\s)`, erroRender)
		addRenderRule(&lkOutputRender, `(warning \d+:|\swarning:\s|^warning:\s)`, warnRender)
		addRenderRule(&lkOutputRender, `(error \d+:|\serror:\s|^error:\s)`, erroRender)
		addRenderRule(&lkOutputRender, `(ASlink-Warning-\w+)`, warnRender)
	case "iar_stm8", "iar_arm":
		addRenderRule(&ccOutputRender, `\b(warning\[\w+\]:\s)`, warnRender)
		addRenderRule(&ccOutputRender, `\b(error\[\w+\]:\s)`, erroRender)
		addRenderRule(&ccOutputRender, `^([\^~\s]*\^[\^~\s]*)$`, hintRender)
		addRenderRule(&ccOutputRender, `^([~\s]*~[~\s]*)$`, noteRender)
		addRenderRule(&ccOutputRender, `^(\s*\|.+)`, hintRender)
		addRenderRule(&lkOutputRender, `\b(warning\[\w+\]:\s)`, warnRender)
		addRenderRule(&lkOutputRender, `\b(error\[\w+\]:\s)`, erroRender)
	case "cosmic_stm8":
		addRenderRule(&ccOutputRender, `^(#warning \w+)`, warnRender)
		addRenderRule(&ccOutputRender, `^(#error \w+)`, erroRender)
		addRenderRule(&lkOutputRender, `^(#warning \w+)`, warnRender)
		addRenderRule(&lkOutputRender, `^(#error \w+)`, erroRender)
		addRenderRule(&lkOutputRender, `\b(symbol \w+ not defined)`, erroRender)
		addRenderRule(&lkOutputRender, `\b(segment [\.\w\-]+ size overflow)`, erroRender)
	case "gnu_sdcc_mcs51":
		addRenderRule(&ccOutputRender, `(warning \d+:|\swarning:\s|^warning:\s)`, warnRender)
		addRenderRule(&ccOutputRender, `(error \d+:|\serror:\s|^error:\s)`, erroRender)
		addRenderRule(&lkOutputRender, `\b(warning:\s)`, warnRender)
		addRenderRule(&lkOutputRender, `\b(error:\s)`, erroRender)
		addRenderRule(&lkOutputRender, `\b(note:\s)`, noteRender)
		addRenderRule(&lkOutputRender, `\b(cannot open linker script file)\b`, erroRender)
		addRenderRule(&lkOutputRender, `\b(undefined reference to `+"`"+`[^']+')`, erroRender)
		addRenderRule(&lkOutputRender, `\b(multiple definition of `+"`"+`[^']+')`, erroRender)
		addRenderRule(&lkOutputRender, `\b(section `+"`"+`[^']+' will not fit in region `+"`"+`[^']+')`, erroRender)
		addRenderRule(&lkOutputRender, `\b(region `+"`"+`[^']+' overflowed by \w+ bytes)`, hintRender)
		addRenderRule(&lkOutputRender, `\b(region \w+ overflowed with \w+)`, hintRender)
		addRenderRule(&ccOutputRender, `(\[\-w[\w\-=]+\])`, hintRender)
	default:
		addRenderRule(&ccOutputRender, `\b(warning:\s)`, warnRender)
		addRenderRule(&ccOutputRender, `\b(error:\s)`, erroRender)
		addRenderRule(&ccOutputRender, `\b(note:\s)`, noteRender)
		addRenderRule(&ccOutputRender, `^([\^~\s]*\^[\^~\s]*)$`, hintRender)
		addRenderRule(&ccOutputRender, `^([~\s]*~[~\s]*)$`, noteRender)
		addRenderRule(&ccOutputRender, `^(\s*\|.+)`, hintRender)
		if ccID == "gcc" {
			addRenderRule(&ccOutputRender, `(\[\-w[\w\-=]+\])`, hintRender)
			addRenderRule(&ccOutputRender, `(\{aka [^\}]+\})`, noteRender)
			addRenderRule(&lkOutputRender, `\b(warning:\s)`, warnRender)
			addRenderRule(&lkOutputRender, `\b(error:\s)`, erroRender)
			addRenderRule(&lkOutputRender, `\b(note:\s)`, noteRender)
			addRenderRule(&lkOutputRender, `\b(cannot open linker script file)\b`, erroRender)
			addRenderRule(&lkOutputRender, `\b(undefined reference to `+"`"+`[^']+')`, erroRender)
			addRenderRule(&lkOutputRender, `\b(multiple definition of `+"`"+`[^']+')`, erroRender)
			addRenderRule(&lkOutputRender, `\b(section `+"`"+`[^']+' will not fit in region `+"`"+`[^']+')`, erroRender)
			addRenderRule(&lkOutputRender, `\b(region `+"`"+`[^']+' overflowed by \w+ bytes)`, hintRender)
			addRenderRule(&lkOutputRender, `\b(region \w+ overflowed with \w+)`, hintRender)
			addRenderRule(&lkOutputRender, `(\[\-w[\w\-=]+\])`, hintRender)
		} else if strings.HasPrefix(ccID, "ac") {
			addRenderRule(&lkOutputRender, `(Fatal error: L\w+:)`, erroRender)
			addRenderRule(&lkOutputRender, `(Error: L\w+:)`, erroRender)
			addRenderRule(&lkOutputRender, `(Warning: L\w+:)`, warnRender)
		}
	}
}

// renderCompilerOutput(C# 4569-4624)
func renderCompilerOutput(output string, isLinker bool) string {
	if strings.TrimSpace(output) == "" {
		return ""
	}
	if !colorRendererEnabled {
		return output + "\n"
	}
	renderMap := &ccOutputRender
	if isLinker {
		renderMap = &lkOutputRender
	}
	lines := reCRLF.Split(output, -1)
	startIdx := 0
	for i := range lines {
		if strings.TrimSpace(lines[i]) != "" {
			startIdx = i
			break
		}
	}
	endIdx := len(lines) - 1
	for ; endIdx >= 0; endIdx-- {
		if strings.TrimSpace(lines[endIdx]) != "" {
			break
		}
	}
	var ret strings.Builder
	for i := startIdx; i <= endIdx; i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "" {
			ret.WriteString(line + "\n")
			continue
		}
		for _, rule := range *renderMap {
			line = rule.re.ReplaceAllString(line, rule.rep)
		}
		ret.WriteString(line + "\n")
	}
	return ret.String()
}

var reCRLF = regexp.MustCompile(`\r\n|\n`)

// ---- 构建日志缓冲(C# 2341-2345) ----

var (
	buildInfoLogs   []string
	compilerLogsCpp []string
	compilerLogsLnk []string
	prebuildLogs    string
	postbuildLogs   string
)

func storeCompileOutput(output string, isLinker bool) {
	if isLinker {
		compilerLogsLnk = append(compilerLogsLnk, output)
	} else {
		compilerLogsCpp = append(compilerLogsCpp, output)
	}
}

func printCompileOutput(output string, isLinker bool) {
	fmt.Print(renderCompilerOutput(output, isLinker))
}

// ---- 构建锁 + 日志文件(C# lockBuild/unlockBuild/dumpCompilerLog/appendLogs) ----

var (
	lockFile          *os.File
	logStream         *os.File
	compilerLogStream *os.File
)

func appendBuildInfo(msg string) {
	buildInfoLogs = append(buildInfoLogs, msg)
}

func lockBuild(opts *Options, dumpPath string) {
	var builderLogPath, compilerLogPath string
	if opts.OnlyDumpCompilerDB || opts.OnlyPrintArgs {
		builderLogPath = os.TempDir() + string(os.PathSeparator) + "unify_builder.log"
		compilerLogPath = os.TempDir() + string(os.PathSeparator) + "compiler.log"
	} else {
		builderLogPath = dumpPath + localSep() + "unify_builder.log"
		compilerLogPath = dumpPath + localSep() + "compiler.log"
	}

	if lockFile == nil {
		_ = os.MkdirAll(dumpPath, 0o755)
		f, err := os.OpenFile(dumpPath+localSep()+".lock", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o666)
		if err == nil {
			lockFile = f
		}
	}
	if logStream == nil {
		mode := os.O_APPEND | os.O_CREATE | os.O_WRONLY
		if st, err := os.Stat(builderLogPath); err == nil && st.Size() > 100*1024 {
			mode = os.O_TRUNC | os.O_WRONLY
		}
		f, err := os.OpenFile(builderLogPath, mode, 0o666)
		if err == nil {
			logStream = f
		}
	}
	if compilerLogStream == nil {
		f, err := os.OpenFile(compilerLogPath, os.O_TRUNC|os.O_CREATE|os.O_WRONLY, 0o666)
		if err == nil {
			compilerLogStream = f
		}
	}
}

func unlockBuild() {
	if compilerLogStream != nil {
		_ = compilerLogStream.Close()
		compilerLogStream = nil
	}
	if logStream != nil {
		_ = logStream.Close()
		logStream = nil
	}
	if lockFile != nil {
		name := lockFile.Name()
		_ = lockFile.Close()
		// 冗余写入触发 nodejs filewatcher(C# 5866-5868)
		_ = os.WriteFile(name, []byte{}, 0o666)
		lockFile = nil
	}
}

func appendLogs(label, msg string, logs []string) {
	if logStream == nil {
		return
	}
	txt := "[" + currentTimeStr() + "]\t" + label + "\r\n" + msg + "\r\n"
	if len(logs) > 0 {
		txt += "---\r\n" + strings.Join(logs, "\r\n") + "\r\n\r\n"
	} else {
		txt += "\r\n"
	}
	_, _ = logStream.Write(encodeBytes(txt, "ANSI"))
}

func dumpCompilerLog() {
	if compilerLogStream == nil {
		return
	}
	sep := "\r\n"
	sections := []struct {
		title string
		body  string
	}{
		{"info", ">>> info" + sep + sep + strings.Join(buildInfoLogs, sep) + sep + sep + sep},
		{"prebuild", ">>> prebuild" + sep + sep + prebuildLogs + sep + sep + sep},
		{"cc", ">>> cc" + sep + sep + strings.Join(compilerLogsCpp, sep) + sep + sep + sep},
		{"ld", ">>> ld" + sep + sep + strings.Join(compilerLogsLnk, sep) + sep + sep + sep},
		{"postbuild", ">>> postbuild" + sep + sep + postbuildLogs},
	}
	for _, sec := range sections {
		_, _ = compilerLogStream.Write([]byte(sec.body))
	}
}

func currentTimeStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// getBlanks(C# 5178-5190)
func getBlanks(num int) string {
	if num <= 0 {
		return ""
	}
	return strings.Repeat(" ", num)
}
