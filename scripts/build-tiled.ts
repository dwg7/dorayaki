/**
 * The tile-aligned parallel build (E022 step 3, documents/build.md): the Kawazu recipe, one z17 tile per job.
 *
 *   npm run build:tiled -- <name> <zone> <file.las[@filters][,file2.las...]> [--workers N] [--centre lng,lat] [--keep]
 *
 * Stages (every stage that is a set of jobs runs N child processes of this same script):
 *   plan     read the LAS headers;
 *   scatter  one job per input file: each point goes through TileFramer into the frame of its z17 tile and is appended to that tile's shard file
 *            data/tiled-work/<name>/shards/<x>_<y>/<file index>.bin (16-byte records, src/pointcloud/tile-shard.ts);
 *   tile     one job per z17 tile, the biggest first: its shards in file order -> buildTilePieces -> the final z17 tile, and the pieces of the lower zooms as gzipped float64;
 *   gather   the pieces joined by position into the lower-zoom tiles;
 *   archive  demo/tiles/<name>/ (tiles, tilejson.json, manifest.json) and demo/tiles/dorayaki-<name>.pmtiles, written from the tile files on disk one at a
 *            time (src/pmtiles-file.ts, E022 step 4): memory does not grow with the size of the archive.
 * A finished scatter file or tile job leaves a marker, so a rerun with the same work directory skips it. The recipe comes from the
 * environment: DORAYAKI_ADAPTIVE_LEVELS (required), _THICKNESS, _COLOR, _SPARSE, _SPARSE_SCALE, DORAYAKI_ZOOM_CELL_SCALE, _THICKNESS_SCALE, _COLOR_SCALE (E023), DORAYAKI_CLASS_PLANE,
 * DORAYAKI_TILE_COMPRESSION. The result does not depend on the number of workers (same bytes).
 * The work directory is removed at the end unless --keep is given.
 */
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { encodeClassPlane } from "../src/class-plane.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { TileFramer } from "../src/geodesy/tile-frame.js";
import { PmtilesCompression, PmtilesTileType } from "../src/pmtiles.js";
import { writePmtilesFile } from "../src/pmtiles-file.js";
import { PLANE_CLASS_SLOTS, planeClassSlot, planeOpacityOf, planeSlotToCode } from "../src/pointcloud/class-slots.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { parseLasSpec } from "../src/pointcloud/las-spec.js";
import { buildTilePieces, type TileBuildConfig } from "../src/pointcloud/tile-build.js";
import { SHARD_RECORD_BYTES, forEachShardRecord, writeShardRecord } from "../src/pointcloud/tile-shard.js";
import type { Splat } from "../src/surfel-block.js";
import { tileLatitude, tileLongitude, tileWidthMetres, type TileAddress } from "../src/tile-geometry.js";

const ZOOM = 17;
/** Zooms below z17 that are built from the z17 tiles (E024; `DORAYAKI_LOWER_ZOOMS=16,15,14,13`; default 16,15 as before). */
const LOWER_ZOOMS = (process.env.DORAYAKI_LOWER_ZOOMS ?? "16,15").split(",").map(Number).sort((a, b) => b - a);
if (LOWER_ZOOMS.some((z, i) => !Number.isInteger(z) || z >= 17 || z < 0 || LOWER_ZOOMS.indexOf(z) !== i)) throw new Error(`DORAYAKI_LOWER_ZOOMS must list distinct integers below 17, got ${process.env.DORAYAKI_LOWER_ZOOMS}`);
const MIN_ZOOM = LOWER_ZOOMS.length > 0 ? LOWER_ZOOMS[LOWER_ZOOMS.length - 1]! : ZOOM;
const classPlane = process.env.DORAYAKI_CLASS_PLANE === "1";

function parseTargets(spec: string): number | Record<number, number> {
  if (/^\d+$/.test(spec)) return Number(spec);
  const out: Record<number, number> = {};
  for (const part of spec.split(",")) {
    const m = /^(\d+):(\d+)$/.exec(part.trim());
    if (!m) throw new Error(`DORAYAKI_ZOOM_TARGET_SPLATS: "${spec}" is not a number or a list like 16:45000,15:50000`);
    out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

function recipe(): TileBuildConfig {
  if (process.env.DORAYAKI_ADAPTIVE_LEVELS === undefined) throw new Error("DORAYAKI_ADAPTIVE_LEVELS is required (the tiled build always merges)");
  if (Number(process.env.DORAYAKI_ADAPTIVE_REFINE ?? 0) !== 0) throw new Error("DORAYAKI_ADAPTIVE_REFINE is not supported by the tiled build");
  return {
    zooms: [ZOOM, ...LOWER_ZOOMS],
    adaptive: {
      maxLevel: Number(process.env.DORAYAKI_ADAPTIVE_LEVELS),
      thickness: Number(process.env.DORAYAKI_ADAPTIVE_THICKNESS ?? 0.05),
      colorTolerance: Number(process.env.DORAYAKI_ADAPTIVE_COLOR ?? 0.1),
      sparseSupport: Number(process.env.DORAYAKI_ADAPTIVE_SPARSE ?? 0),
      sparseScale: Number(process.env.DORAYAKI_ADAPTIVE_SPARSE_SCALE ?? 1),
      ...(classPlane ? { opacityOf: planeOpacityOf } : {}),
    },
    ...(classPlane ? { classSlots: PLANE_CLASS_SLOTS } : {}),
    // E023: coarser zooms below z17 (all default to 1, which builds as before).
    cellScale: Number(process.env.DORAYAKI_ZOOM_CELL_SCALE ?? 1),
    // E025: a coarser cell at z17 itself (default 1).
    finestCellScale: Number(process.env.DORAYAKI_Z17_CELL_SCALE ?? 1),
    thicknessScale: Number(process.env.DORAYAKI_ZOOM_THICKNESS_SCALE ?? 1),
    colorScale: Number(process.env.DORAYAKI_ZOOM_COLOR_SCALE ?? 1),
    // E024: size as the criterion: splats per whole tile below z17 (`50000`, or `16:45000,15:50000`); a piece over its share is merged harder.
    ...(process.env.DORAYAKI_ZOOM_TARGET_SPLATS ? { targetSplats: parseTargets(process.env.DORAYAKI_ZOOM_TARGET_SPLATS) } : {}),
  };
}

/** Fields of a splat in a piece file (x, y, z, sx, sy, sz, qw, qx, qy, qz, r, g, b, a). */
const PIECE_FIELDS = 14;
const gz = (b: Uint8Array) => new Uint8Array(gzipSync(b, { level: 9 }));
/** The block of a tile's splats and, with class planes, the plane (the class travels in the opacity byte until here). */
function encodeTile(splats: Splat[]): Uint8Array {
  if (!classPlane) return encodeDemoTile(splats, [splats.length]);
  const plane = encodeClassPlane(Uint8Array.from(splats, (s) => planeSlotToCode(s.a)), gz);
  return encodeDemoTile(splats.map((s) => ({ ...s, a: 242 })), [splats.length], plane);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "scatter") scatterJob(rest);
else if (mode === "tile") tileJob(rest);
else await orchestrate([mode ?? "", ...rest]);

// ---------------------------------------------------------------------------------------------------------------- scatter

function scatterJob([work, fiArg, zoneArg, specArg]: string[]): void {
  const fi = Number(fiArg), spec = parseLasSpec(specArg!);
  const framer = new TileFramer(Number(zoneArg), ZOOM);
  const shards = `${work}/shards`;
  mkdirSync(shards, { recursive: true });
  // A crashed earlier run of this file leaves partial shards: start from none.
  for (const d of readdirSync(shards)) rmSync(`${shards}/${d}/${fi}.bin`, { force: true });
  const fd = openSync(spec.path, "r");
  const head = new Uint8Array(375); readSync(fd, head, 0, 375, 0);
  const header = parseLasHeader(head);
  if (header.rgbOffset === null) throw new Error(`expected RGB points in ${spec.path}`);
  const BUF = 1 << 20;
  const perTile = new Map<string, { buf: Uint8Array; view: DataView; n: number; path: string; width: number; total: number }>();
  const flush = (t: { buf: Uint8Array; n: number; path: string }) => { if (t.n > 0) appendFileSync(t.path, t.buf.subarray(0, t.n * SHARD_RECORD_BYTES)); t.n = 0; };
  const CHUNK = Math.floor(64_000_000 / header.recordLength);
  const buf = new Uint8Array(CHUNK * header.recordLength);
  let done = 0, kept = 0, clamped = 0;
  const t0 = performance.now();
  while (done < header.count) {
    const n = Math.min(CHUNK, header.count - done), want = n * header.recordLength;
    let got = 0;
    while (got < want) { const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got); if (r === 0) throw new Error(`${spec.path} ended after ${done} records`); got += r; }
    forEachLasRecord(buf, header, n, (e, nn, z, c, r, g, b, returns) => {
      if (!spec.keep(c, returns)) return;
      const loc = framer.locate(e, nn);
      if (loc.clamped) clamped++;
      const key = `${loc.x}_${loc.y}`;
      let t = perTile.get(key);
      if (!t) {
        mkdirSync(`${shards}/${key}`, { recursive: true });
        const b0 = new Uint8Array(BUF);
        t = { buf: b0, view: new DataView(b0.buffer), n: 0, path: `${shards}/${key}/${fi}.bin`, width: loc.widthMetres, total: 0 };
        perTile.set(key, t);
      }
      // A point clamped into its tile after stepping can lie millimetres outside it, and float32 rounds a value just under the width up to the
      // width (resolution 2e-5 m at 250 m): keep every point 0.1 mm inside [0, width).
      const hi = t.width - 1e-4;
      writeShardRecord(t.view, t.n * SHARD_RECORD_BYTES, Math.min(hi, Math.max(0, loc.east)), Math.min(hi, Math.max(0, loc.south)), z, r >> 8, g >> 8, b >> 8, classPlane ? planeClassSlot(c, returns) : -1);
      t.n++; t.total++; kept++;
      if (t.n * SHARD_RECORD_BYTES === BUF) flush(t);
    });
    done += n;
  }
  closeSync(fd);
  for (const t of perTile.values()) flush(t);
  const tiles: Record<string, number> = {};
  for (const [k, t] of perTile) tiles[k] = t.total;
  writeFileSync(`${work}/scatter-${fi}.json`, JSON.stringify({ file: spec.path, points: header.count, kept, clamped, seconds: (performance.now() - t0) / 1000, tiles }));
}

// ---------------------------------------------------------------------------------------------------------------- tile

function tileJob([work, x, y]: string[]): void {
  const tile: TileAddress = { z: ZOOM, x: Number(x), y: Number(y) };
  const t0 = performance.now();
  const dir = `${work}/shards/${x}_${y}`;
  const files = readdirSync(dir).filter((f) => f.endsWith(".bin")).sort((a, b) => parseInt(a) - parseInt(b));
  const CHUNK = 1 << 20; // records
  const buf = new Uint8Array(CHUNK * SHARD_RECORD_BYTES);
  // The same bound again on reading: shards written by a run before that fix hold values rounded up to the width.
  const hi = tileWidthMetres(tile) - 1e-4;
  const pieces = buildTilePieces((feedPoint) => {
    const add = (e: number, s: number, u: number, r: number, g: number, b: number, slot: number): void => feedPoint(Math.min(e, hi), Math.min(s, hi), u, r, g, b, slot);
    for (const f of files) {
      const fd = openSync(`${dir}/${f}`, "r");
      const total = statSync(`${dir}/${f}`).size / SHARD_RECORD_BYTES;
      if (!Number.isInteger(total)) throw new Error(`${dir}/${f}: size is not a whole number of records`);
      for (let done = 0; done < total;) {
        const n = Math.min(CHUNK, total - done), want = n * SHARD_RECORD_BYTES;
        let got = 0;
        while (got < want) { const r = readSync(fd, buf, got, want - got, done * SHARD_RECORD_BYTES + got); if (r === 0) throw new Error(`${dir}/${f}: short read`); got += r; }
        forEachShardRecord(buf, n, add);
        done += n;
      }
      closeSync(fd);
    }
  }, tile, recipe());
  const out = process.env.DORAYAKI_TILED_OUT!;
  const stats: Record<string, unknown> = { tile: `${x}/${y}`, points: pieces[0]!.points, voxels: pieces[0]!.voxels, perZoom: {} as Record<number, number> };
  for (const p of pieces) {
    (stats.perZoom as Record<number, number>)[p.tile.z] = p.splats.length;
    if (p.mergeScale !== undefined) ((stats.mergeScale ??= {}) as Record<number, number>)[p.tile.z] = p.mergeScale;
    if (p.tile.z === ZOOM) {
      const path = `${out}/${ZOOM}/${x}/${y}.mlt`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, encodeTile(p.splats));
    } else {
      const d = `${work}/pieces/${p.tile.z}/${p.tile.x}/${p.tile.y}`;
      mkdirSync(d, { recursive: true });
      // Every field, full precision (float64: the same numbers JSON would carry), gzip level 1: JSON text of the pieces took 4.7 GB for 23 sheets and
      // filled the disk at 32 (E023 note in documents/datasets.md).
      const f = new Float64Array(p.splats.length * PIECE_FIELDS);
      p.splats.forEach((s, i) => f.set([s.x, s.y, s.z, s.sx, s.sy, s.sz, s.qw, s.qx, s.qy, s.qz, s.r, s.g, s.b, s.a], i * PIECE_FIELDS));
      writeFileSync(`${d}/${x}_${y}.f64.gz`, gzipSync(new Uint8Array(f.buffer), { level: 1 }));
    }
  }
  stats.seconds = (performance.now() - t0) / 1000;
  stats.maxRssMB = process.resourceUsage().maxRSS / 1024;
  writeFileSync(`${work}/done/${x}_${y}.json`, JSON.stringify(stats));
}

// ---------------------------------------------------------------------------------------------------------------- orchestrator

/** Run `jobs` (argument lists of this script) with at most `workers` processes at once; fail on the first failure. */
async function runJobs(jobs: string[][], workers: number, env: NodeJS.ProcessEnv = {}): Promise<void> {
  const self = fileURLToPath(import.meta.url);
  let next = 0, failed: Error | undefined;
  const worker = async (): Promise<void> => {
    while (!failed && next < jobs.length) {
      const args = jobs[next++]!;
      await new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ["--max-old-space-size=2560", self, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "pipe"] });
        let err = "";
        child.stderr.on("data", (d) => { err += d; });
        child.on("close", (code) => { if (code !== 0) failed ??= new Error(`job ${args.slice(0, 3).join(" ")} exited with ${code}: ${err.slice(-800)}`); resolve(); });
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));
  if (failed) throw failed;
}

async function orchestrate(argv: string[]): Promise<void> {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--keep") flags.set("keep", "1");
    else if (a === "--workers" || a === "--centre") flags.set(a.slice(2), argv[++i] ?? "");
    else positional.push(a);
  }
  const [name, zoneArg, fileArg] = positional;
  if (!name || !zoneArg || !fileArg) throw new Error("usage: build-tiled <name> <zone> <file.las[@filters][,file2.las ...]> [--workers N] [--centre lng,lat] [--keep]");
  const workers = Number(flags.get("workers") ?? 4);
  const config = recipe();
  const specs = fileArg.split(",");
  const work = `data/tiled-work/${name}`;
  const out = `demo/tiles/${name}`;
  mkdirSync(`${work}/done`, { recursive: true });
  const stage: Record<string, number> = {};
  const clock = async <T>(label: string, f: () => Promise<T> | T): Promise<T> => { const t = performance.now(); const r = await f(); stage[label] = (performance.now() - t) / 1000; return r; };

  // plan
  const heads = specs.map((s) => { const fd = openSync(parseLasSpec(s).path, "r"); const h = new Uint8Array(375); readSync(fd, h, 0, 375, 0); closeSync(fd); return parseLasHeader(h); });
  const centreArg = flags.get("centre");
  const origin = centreArg ? { lng: Number(centreArg.split(",")[0]), lat: Number(centreArg.split(",")[1]) }
    : jprcsToLatLng(Number(zoneArg), (heads[0]!.min[1] + heads[0]!.max[1]) / 2, (heads[0]!.min[0] + heads[0]!.max[0]) / 2);

  // scatter
  await clock("scatter", () => runJobs(
    specs.flatMap((s, fi) => (existsSync(`${work}/scatter-${fi}.json`) ? [] : [["scatter", work, String(fi), zoneArg, s]])), workers));
  const scatterStats = specs.map((_, fi) => JSON.parse(readFileSync(`${work}/scatter-${fi}.json`, "utf8")) as { points: number; kept: number; clamped: number; seconds: number });
  const shardBytes = scatterStats.reduce((n, s) => n + s.kept * SHARD_RECORD_BYTES, 0);

  // tile jobs, biggest first
  const tiles = readdirSync(`${work}/shards`).map((d) => {
    const bytes = readdirSync(`${work}/shards/${d}`).reduce((n, f) => n + statSync(`${work}/shards/${d}/${f}`).size, 0);
    const [x, y] = d.split("_").map(Number) as [number, number];
    return { x, y, bytes };
  }).sort((a, b) => b.bytes - a.bytes || a.x - b.x || a.y - b.y);
  await clock("tiles", () => runJobs(
    tiles.flatMap((t) => (existsSync(`${work}/done/${t.x}_${t.y}.json`) ? [] : [["tile", work, String(t.x), String(t.y)]])), workers, { DORAYAKI_TILED_OUT: out }));
  const jobStats = tiles.map((t) => JSON.parse(readFileSync(`${work}/done/${t.x}_${t.y}.json`, "utf8")) as { points: number; seconds: number; maxRssMB: number; perZoom: Record<number, number> });

  // gather
  const archiveTiles: TileAddress[] = [];
  const manifestTiles: Array<TileAddress & { levels: number[]; bytes: number }> = [];
  const perZoom: Record<number, { tiles: number; splats: number; bytes: number }> = {};
  const add = (t: TileAddress, bytes: number, splats: number): void => {
    archiveTiles.push(t);
    manifestTiles.push({ ...t, levels: [splats], bytes });
    const pz = (perZoom[t.z] ??= { tiles: 0, splats: 0, bytes: 0 });
    pz.tiles++; pz.splats += splats; pz.bytes += bytes;
  };
  await clock("gather", () => {
    for (const t of tiles) {
      add({ z: ZOOM, x: t.x, y: t.y }, statSync(`${out}/${ZOOM}/${t.x}/${t.y}.mlt`).size, jobStats[tiles.indexOf(t)]!.perZoom[ZOOM]!);
    }
    for (const z of LOWER_ZOOMS) {
      for (const xd of readdirSync(`${work}/pieces/${z}`)) for (const yd of readdirSync(`${work}/pieces/${z}/${xd}`)) {
        const d = `${work}/pieces/${z}/${xd}/${yd}`;
        const splats: Splat[] = [];
        // In the order of the source tiles (y, then x), so the tile does not depend on which job finished first.
        const parts = readdirSync(d).map((f) => f.replace(".f64.gz", "").split("_").map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        for (const [sx, sy] of parts) {
          const raw = gunzipSync(readFileSync(`${d}/${sx}_${sy}.f64.gz`));
          const f = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); // a copy: the buffer is not 8-byte aligned
          for (let i = 0; i < f.length; i += PIECE_FIELDS) {
            splats.push({ x: f[i]!, y: f[i + 1]!, z: f[i + 2]!, sx: f[i + 3]!, sy: f[i + 4]!, sz: f[i + 5]!, qw: f[i + 6]!, qx: f[i + 7]!, qy: f[i + 8]!, qz: f[i + 9]!, r: f[i + 10]!, g: f[i + 11]!, b: f[i + 12]!, a: f[i + 13]! });
          }
        }
        const t = { z, x: Number(xd), y: Number(yd) };
        const data = encodeTile(splats);
        mkdirSync(`${out}/${z}/${t.x}`, { recursive: true });
        writeFileSync(`${out}/${z}/${t.x}/${t.y}.mlt`, data);
        add(t, data.byteLength, splats.length);
      }
    }
    archiveTiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
    manifestTiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  });

  // archive
  await clock("archive", () => {
    const top = manifestTiles.filter((t) => t.z === ZOOM);
    const minX = Math.min(...top.map((t) => t.x)), maxX = Math.max(...top.map((t) => t.x));
    const minY = Math.min(...top.map((t) => t.y)), maxY = Math.max(...top.map((t) => t.y));
    const o = { z: ZOOM, x: minX, y: minY };
    const bounds: [number, number, number, number] = [tileLongitude(o, 0), tileLatitude(o, maxY - minY + 1), tileLongitude(o, maxX - minX + 1), tileLatitude(o, 0)];
    const stats = { inputs: specs, workers, points: scatterStats.reduce((n, s) => n + s.kept, 0), tiles: manifestTiles.length, maxzoomTiles: top.length, perZoom, tileBytes: manifestTiles.reduce((n, t) => n + t.bytes, 0) };
    const manifest = {
      name: `${name}: tile-aligned build, aggregated z${LOWER_ZOOMS.join(",")}, maxzoom z${ZOOM}`,
      attribution: process.env.DORAYAKI_ATTRIBUTION ?? "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成", // `DORAYAKI_ATTRIBUTION` for other sources
      verticalDatum: "orthometric height (標高), metres, as in the source LAS",
      centre: [origin.lng, origin.lat], maxzoom: ZOOM, tiles: manifestTiles, bounds, stats,
    };
    writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(`${out}/tilejson.json`, JSON.stringify({ tilejson: "3.0.0", name: manifest.name, attribution: manifest.attribution, tiles: ["{z}/{x}/{y}.mlt"], minzoom: MIN_ZOOM, maxzoom: ZOOM, bounds, center: [origin.lng, origin.lat, ZOOM] }, null, 2) + "\n");
    const gzipTiles = process.env.DORAYAKI_TILE_COMPRESSION === "gzip";
    const tileFile = (t: TileAddress): string => `${out}/${t.z}/${t.x}/${t.y}.mlt`;
    const archiveBytes = writePmtilesFile(`demo/tiles/dorayaki-${name}.pmtiles`, archiveTiles.map((t) => ({
      ...t, read: () => (gzipTiles ? gz(readFileSync(tileFile(t))) : new Uint8Array(readFileSync(tileFile(t)))),
    })), {
      tileType: PmtilesTileType.Mlt, bounds, ...(gzipTiles ? { tileCompression: PmtilesCompression.Gzip } : {}), center: [origin.lng, origin.lat, ZOOM],
      internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
      metadata: { name: manifest.name, attribution: manifest.attribution, dorayaki: manifest },
    });
    console.log(JSON.stringify({
      ...stats, pmtilesBytes: archiveBytes, shardBytes, seconds: stage,
      tileJobs: { count: jobStats.length, secondsSum: jobStats.reduce((n, s) => n + s.seconds, 0), maxRssMB: Math.max(...jobStats.map((s) => s.maxRssMB)) },
      scatterClamped: scatterStats.reduce((n, s) => n + s.clamped, 0), tileWidthMetres: tileWidthMetres({ z: ZOOM, x: tiles[0]!.x, y: tiles[0]!.y }),
    }, null, 2));
  });
  if (!flags.has("keep")) rmSync(work, { recursive: true, force: true });
}
