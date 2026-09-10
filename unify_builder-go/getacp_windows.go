//go:build windows

package main

import "syscall"

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var procGetACP = kernel32.NewProc("GetACP")

func getACP() int {
	r, _, _ := procGetACP.Call()
	return int(r)
}
