//go:build windows

package main

import (
	"os/exec"
	"strings"
	"syscall"
)

// applyProcAttr: Windows 用原生命令行字符串启动进程,语义对齐 .NET Process.Start:
//   lpApplicationName = cmd.Path(exe 本体,由 os/exec 传入)
//   lpCommandLine     = 带引号的 exe 路径 + " " + 参数串(CreateProcess 惯例:argv[0] 为程序名)
//
// SysProcAttr.CmdLine 设置后 Args 被忽略,由本函数全权构造命令行。
func applyProcAttr(cmd *exec.Cmd, exePath, argsLine string) {
	exePart := exePath
	if strings.Contains(exePart, " ") && !strings.HasPrefix(exePart, "\"") {
		exePart = "\"" + exePart + "\""
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine:       exePart + " " + argsLine,
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
