import { test } from "node:test";
import assert from "node:assert/strict";
import { inheritPendingData, type TileData } from "../demo/src/pending-tiles.js";

const at = (z: number, x: number, y: number): { z: number; x: number; y: number } => ({ z, x, y });

test("a tile that comes without data takes the data of the unapplied set", () => {
  const first: TileData[] = [{ tile: at(16, 1, 1), packed: { n: 1 }, classes: new Uint8Array(1) }];
  const second: TileData[] = [{ tile: at(16, 1, 1) }, { tile: at(17, 2, 2), packed: { n: 2 } }];
  const out = inheritPendingData(first, second);
  assert.deepEqual(out[0]!.packed, { n: 1 });
  assert.ok(out[0]!.classes);
  assert.deepEqual(out[1]!.packed, { n: 2 });
});

test("a tile with its own data is left as it is, and a tile that was not pending stays empty", () => {
  const first: TileData[] = [{ tile: at(16, 1, 1), packed: { n: 1 } }];
  const second: TileData[] = [{ tile: at(16, 1, 1), packed: { n: 9 } }, { tile: at(16, 5, 5) }];
  const out = inheritPendingData(first, second);
  assert.deepEqual(out[0]!.packed, { n: 9 });
  assert.equal(out[1]!.packed, undefined);
});
