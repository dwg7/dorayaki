import assert from "node:assert/strict";
import { test } from "node:test";

import { PMTiles, TileType, zxyToTileId as referenceTileId, type RangeResponse, type Source } from "pmtiles";

import { gzipSync } from "node:zlib";

import { PmtilesCompression, PmtilesTileType, writePmtiles, zxyToTileId } from "../src/pmtiles.js";

/** A pmtiles Source over bytes in memory, as a Range-capable server would serve them. */
class BytesSource implements Source {
  readonly reads: Array<[number, number]> = [];
  constructor(private readonly bytes: Uint8Array) {}
  getKey(): string { return "memory"; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.reads.push([offset, length]);
    const slice = this.bytes.slice(offset, offset + length);
    return { data: slice.buffer };
  }
}

test("tile IDs match the reference implementation", () => {
  const cases: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [2, 3, 1],
    [18, 234000, 96256], [20, 928618, 414861], [24, 12345678, 7654321], [26, 2 ** 26 - 1, 0]];
  for (const [z, x, y] of cases) assert.equal(zxyToTileId(z, x, y), referenceTileId(z, x, y), `${z}/${x}/${y}`);
  // Exhaustive at zoom 4.
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) assert.equal(zxyToTileId(4, x, y), referenceTileId(4, x, y));
  assert.throws(() => zxyToTileId(3, 8, 0), RangeError);
  assert.throws(() => zxyToTileId(27, 0, 0), RangeError);
});

test("the reference reader reads header, metadata and every tile of a written archive", async () => {
  const tiles = [
    { z: 18, x: 232154, y: 103715, data: Uint8Array.from([1, 2, 3]) },
    { z: 20, x: 928618, y: 414861, data: Uint8Array.from([9, 8, 7, 6, 5]) },
    { z: 19, x: 464309, y: 207430, data: new Uint8Array(1000).fill(42) },
    { z: 20, x: 928618, y: 414860, data: Uint8Array.from([0]) },
  ];
  const bytes = writePmtiles(tiles, {
    tileType: PmtilesTileType.Mlt,
    bounds: [138.8157, 35.1340, 138.8162, 35.1344],
    center: [138.81596, 35.13419, 20],
    metadata: { name: "test", attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY)", dorayaki: { maxzoom: 20 } },
  });
  const source = new BytesSource(bytes);
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  assert.equal(header.specVersion, 3);
  assert.equal(header.tileType, TileType.Mlt);
  assert.deepEqual([header.minZoom, header.maxZoom], [18, 20]);
  assert.equal(header.numAddressedTiles, 4);
  assert.equal(header.clustered, true);
  assert.ok(Math.abs(header.centerLon - 138.81596) < 1e-6);
  const metadata = (await archive.getMetadata()) as { attribution: string; dorayaki: { maxzoom: number } };
  assert.equal(metadata.attribution, "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY)");
  assert.equal(metadata.dorayaki.maxzoom, 20);
  for (const t of tiles) {
    const got = await archive.getZxy(t.z, t.x, t.y);
    assert.ok(got, `${t.z}/${t.x}/${t.y} missing`);
    assert.deepEqual(new Uint8Array(got.data), t.data);
  }
  assert.equal(await archive.getZxy(20, 928618, 414862), undefined);
});

test("writer rejects empty input and duplicate tiles", () => {
  const opts = { tileType: PmtilesTileType.Mlt, bounds: [0, 0, 1, 1] as [number, number, number, number], center: [0, 0, 0] as [number, number, number], metadata: {} };
  assert.throws(() => writePmtiles([], opts), RangeError);
  const t = { z: 1, x: 0, y: 0, data: new Uint8Array(1) };
  assert.throws(() => writePmtiles([t, { ...t }], opts), RangeError);
});

test("gzip-compressed directory and metadata read back with the reference reader", async () => {
  const tiles = [{ z: 20, x: 928618, y: 414861, data: Uint8Array.from([1, 2, 3, 4]) }, { z: 18, x: 232154, y: 103715, data: Uint8Array.from([5]) }];
  const bytes = writePmtiles(tiles, {
    tileType: PmtilesTileType.Mlt, bounds: [138, 35, 139, 36], center: [138.5, 35.5, 18],
    metadata: { attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY)" },
    internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
  });
  const archive = new PMTiles(new BytesSource(bytes));
  const header = await archive.getHeader();
  assert.equal(header.internalCompression, PmtilesCompression.Gzip);
  assert.equal(header.tileCompression, PmtilesCompression.None);
  assert.equal(((await archive.getMetadata()) as { attribution: string }).attribution, "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY)");
  for (const t of tiles) assert.deepEqual(new Uint8Array((await archive.getZxy(t.z, t.x, t.y))!.data), t.data);
});
