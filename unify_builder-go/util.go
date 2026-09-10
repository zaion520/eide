package main

// 路径/环境变量工具,对齐 C# Utility + Program 的环境处理。

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	osWin32 = runtime.GOOS == "windows"
	dirSep  = "/"
)

func localSep() string {
	if osWin32 {
		return "\\"
	}
	return "/"
}

func toUnixPath(p string) string      { return strings.ReplaceAll(p, "\\", "/") }
func toLocalPath(p string) string {
	if osWin32 {
		return strings.ReplaceAll(p, "/", "\\")
	}
	return strings.ReplaceAll(p, "\\", "/")
}

// formatPath: 删除 '.' 段后按本地分隔符拼接(不处理 '..' —— 与 C# 一致)。
func formatPath(p string) string {
	parts := strings.Split(toUnixPath(p), "/")
	out := make([]string, 0, len(parts))
	for _, seg := range parts {
		if seg != "." {
			out = append(out, seg)
		}
	}
	return strings.Join(out, localSep())
}

func isAbsolutePath(p string) bool {
	return filepath.IsAbs(p)
}

// toRelativePath 对齐 C# Utility.toRelativePath:大小写敏感的段比较;
// 无公共前缀(comLen==0)或非绝对路径 → 返回 ""(C# null)。
func toRelativePath(root_, targetPath_ string, useUnixPath bool) string {
	if strings.TrimSpace(root_) == "" || strings.TrimSpace(targetPath_) == "" {
		return ""
	}
	root := formatPath(root_)
	target := formatPath(targetPath_)
	if !isAbsolutePath(root) || !isAbsolutePath(target) {
		return ""
	}
	rootList := strings.Split(strings.Trim(toUnixPath(root), "/"), "/")
	targetList := strings.Split(strings.Trim(toUnixPath(target), "/"), "/")
	minLen := len(rootList)
	if len(targetList) < minLen {
		minLen = len(targetList)
	}
	comLen := 0
	for ; comLen < minLen; comLen++ {
		if rootList[comLen] != targetList[comLen] {
			break
		}
	}
	if comLen == 0 {
		return ""
	}
	sep := localSep()
	if useUnixPath {
		sep = "/"
	}
	var rePath []string
	for i := 0; i < len(rootList)-comLen; i++ {
		rePath = append(rePath, "..")
	}
	for i := comLen; i < len(targetList); i++ {
		rePath = append(rePath, targetList[i])
	}
	return strings.Join(rePath, sep)
}

// ---- 环境变量 ----

var curEnvs = map[string]string{}
var cliVars = map[string]string{} // 仅供 $(key)/${key} 展开,不写入真实进程环境(C# cliVars)

func setEnvValue(key, value string) {
	if strings.ToLower(key) == "path" {
		name := "PATH"
		if osWin32 {
			name = "Path"
		}
		if old, ok := os.LookupEnv(name); ok {
			_ = os.Setenv(name, value+string(os.PathListSeparator)+old)
		} else {
			_ = os.Setenv(name, value)
		}
		return
	}
	curEnvs[key] = value
	_ = os.Setenv(key, value)
}

func addCliVar(key, val string) {
	curEnvs[key] = val // 仅供 $(key)/${key} 展开,不写入真实进程环境
}

var envExpr1 = regexp.MustCompile(`\$\{[\w]+\}`)
var envExpr2 = regexp.MustCompile(`\$\([\w]+\)`)

// replaceEnvVariable 对齐 C# 4772 行:%KEY% / ${KEY} / $(KEY),最多 5 层。
func replaceEnvVariable(str string, makeUndefVarAsEmpty bool) string {
	for i := 0; i < 5; i++ {
		if !strings.Contains(str, "%") && !strings.Contains(str, "$(") && !strings.Contains(str, "${") {
			break
		}
		for k, v := range curEnvs {
			str = strings.ReplaceAll(str, "%"+k+"%", v)
			str = strings.ReplaceAll(str, "${"+k+"}", v)
			str = strings.ReplaceAll(str, "$("+k+")", v)
		}
	}
	if makeUndefVarAsEmpty {
		for i := 0; i < 3; i++ {
			if !strings.Contains(str, "$(") && !strings.Contains(str, "${") {
				break
			}
			str = envExpr1.ReplaceAllString(str, "")
			str = envExpr2.ReplaceAllString(str, "")
		}
	}
	return str
}

// getPathEnvKey: setEnvValue("PATH") 时 windows 用 "Path"。
func pathEnvKey() string {
	if osWin32 {
		return "Path"
	}
	return "PATH"
}

var _ = fmt.Sprintf // keep import

func isMacOS() bool { return runtime.GOOS == "darwin" }

// kvPair: 有序键值对(ref.json 写出用)
type kvPair struct{ k, v string }

// baseName: Path.GetFileName
func baseName(p string) string {
	if i := strings.LastIndexAny(p, `\/`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// exeBaseDir: C# appBaseDir
func exeBaseDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return strings.TrimSuffix(filepath.Dir(exe), string(os.PathSeparator))
}
