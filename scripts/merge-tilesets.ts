/**
 * Merge tilesets built separately (for example one per survey mesh) into one:
 * tiles with the same address are concatenated (decoded, joined, re-encoded as
 * one level), other tiles are copied. Needed when the area is too large to
 * aggregate in one process (memory follows the number of voxels). Seams between
 * inputs are not reconciled: a voxel cut by the boundary between two meshes is
 * fitted in each, so splats may overlap there.
 *
 * Usage: node merge-tilesets.mjs <name> <input dir name> [<input dir name> ...]
 * Inputs are demo/tiles/<dir>/ (with manifest.json); output is demo/tiles/<name>/
 * (z/x/y.mlt, tilejson.json, manifest.json) and demo/tiles/dorayaki-<name>.pmtiles.
 * Tiles in the archive are raw unless DORAYAKI_TILE_COMPRESSION=gzip.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";
import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import type { Splat } from "../src/surfel-block.js";
import { tileLatitude, tileLongitude } from "../src/tile-geometry.js";

const [name, ...inputs] = process.argv.slice(2);
if (!name || inputs.length === 0) throw new Error("usage: merge-tilesets <name> <input dir name> [...]");
const ROOT = "demo/tiles";
const OUT = `${ROOT}/${name}`;

interface Manifest { tiles: Array<{ z: number; x: number; y: number }>; maxzoom: number; attribution: string; centre: [number, number]; stats: { tileBytes: number; perZoom: Record<string, unknown> } }
const manifests = inputs.map((d) => JSON.parse(readFileSync(`${ROOT}/${d}/manifest.json`, "utf8")) as Manifest);
const maxzoom = Math.max(...manifests.map((m) => m.maxzoom));

const byAddress = new Map<string, { z: number; x: number; y: number; from: string[] }>();
manifests.forEach((m, i) => {
  for (const t of m.tiles) {
    const k = `${t.z}/${t.x}/${t.y}`;
    const e = byAddress.get(k);
    if (e) e.from.push(inputs[i]!); else byAddress.set(k, { z: t.z, x: t.x, y: t.y, from: [inputs[i]!] });
  }
});

mkdirSync(OUT, { recursive: true });
const gzipTiles = process.env.DORAYAKI_TILE_COMPRESSION === "gzip";
const archiveTiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
const tiles: Array<{ z: number; x: number; y: number; bytes: number; splats: number }> = [];
const perZoom: Record<number, { tiles: number; splats: number; bytes: number }> = {};
for (const e of [...byAddress.values()].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y)) {
  const splats: Splat[] = [];
  // A loop, not push(...array): spreading hundreds of thousands of arguments overflows the stack.
  for (const d of e.from) for (const s of decodeSurfelTileWithLevels(new Uint8Array(readFileSync(`${ROOT}/${d}/${e.z}/${e.x}/${e.y}.mlt`))).splats) splats.push(s);
  const data = encodeDemoTile(splats, [splats.length], process.env.DORAYAKI_BLOCK_VERSION === "6" ? 6 : undefined);
  const path = `${OUT}/${e.z}/${e.x}/${e.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  archiveTiles.push({ z: e.z, x: e.x, y: e.y, data });
  tiles.push({ z: e.z, x: e.x, y: e.y, bytes: data.byteLength, splats: splats.length });
  const pz = (perZoom[e.z] ??= { tiles: 0, splats: 0, bytes: 0 });
  pz.tiles++; pz.splats += splats.length; pz.bytes += data.byteLength;
}

const top = tiles.filter((t) => t.z === maxzoom);
const min = (f: (t: { x: number; y: number }) => number) => top.reduce((m, t) => Math.min(m, f(t)), Infinity);
const max = (f: (t: { x: number; y: number }) => number) => top.reduce((m, t) => Math.max(m, f(t)), -Infinity);
const o = { z: maxzoom, x: min((t) => t.x), y: min((t) => t.y) };
const bounds: [number, number, number, number] = [tileLongitude(o, 0), tileLatitude(o, max((t) => t.y) - o.y + 1), tileLongitude(o, max((t) => t.x) - o.x + 1), tileLatitude(o, 0)];
const centre = manifests[0]!.centre;
const stats = { inputs, tileBytes: tiles.reduce((n, t) => n + t.bytes, 0), tiles: tiles.length, maxzoomTiles: top.length, perZoom };
const manifest = { name: `${name}: merged ${inputs.join(", ")}`, attribution: manifests[0]!.attribution, centre, maxzoom, tiles, bounds, stats };
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const minzoom = Math.min(...tiles.map((t) => t.z));
writeFileSync(`${OUT}/tilejson.json`, JSON.stringify({ tilejson: "3.0.0", name: manifest.name, attribution: manifest.attribution, tiles: ["{z}/{x}/{y}.mlt"], minzoom, maxzoom, bounds, center: [...centre, maxzoom] }, null, 2) + "\n");
const archive = writePmtiles(gzipTiles ? archiveTiles.map((t) => ({ ...t, data: new Uint8Array(gzipSync(t.data, { level: 9 })) })) : archiveTiles, {
  tileType: PmtilesTileType.Mlt, bounds, center: [...centre, maxzoom] as [number, number, number],
  ...(gzipTiles ? { tileCompression: PmtilesCompression.Gzip } : {}),
  internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
  metadata: { name: manifest.name, attribution: manifest.attribution, dorayaki: manifest },
});
writeFileSync(`${ROOT}/dorayaki-${name}.pmtiles`, archive);
console.log(JSON.stringify({ ...stats, pmtilesBytes: archive.byteLength }, null, 2));
