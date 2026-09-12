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
# 单次 robocopy 的硬超时(秒)。60s 足够(实测完整安装 2~11s)。
# 超时**不等于失败** —— robocopy 是增量复制, 下一趟从断点继续, 因此用多趟重试兜底,
# 最后由"文件数一致性校验"保证最终结果是完整的(绝不会静默留下半成品目录)。
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"
MAX_PASSES="${MAX_PASSES:-3}"          # robocopy 最多执行几趟(增量补齐)
ROBO_RETRY="${ROBO_RETRY:-1}"          # /R: 单文件失败重试次数(默认无穷大, 必须限制)
ROBO_WAIT="${ROBO_WAIT:-1}"            # /W: 重试间隔(秒)

REPO="/c/Users/XC/Desktop/eide-master"
EXT_DIR="$HOME/.vscode/extensions"
EXT_DIR_M="$(cygpath -m "$EXT_DIR")"   # 给 node 用的 Windows 混合路径(C:/Users/...)
VSIX="$REPO/eide-$VER.vsix"
WORK="/c/Users/XC/AppData/Local/Temp/eide-install-$VER"
TARGET="$EXT_DIR/cl.eide-$VER"
BSDTAR="/c/Windows/System32/tar.exe"

step() { echo "[$(date '+%H:%M:%S')] $*"; }

# 强制清理 robocopy 进程。
# 关键: GNU `timeout` 发的是 SIGTERM, **原生 Windows 进程不响应**, 于是超时后
# robocopy 仍然活着 —— 下一趟又拉起一个, 两个进程抢同一目标目录, 速度会崩到
# 每 10 秒几个文件, 还会留下半成品。必须用 taskkill 真正杀掉。
kill_robocopy() { taskkill /F /IM Robocopy.exe >/dev/null 2>&1 || true; }

# 带超时的 robocopy: 每趟最多 TIMEOUT_SEC 秒, 最多 MAX_PASSES 趟(增量补齐)。
#   rc=124 → timeout 到期(不等价于失败, robocopy 是增量复制)
#   rc>=8  → robocopy 报告有文件复制失败
# 每趟前后都清进程, 保证任意时刻只有一个 robocopy 在写目标目录。
retry_robocopy() {
    local src="$1" dst="$2" label="$3" pass rc
    for ((pass = 1; pass <= MAX_PASSES; pass++)); do
        kill_robocopy
        timeout "$TIMEOUT_SEC" robocopy "$src" "$dst" \
            /E /MT:16 /R:"$ROBO_RETRY" /W:"$ROBO_WAIT" /NFL /NDL /NJH /NJS /NP
        rc=$?
        kill_robocopy
        if [ "$rc" -le 7 ]; then
            if [ "$pass" -gt 1 ]; then step "    ${label}: 第 ${pass} 趟增量补齐完成"; fi
            return 0
        fi
        if [ "$rc" -eq 124 ]; then
            echo "    ${label}: 第 ${pass}/${MAX_PASSES} 趟超过 ${TIMEOUT_SEC}s 被中断, 增量重试..."
        else
            echo "    ${label}: 第 ${pass}/${MAX_PASSES} 趟 rc=${rc}, 增量重试..."
        fi
    done
    echo "    ${label}: ${MAX_PASSES} 趟(每趟 ${TIMEOUT_SEC}s)后仍未完成"
    return 1
}

[ -f "$VSIX" ] || { echo "找不到 $VSIX (先执行 vsce package)"; exit 1; }
[ -d "$EXT_DIR" ] || { echo "找不到扩展目录 $EXT_DIR"; exit 1; }

# 写入 extensions.json 注册当前版本
register_extension() {
    local ts
    ts=$(date +%s%3N)
    node -e "
const fs = require('fs');
const p = '$EXT_DIR_M/extensions.json';
const list = JSON.parse(fs.readFileSync(p, 'utf8'));
const e = list.find(x => x.identifier && x.identifier.id === 'cl.eide');
if (!e) { console.error('extensions.json 里找不到 cl.eide'); process.exit(1); }
e.version = '$VER';
e.location = { \$mid: 1, path: '/c:/Users/XC/.vscode/extensions/cl.eide-$VER', scheme: 'file' };
e.relativeLocation = 'cl.eide-$VER';
if (e.metadata) e.metadata.installedTimestamp = $ts;
fs.writeFileSync(p, JSON.stringify(list));
console.log('    已注册 cl.eide -> $VER');
" || exit 1
}

# ---- 并发锁 ----
# 两个安装进程同时写同一目标目录会互相抢文件(实测速度崩到 6 文件/秒), 且难排查。
# mkdir 是原子操作, 用它做锁最稳。
mkdir -p "$WORK" 2>/dev/null
LOCK_DIR="$WORK/.install.lock"
LOCK_STALE_SEC="${LOCK_STALE_SEC:-300}"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0) ))
    if [ "$LOCK_AGE" -gt "$LOCK_STALE_SEC" ]; then
        echo "检测到陈旧锁(已存在 ${LOCK_AGE}s > ${LOCK_STALE_SEC}s), 自动清除后继续"
        rmdir "$LOCK_DIR" 2>/dev/null
        mkdir "$LOCK_DIR" 2>/dev/null || { echo "无法获取锁, 退出"; exit 1; }
    else
        echo "检测到另一个安装进程正在运行 (锁: $LOCK_DIR, 已存在 ${LOCK_AGE}s)"
        echo "若确认没有进程在跑, 删除锁后重试:  rmdir \"$LOCK_DIR\""
        exit 1
    fi
fi
# 退出/被中断(含 SIGTERM)都要放锁并清残留 robocopy —— 否则锁会留在磁盘上挡住下次安装
trap 'rmdir "$LOCK_DIR" 2>/dev/null; kill_robocopy' EXIT INT TERM

# ---- 幂等快路径 ----
# 目标目录已是本次要装的"完整"副本时, 跳过解压/重打包/暂存(全是耗时的全量 IO),
# 只补一次注册 —— 重复执行从数十秒降到 ~2 秒。
#
# 注意: 判定必须带上 **vsix 的时间戳**, 不能只看版本号+文件数 ——
# 同一版本重新打包(改完代码重跑)时文件数往往不变, 只看这两个会让
# 陈旧代码被当成"已是最新"而静默跳过(实测踩过: 修完 bug 重装, 装上的还是旧包)。
MARKER="$WORK/.installed-ok"
if [ -f "$MARKER" ] && [ -f "$TARGET/dist/extension.js" ]; then
    read -r MK_VER MK_COUNT MK_STAMP < "$MARKER" 2>/dev/null || true
    CUR_COUNT=$(find "$TARGET" -type f 2>/dev/null | wc -l)
    VSIX_STAMP=$(stat -c %Y "$VSIX" 2>/dev/null || echo 0)
    if [ "$MK_VER" = "$VER" ] && [ "$MK_COUNT" = "$CUR_COUNT" ] && [ "$MK_STAMP" = "$VSIX_STAMP" ]; then
        step "检测到 $VER 已完整安装($CUR_COUNT 文件, 与 vsix 同版本), 跳过构建与复制"
        register_extension
        echo
        echo "✅ 已是最新: cl.eide-$VER ($CUR_COUNT 文件) —— 请在 VSCode 执行 Reload Window"
        exit 0
    fi
fi

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
    retry_robocopy "$(cygpath -w "$SRC_NM")" "$(cygpath -w "$WORK/extract/extension/node_modules")" "注入 node_modules" \
        || { echo "node_modules 注入失败"; exit 1; }
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

# ---- 4) 安装: 同卷暂存 + 原子 rename ----
#
# 为什么不在 extensions 目录里逐文件复制:
#   VSCode 运行时会扫描并回收该目录, 未登记的半成品目录会被它当成垃圾清理,
#   与复制进程互抢文件句柄 —— 实测同样 5703 个文件: 复制到 %TEMP% 只要 2 秒,
#   复制进 extensions 目录却掉到 ~2 文件/秒(几分钟都完不成)。
# 做法: 先在 %TEMP%(同卷)备好完整副本, 再用 rename 原子搬入 —— 同卷 rename 是
#   元数据操作, 瞬间完成, VSCode 几乎没有干预窗口, 也不存在"半成品目录"暴露期。
SRC_COUNT=$(find extension -type f | wc -l)
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

STAGE_ROOT="$WORK/stage-$VER"
STAGING="$STAGE_ROOT/cl.eide-$VER"
mkdir -p "$STAGE_ROOT"

step "4/5 暂存完整副本到同卷临时目录 (每趟 ${TIMEOUT_SEC}s)"
retry_robocopy "$(cygpath -w "$WORK/extract/extension")" "$(cygpath -w "$STAGING")" "暂存副本" \
    || { echo "暂存失败"; exit 1; }

STAGED_COUNT=$(find "$STAGING" -type f 2>/dev/null | wc -l)
if [ "$SRC_COUNT" != "$STAGED_COUNT" ]; then
    echo "暂存完整性校验失败: 源 $SRC_COUNT / 暂存 $STAGED_COUNT"
    exit 1
fi
step "    暂存 OK ($STAGED_COUNT 文件), 原子搬入 -> $TARGET"

# 目标已存在(半成品/旧同版本) → 先挪到临时区, 保证 rename 目标不存在
# (用 mv 而非 rm: 同卷 rename 同样瞬间完成, 且避免删除操作)
if [ -e "$TARGET" ]; then
    mv "$TARGET" "$STAGE_ROOT/old-target" 2>/dev/null || true
fi

if ! mv "$STAGING" "$TARGET" 2>/dev/null; then
    echo "    原子搬入失败: 目标目录仍被占用(通常是 VSCode 正在扫描/持有该目录)。"
    echo "    请关闭该目录上的句柄后重跑本脚本(暂存副本可直接复用, 几秒即可完成)。"
    echo "    注意: 不做\"直接复制进 extensions 目录\"的回退 —— 实测被 VSCode 干扰后"
    echo "    会掉到 ~2 文件/秒, 几分钟都完不成, 只会留下半成品目录。"
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
register_extension
step "5/5 完成"

# 记录本次成功的版本、文件数与 vsix 时间戳, 供下次"幂等快路径"直接判定
# (时间戳不可省: 同版本重打包时文件数不变, 少了它会误判为"已是最新")
echo "$VER $DST_COUNT $(stat -c %Y "$VSIX" 2>/dev/null || echo 0)" > "$MARKER"

echo
echo "✅ 安装完成: cl.eide-$VER ($DST_COUNT 文件)"
echo "   请在 VSCode 执行 Reload Window 生效"
