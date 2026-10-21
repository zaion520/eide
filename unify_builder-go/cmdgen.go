package main

// CmdGenerator 的 Go 移植,对照 C# Program.cs 290-2251 行。
// 所有序号注释均为 C# 行号,便于回溯对拍。

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// ---- OsInfo(205-251) ----

const sysCmdLenLimit = 16 * 1024 // win32 保守值;非 win32 为 32K(见 OsInfo 232-241)

// ---- CmdFormat / InvokeFormat(339-356) ----

type CmdFormat struct {
	Prefix    string
	Body      string
	BodyNoVal *string
	Suffix    string
	Sep       string
	NoQuotes  bool
}

type InvokeFormat struct {
	UseFile bool
	Body    string
}

func newInvokeFormat() InvokeFormat { return InvokeFormat{Body: "${value}"} }

// ---- CmdInfo(303-325) ----

type CmdInfo struct {
	ExePath           string
	CommandLine       string
	SourcePath        string
	SourceArgs        string
	SourceType        string
	OutPath           string
	OutputEncoding    string // 字符集名称(UTF8/GBK/...);解码在阶段 3 的执行器
	SourceArgsChanged bool
	BaseArgs          string
	CompilerID        string
	CompilerModel     string
	Title             string
	ShellCommand      string
	Outputs           []string
	SdccBundleLibArgs string
}

// ---- CmdGenerator(290-2251) ----

type CmdGenerator struct {
	model     *JObj
	params    *JObj
	outDir    string
	binDir    string // 形如 "%TOOL_DIR%\"(历史原因保留环境变量形态)
	cwd       string
	cmdPrefix string

	toolID      string
	useUnixPath bool
	attrDirSep  string

	toolPrefix      string
	compilerName    string
	compilerVersion string
	compilerFull    string

	// 工具路径解析缓存: name -> 实际存在的可执行文件路径。
	// 非 Windows 上运行 Wine 装的 Windows 工具链时, 模型里的 "$path"(如 bin/armclang)
	// 没有 .exe 后缀, 需要回退到 bin/armclang.exe(见 resolveToolPath)。
	toolPathCache map[string]string

	// wineToolchain: 非 Windows 平台上运行 Wine 安装的 Windows 工具链(AC5/AC6/IAR/C51)。
	// 这类工具是真正的 PE 程序, 只认 Windows 路径(Z: 或 C: 开头),
	// 收到 POSIX 路径(/x/y)会报 "Invalid argument" / "Could not open"。
	wineToolchain bool
	// wineDriveMaps: POSIX 前缀 -> Wine 盘符, 按前缀长度降序匹配
	// (如 "/home/u/.wine/drive_c" -> "C:", "/" -> "Z:")
	wineDriveMaps []wineDriveMap

	asmCompilerName string

	paramObj      map[string]*JObj
	models        map[string]*JObj
	objNameMap    map[string]int
	srcParams     map[string]string
	encodings     map[string]string
	baseOpts      map[string][]string
	userOpts      map[string][]string
	formats       map[string]map[string]CmdFormat
	invokeFormats map[string]InvokeFormat
}

var cFileFilter = regexp.MustCompile(`(?i)\.c$`)
var asmFileFilter = regexp.MustCompile(`(?i)\.(?:s|asm|a51)$`)
var libFileFilter = regexp.MustCompile(`(?i)\.(?:lib|a|o|obj|sm8)$`)
var cppFileFilter = regexp.MustCompile(`(?i)\.(?:cpp|cxx|cc|c\+\+)$`)

var reObjOrderGlob = regexp.MustCompile(`(?i)^[a-z]:/`) // 占位(见 genLinkCommand,阶段 3)

var reArgsFileVar = regexp.MustCompile(`(?i)\$\{argsFile:(.+?)\}`)
var reOverrideExpr = regexp.MustCompile(`\$<override:(.+?)>`)
var reReplaceExpr = regexp.MustCompile(`\$<replace:(?<old>.+?)/(?<new>.*?)>`)
var reVarExpr = regexp.MustCompile(`(?i)\$\{([^\}]+)\}`)
var reDrvLetter = regexp.MustCompile(`^(?i)(?<drv>[a-z]):/`)

// prepareModel(5664-5734):OS 形态修正 + global 选项注入 groups。
func prepareModel(model *JObj) error {
	globals := model.ObjOr("global")
	groups := model.ObjOr("groups")
	if globals == nil || groups == nil {
		return fmt.Errorf("model missing 'global' or 'groups'")
	}
	for _, kv := range groups.Keys() {
		grp := groups.ObjOr(kv)
		if grp == nil {
			continue
		}
		if grp.Has("$path") && osWin32 {
			grp.Set("$path", &JVal{Kind: JString,
				Str: strings.ReplaceAll(grp.Str("$path"), "/", "\\") + ".exe"})
		}
		for _, listKey := range []string{"$outputBin", "$extraCommand"} {
			for _, item := range grp.ArrOr(listKey) {
				if item.Kind != JObject {
					continue
				}
				if osWin32 && item.Obj.Has("toolPath") {
					item.Obj.Set("toolPath", &JVal{Kind: JString,
						Str: strings.ReplaceAll(item.Obj.Str("toolPath"), "/", "\\") + ".exe"})
				}
				if osWin32 && item.Obj.Has("command.win32") {
					item.Obj.Set("command", item.Obj.Get("command.win32"))
				} else if !osWin32 && item.Obj.Has("command.unix") {
					item.Obj.Set("command", item.Obj.Get("command.unix"))
				}
			}
		}
	}
	for _, key := range globals.Keys() {
		gv := globals.Get(key)
		if gv.Kind != JObject {
			continue
		}
		gvObj := gv.Obj
		if !gvObj.Has("group") {
			return fmt.Errorf("not found 'group' in global option '%s'", key)
		}
		for _, category := range gvObj.ArrOr("group") {
			cat := category.AsString()
			if groups.Has(cat) {
				target := groups.ObjOr(cat)
				if gvObj.Str("location") == "first" {
					target.AddFirst(key, gv)
				} else if !target.Has(key) {
					target.Set(key, gv)
				} else {
					target.Set(key, gv) // C# Add 遇重复键会抛错;此处按覆盖处理并保持顺序
				}
			}
		}
	}
	return nil
}

// getUserSpecifiedModelName(892-907)
func (g *CmdGenerator) getUserSpecifiedModelName(modelName string) string {
	po := g.paramObj[modelName]
	if po == nil || !po.Has("$use") {
		return modelName
	}
	name := po.Str("$use")
	if strings.TrimSpace(name) == "" {
		return modelName
	}
	if strings.HasPrefix(name, modelName+"-") || name == modelName {
		return name
	}
	return modelName + "-" + name
}

// NewCmdGenerator 对齐 C# 构造器(397-763)。
func NewCmdGenerator(model *JObj, params *JObj, opt GenOption) (*CmdGenerator, error) {
	g := &CmdGenerator{
		model:         model,
		params:        params,
		outDir:        opt.OutPath,
		cwd:           opt.Cwd,
		cmdPrefix:     opt.CompilerPrefix,
		paramObj:      map[string]*JObj{},
		models:        map[string]*JObj{},
		objNameMap:    map[string]int{},
		srcParams:     opt.SrcParams,
		encodings:     map[string]string{},
		baseOpts:      map[string][]string{},
		userOpts:      map[string][]string{},
		formats:       map[string]map[string]CmdFormat{},
		invokeFormats: map[string]InvokeFormat{},
	}
	g.binDir = ""
	if opt.BindirEnvName != "" {
		g.binDir = opt.BindirEnvName + localSep()
	}

	g.toolID = model.Str("id")
	g.useUnixPath = model.BoolOr("useUnixPath", false)
	g.attrDirSep = "/"
	if !g.useUnixPath {
		g.attrDirSep = localSep()
	}

	// init compiler params(425-431)
	compileOptions := params.ObjOr("options")
	if compileOptions == nil {
		compileOptions = NewJObj()
	}
	g.paramObj["global"] = orEmptyObj(compileOptions.ObjOr("global"))
	g.paramObj["c"] = orEmptyObj(compileOptions.ObjOr("c/cpp-compiler"))
	g.paramObj["cpp"] = orEmptyObj(compileOptions.ObjOr("c/cpp-compiler"))
	g.paramObj["asm"] = orEmptyObj(compileOptions.ObjOr("asm-compiler"))
	g.paramObj["linker"] = orEmptyObj(compileOptions.ObjOr("linker"))

	// init compiler models(434-462)
	groups := model.ObjOr("groups")
	cCompilerName, cppCompilerName := "c", "cpp"
	if groups.Has("c/cpp") {
		cCompilerName, cppCompilerName = "c/cpp", "c/cpp"
	}
	linkerName := g.getUserSpecifiedModelName("linker")
	if !groups.Has(cCompilerName) {
		return nil, fmt.Errorf("Not found c compiler model")
	}
	if !groups.Has(cppCompilerName) {
		return nil, fmt.Errorf("Not found cpp compiler model")
	}
	if !groups.Has(linkerName) {
		return nil, fmt.Errorf("Invalid '$use' option, please check compile option 'linker.$use'")
	}
	g.models["c"] = groups.ObjOr(cCompilerName)
	g.models["cpp"] = groups.ObjOr(cppCompilerName)
	g.models["linker"] = groups.ObjOr(linkerName)

	// asm models(466-482)
	g.asmCompilerName = g.getUserSpecifiedModelName("asm")
	if g.asmCompilerName == "asm-auto" {
		g.models["asm"] = groups.ObjOr("asm")
		for _, key := range groups.Keys() {
			if strings.HasPrefix(key, "asm-") {
				g.models[key] = groups.ObjOr(key)
				g.paramObj[key] = g.paramObj["asm"]
			}
		}
	} else {
		if !groups.Has(g.asmCompilerName) {
			return nil, fmt.Errorf("Invalid '$use' option, please check compile option 'asm-compiler.$use'")
		}
		g.models["asm"] = groups.ObjOr(g.asmCompilerName)
	}

	globalParams := g.paramObj["global"]

	// tool prefix(486-497)
	if globalParams.Has("toolPrefix") {
		g.toolPrefix = globalParams.Str("toolPrefix")
	} else if model.Has("toolPrefix") {
		g.toolPrefix = model.Str("toolPrefix")
	}

	// elf suffix(500-507)
	if lp := g.paramObj["linker"]; lp.Has("elf-suffix") {
		g.models["linker"].Set("$outputSuffix", lp.Get("elf-suffix"))
	}

	// ${toolPrefix} 替换(510-516)
	for _, key := range g.modelsKeys() {
		oldName := g.models[key].Str("$path")
		g.models[key].Set("$path", &JVal{Kind: JString,
			Str: strings.ReplaceAll(oldName, "${toolPrefix}", g.toolPrefix)})
	}
	// ${toolName} 替换(519-534)
	for _, key := range g.modelsKeys() {
		po := g.paramObj[key]
		if po.Has("$toolName") {
			oldName := g.models[key].Str("$path")
			g.models[key].Set("$path", &JVal{Kind: JString,
				Str: strings.ReplaceAll(oldName, "${toolName}", po.Str("$toolName"))})
		} else if g.models[key].Has("$defToolName") {
			oldName := g.models[key].Str("$path")
			g.models[key].Set("$path", &JVal{Kind: JString,
				Str: strings.ReplaceAll(oldName, "${toolName}", g.models[key].Str("$defToolName"))})
		}
	}

	// 非 Windows 平台上跑 Wine 装的 Windows 工具链: 路径必须转成 Windows 形态。
	// 判据是"解析出的工具可执行文件是 .exe" —— 只有 PE 程序才需要这种转换;
	// Linux 原生 GCC 等不受影响。
	//
	// **位置很关键, 两个约束同时成立**:
	//  1. 必须在 ${toolPrefix}/${toolName} 替换之后 —— 否则探测的是
	//     "/usr/bin/${toolPrefix}gcc" 这种未展开的路径(实测 GCC 报 Not found 'C Compiler');
	//  2. 必须在展开选项(baseOpts)之前 —— 链接器的 --scatter 等 list 型选项
	//     在展开时就要决定路径形态(实测: 编译全过, 链接报 L6031U)。
	if !osWin32 {
		if exePath := replaceEnvVariable(g.getActivedToolFullPath("c"), false); strings.HasSuffix(strings.ToLower(exePath), ".exe") {
			g.wineToolchain = true
			g.wineDriveMaps = wineDriveMapsFromPrefix(winePrefixOf(exePath))
			// 工具链是 Windows 程序: 它按 Wine 的 ACP 解读文件/命令行, 而不是 Linux 的 UTF-8。
			wineACPOverride = detectWineACP(exePath)
			isWineToolchain = true
			// 预热 wineserver(不用 -p 常驻 —— 实测 wine-staging 11.0 + Wayland 下
			// `wineserver -p` 会让后续所有 wine 客户端挂死, 不可用)。
			//
			// 为什么: wineserver 默认在最后一个客户端退出后约 3s 自杀; 自杀后
			// 新客户端的首次连接要等 server fork+初始化, 实测首连 ~5s。构建各
			// 阶段(编译→链接→fromelf)间有空档, 若跨越空闲窗口, 每个阶段的
			// 第一个工具调用都要撞上这个 5s(fromelf ×3 就是 15s 的由来)。
			// 这里用一条极廉价的命令(wineboot -u 或 wine help)把 server 拉起来,
			// 之后所有工具调用共享它; 构建过程中工具调用间隔 <3s, server 不退出。
			warmUpWineserver()
		}
	}
	// $objectSuffix(537-556)
	if lp := g.paramObj["linker"]; lp.Has("$objectSuffix") {
		if objSuffix := strings.TrimSpace(lp.Str("$objectSuffix")); objSuffix != "" {
			for _, key := range []string{"c", "cpp", "asm"} {
				if g.models[key].Has("$outputSuffix") {
					g.models[key].Set("$outputSuffix", &JVal{Kind: JString, Str: objSuffix})
				}
			}
			for _, key := range g.modelsKeys() {
				if strings.HasPrefix(key, "asm-") && g.models[key].Has("$outputSuffix") {
					g.models[key].Set("$outputSuffix", &JVal{Kind: JString, Str: objSuffix})
				}
			}
		}
	}

	// 编译器版本探测(558-616):结果只影响日志,不影响 db 产物;此处尽力查询
	g.compilerName = g.getModelName()
	g.compilerVersion = ""
	g.compilerFull = g.compilerName
	if vMatcher := g.getToolchainVersionMatcher(); vMatcher != nil {
		exePath := opt.BindirAbsPath + localSep() + g.getActivedRawToolPath("c")
		out, _, err := runExeCapture(exePath, vMatcher.Str("args"))
		if err == nil && strings.TrimSpace(out) != "" {
			re, err2 := regexp.Compile("(?i)" + vMatcher.Str("matcher"))
			if err2 == nil {
				for _, line := range splitCRLF(out) {
					if res := re.FindStringSubmatch(line); res != nil {
						idx := re.SubexpIndex("name")
						if idx >= 0 && idx < len(res) {
							g.compilerName = res[idx]
						}
						idx = re.SubexpIndex("version")
						if idx >= 0 && idx < len(res) {
							g.compilerVersion = res[idx]
						}
						g.compilerFull = strings.TrimSpace(line)
						break
					}
				}
			}
		}
	}
	if strings.TrimSpace(g.compilerName) == "" {
		g.compilerName = g.getModelName()
	}

	// encodings(622-651):阶段 1 存字符集名称,执行器解码在阶段 3
	for _, name := range g.modelsKeys() {
		mp := g.models[name]
		if mp.Has("$encoding") {
			g.encodings[name] = mp.Str("$encoding")
		} else {
			g.encodings[name] = "ANSI"
		}
	}

	// formats(654-676)
	for _, name := range g.modelsKeys() {
		mp := g.models[name]
		props := map[string]CmdFormat{}
		for _, fk := range []string{"$includes", "$defines", "$libs"} {
			if mp.Has(fk) {
				props[fk] = parseCmdFormat(mp.Get(fk))
			}
		}
		g.formats[name] = props
		inv := newInvokeFormat()
		if mp.Has("$invoke") {
			iv := mp.Get("$invoke").Obj
			if iv != nil {
				inv.UseFile = iv.BoolOr("useFile", false)
				if iv.Has("body") {
					inv.Body = iv.Str("body")
				}
			}
		}
		if opt.TestMode {
			inv.UseFile = false
		}
		g.invokeFormats[name] = inv
	}

	// outName 注册防重(679)
	g.getUniqueName(g.getOutName())

	// base/user options(682-761)
	for _, name := range g.modelsKeys() {
		cmpModel := g.models[name]
		cmpParams := []*JObj{globalParams, g.paramObj[name]}
		var baseOptLi, userOptLi []string

		if cmpModel.Has("$default") {
			baseOptLi = append(baseOptLi, cmpModel.Get("$default").ValuesOfString()...)
		}
		if name != "linker" {
			if incOpts := g.getIncludesCmdLine(name, jvals2str(params.ArrOr("incDirs"))); incOpts != "" {
				userOptLi = append(userOptLi, incOpts)
			}
			if defOpts := g.getdefinesCmdLine(name, jvals2str(params.ArrOr("defines"))); defOpts != "" {
				userOptLi = append(userOptLi, defOpts)
			}
		} else {
			if cmd := g.getLibSearchFolders(name, jvals2str(params.ArrOr("libDirs"))); cmd != "" {
				baseOptLi = append(baseOptLi, cmd)
			}
		}
		for _, key := range cmpModel.Keys() {
			if strings.HasPrefix(key, "$") {
				continue
			}
			field := cmpModel.Get(key).Obj
			if field == nil {
				continue
			}
			paramsValue := g.mergeParamsList(cmpParams, key, field.Str("type"))
			cmd := strings.TrimSpace(g.getCommandValue(field, paramsValue))
			if cmd != "" {
				userOptLi = append(userOptLi, cmd)
			}
		}
		if cmpModel.Has("$default-tail") {
			userOptLi = append(userOptLi, cmpModel.Get("$default-tail").ValuesOfString()...)
		}
		g.formatVarInCompilerOptions(cmpModel, baseOptLi, cmpParams)
		g.formatVarInCompilerOptions(cmpModel, userOptLi, cmpParams)
		g.baseOpts[name] = baseOptLi
		g.userOpts[name] = userOptLi
	}

	return g, nil
}

// winePrefixOf: 从形如 "<prefix>/drive_c/Keil/..." 的工具路径反推 wine prefix。
// 找不到 "drive_c" 段时返回空串(此时只用 Z: 映射)。
func winePrefixOf(exePath string) string {
	normalized := strings.ReplaceAll(exePath, "\\", "/")
	idx := strings.Index(normalized, "/drive_c/")
	if idx < 0 {
		return ""
	}
	return normalized[:idx]
}

func (g *CmdGenerator) modelsKeys() []string { return sortedKeys(g.models) }

func orEmptyObj(o *JObj) *JObj {
	if o == nil {
		return NewJObj()
	}
	return o
}

func parseCmdFormat(v *JVal) CmdFormat {
	f := CmdFormat{Sep: " "}
	if o := v.Obj; o != nil {
		if o.Has("prefix") {
			f.Prefix = o.Str("prefix")
		}
		if o.Has("body") {
			f.Body = o.Str("body")
		}
		if o.Has("body_noval") {
			s := o.Str("body_noval")
			f.BodyNoVal = &s
		}
		if o.Has("suffix") {
			f.Suffix = o.Str("suffix")
		}
		if o.Has("sep") {
			f.Sep = o.Str("sep")
		}
		f.NoQuotes = o.BoolOr("noQuotes", false)
	}
	return f
}

func sortedKeys[M any](m map[string]M) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
