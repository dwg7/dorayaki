/**
 * The tile-aligned parallel build (E022 step 3, documents/tile-aligned-build.md): the Kawazu recipe, one z17 tile per job.
 *
 *   npm run build:tiled -- <name> <zone> <file.las[@filters][,file2.las...]> [--workers N] [--centre lng,lat] [--keep]
 *
 * Stages (every stage that is a set of jobs runs N child processes of this same script):
 *   plan     read the LAS headers;
 *   scatter  one job per input file: each point goes through TileFramer into the frame of its z17 tile and is appended to that tile's shard file
 *            data/tiled-work/<name>/shards/<x>_<y>/<file index>.bin (16-byte records, src/pointcloud/tile-shard.ts);
 *   tile     one job per z17 tile, the biggest first: its shards in file order -> buildTilePieces -> the final z17 tile, and the pieces of z16 and z15 as JSON;
 *   gather   the pieces joined by position into the z16 and z15 tiles;
 *   archive  demo/tiles/<name>/ (tiles, tilejson.json, manifest.json) and demo/tiles/dorayaki-<name>.pmtiles (built in memory; a streaming writer is step 4).
 * A finished scatter file or tile job leaves a marker, so a rerun with the same work directory skips it. The recipe comes from the same
 * environment as build-tileset.ts: DORAYAKI_ADAPTIVE_LEVELS (required), _THICKNESS, _COLOR, _SPARSE, _SPARSE_SCALE, DORAYAKI_CLASS_PLANE,
 * DORAYAKI_BLOCK_VERSION, DORAYAKI_TILE_COMPRESSION. The result does not depend on the number of workers (same bytes).
 * The work directory is removed at the end unless --keep is given.
 */
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { encodeClassPlane } from "../src/class-plane.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { TileFramer } from "../src/geodesy/tile-frame.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import { PLANE_CLASS_SLOTS, planeClassSlot, planeOpacityOf, planeSlotToCode } from "../src/pointcloud/class-slots.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { parseLasSpec } from "../src/pointcloud/las-spec.js";
import { buildTilePieces, type TileBuildConfig } from "../src/pointcloud/tile-build.js";
import { SHARD_RECORD_BYTES, forEachShardRecord, writeShardRecord } from "../src/pointcloud/tile-shard.js";
import type { Splat } from "../src/surfel-block.js";
import { tileLatitude, tileLongitude, tileWidthMetres, type TileAddress } from "../src/tile-geometry.js";

const ZOOM = 17;
const blockVersion = process.env.DORAYAKI_BLOCK_VERSION === "6" ? (6 as const) : undefined;
const classPlane = process.env.DORAYAKI_CLASS_PLANE === "1";

function recipe(): TileBuildConfig {
  if (process.env.DORAYAKI_ADAPTIVE_LEVELS === undefined) throw new Error("DORAYAKI_ADAPTIVE_LEVELS is required (the tiled build always merges)");
  if (Number(process.env.DORAYAKI_ADAPTIVE_REFINE ?? 0) !== 0) throw new Error("DORAYAKI_ADAPTIVE_REFINE is not supported by the tiled build");
  return {
    adaptive: {
      maxLevel: Number(process.env.DORAYAKI_ADAPTIVE_LEVELS),
      thickness: Number(process.env.DORAYAKI_ADAPTIVE_THICKNESS ?? 0.05),
      colorTolerance: Number(process.env.DORAYAKI_ADAPTIVE_COLOR ?? 0.1),
      sparseSupport: Number(process.env.DORAYAKI_ADAPTIVE_SPARSE ?? 0),
      sparseScale: Number(process.env.DORAYAKI_ADAPTIVE_SPARSE_SCALE ?? 1),
      ...(classPlane ? { opacityOf: planeOpacityOf } : {}),
    },
    ...(classPlane ? { classSlots: PLANE_CLASS_SLOTS } : {}),
  };
}

const gz = (b: Uint8Array) => new Uint8Array(gzipSync(b, { level: 9 }));
/** The block of a tile's splats and, with class planes, the plane (the class travels in the opacity byte until here, as in build-tileset.ts). */
function encodeTile(splats: Splat[]): Uint8Array {
  if (!classPlane) return encodeDemoTile(splats, [splats.length], blockVersion);
  const plane = encodeClassPlane(Uint8Array.from(splats, (s) => planeSlotToCode(s.a)), gz);
  return encodeDemoTile(splats.map((s) => ({ ...s, a: 242 })), [splats.length], blockVersion, plane);
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
      // A point clamped into its tile after stepping can lie millimetres outside it: keep every point inside [0, width).
      const hi = t.width * (1 - 1e-9);
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
  const pieces = buildTilePieces((add) => {
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
    if (p.tile.z === ZOOM) {
      const path = `${out}/${ZOOM}/${x}/${y}.mlt`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, encodeTile(p.splats));
    } else {
      const d = `${work}/pieces/${p.tile.z}/${p.tile.x}/${p.tile.y}`;
      mkdirSync(d, { recursive: true });
      // Every field, full precision; z16 and z15 pieces are about a tenth of the z17 tile.
      writeFileSync(`${d}/${x}_${y}.json`, JSON.stringify(p.splats.map((s) => [s.x, s.y, s.z, s.sx, s.sy, s.sz, s.qw, s.qx, s.qy, s.qz, s.r, s.g, s.b, s.a])));
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
  const archiveTiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
  const manifestTiles: Array<TileAddress & { levels: number[]; bytes: number }> = [];
  const perZoom: Record<number, { tiles: number; splats: number; bytes: number }> = {};
  const add = (t: TileAddress, data: Uint8Array, splats: number): void => {
    archiveTiles.push({ ...t, data });
    manifestTiles.push({ ...t, levels: [splats], bytes: data.byteLength });
    const pz = (perZoom[t.z] ??= { tiles: 0, splats: 0, bytes: 0 });
    pz.tiles++; pz.splats += splats; pz.bytes += data.byteLength;
  };
  await clock("gather", () => {
    for (const t of tiles) {
      const data = new Uint8Array(readFileSync(`${out}/${ZOOM}/${t.x}/${t.y}.mlt`));
      add({ z: ZOOM, x: t.x, y: t.y }, data, jobStats[tiles.indexOf(t)]!.perZoom[ZOOM]!);
    }
    for (const z of [16, 15]) {
      for (const xd of readdirSync(`${work}/pieces/${z}`)) for (const yd of readdirSync(`${work}/pieces/${z}/${xd}`)) {
        const d = `${work}/pieces/${z}/${xd}/${yd}`;
        const splats: Splat[] = [];
        // In the order of the source tiles (y, then x), so the tile does not depend on which job finished first.
        const parts = readdirSync(d).map((f) => f.replace(".json", "").split("_").map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        for (const [sx, sy] of parts) {
          for (const s of JSON.parse(readFileSync(`${d}/${sx}_${sy}.json`, "utf8")) as number[][]) {
            splats.push({ x: s[0]!, y: s[1]!, z: s[2]!, sx: s[3]!, sy: s[4]!, sz: s[5]!, qw: s[6]!, qx: s[7]!, qy: s[8]!, qz: s[9]!, r: s[10]!, g: s[11]!, b: s[12]!, a: s[13]! });
          }
        }
        const t = { z, x: Number(xd), y: Number(yd) };
        const data = encodeTile(splats);
        mkdirSync(`${out}/${z}/${t.x}`, { recursive: true });
        writeFileSync(`${out}/${z}/${t.x}/${t.y}.mlt`, data);
        add(t, data, splats.length);
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
      name: `${name}: tile-aligned build, aggregated z16,15, maxzoom z${ZOOM}`,
      attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成",
      verticalDatum: "orthometric height (標高), metres, as in the source LAS",
      centre: [origin.lng, origin.lat], maxzoom: ZOOM, tiles: manifestTiles, bounds, stats,
    };
    writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(`${out}/tilejson.json`, JSON.stringify({ tilejson: "3.0.0", name: manifest.name, attribution: manifest.attribution, tiles: ["{z}/{x}/{y}.mlt"], minzoom: 15, maxzoom: ZOOM, bounds, center: [origin.lng, origin.lat, ZOOM] }, null, 2) + "\n");
    const gzipTiles = process.env.DORAYAKI_TILE_COMPRESSION === "gzip";
    const archive = writePmtiles(gzipTiles ? archiveTiles.map((t) => ({ ...t, data: gz(t.data) })) : archiveTiles, {
      tileType: PmtilesTileType.Mlt, bounds, ...(gzipTiles ? { tileCompression: PmtilesCompression.Gzip } : {}), center: [origin.lng, origin.lat, ZOOM],
      internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
      metadata: { name: manifest.name, attribution: manifest.attribution, dorayaki: manifest },
    });
    writeFileSync(`demo/tiles/dorayaki-${name}.pmtiles`, archive);
    console.log(JSON.stringify({
      ...stats, pmtilesBytes: archive.byteLength, shardBytes, seconds: stage,
      tileJobs: { count: jobStats.length, secondsSum: jobStats.reduce((n, s) => n + s.seconds, 0), maxRssMB: Math.max(...jobStats.map((s) => s.maxRssMB)) },
      scatterClamped: scatterStats.reduce((n, s) => n + s.clamped, 0), tileWidthMetres: tileWidthMetres({ z: ZOOM, x: tiles[0]!.x, y: tiles[0]!.y }),
    }, null, 2));
  });
  if (!flags.has("keep")) rmSync(work, { recursive: true, force: true });
}
