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
func encodingForName(name string) encoding.Encoding {
	switch strings.ToUpper(strings.TrimSpace(name)) {
	case "", "ANSI", "DEFAULT":
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
func runShellCommand(command string, encName string, dryRun bool) (string, int) {
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
