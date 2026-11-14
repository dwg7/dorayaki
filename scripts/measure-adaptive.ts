/**
 * E005: how many splats adaptive merging leaves, for a grid of limits.
 * One streaming pass accumulates the base grid; then each (thickness, colour)
 * pair is merged and counted. Counts only; no tiles are written.
 *
 * Usage: node measure-adaptive.mjs <file.las> <zone> <base cell metres> <levels>
 * Merge limits tried: thickness 0.03 0.05 0.1 0.2 m, colour 0.1 0.2 0.3 1 (1 = off).
 */
import { closeSync, openSync, readSync } from "node:fs";

import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";

const [file, , sizeArg, levelsArg] = process.argv.slice(2);
if (!file || !sizeArg || !levelsArg) throw new Error("usage: measure-adaptive <file.las> <zone> <base cell metres> <levels>");
const size = Number(sizeArg), levels = Number(levelsArg);

const fd = openSync(file, "r");
const head = new Uint8Array(375);
readSync(fd, head, 0, 375, 0);
const header = parseLasHeader(head);
const e0 = (header.min[0] + header.max[0]) / 2, n0 = (header.min[1] + header.max[1]) / 2;
const acc = new VoxelAccumulator(size);
const CHUNK = Math.floor(64_000_000 / header.recordLength);
const buf = new Uint8Array(CHUNK * header.recordLength);
let done = 0;
while (done < header.count) {
  const n = Math.min(CHUNK, header.count - done);
  const want = n * header.recordLength;
  let got = 0;
  while (got < want) {
    const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got);
    if (r === 0) throw new Error("file ended early");
    got += r;
  }
  forEachLasRecord(buf, header, n, (x, y, z, _c, r, g, b) => acc.add(x - e0, y - n0, z, (r >> 8) / 255, (g >> 8) / 255, (b >> 8) / 255));
  done += n;
}
closeSync(fd);
console.log(`base ${size} m: ${acc.voxels} voxels, levels ${levels}`);
console.log("thickness colour -> splats (share of base), per-level counts, MB at 16 B");
for (const thickness of [0.03, 0.05, 0.1, 0.2]) {
  for (const colourTolerance of [0.1, 0.2, 0.3, 1]) {
    const { gaussians, perLevel } = adaptiveGaussians(acc, { maxLevel: levels, thickness, colourTolerance });
    console.log(`${thickness} ${colourTolerance} -> ${gaussians.length} (${(gaussians.length / acc.voxels * 100).toFixed(0)}%) [${perLevel.join(",")}] ${(gaussians.length * 16 / 1e6).toFixed(2)} MB`);
  }
}
