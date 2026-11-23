import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { PMTiles, type RangeResponse, type Source } from "pmtiles";

import { PmtilesCompression, PmtilesTileType, writePmtiles, zxyToTileId, type PmtilesOptions, type PmtilesTile } from "../src/pmtiles.js";
import { writePmtilesFile } from "../src/pmtiles-file.js";

const OPTIONS: PmtilesOptions = {
  tileType: PmtilesTileType.Mlt,
  bounds: [129.7, 33.17, 129.73, 33.19],
  center: [129.7198, 33.179, 17],
  metadata: { name: "test", attribution: "点群: テスト" },
  internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
};

/** `count` tiles of zoom 17 with varying contents, in an order that is not the tile-ID order. */
function tilesOf(count: number): PmtilesTile[] {
  const tiles: PmtilesTile[] = [];
  for (let i = 0; i < count; i++) {
    const x = 112700 + (i * 7919) % 211;
    const y = 52700 + ((i * 104729) % 97);
    tiles.push({ z: 17, x, y, data: new Uint8Array(1 + ((i * 31) % 50)).fill(i % 251) });
  }
  const seen = new Set<string>();
  return tiles.filter((t) => !seen.has(`${t.x}/${t.y}`) && seen.add(`${t.x}/${t.y}`) !== undefined);
}

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dorayaki-pmtiles-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const asFileTiles = (tiles: readonly PmtilesTile[], log?: string[]) => tiles.map((t) => ({ z: t.z, x: t.x, y: t.y, read: () => { log?.push(`${t.z}/${t.x}/${t.y}`); return t.data; } }));

test("the file writer produces the same bytes as the in-memory writer", () => {
  withDir((dir) => {
    const tiles = tilesOf(40);
    const size = writePmtilesFile(join(dir, "a.pmtiles"), asFileTiles(tiles), OPTIONS);
    const expected = writePmtiles(tiles, OPTIONS);
    assert.equal(size, expected.byteLength);
    assert.ok(Buffer.from(readFileSync(join(dir, "a.pmtiles"))).equals(Buffer.from(expected)));
  });
});

test("the same bytes when the root directory spills into leaf directories", () => {
  withDir((dir) => {
    // Directories left uncompressed, so that the entries do not fit in the root's 16 KiB (gzip would shrink them under it).
    const { internal: _internal, ...plain } = OPTIONS;
    const tiles = tilesOf(6000);
    const expected = writePmtiles(tiles, plain);
    const head = new DataView(expected.buffer, expected.byteOffset);
    assert.ok(head.getUint32(48, true) > 0 || head.getUint32(52, true) > 0, "the archive has leaf directories");
    writePmtilesFile(join(dir, "b.pmtiles"), asFileTiles(tiles), plain);
    assert.ok(Buffer.from(readFileSync(join(dir, "b.pmtiles"))).equals(Buffer.from(expected)));
  });
});

test("tiles are read once each, in tile-ID order, and a reference reader reads the archive", async () => {
  await withDir(async (dir) => {
    const tiles = tilesOf(25);
    const log: string[] = [];
    writePmtilesFile(join(dir, "c.pmtiles"), asFileTiles(tiles, log), { ...OPTIONS, tileCompression: PmtilesCompression.None });
    assert.equal(log.length, tiles.length);
    const ids = log.map((k) => { const [z, x, y] = k.split("/").map(Number) as [number, number, number]; return zxyToTileId(z, x, y); });
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));

    const bytes = new Uint8Array(readFileSync(join(dir, "c.pmtiles")));
    const source: Source = { getKey: () => "m", getBytes: async (o: number, l: number): Promise<RangeResponse> => ({ data: bytes.slice(o, o + l).buffer }) };
    const archive = new PMTiles(source);
    for (const t of tiles) {
      const got = await archive.getZxy(t.z, t.x, t.y);
      assert.ok(got, `tile ${t.x}/${t.y}`);
      assert.deepEqual(new Uint8Array(got.data), t.data);
    }
    assert.equal(((await archive.getMetadata()) as { attribution: string }).attribution, "点群: テスト");
  });
});

test("a duplicate tile or an empty set is rejected and leaves nothing behind", () => {
  withDir((dir) => {
    const one: PmtilesTile = { z: 17, x: 112764, y: 52717, data: Uint8Array.from([1]) };
    assert.throws(() => writePmtilesFile(join(dir, "d.pmtiles"), asFileTiles([one, { ...one }]), OPTIONS), /duplicate tile 17\/112764\/52717/);
    assert.throws(() => writePmtilesFile(join(dir, "d.pmtiles"), [], OPTIONS), RangeError);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("a failing read leaves no archive and no temporary files", () => {
  withDir((dir) => {
    const tiles = asFileTiles(tilesOf(5));
    tiles[2]!.read = () => { throw new Error("disk went away"); };
    assert.throws(() => writePmtilesFile(join(dir, "e.pmtiles"), tiles, OPTIONS), /disk went away/);
    assert.equal(existsSync(join(dir, "e.pmtiles")), false);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("an existing archive is replaced only when the new one is complete", () => {
  withDir((dir) => {
    const target = join(dir, "f.pmtiles");
    writePmtilesFile(target, asFileTiles(tilesOf(5)), OPTIONS);
    const before = readFileSync(target);
    const bad = asFileTiles(tilesOf(5));
    bad[1]!.read = () => { throw new Error("boom"); };
    assert.throws(() => writePmtilesFile(target, bad, OPTIONS), /boom/);
    assert.ok(readFileSync(target).equals(before), "the old archive is untouched");
  });
});
