package main

// builder.params / 工具链模型的契约类型。
// schema 来源:src/CodeBuilder.ts getCommands()(扩展侧生成方)
//           + 真实样例 build/<target>/builder.params
//           + C# Program.cs prepareParams/prepareSourceFiles。

// BuilderParams 对应 C# paramsObj(JObject)的顶层字段。
type BuilderParams struct {
	Name             string            `json:"name"`
	Target           string            `json:"target"`
	Toolchain        string            `json:"toolchain"`        // AC5/AC6/GCC/LLVM/Keil_C51/SDCC/...
	ToolchainLocation string           `json:"toolchainLocation"`
	ToolchainCfgFile string            `json:"toolchainCfgFile"` // res/data/models/<id>.model.json
	BuildMode        string            `json:"buildMode"`        // "fast|multhread"
	ShowRepathOnLog  bool              `json:"showRepathOnLog"`
	ThreadNum        int               `json:"threadNum"`
	RootDir          string            `json:"rootDir"`
	DumpPath         string            `json:"dumpPath"`
	OutDir           string            `json:"outDir"`
	Ram              int               `json:"ram,omitempty"`
	Rom              int               `json:"rom,omitempty"`
	IncDirs          []string          `json:"incDirs"`
	LibDirs          []string          `json:"libDirs,omitempty"`
	Defines          []string          `json:"defines"`
	SourceList       []string          `json:"sourceList"`
	AlwaysInBuildSources []string      `json:"alwaysInBuildSources,omitempty"`
	SourceParams     map[string]string `json:"sourceParams,omitempty"`
	Options          map[string]any    `json:"options"` // global / c-compiler / cpp-compiler / asm... 按模型定义
	Env              map[string]string `json:"env,omitempty"`
	SysPaths         []string          `json:"sysPaths,omitempty"`
	SourceMapName    string            `json:"sourceMapName,omitempty"` // 默认 ref.json
}


// CompileCommandsEntry 对齐 C# CompileCommandsDataBaseItem(Main ~3320 行):
// command 是"完整 shell 命令字符串"(非 arguments 数组!),序列化为单行紧凑 JSON。
type CompileCommandsEntry struct {
	Directory string `json:"directory"` // 项目根(本地路径分隔符)
	File      string `json:"file"`      // 源文件绝对路径
	Command   string `json:"command"`   // shell 命令字符串
}
