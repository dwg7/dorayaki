/**
 * Streaming voxelisation of a LAS file (src/pointcloud/voxel-accumulator.ts):
 * reports voxel counts, time and memory per voxel size, without building any
 * tiles. Reads the file in chunks, so files larger than memory are fine.
 *
 * Usage: node measure-stream.mjs <file.las> <zone> [zoom ...]
 * Voxel size for a zoom is the tile width at the data centre / 512 (the same
 * rule as buildPyramid). Default zooms: 18 19.
 */
import { closeSync, openSync, readSync } from "node:fs";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { BASE_CELLS } from "../src/progressive.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const [file, zoneArg, ...zoomArgs] = process.argv.slice(2);
if (!file || !zoneArg) throw new Error("usage: measure-stream <file.las> <zone> [zoom ...]");
const zones = zoomArgs.length ? zoomArgs.map(Number) : [18, 19];

const fd = openSync(file, "r");
const head = new Uint8Array(375);
readSync(fd, head, 0, 375, 0);
const header = parseLasHeader(head);
const e0 = (header.min[0] + header.max[0]) / 2;
const n0 = (header.min[1] + header.max[1]) / 2;
const origin = jprcsToLatLng(Number(zoneArg), n0, e0);
const widthAt = (z: number) => {
  const n = 2 ** z;
  const y = Math.floor(((1 - Math.asinh(Math.tan((origin.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return tileWidthMetres({ z, x: 0, y });
};
const accs = zones.map((z) => ({ z, size: widthAt(z) / BASE_CELLS, acc: new VoxelAccumulator(widthAt(z) / BASE_CELLS) }));

const CHUNK_RECORDS = Math.floor(64_000_000 / header.recordLength);
const buf = new Uint8Array(CHUNK_RECORDS * header.recordLength);
const t0 = Date.now();
let done = 0;
let nextReport = 20_000_000;
while (done < header.count) {
  const n = Math.min(CHUNK_RECORDS, header.count - done);
  const want = n * header.recordLength;
  let got = 0;
  while (got < want) {
    const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got);
    if (r === 0) throw new Error(`file ended after ${done} records`);
    got += r;
  }
  forEachLasRecord(buf, header, n, (x, y, z, _c, r, g, b) => {
    const lx = x - e0, ly = y - n0;
    const cr = (r >> 8) / 255, cg = (g >> 8) / 255, cb = (b >> 8) / 255;
    for (const a of accs) a.acc.add(lx, ly, z, cr, cg, cb);
  });
  done += n;
  if (done >= nextReport) {
    nextReport += 20_000_000;
    console.error(`${done} points, ${((Date.now() - t0) / 1000).toFixed(0)} s, rss ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB, voxels ${accs.map((a) => a.acc.voxels).join("/")}`);
  }
}
closeSync(fd);
const seconds = (Date.now() - t0) / 1000;
console.log(JSON.stringify({
  file, points: done, seconds, pointsPerSecond: Math.round(done / seconds),
  rssGB: process.memoryUsage().rss / 1e9,
  grids: accs.map((a) => ({ zoom: a.z, voxelMetres: a.size, voxels: a.acc.voxels, accumulatorMB: a.acc.byteLength / 1e6, pointsPerVoxel: a.acc.points / a.acc.voxels })),
}, null, 2));
