//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// applyProcAttr: 非 Windows 把命令行字符串解析为 argv(由 exec.go 设置 cmd.Args)。
func applyProcAttr(cmd *exec.Cmd, exePath, argsLine string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{}
}
