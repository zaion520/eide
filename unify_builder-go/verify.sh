#!/usr/bin/env bash
# 黄金对拍验收脚本:同一 builder.params,C# 原版 vs Go 移植版,
# 各跑一次 --only-dump-compilerdb,对 compile_commands.json / ref.json 做逐字节比较。
# 用法: ./verify.sh <C# exe|dll目录> <Go exe> <builder.params>
#   例: ./verify.sh "C:\...\res\tools\win32\unify_builder" ./unify_builder.exe \
#         "d:\...\build\nuoxun\builder.params"
set -u

CS_DIR="$1"; GO_EXE="$2"; PARAMS="$3"

rootDir=$(node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.rootDir)" "$PARAMS")
outDir=$(node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.outDir)" "$PARAMS")
refName=$(node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.sourceMapName||'ref.json')" "$PARAMS")
outAbs=$(node -e "const path=require('path');const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(path.isAbsolute(p.outDir)?p.outDir:path.join(p.rootDir,p.outDir))" "$PARAMS")

CC_JSON="$outAbs/compile_commands.json"; REF_JSON="$outAbs/$refName"
T=$(mktemp -d)

# 1) C# 原版
(cd "$rootDir" && "$CS_DIR/unify_builder.exe" -p "$PARAMS" --only-dump-compilerdb --no-color) > "$T/cs.out" 2>&1
cs_rc=$?
cp "$CC_JSON" "$T/cc.cs.json" 2>/dev/null; cp "$REF_JSON" "$T/ref.cs.json" 2>/dev/null

# 2) Go 版
(cd "$rootDir" && "$GO_EXE" -p "$PARAMS" --only-dump-compilerdb --no-color) > "$T/go.out" 2>&1
go_rc=$?
cp "$CC_JSON" "$T/cc.go.json" 2>/dev/null; cp "$REF_JSON" "$T/ref.go.json" 2>/dev/null

# 3) 恢复 C# 产物为项目当前文件(它是权威输出)
cp "$T/cc.cs.json" "$CC_JSON" 2>/dev/null; cp "$T/ref.cs.json" "$REF_JSON" 2>/dev/null

echo "== exit: cs=$cs_rc go=$go_rc"
fail=0
if cmp -s "$T/cc.cs.json" "$T/cc.go.json"; then echo "OK  compile_commands.json 逐字节一致"; else echo "FAIL compile_commands.json 不一致"; fail=1; fi
if cmp -s "$T/ref.cs.json" "$T/ref.go.json"; then echo "OK  $refName 逐字节一致"; else echo "FAIL $refName 不一致"; fail=1; fi
if cmp -s "$T/cs.out" "$T/go.out"; then echo "OK  契约日志行一致"; else echo "WARN 日志输出不一致(契约行须一致,进度类可忽略)"; fi
echo "== 明细: $T"
exit $fail
