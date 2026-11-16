/**
 * E020: what would a class per splat cost in a tile? Reads tilesets built with DORAYAKI_CLASS_ALPHA=1 (the dominant class of
 * the points of each splat and its purity are in the opacity byte: slot * 32 + round(share * 31)) and reports the class mix,
 * how pure the splats are, the entropy of the class (alone and given its neighbour in stored order and the splat's shape),
 * and the sizes of a few ways to store it.
 *
 *   npm run measure:class -- <zoom> <tileset dir> [<tileset dir> ...]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";

const [zoomArg, ...dirs] = process.argv.slice(2);
if (!zoomArg || dirs.length === 0) { console.error("usage: measure-class <zoom> <tileset dir> [...]"); process.exit(1); }

const NAMES = ["0 none", "1 unclassified (1 return)", "2 ground", "3 low vegetation", "4 medium vegetation", "5 high vegetation", "6 unclassified (several returns)", "7 other"];
const GROUP = [2, 2, 0, 1, 1, 1, 1, 2]; // 0 ground, 1 vegetation, 2 other
const GROUP_NAMES = ["ground", "vegetation (3-5, or several returns)", "other"];

/** Total zero-order entropy in bits of a sequence of symbols (numbers). */
function entropy(sym: ArrayLike<number>): number {
  const m = new Map<number, number>();
  for (let i = 0; i < sym.length; i++) m.set(sym[i]!, (m.get(sym[i]!) ?? 0) + 1);
  let b = 0;
  for (const c of m.values()) b -= c * Math.log2(c / sym.length);
  return b;
}
/** Conditional entropy in bits: H(symbol | context), both given per element. */
function condEntropy(sym: ArrayLike<number>, ctx: ArrayLike<number>): number {
  const byCtx = new Map<number, Map<number, number>>();
  for (let i = 0; i < sym.length; i++) {
    let m = byCtx.get(ctx[i]!);
    if (!m) byCtx.set(ctx[i]!, (m = new Map()));
    m.set(sym[i]!, (m.get(sym[i]!) ?? 0) + 1);
  }
  let b = 0;
  for (const m of byCtx.values()) {
    let tot = 0;
    for (const c of m.values()) tot += c;
    for (const c of m.values()) b -= c * Math.log2(c / tot);
  }
  return b;
}
const gz = (b: Uint8Array) => gzipSync(b, { level: 9 }).byteLength;

const slotCount = new Array(8).fill(0);
const purityHist = new Array(4).fill(0); // share >= 0.9, 0.7-0.9, 0.5-0.7, below
let n = 0, tileBytes = 0, tiles = 0;
const bitsAcc: Record<string, number> = {};
const add = (k: string, v: number) => (bitsAcc[k] = (bitsAcc[k] ?? 0) + v);
let gzByte = 0, gz2bit = 0, gzRle = 0, gzBin = 0, rawRunBytes = 0;
const mixByGroup = [0, 0, 0];
const heightByGroup = [0, 0, 0];

for (const dir of dirs) {
  const zdir = join(dir, zoomArg);
  for (const xs of readdirSync(zdir)) {
    for (const f of readdirSync(join(zdir, xs))) {
      if (!f.endsWith(".mlt")) continue;
      const file = new Uint8Array(readFileSync(join(zdir, xs, f)));
      const { splats } = decodeSurfelTileWithLevels(file);
      tileBytes += file.byteLength; tiles++;
      const m = splats.length;
      n += m;
      const slot = new Uint8Array(m), group = new Uint8Array(m), round = new Uint8Array(m), purity = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        const s = splats[i]!;
        slot[i] = s.a >> 5;
        group[i] = GROUP[slot[i]!]!;
        purity[i] = (s.a & 31) / 31;
        round[i] = Math.max(s.sx, s.sy, s.sz) / Math.min(s.sx, s.sy, s.sz) < 1.5 ? 1 : 0;
        slotCount[slot[i]!]++;
        purityHist[purity[i]! >= 0.9 ? 0 : purity[i]! >= 0.7 ? 1 : purity[i]! >= 0.5 ? 2 : 3]++;
        mixByGroup[group[i]!]!++;
      }
      const prev = (a: ArrayLike<number>): Int32Array => { const o = new Int32Array(m); for (let i = 1; i < m; i++) o[i] = a[i - 1]! + 1; return o; };
      const prevSlot = prev(slot), prevGroup = prev(group);
      const withRound = (c: Int32Array): Int32Array => c.map((v, i) => v * 2 + round[i]!);
      const bin = group.map((g) => (g === 0 ? 1 : 0));
      add("fine class (8 slots), no context", entropy(slot));
      add("fine class | previous splat's fine class", condEntropy(slot, prevSlot));
      add("fine class | previous, shape", condEntropy(slot, withRound(prevSlot)));
      add("3 groups, no context", entropy(group));
      add("3 groups | previous group", condEntropy(group, prevGroup));
      add("3 groups | previous group, shape", condEntropy(group, withRound(prevGroup)));
      add("ground or not, no context", entropy(bin));
      add("ground or not | previous", condEntropy(bin, prev(bin)));
      // Stored forms, gzip per tile.
      gzByte += gz(Uint8Array.from(slot));
      const packed = new Uint8Array(Math.ceil(m / 4));
      for (let i = 0; i < m; i++) packed[i >> 2]! |= group[i]! << ((i & 3) * 2);
      gz2bit += gz(packed);
      const runs: number[] = [];
      for (let i = 0; i < m;) { let j = i; while (j < m && group[j] === group[i]) j++; runs.push((j - i) * 4 + group[i]!); i = j; }
      const rle: number[] = [];
      for (const v of runs) { let x = v; while (x >= 128) { rle.push((x & 127) | 128); x >>= 7; } rle.push(x); }
      rawRunBytes += rle.length;
      gzRle += gz(Uint8Array.from(rle));
      const binPacked = new Uint8Array(Math.ceil(m / 8));
      for (let i = 0; i < m; i++) if (bin[i]) binPacked[i >> 3]! |= 1 << (i & 7);
      gzBin += gz(binPacked);
      for (let i = 0; i < m; i++) heightByGroup[group[i]!]! += splats[i]!.z;
    }
  }
}

const pct = (v: number) => (100 * v / n).toFixed(1) + " %";
console.log(`${dirs.join(", ")} z${zoomArg}: ${tiles} tiles, ${n} splats, ${tileBytes} bytes stored (${(tileBytes / n).toFixed(2)} per splat)`);
console.table(NAMES.map((name, i) => ({ class: name, splats: slotCount[i], share: pct(slotCount[i]) })).filter((r) => r.splats > 0));
console.table(GROUP_NAMES.map((name, i) => ({ group: name, splats: mixByGroup[i], share: pct(mixByGroup[i]!) })));
console.log("purity (share of a splat's points in its dominant class): >= 0.9:", pct(purityHist[0]), " 0.7-0.9:", pct(purityHist[1]), " 0.5-0.7:", pct(purityHist[2]), " below 0.5:", pct(purityHist[3]));
console.table(Object.entries(bitsAcc).map(([what, b]) => ({ "class coded as": what, "ideal bits per splat": +(b / n).toFixed(3) })));
const bps = (bytes: number) => +(8 * bytes / n).toFixed(3);
console.table([
  { form: "1 byte per splat (fine class), gzip per tile", "bits per splat": bps(gzByte) },
  { form: "2 bits per splat (3 groups), gzip per tile", "bits per splat": bps(gz2bit) },
  { form: "2 bits per splat, packed, not compressed", "bits per splat": 2 },
  { form: "run lengths of 3 groups (varint), not compressed", "bits per splat": bps(rawRunBytes) },
  { form: "run lengths of 3 groups (varint), gzip per tile", "bits per splat": bps(gzRle) },
  { form: "1 bit per splat (ground or not), gzip per tile", "bits per splat": bps(gzBin) },
  { form: "1 bit per splat (ground or not), not compressed", "bits per splat": 1 },
]);
