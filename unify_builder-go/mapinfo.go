package main

// map 文件解析:对照 C# memorysize2str(4143-4160)、
// parseMapRegionInfoForArmlink(4162-4261)、parseMapFileForIar(4263-4339)、
// parseMapFileForSdcc(4348-4511)、parseMapFileForDef(4513-4555)。

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// memorysize2str(C# 4143-4160)
func memorysize2str(size uint32) string {
	if size > 1024 {
		if size > 1024*1024 {
			return fmt.Sprintf("%.1fMB", float64(size)/(1024.0*1024.0))
		}
		return fmt.Sprintf("%.1fKB", float64(size)/1024.0)
	}
	return fmt.Sprintf("%dB", size)
}

// ---- armlink load/execution region(C# 4162-4261) ----

type mapRegion struct {
	name    string
	addr    uint32
	size    uint32
	maxSize uint32
}

type mapRegionItem struct {
	attr     mapRegion
	children []mapRegion
}

type mapRegionInfo struct {
	loadRegions []mapRegionItem
}

var reArmlinkRegion = regexp.MustCompile(`^\w+ Region\s+([^\s]+)\s+\((.+)\)$`)

func parseArmlinkRegionLine(line string) *mapRegion {
	m := reArmlinkRegion.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	region := &mapRegion{name: m[1]}
	for _, attr := range strings.Split(m[2], ",") {
		parts := strings.SplitN(attr, ":", 2)
		if len(parts) != 2 {
			continue
		}
		k := strings.TrimSpace(parts[0])
		v := strings.TrimSpace(parts[1])
		// armlink map 带形式如 "Base: 0x08900000";剥掉 0x 前缀后按 16 进制解析
		v = strings.TrimPrefix(strings.TrimPrefix(v, "0x"), "0X")
		switch k {
		case "Base":
			if n, err := strconv.ParseUint(v, 16, 32); err == nil {
				region.addr = uint32(n)
			}
		case "Size":
			if n, err := strconv.ParseUint(v, 16, 32); err == nil {
				region.size = uint32(n)
			}
		case "Max":
			if n, err := strconv.ParseUint(v, 16, 32); err == nil {
				region.maxSize = uint32(n)
			}
		}
	}
	if region.name != "" && region.maxSize > 0 {
		return region
	}
	return nil
}

func parseMapRegionInfoForArmlink(mapFilePath string) *mapRegionInfo {
	info := &mapRegionInfo{}
	var curRegion *mapRegionItem
	var curChildren []mapRegion

	text, err := os.ReadFile(mapFilePath)
	if err != nil {
		return info
	}
	for _, raw := range splitLines(decodeBytes(text, "ANSI")) {
		line := strings.TrimSpace(raw)

		if strings.HasPrefix(line, "Load Region ") {
			region := parseArmlinkRegionLine(line)
			if region != nil {
				if curRegion != nil {
					curRegion.children = curChildren
					info.loadRegions = append(info.loadRegions, *curRegion)
				}
				curRegion = &mapRegionItem{attr: *region}
				curChildren = nil
			}
		} else if strings.HasPrefix(line, "Execution Region ") {
			region := parseArmlinkRegionLine(line)
			if region != nil && curRegion != nil {
				curChildren = append(curChildren, *region)
			}
		}
	}
	if curRegion != nil {
		curRegion.children = curChildren
		info.loadRegions = append(info.loadRegions, *curRegion)
	}
	return info
}

// ---- IAR(C# 4263-4339) ----

var reIarMemLine = regexp.MustCompile(`^\s*([\d\s]+) bytes of (readonly|readwrite)\s+(code|data) memory`)

func parseMapFileForIar(mapFilePath string) (ramSize, romSize int, maplog string) {
	ramSize, romSize = 0, 0
	var mLog strings.Builder

	var strLi []string
	roCodeSize, roDataSize, rwDataSize := -1, -1, -1

	text, err := os.ReadFile(mapFilePath)
	if err != nil {
		return
	}
	for _, line := range splitLines(decodeBytes(text, "ANSI")) {
		if m := reIarMemLine.FindStringSubmatch(line); m != nil {
			memSize := strings.ReplaceAll(m[1], " ", "")
			memType := m[2] + "_" + m[3]
			switch memType {
			case "readonly_code":
				roCodeSize, _ = strconv.Atoi(memSize)
			case "readonly_data":
				roDataSize, _ = strconv.Atoi(memSize)
			case "readwrite_data":
				rwDataSize, _ = strconv.Atoi(memSize)
			}
			strLi = append(strLi, line)
		}
	}

	if roCodeSize >= 0 && roDataSize >= 0 && rwDataSize >= 0 {
		ramSize = rwDataSize
		romSize = roCodeSize + roDataSize
	}

	firstNonSpaceIdx := 0
	for _, item := range strLi {
		idx := strings.IndexFunc(item, func(c rune) bool { return c != ' ' })
		if idx < 0 {
			idx = 0
		}
		if firstNonSpaceIdx == 0 || idx < firstNonSpaceIdx {
			firstNonSpaceIdx = idx
		}
	}
	for _, item := range strLi {
		if firstNonSpaceIdx < len(item) {
			mLog.WriteString(item[firstNonSpaceIdx:] + "\r\n")
		}
	}
	return ramSize, romSize, mLog.String()
}

// ---- SDCC(C# 4341-4511) ----

type sdccSectionDef struct {
	name string
	addr int
	size int
}

var reSdccInfoLine = regexp.MustCompile(`(?i)^\s*([\w-]+)\s+([0-9a-f]+)\s+([0-9a-f]+)`)

func parseMapFileForSdcc(mapFilePath string) (ramSize, romSize int, maplog string) {
	ramSize, romSize = 0, 0
	var mLog strings.Builder

	// if target is mcs51, use .mem file
	memFilePath := strings.TrimSuffix(mapFilePath, filepathExt(mapFilePath)) + ".mem"
	if data, err := os.ReadFile(memFilePath); err == nil {
		isMatched := false
		for _, line := range splitLines(decodeBytes(data, "ANSI")) {
			if !isMatched && (strings.HasPrefix(line, "Stack starts") || strings.HasPrefix(line, "Other memory:")) {
				isMatched = true
			}
			if isMatched {
				mLog.WriteString(line + "\r\n")
			}
		}
		return ramSize, romSize, mLog.String()
	}

	secList := map[string]sdccSectionDef{}
	var secOrder []string

	const (
		smReady = 0
		smInArea = 1
		smInAreaInfo = 2
	)
	curState := smReady

	text, err := os.ReadFile(mapFilePath)
	if err != nil {
		return
	}
	for _, line := range splitLines(decodeBytes(text, "ANSI")) {
		switch curState {
		case smReady:
			if strings.HasPrefix(strings.TrimLeft(line, " \t"), "Area") {
				curState = smInArea
			}
		case smInArea:
			if strings.HasPrefix(strings.TrimLeft(line, " \t"), "Area") {
				curState = smInArea
			} else if strings.HasPrefix(strings.TrimLeft(line, " \t"), "----------") {
				curState = smInAreaInfo
			} else {
				curState = smReady
			}
		case smInAreaInfo:
			if m := reSdccInfoLine.FindStringSubmatch(line); m != nil {
				addr, _ := strconv.ParseInt(m[2], 16, 32)
				size, _ := strconv.ParseInt(m[3], 16, 32)
				def := sdccSectionDef{name: m[1], addr: int(addr), size: int(size)}
				if _, dup := secList[def.name]; !dup {
					secOrder = append(secOrder, def.name)
				}
				secList[def.name] = def
			}
			curState = smReady
		}
	}

	// calcu mem size
	ramSegLi := []string{"DATA", "INITALIZED", "SSEG"}
	romSegLi := []string{"CODE", "CONST", "INITIALIZER", "GSINIT", "HOME", "GSFINAL"}

	for _, name := range ramSegLi {
		if sec, ok := secList[name]; ok {
			ramSize += sec.size
		}
	}
	for _, name := range romSegLi {
		if sec, ok := secList[name]; ok {
			romSize += sec.size
		}
	}

	// Minimal table(C# 4477-4484)
	headers := []string{"Segment", "Address", "Size", "Size(Decimal)"}
	var rows [][]string
	for _, name := range secOrder {
		sec := secList[name]
		rows = append(rows, []string{
			sec.name,
			fmt.Sprintf("%08X", sec.addr),
			fmt.Sprintf("%08X", sec.size),
			strconv.Itoa(sec.size),
		})
	}
	mLog.WriteString(renderTableMinimal(headers, rows))

	mLog.WriteString("\r\n")

	stackPromptTxt := ""
	if sseg, ok := secList["SSEG"]; ok && sseg.size == 1 {
		if ramMaxSize > 0 {
			stackPromptTxt = fmt.Sprintf(", Stack Size: %d Bytes (MCU_RAM_SIZE - RAM_TOTAL)", ramMaxSize-ramSize)
		} else {
			stackPromptTxt = ", Stack Size: Auto (MCU_RAM_SIZE - RAM_TOTAL)"
		}
	}

	maxPadWidth := len(strconv.Itoa(maxInt(ramSize, romSize)))

	mLog.WriteString("RAM Total: " + padRight(strconv.Itoa(ramSize), maxPadWidth) +
		" Bytes (" + strings.Join(ramSegLi, " + ") + ")" + stackPromptTxt + "\r\n")
	mLog.WriteString("ROM Total: " + padRight(strconv.Itoa(romSize), maxPadWidth) +
		" Bytes (" + strings.Join(romSegLi, " + ") + ")\r\n")

	return ramSize, romSize, mLog.String()
}

// ---- 通用(C# 4513-4555):按模型 matcher 提取 ----

func parseMapFileForDef(mapFilePath string, cmdGen *CmdGenerator) (ramSize, romSize int, maplog string) {
	ramSize, romSize = -1, -1
	var mLog strings.Builder

	ramReg := cmdGen.getRamSizeMatcher()
	romReg := cmdGen.getRomSizeMatcher()
	regList := cmdGen.getMapMatcher()

	text, err := os.ReadFile(mapFilePath)
	if err != nil {
		return
	}
	for _, line := range splitLines(decodeBytes(text, "ANSI")) {
		matched := false
		for _, re := range regList {
			if re.MatchString(line) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		mLog.WriteString(strings.TrimSpace(line) + "\r\n")

		if ramSize == -1 && ramReg != nil {
			if m := ramReg.FindStringSubmatch(line); m != nil && len(m) > 1 {
				if n, err := strconv.Atoi(strings.TrimSpace(m[1])); err == nil {
					ramSize = n
				}
			}
		}
		if romSize == -1 && romReg != nil {
			if m := romReg.FindStringSubmatch(line); m != nil && len(m) > 1 {
				if n, err := strconv.Atoi(strings.TrimSpace(m[1])); err == nil {
					romSize = n
				}
			}
		}
	}
	return ramSize, romSize, mLog.String()
}

// ---- 表格渲染(ConsoleTableBuilder 近似) ----

func cellWidth(s string) int {
	// 中文字符宽度按 2 计
	w := 0
	for _, r := range s {
		if r > 0x2E80 {
			w += 2
		} else {
			w++
		}
	}
	return w
}

func padCell(s string, w int) string {
	d := w - cellWidth(s)
	if d > 0 {
		return s + strings.Repeat(" ", d)
	}
	return s
}

// renderTableAlternative: +---+ 风格(C# ConsoleTableBuilderFormat.Alternative 近似)
func renderTableAlternative(headers []string, rows [][]string) string {
	all := append([][]string{headers}, rows...)
	colW := make([]int, len(headers))
	for _, row := range all {
		for i, cell := range row {
			if i < len(colW) && cellWidth(cell) > colW[i] {
				colW[i] = cellWidth(cell)
			}
		}
	}
	sep := "+"
	for _, w := range colW {
		sep += strings.Repeat("-", w+2) + "+"
	}
	var b strings.Builder
	line := func(cells []string) {
		b.WriteString("|")
		for i, cell := range cells {
			b.WriteString(" " + padCell(cell, colW[i]) + " |")
		}
		b.WriteString("\r\n")
	}
	b.WriteString(sep + "\r\n")
	line(headers)
	b.WriteString(sep + "\r\n")
	for _, row := range rows {
		line(row)
	}
	b.WriteString(sep + "\r\n")
	return b.String()
}

// renderTableMinimal: 简易两段式(C# ConsoleTableBuilderFormat.Minimal 近似)
func renderTableMinimal(headers []string, rows [][]string) string {
	all := append([][]string{headers}, rows...)
	colW := make([]int, len(headers))
	for _, row := range all {
		for i, cell := range row {
			if i < len(colW) && cellWidth(cell) > colW[i] {
				colW[i] = cellWidth(cell)
			}
		}
	}
	var b strings.Builder
	line := func(cells []string) {
		parts := make([]string, len(cells))
		for i, cell := range cells {
			parts[i] = padCell(cell, colW[i])
		}
		b.WriteString(strings.Join(parts, "  ") + "\r\n")
	}
	sep := func() {
		parts := make([]string, len(headers))
		for i, w := range colW {
			parts[i] = strings.Repeat("-", w)
		}
		b.WriteString(strings.Join(parts, "  ") + "\r\n")
	}
	line(headers)
	sep()
	for _, row := range rows {
		line(row)
	}
	return b.String()
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func filepathExt(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '.' {
			return p[i:]
		}
		if p[i] == '\\' || p[i] == '/' {
			break
		}
	}
	return ""
}
