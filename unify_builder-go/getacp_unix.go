//go:build !windows

package main

// getACP: 非 Windows 上 .NET Core 的 Encoding.Default == UTF-8(65001)
func getACP() int { return 65001 }
