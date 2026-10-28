#!/usr/bin/env bash
# 更新用 zip（update-MMDDx.zip）を作る。前回まるごと入れた時点（BASE）から変わったサーバー側のファイルと、最新の画面をまとめる。
#   使い方：scripts/make-update.sh <BASE のコミット> <出力先フォルダ> [名前]
#   例：    scripts/make-update.sh 1dbc1d4 /tmp/out update-1028a
# 中身（アップロードの順番）：
#   1_assets … public/assets に上げる（js・css）
#   2_app    … app フォルダに上げる（BASE から変わった PHP・SQL。config.php は入れない）
#   2_guide  … public/guide に上げる（使い方の画面写真）
#   3_root   … public の直下に最後に上げる（index.html・version.json・index.php）
set -euo pipefail
BASE="${1:?BASE のコミットを指定してください（前回まるごと入れた時点）}"
OUT="${2:?出力先フォルダを指定してください}"
NAME="${3:-update-$(TZ=Asia/Tokyo date +%m%d)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1) 画面を作り直す（version.json も同時に書き出される）
(cd frontend && npx tsc --noEmit -p . && npx vite build >/dev/null)
# 確認用の版（2099）のまま配らない
if grep -q '"version": "2099' public/version.json; then echo "public/version.json が確認用の版のままです。もう一度ビルドしてください" >&2; exit 1; fi
JS="$(grep -o 'assets/index-[^"]*\.js' public/index.html)"
V="$(grep -m1 -o '"version": "[^"]*"' public/version.json | cut -d'"' -f4)"
if ! grep -q "$V" "public/$JS"; then echo "画面（$JS）と version.json の版（$V）が合いません。もう一度ビルドしてください" >&2; exit 1; fi

P="$OUT/$NAME"
[ -e "$P" ] && { echo "$P はもうあります" >&2; exit 1; }
mkdir -p "$P/1_assets" "$P/2_app" "$P/2_guide" "$P/3_root"
for a in $(grep -o 'assets/[^"]*' public/index.html); do cp "public/$a" "$P/1_assets/"; done
cp public/index.html public/version.json public/index.php "$P/3_root/"
cp public/guide/*.png "$P/2_guide/" 2>/dev/null || true
# BASE から変わったサーバー側のファイル（消えたファイルは入れない）
git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- app | while read -r f; do
  r="${f#*app/}"; case "$r" in config.php) continue;; esac
  mkdir -p "$P/2_app/$(dirname "$r")"; cp "app/$r" "$P/2_app/$r"
done
# まだコミットしていない変更があれば止める（配るものと Git をそろえる）
if [ -n "$(git status --porcelain -- app frontend/src public/index.php)" ]; then echo "コミットしていない変更があります。先にコミットしてください" >&2; exit 1; fi
[ -e "$P/2_app/config.php" ] && { echo "config.php が入っています" >&2; exit 1; }
(cd "$P" && zip -qr "../$NAME.zip" .)
echo "作成：$OUT/$NAME.zip（画面の版 $V）"
find "$P" -type f | sed "s#^$P/##" | sort
