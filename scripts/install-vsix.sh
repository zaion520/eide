#!/usr/bin/env bash
#
# 安装 eide vsix 到 VSCode 扩展目录(完整流程)
#
# 用法:
#   bash scripts/install-vsix.sh 3.27.44
#
# 为什么需要这个脚本:
#   手工安装流程有 6 个已知坑, 每次重踩 —— 本脚本把它们一次性固化:
#     1. vsce --no-dependencies 产出的 vsix 不含 node_modules, 而 webpack externals
#        (x2js/jsonc/iconv-lite/@modelcontextprotocol/sdk) 运行时必需 → 必须注入
#     2. robocopy 默认 /R:1000000(近乎无限重试), 遇到被占用的文件会卡住数分钟
#        → 本次加 /R:2 /W:2, 并用 timeout 兜底(见 TIMEOUT_SEC)
#     3. 安装 6000+ 文件耗时可能 >5 分钟, 前台会被工具超时杀掉, 留下半成品目录
#        → 由调用方以 run_in_background 运行; 本脚本也自设 timeout
#     4. 半成品目录存在时, VSCode 自己再装同版本会 EPERM rename 失败 → 必须校验完整性
#     5. Git Bash 裸 tar 是 GNU tar(把 C:/ 当远程主机) → 用系统 bsdtar
#     6. MSYS 会改写 robocopy 开关(/E → //E) → 用 MSYS_NO_PATHCONV=1
#
set -u

VER="${1:-}"
if [ -z "$VER" ]; then
    echo "用法: bash scripts/install-vsix.sh <version>   例: bash scripts/install-vsix.sh 3.27.44"
    exit 1
fi

# ---- 可调参数 ----
TIMEOUT_SEC="${TIMEOUT_SEC:-900}"      # robocopy 硬超时(秒)
ROBO_RETRY="${ROBO_RETRY:-2}"          # /R: 失败重试次数
ROBO_WAIT="${ROBO_WAIT:-2}"            # /W: 重试间隔(秒)

REPO="/c/Users/XC/Desktop/eide-master"
EXT_DIR="$HOME/.vscode/extensions"
EXT_DIR_M="$(cygpath -m "$EXT_DIR")"   # 给 node 用的 Windows 混合路径(C:/Users/...)
VSIX="$REPO/eide-$VER.vsix"
WORK="/c/Users/XC/AppData/Local/Temp/eide-install-$VER"
TARGET="$EXT_DIR/cl.eide-$VER"
BSDTAR="/c/Windows/System32/tar.exe"

step() { echo "[$(date '+%H:%M:%S')] $*"; }

[ -f "$VSIX" ] || { echo "找不到 $VSIX (先执行 vsce package)"; exit 1; }
[ -d "$EXT_DIR" ] || { echo "找不到扩展目录 $EXT_DIR"; exit 1; }

# ---- 1) 解压 ----
mkdir -p "$WORK/extract" "$WORK/out"
cp "$VSIX" "$WORK/extract/"
cd "$WORK/extract" || exit 1
"$BSDTAR" -xf "eide-$VER.vsix" || { echo "解压失败"; exit 1; }
rm -f "eide-$VER.vsix"
step "1/5 解压完成"

# ---- 2) 注入 node_modules(取已装的最新一版作为来源) ----
SRC_NM=""
for d in $(ls -d "$EXT_DIR"/cl.eide-* 2>/dev/null | sort -V -r); do
    if [ -d "$d/node_modules" ] && [ "$(basename "$d")" != "cl.eide-$VER" ]; then
        SRC_NM="$d/node_modules"; break
    fi
done
[ -n "$SRC_NM" ] || { echo "找不到可用的 node_modules 来源目录"; exit 1; }

if [ ! -d "extension/node_modules" ]; then
    export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
    step "2/5 注入 node_modules <- $(basename "$(dirname "$SRC_NM")")"
    timeout "$TIMEOUT_SEC" robocopy "$(cygpath -w "$SRC_NM")" "$(cygpath -w "$WORK/extract/extension/node_modules")" \
        /E /MT:16 /R:"$ROBO_RETRY" /W:"$ROBO_WAIT" /NFL /NDL /NJH /NJS /NP
    rc=$?
    [ "$rc" -le 7 ] || { echo "robocopy 注入失败 rc=$rc"; exit 1; }
else
    step "2/5 node_modules 已存在, 跳过"
fi
NM_COUNT=$(ls extension/node_modules 2>/dev/null | wc -l)
[ "$NM_COUNT" -gt 100 ] || { echo "node_modules 注入异常(仅 $NM_COUNT 项)"; exit 1; }
step "    node_modules: $NM_COUNT 项"

# ---- 3) 重打包为完整 vsix ----
"$BSDTAR" -a -c -f ../out/repack.zip "[Content_Types].xml" extension.vsixmanifest extension || { echo "重打包失败"; exit 1; }
cp ../out/repack.zip "$VSIX"
step "3/5 重打包完成 ($(du -h "$VSIX" | cut -f1))"

# ---- 4) 安装(带超时 + 有限重试) ----
SRC_COUNT=$(find extension -type f | wc -l)
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
step "4/5 robocopy 安装 -> $TARGET (timeout ${TIMEOUT_SEC}s, /R:${ROBO_RETRY} /W:${ROBO_WAIT})"
timeout "$TIMEOUT_SEC" robocopy "$(cygpath -w "$WORK/extract/extension")" "$(cygpath -w "$TARGET")" \
    /E /MT:16 /R:"$ROBO_RETRY" /W:"$ROBO_WAIT" /NFL /NDL /NJH /NJS /NP
rc=$?
if [ "$rc" -gt 7 ]; then
    echo "robocopy 安装失败 rc=$rc (8+ 表示有文件复制失败)"
    exit 1
fi

# 完整性校验: 防半成品目录残留(半成品会让 VSCode 自己再装同版本时 EPERM)
DST_COUNT=$(find "$TARGET" -type f 2>/dev/null | wc -l)
if [ "$SRC_COUNT" != "$DST_COUNT" ]; then
    echo "完整性校验失败: 源 $SRC_COUNT / 目标 $DST_COUNT"
    exit 1
fi
[ -f "$TARGET/dist/extension.js" ] || { echo "缺少 dist/extension.js"; exit 1; }
step "    完整性 OK ($DST_COUNT 文件)"

# ---- 5) 注册 extensions.json ----
TS=$(date +%s%3N)
node -e "
const fs = require('fs');
const p = '$EXT_DIR_M/extensions.json';
const list = JSON.parse(fs.readFileSync(p, 'utf8'));
const e = list.find(x => x.identifier && x.identifier.id === 'cl.eide');
if (!e) { console.error('extensions.json 里找不到 cl.eide'); process.exit(1); }
e.version = '$VER';
e.location = { \$mid: 1, path: '/c:/Users/XC/.vscode/extensions/cl.eide-$VER', scheme: 'file' };
e.relativeLocation = 'cl.eide-$VER';
if (e.metadata) e.metadata.installedTimestamp = $TS;
fs.writeFileSync(p, JSON.stringify(list));
console.log('    已注册 cl.eide -> $VER');
" || exit 1
step "5/5 完成"

echo
echo "✅ 安装完成: cl.eide-$VER ($DST_COUNT 文件)"
echo "   请在 VSCode 执行 Reload Window 生效"
