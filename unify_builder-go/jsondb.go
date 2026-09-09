package main

// JSON 产物写出,对齐 C# 3318-3344 行。

import (
	"strings"
	"encoding/json"
	"os"
	"path/filepath"
)

// writeCompileCommandsJSON:单行紧凑 JSON、保持 sourceList 遍历序、UTF-8 无 BOM。
// ⚠️ COSMIC .d hack 依赖本文件路径形态,验收标准为与 C# 产物逐字节一致。
func writeCompileCommandsJSON(outDir string, entries []CompileCommandsEntry) error {
	data, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "compile_commands.json"), data, 0o644)
}

// writeRefJSON:插入序字典 → 单行紧凑 JSON(Go map 会排序,必须手写保序)。
func writeRefJSON(outDir, refJsonName string, pairs []kvPair) error {
	var b strings.Builder
	b.WriteByte('{')
	for i, kv := range pairs {
		if i > 0 {
			b.WriteByte(',')
		}
		enc, _ := json.Marshal(kv.k)
		b.Write(enc)
		b.WriteByte(':')
		enc, _ = json.Marshal(kv.v)
		b.Write(enc)
	}
	b.WriteByte('}')
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, refJsonName), []byte(b.String()), 0o644)
}

func orSelf(v, def string) string {
	if v != "" {
		return v
	}
	return def
}

func setEnvValueChecked(key, value string) error {
	setEnvValue(key, value)
	return nil
}
