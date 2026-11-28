#!/bin/bash
# Produce a Dorayaki tileset from downloaded Open Nagasaki zips, repeatably (documents/datasets.md, "production").
#
#   npm run produce:opennagasaki -- <name> <count | codes file>
#
# <count>: the first N sheets of $ON_DIR/order.txt (nearest to central Sasebo first) that have a zip; or a file with one sheet code per line.
# Unzips the LAS that are missing into $LAS_DIR (checked against the size in the zip), then runs build:tiled with the E024/E025 recipe and records
# time, memory, disk, tiles and archive size in $ON_DIR/runs/<name>.txt. The work directory is data/tiled-work/<name> (a link to the external
# disk on the build machine). Nothing is uploaded.
#
# Environment (defaults for the build machine): ON_DIR=/Volumes/dorayaki/opennagasaki, LAS_DIR=/Volumes/dorayaki/data/nagasaki/las,
# WORKERS=3, CENTRE=129.7198,33.1790, REMOVE_LAS=0 (1: remove the LAS unzipped by this run once the archive is written), INCREMENTAL=0 (1: see 2a), LANES=3.
set -euo pipefail
name=${1:?name}; sel=${2:?count or codes file}
ON_DIR=${ON_DIR:-/Volumes/dorayaki/opennagasaki}
LAS_DIR=${LAS_DIR:-/Volumes/dorayaki/data/nagasaki/las}
WORKERS=${WORKERS:-3}; CENTRE=${CENTRE:-129.7198,33.1790}; REMOVE_LAS=${REMOVE_LAS:-0}
mkdir -p "$LAS_DIR" "$ON_DIR/runs"
report="$ON_DIR/runs/$name.txt"; : > "$report"
say() { echo "$(date '+%F %T') $*" | tee -a "$report"; }

# 1. The sheets.
if [[ "$sel" =~ ^[0-9]+$ ]]; then
  # awk reads to the end (head would close the pipe early, which pipefail turns into an exit).
  codes=$(while read -r c; do if [ -f "$ON_DIR/zips/$c.zip" ]; then echo "$c"; fi; done < "$ON_DIR/order.txt" | awk -v n="$sel" 'NR <= n')
else
  codes=$(grep -v '^\s*$' "$sel")
fi
n=$(echo "$codes" | wc -l | tr -d ' ')
say "sheets: $n"

# 2a. INCREMENTAL=1 (an area larger than the disk holds as LAS; D26 the growing prefecture): scatter each sheet on its own as its zip arrives, then remove its LAS, in LANES parallel; the work area is kept (--keep), so a later run with more sheets (the codes file only appended to: indices must not move) builds again only the tiles they touch
# lanes; the tile jobs below then run on the shards alone (build:tiled reads no LAS header with --centre). Waits for a zip still being downloaded.
if [ "${INCREMENTAL:-0}" = 1 ]; then
  LANES=${LANES:-3}
  work="data/tiled-work/$name"; mkdir -p "$work"
  npx esbuild scripts/build-tiled.ts --bundle --platform=node --format=esm --outfile=demo/build/build-tiled.mjs --log-level=warning   # as npm run build:tiled bundles it
  lane() {
    local k=$1 i=0 c z entry want out
    for c in $codes; do
      if [ $((i % LANES)) = "$k" ] && [ ! -f "$work/scatter-$i.json" ]; then
        z="$ON_DIR/zips/$c.zip"
        while [ ! -f "$z" ]; do
          if ! ps -p "$(cat "$ON_DIR/fetch.pid" 2>/dev/null || echo 0)" >/dev/null 2>&1; then say "lane $k: $c has no zip and the downloader is not running"; return 1; fi
          sleep 60
        done
        entry=$(unzip -Z1 "$z" | grep -i '\.las$' | head -1)
        want=$(unzip -l "$z" | awk -v e="$entry" '$4==e {print $1}')
        out="$LAS_DIR/$(basename "$entry")"
        unzip -o -j -q "$z" "$entry" -d "$LAS_DIR"
        [ "$(stat -f %z "$out")" = "$want" ] || { say "size mismatch after unzip: $c"; return 1; }
        node demo/build/build-tiled.mjs scatter "$work" "$i" 1 "$out" >> "$ON_DIR/runs/$name.scatter.log" 2>&1 || { say "scatter failed: $c"; return 1; }
        rm -f -- "$out"
        echo "$(date '+%F %T') lane $k scattered $i $c" >> "$ON_DIR/runs/$name.scatter.log"
      fi
      i=$((i + 1))
    done
  }
  t0=$(date +%s); pids=()
  for k in $(seq 0 $((LANES - 1))); do lane "$k" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || { say "a scatter lane failed"; exit 1; }; done
  say "scatter: $(( $(date +%s) - t0 )) s for $n sheets"
  files=(); for c in $codes; do files+=("$LAS_DIR/$c.las"); done
  fresh=()
else
# 2. Unzip what is missing (one file per zip; its size checked against the zip's listing).
files=(); fresh=()
for c in $codes; do
  z="$ON_DIR/zips/$c.zip"
  [ -f "$z" ] || { say "missing zip $c"; exit 1; }
  entry=$(unzip -Z1 "$z" | grep -i '\.las$' | head -1)
  want=$(unzip -l "$z" | awk -v e="$entry" '$4==e {print $1}')
  out="$LAS_DIR/$(basename "$entry")"
  if [ ! -f "$out" ] || [ "$(stat -f %z "$out")" != "$want" ]; then
    unzip -o -j -q "$z" "$entry" -d "$LAS_DIR"
    [ "$(stat -f %z "$out")" = "$want" ] || { say "size mismatch after unzip: $c"; exit 1; }
    fresh+=("$out")
  fi
  files+=("$out")
done
say "LAS ready: ${#files[@]} files ($(du -ch "${files[@]}" | tail -1 | cut -f1)), unzipped now: ${#fresh[@]}"
fi
list=$(IFS=,; echo "${files[*]}")

# 3. Build (E024 recipe for the lower zooms; E025 for z17: cells of about 1 m and at most 100,000 splats per tile).
free0=$(df -k "$ON_DIR" | tail -1 | awk '{print $4}')
export DORAYAKI_ATTRIBUTION='点群: 長崎県 オープンナガサキ (CC BY 4.0) を加工して作成'
export DORAYAKI_ADAPTIVE_LEVELS=3 DORAYAKI_ADAPTIVE_THICKNESS=0.2 DORAYAKI_ADAPTIVE_COLOR=0.2 DORAYAKI_ADAPTIVE_SPARSE=0
export DORAYAKI_LOWER_ZOOMS=16,15,14,13 DORAYAKI_ZOOM_CELL_SCALE=2 DORAYAKI_Z17_CELL_SCALE=2
export DORAYAKI_ZOOM_TARGET_SPLATS=17:100000,16:100000,15:160000,14:160000,13:160000
export DORAYAKI_MIN_LONG_AXIS_PX=16:2,15:2,14:2,13:2   # E027 (D24): drop splats under 2 px at the lower zooms
# A watcher records the lowest free space on the external disk while the build runs (the work directory's peak).
( low=$free0; while sleep 15; do f=$(df -k "$ON_DIR" | tail -1 | awk '{print $4}'); [ "$f" -lt "$low" ] && low=$f && echo "$low" > "$ON_DIR/runs/$name.lowfree"; done ) & watcher=$!
t0=$(date +%s)
/usr/bin/time -l npm run -s build:tiled -- "$name" 1 "$list" --workers "$WORKERS" --centre "$CENTRE" $([ "${INCREMENTAL:-0}" = 1 ] && echo --keep) > "$ON_DIR/runs/$name.build.log" 2>&1 || { kill $watcher; say "build failed: $ON_DIR/runs/$name.build.log"; exit 1; }
kill $watcher 2>/dev/null || true
t1=$(date +%s)
low=$(cat "$ON_DIR/runs/$name.lowfree" 2>/dev/null || echo "$free0")
say "build: $((t1 - t0)) s; max RSS of the orchestrator $(awk '/maximum resident set size/ {printf "%.2f GB", $1/1e9}' "$ON_DIR/runs/$name.build.log"); work directory peak about $(( (free0 - low) / 1048576 )) GB on the external disk"

# 4. What came out.
for z in 13 14 15 16 17; do
  d="demo/tiles/$name/$z"; [ -d "$d" ] || continue
  find "$d" -name '*.mlt' -exec stat -f %z {} + | awk -v z="$z" '{n++; s+=$1; if ($1>m) m=$1} END {printf "z%s: %d tiles, mean %.2f MB, max %.2f MB, total %.1f MB\n", z, n, s/n/1e6, m/1e6, s/1e6}' | tee -a "$report"
done
p="demo/tiles/dorayaki-$name.pmtiles"
say "archive: $(stat -f %z "$p") B, SHA-256 $(shasum -a 256 "$p" | cut -c1-64)"
if [ "$REMOVE_LAS" = 1 ] && [ ${#fresh[@]} -gt 0 ]; then rm -f -- "${fresh[@]}"; say "removed ${#fresh[@]} LAS unzipped by this run"; fi
say "report: $report"
