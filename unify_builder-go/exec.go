package main

// 进程执行器,对照 C# Program.runExe/runShellCommand(4889-5037) + RuntimeEncoding(252-288)。
//
// 关键语义:
//   - Windows: C# Process.Arguments 是"原始命令行字符串"(CreateProcess 规则),
//     Go 侧用 syscall.SysProcAttr.CmdLine 原样传递,避免参数转义差异。
//   - 非 Windows: .NET 会把 Arguments 字符串解析成 argv;此处用 shell-words 规则拆分。
//   - 编码: 子进程输出按模型 $encoding(CmdInfo.OutputEncoding)解码;
//     "ANSI"/空 在 Windows 上取系统 ACP(GetACP,中文系统=GBK/936),非 Windows 为 UTF-8。

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
)

// ---- 代码页(C# GetACP P/Invoke,见 getacp_windows.go) ----

// encodingForName: 模型 $encoding / "ANSI" / 码页 → 解码器(对应 C# Encoding.GetEncoding)。
// wineACPOverride: Wine 工具链的 ANSI 代码页。
//
// 非 Windows 上 getACP() 返回 65001(UTF-8), 但 Wine 里的 Windows 程序仍按
// Wine 自己的 ACP 解读文件与命令行(中文环境实测 = 936/GBK)。若用 UTF-8 写
// .lnp/.objlist, armlink 会把中文字节当 GBK 解, 路径变成 "锟斤拷锟斤拷",
// 报 L6002U "Could not open file"。
//
// 因此检测到 Wine 工具链时, "ANSI"/空编码要解析成 Wine 的 ACP。
// 0 表示未启用(走原逻辑)。
var wineACPOverride int

// isWineToolchain 标记当前构建使用的是 Wine 工具链。
//
// 为什么需要: wineACPOverride 是进程级全局变量, 但一个进程只构建一个工具链,
// 所以它天然只对当前工具链有效。真正的问题是**输出解码**:
// Wine 工具链的 stdout/stderr 是 ANSI(GBK), 而 Linux 原生工具链(GCC)是 UTF-8,
// 两者必须分开判断, 否则 GCC 的输出会被按 GBK 解码成乱码。
var isWineToolchain bool

func encodingForName(name string) encoding.Encoding {
	switch strings.ToUpper(strings.TrimSpace(name)) {
	case "", "ANSI", "DEFAULT":
		if wineACPOverride > 0 {
			return encodingForCodePage(wineACPOverride)
		}
		return encodingForCodePage(getACP())
	case "UTF8", "UTF-8", "65001":
		return unicode.UTF8 // C# new UTF8Encoding(false): 无 BOM
	case "UTF16", "UNICODE", "1200":
		return unicode.UTF16(unicode.LittleEndian, unicode.UseBOM)
	case "UTF16BE", "UTF-16BE", "1201":
		return unicode.UTF16(unicode.BigEndian, unicode.UseBOM)
	case "GBK", "GB2312", "936", "CP936":
		return simplifiedchinese.GBK
	case "GB18030", "54936":
		return simplifiedchinese.GB18030
	case "BIG5", "950", "CP950":
		return traditionalchinese.Big5
	case "ASCII", "20127":
		return charmap.ISO8859_1 // 近似:纯 ASCII 段两者一致
	}
	if cp := parseCodePage(name); cp > 0 {
		return encodingForCodePage(cp)
	}
	return encodingForCodePage(getACP())
}

func parseCodePage(name string) int {
	if len(name) == 0 || name[0] < '0' || name[0] > '9' {
		return -1
	}
	n := 0
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func encodingForCodePage(cp int) encoding.Encoding {
	switch cp {
	case 65001, 0:
		return unicode.UTF8
	case 936, 52936, 20936, 10008:
		return simplifiedchinese.GBK
	case 950:
		return traditionalchinese.Big5
	case 54936:
		return simplifiedchinese.GB18030
	case 1252:
		return charmap.Windows1252
	case 1250:
		return charmap.Windows1250
	case 1251:
		return charmap.Windows1251
	case 1253:
		return charmap.Windows1253
	case 1254:
		return charmap.Windows1254
	case 1255:
		return charmap.Windows1255
	case 1256:
		return charmap.Windows1256
	case 1257:
		return charmap.Windows1257
	case 1258:
		return charmap.Windows1258
	case 932:
		return charmap.Windows1252 // 日文码页不在常见 EIDE 模型内,给近似回退
	case 28591:
		return charmap.ISO8859_1
	case 28592:
		return charmap.ISO8859_2
	default:
		return unicode.UTF8
	}
}

// encodeBytes: 按 C# Encoding.GetBytes 语义把 UTF-8 字符串编码为目标字符集(写文件用)。
func encodeBytes(text string, encName string) []byte {
	enc := encodingForName(encName)
	if enc == nil {
		return []byte(text)
	}
	out, err := enc.NewEncoder().Bytes([]byte(text))
	if err != nil {
		return []byte(text)
	}
	return out
}

func decodeBytes(data []byte, encName string) string {
	enc := encodingForName(encName)
	if enc == nil {
		return string(data)
	}
	out, err := enc.NewDecoder().Bytes(data)
	if err != nil {
		// 解码失败时尽力保留原文(容错,不静默丢内容)
		return string(data)
	}
	return string(out)
}

// ---- 参数字符串拆分(非 Windows: .NET Arguments → argv) ----

// splitArgsLine: 解析命令行字符串为 argv,支持双/单引号与反斜杠转义。
func splitArgsLine(line string) []string {
	var args []string
	var cur strings.Builder
	i := 0
	n := len(line)
	for i < n {
		for i < n && (line[i] == ' ' || line[i] == '\t') {
			i++
		}
		if i >= n {
			break
		}
		cur.Reset()
		for i < n && line[i] != ' ' && line[i] != '\t' {
			c := line[i]
			if c == '\\' && i+1 < n && (line[i+1] == '"' || line[i+1] == '\\') {
				cur.WriteByte(line[i+1])
				i += 2
				continue
			}
			if c == '"' {
				i++
				for i < n && line[i] != '"' {
					if line[i] == '\\' && i+1 < n && line[i+1] == '"' {
						cur.WriteByte('"')
						i += 2
						continue
					}
					cur.WriteByte(line[i])
					i++
				}
				i++ // skip closing quote
				continue
			}
			if c == '\'' {
				i++
				for i < n && line[i] != '\'' {
					cur.WriteByte(line[i])
					i++
				}
				i++
				continue
			}
			cur.WriteByte(c)
			i++
		}
		args = append(args, cur.String())
	}
	return args
}

// utf16PtrFromString 简化: windows syscall 需要 UTF-16 指针时由 SysProcAttr 处理,这里不需要。

// runExe: 运行子进程并捕获合并输出(stdout+stderr 按到达顺序混排近似:先 stdout 后 stderr,
// C# 用事件回调按行交错;对构建日志而言行序差异可接受,EIDE LogAnalyzer 按行解析)。
func runExe(exe string, args string, encName string, dryRun bool) (string, int) {
	if dryRun {
		return "", codeDone
	}

	exePath := replaceEnvVariable(exe, false)
	argsLine := replaceEnvVariable(args, false)

	// if executable is 'cmd', force use system default encoding(C# 4908-4912)
	if base := strings.ToLower(exePath); base == "cmd" || base == "cmd.exe" {
		encName = "ANSI"
	}

	cmd := exec.Command(exePath)
	cmd.Args = append([]string{exePath}, splitArgsLine(argsLine)...)
	applyProcAttr(cmd, exePath, argsLine)
	// Wine 工具链: 关闭 wine 自身的调试噪音。
	// 默认 Wine 会往 stderr 打大量 "fixme:winediag:loader_init wine-staging ..." /
	// "err:waylanddrv:wayland_process_init ..." 之类的前缀行, 这些会混进编译输出,
	// 既干扰用户看错误, 也会被 EIDE 的诊断解析当成编译器消息。
	cmd.Env = envForWineToolchain()
	// Wine 工具链: 子进程 stdin 必须显式指向 /dev/null。
	//
	// 否则触发 Wine 加载器的控制台检测阻塞: 当 stdin 是继承来的管道(无终端)
	// 时, wine 会尝试初始化/附加 console host, 等待约 5s 后才放弃继续执行
	// (实测: fromelf 单次 5.1s -> 0.3s; stdin=DEVNULL 后恢复)。
	// Linux 原生工具链(GCC 等)无此行为, 不受影响。

	var buf, ebuf bytes.Buffer
	var wg sync.WaitGroup
	stdout, err1 := cmd.StdoutPipe()
	stderr, err2 := cmd.StderrPipe()
	if err1 != nil || err2 != nil {
		return "", codeErr
	}

	startErr := cmd.Start()
	if startErr != nil {
		return fmt.Sprintf("run '%s' failed: %v\r\n", exePath, startErr), codeErr
	}

	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(&buf, stdout) }()
	go func() { defer wg.Done(); _, _ = io.Copy(&ebuf, stderr) }()
	wg.Wait()
	exitCode := cmd.Wait()

	// 合并输出并按编码解码(C# output = stdout.AppendLine + stderr.AppendLine)
	merged := append(buf.Bytes(), ebuf.Bytes()...)
	text := decodeBytes(merged, encName)
	// 兜底: 即便 WINEDEBUG=-all, 部分 Wine 版本仍会输出 fixme/err 行
	if isWineToolchain {
		text = filterWineNoise(text)
	}

	code := codeDone
	if exitErr, ok := exitErrOf(exitCode); ok {
		code = exitErr
	}
	return text, code
}

func exitErrOf(err error) (int, bool) {
	if err == nil {
		return 0, false
	}
	if ee, ok := err.(*exec.ExitError); ok {
		return ee.ExitCode(), true
	}
	return codeErr, true
}

// runExeNoCapture: 不捕获输出版本(C# runExe 第二重载,SDCC sdar 打包时使用)。
func runExeNoCapture(exe string, args string, dryRun bool) int {
	if dryRun {
		return codeDone
	}
	exePath := replaceEnvVariable(exe, false)
	argsLine := replaceEnvVariable(args, false)
	cmd := exec.Command(exePath)
	cmd.Args = append([]string{exePath}, splitArgsLine(argsLine)...)
	applyProcAttr(cmd, exePath, argsLine)
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return ee.ExitCode()
		}
		return codeErr
	}
	return codeDone
}

// runShellCommand: 通过系统 shell 执行(C# 5001-5018;SDCC 有 '>' 重定向,必须走 cmd)。
// runShellCommand 通过系统 shell 执行命令(支持 '>' 重定向等 shell 语法)。
//
// 为什么要区分:
//
//	原本所有输出任务都无脑包一层 `bash -c "<exe> <args>"`, 理由是有工具链
//	(SDCC)需要 '>' 重定向。但在 Linux + Wine 下这个包装有严重副作用 ——
//	Wine 的 binfmt 处理器遇到「引号包裹的绝对路径」时会改走 `start.exe /exec`,
//	而 start.exe 会**新建一整个 Wine 会话**而不复用 wineserver:
//	  实测 fromelf 单次 0.28s -> 5.0s(×3 个输出文件 = 白白多花 15s)。
//	改为: 命令不含 shell 元字符时直接 exec(与编译阶段同一条路径, 复用 wineserver),
//	含元字符时才回退到 shell。
func runShellCommand(command string, encName string, dryRun bool) (string, int) {
	if os.Getenv("EIDE_DBG_SH") != "" {
		fmt.Fprintf(os.Stderr, "[SH] shell=%v cmd=%q\n", needsShell(command), command)
	}
	if !needsShell(command) {
		// 直接执行: 拆出首个 token 作为可执行文件, 其余作为参数
		exe, rest := splitFirstToken(command)
		if exe != "" {
			return runExe(exe, rest, encName, dryRun)
		}
	}
	var filename, args string
	if osWin32 {
		filename = "cmd"
		args = "/C \"" + command + "\""
	} else {
		filename = "/bin/bash"
		args = "-c \"" + command + "\""
	}
	return runExe(filename, args, encName, dryRun)
}

// needsShell 判断命令行是否必须经由 shell 解释。
//
// 只有这些字符有 shell 语义: 重定向(>/<)、管道(|)、命令连接(&/;)、
// 命令替换(`)、变量展开($)、通配符(*?[)、反斜线转义。
// 注意: 不含空格 —— 参数里的空格由 splitFirstToken/splitArgsLine 处理。
func needsShell(command string) bool {
	inQuote := byte(0)
	for i := 0; i < len(command); i++ {
		c := command[i]
		if inQuote != 0 {
			if c == inQuote {
				inQuote = 0
			} else if c == '\\' && inQuote == '"' {
				i++ // 引号内的反斜线转义不算 shell 语义
			}
			continue
		}
		switch c {
		case '"', '\'':
			inQuote = c
		case '>', '<', '|', '&', ';', '`', '$', '*', '?', '(', ')':
			return true
		}
	}
	return false
}

// splitFirstToken 从命令行里拆出首个 token(支持引号), 返回 (exe, 剩余参数)。
func splitFirstToken(command string) (string, string) {
	s := strings.TrimSpace(command)
	if s == "" {
		return "", ""
	}
	if s[0] == '"' || s[0] == '\'' {
		q := s[0]
		for i := 1; i < len(s); i++ {
			if s[i] == q {
				return s[1:i], strings.TrimSpace(s[i+1:])
			}
		}
		return s[1:], ""
	}
	if idx := strings.IndexAny(s, " \t"); idx >= 0 {
		return s[:idx], strings.TrimSpace(s[idx+1:])
	}
	return s, ""
}
