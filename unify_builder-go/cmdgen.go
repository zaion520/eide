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
	model    *JObj
	params   *JObj
	outDir   string
	binDir   string // 形如 "%TOOL_DIR%\"(历史原因保留环境变量形态)
	cwd      string
	cmdPrefix string

	toolID      string
	useUnixPath bool
	attrDirSep  string

	toolPrefix      string
	compilerName    string
	compilerVersion string
	compilerFull    string

	asmCompilerName string

	paramObj     map[string]*JObj
	models       map[string]*JObj
	objNameMap   map[string]int
	srcParams    map[string]string
	encodings    map[string]string
	baseOpts     map[string][]string
	userOpts     map[string][]string
	formats      map[string]map[string]CmdFormat
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
		model:      model,
		params:     params,
		outDir:     opt.OutPath,
		cwd:        opt.Cwd,
		cmdPrefix:  opt.CompilerPrefix,
		paramObj:   map[string]*JObj{},
		models:     map[string]*JObj{},
		objNameMap: map[string]int{},
		srcParams:  opt.SrcParams,
		encodings:  map[string]string{},
		baseOpts:   map[string][]string{},
		userOpts:   map[string][]string{},
		formats:    map[string]map[string]CmdFormat{},
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
