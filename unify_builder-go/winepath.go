package main

// Wine 工具链路径转换。
//
// 背景(实测, Fedora 45 + wine-11.0 + MDK AC6):
// 在 Linux 上用 Wine 安装 AC5/AC6/IAR/Keil C51 后, 工具本身是 PE 程序,
// 只接受 Windows 路径。把 POSIX 路径传进去会得到:
//
//   armlink: Fatal error: L6031U: Could not open scatter description file
//            /tmp/p/build/x.sct: Invalid argument
//
// 编译阶段(armclang -I/-o)之所以"看起来能过", 是因为它只是读文件;
// 一旦链接器要写 .lnp/.map/.axf 或按路径打开 scatter, 立刻失败。
//
// 转换规则与 `winepath -w` 一致(实测):
//   /tmp                     -> Z:\tmp
//   /home/u/.wine/drive_c/x  -> C:\x
//   /mnt/d/x                 -> Z:\mnt\d\x
//
// 这里用"前缀 -> 盘符"映射表实现, 不依赖外部 winepath 进程(避免每次转换 fork)。

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type wineDriveMap struct {
	// POSIX 前缀(已 Clean, 无尾斜杠)
	posixPrefix string
	// Wine 盘符, 形如 "C:" / "Z:"
	drive string
}

// wineDriveMapsFromPrefix 按 Wine 约定推导盘符映射。
//
// driveC 是 wine prefix 的 drive_c 目录; 它映射到 C:, 根目录 "/" 映射到 Z:。
// 若项目本身就在 drive_c 内(常见), 前缀匹配会优先命中 C:。
func wineDriveMapsFromPrefix(prefix string) []wineDriveMap {
	maps := make([]wineDriveMap, 0, 2)

	driveC := filepath.Join(prefix, "drive_c")
	if st, err := os.Stat(driveC); err == nil && st.IsDir() {
		maps = append(maps, wineDriveMap{posixPrefix: filepath.Clean(driveC), drive: "C:"})
	}
	maps = append(maps, wineDriveMap{posixPrefix: "/", drive: "Z:"})

	// 长前缀优先(保证 drive_c 内的路径不会被 "/" 抢走)
	sort.SliceStable(maps, func(i, j int) bool {
		return len(maps[i].posixPrefix) > len(maps[j].posixPrefix)
	})
	return maps
}

// toWinePath 把 POSIX 路径转成 Wine 可见的 Windows 路径。
//
// 已经是 Windows 形态(含盘符或反斜杠)时原样返回, 便于幂等调用。
func toWinePath(posixPath string, maps []wineDriveMap) string {
	if posixPath == "" {
		return posixPath
	}
	// 已经是 Windows 路径(如模型里写死 C:\Keil\...)
	if reDrvLetter.MatchString(strings.ReplaceAll(posixPath, "\\", "/")) {
		return posixPath
	}
	if !filepath.IsAbs(posixPath) {
		return posixPath // 相对路径无需转换(工具链按 cwd 解析)
	}

	cleaned := filepath.Clean(posixPath)
	for _, m := range maps {
		if m.posixPrefix == "/" {
			// 根映射: 去掉前导 "/" 后接 Z:\
			rest := strings.TrimPrefix(cleaned, "/")
			return m.drive + "\\" + strings.ReplaceAll(rest, "/", "\\")
		}
		if cleaned == m.posixPrefix {
			return m.drive + "\\"
		}
		if strings.HasPrefix(cleaned, m.posixPrefix+"/") {
			rest := strings.TrimPrefix(cleaned, m.posixPrefix+"/")
			return m.drive + "\\" + strings.ReplaceAll(rest, "/", "\\")
		}
	}
	return posixPath
}

// winePathToPosix 是 toWinePath 的逆运算, 用于把工具输出/响应文件里的
// Windows 路径还原成 POSIX(供 EIDE 解析诊断与 map 文件)。
func winePathToPosix(winPath string, maps []wineDriveMap) string {
	if winPath == "" {
		return winPath
	}
	normalized := strings.ReplaceAll(winPath, "\\", "/")
	m := reDrvLetter.FindStringSubmatch(normalized)
	if m == nil {
		return winPath
	}
	drive := strings.ToUpper(m[1]) + ":"
	rest := strings.TrimPrefix(normalized, m[0])

	for _, dm := range maps {
		if strings.EqualFold(dm.drive, drive) {
			if dm.posixPrefix == "/" {
				return "/" + rest
			}
			return dm.posixPrefix + "/" + rest
		}
	}
	return winPath
}

// detectWineACP 探测 Wine 的 ANSI 代码页(ACP)。
//
// 优先用环境变量 EIDE_WINE_ACP 覆盖(便于用户自定义); 否则查 Wine 注册表。
// 探测失败时回退 936(中文 Windows 默认) —— 对纯 ASCII 路径无影响,
// 而含中文路径时 936 是绝大多数中文 Wine 环境的实际值。
func detectWineACP(exePath string) int {
	if v := os.Getenv("EIDE_WINE_ACP"); v != "" {
		if n := atoiSafe(v); n > 0 {
			return n
		}
	}

	// 从工具路径反推 WINEPREFIX
	prefix := winePrefixOf(exePath)
	if prefix == "" {
		return 936
	}
	out, err := execCommandOutput("wine", "reg", "query",
		`HKLM\System\CurrentControlSet\Control\Nls\CodePage`, "/v", "ACP")
	if err != nil {
		return 936
	}
	if m := regexp.MustCompile(`ACP\s+REG_SZ\s+(\d+)`).FindStringSubmatch(out); m != nil {
		if n := atoiSafe(m[1]); n > 0 {
			return n
		}
	}
	return 936
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// execCommandOutput 执行命令并返回合并输出(失败也返回已拿到的输出)。
func execCommandOutput(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// envForWineToolchain 返回子进程环境: 非 Wine 工具链时原样继承父进程;
// Wine 工具链时追加 WINEDEBUG=-all 抑制 wine 自身的 fixme/err 噪音。
func envForWineToolchain() []string {
	env := os.Environ()
	if !isWineToolchain {
		return env
	}
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		// 覆盖用户已有的 WINEDEBUG
		if strings.HasPrefix(kv, "WINEDEBUG=") {
			continue
		}
		out = append(out, kv)
	}
	return append(out, "WINEDEBUG=-all")
}

// wineNoiseRe 匹配 wine 自身输出的噪音行(带 PID 前缀的 fixme/err/warn)。
var wineNoiseRe = regexp.MustCompile(
	`^[0-9a-f]{4}:(fixme|err|warn):[^\r\n]*\r?\n?`)

// filterWineNoise 去掉输出里的 wine 调试噪音行。
func filterWineNoise(text string) string {
	if text == "" {
		return text
	}
	return wineNoiseRe.ReplaceAllString(text, "")
}

// toolDirForCommand 返回命令文本里 %TOOL_DIR% 应展开成的形态。
//
// Wine 工具链: 必须给 Windows 路径(fromelf.exe 用它在命令行里定位同级工具);
// 其余: 原样返回 POSIX 路径。
func (g *CmdGenerator) toolDirForCommand() string {
	if g.wineToolchain {
		return toWinePath(toolchainRoot, g.wineDriveMaps)
	}
	return toolchainRoot
}

// warmUpWineserver 预热 wineserver: 确保构建开始时它已在运行。
//
// 不用 `wineserver -p`(persistent): 实测 wine-staging 11.0 + Wayland 环境下,
// -p 模式的 server 会让后续所有 wine 客户端无限挂死(疑似 staging bug)。
// 改为普通启动: 一旦有客户端连上, server 在最后一个客户端退出后 3s 才退出;
// 构建过程中工具调用间隔远小于 3s, 因此全程不会再次冷启动。
//
// 失败静默忽略 —— 这只是性能优化, 不影响构建正确性。
func warmUpWineserver() {
	if !isWineToolchain {
		return
	}
	// wineboot -i 初始化前缀(幂等, 前缀已就绪时开销极小);
	// 比跑工具链本身便宜得多, 也能确保 server 进入服务状态。
	cmd := exec.Command("wineboot", "-i")
	cmd.Env = envForWineToolchain()
	_ = cmd.Run()
}
