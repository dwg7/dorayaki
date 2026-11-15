import assert from "node:assert/strict";
import { test } from "node:test";

import { TileStreamer, type StreamedTile } from "../demo/src/tile-streamer.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../src/tile-geometry.js";

const key = (t: TileAddress) => `${t.z}/${t.x}/${t.y}`;
const around = (t: TileAddress): [number, number, number, number] => [tileLongitude(t, 0.1), tileLatitude(t, 0.9), tileLongitude(t, 0.9), tileLatitude(t, 0.1)];
const bothOf = (a: TileAddress, b: TileAddress): [number, number, number, number] => [tileLongitude(a, 0.1), tileLatitude(b, 0.9), tileLongitude(b, 0.9), tileLatitude(a, 0.1)];

/** A loader whose promises the test resolves by hand. */
function manualLoader() {
  const calls: string[] = [];
  const waiting = new Map<string, (v: string | null) => void>();
  const load = (t: TileAddress) => new Promise<string | null>((resolve) => { calls.push(key(t)); waiting.set(key(t), resolve); });
  return { calls, load, finish: (t: TileAddress, v: string | null = key(t)) => waiting.get(key(t))!(v) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const A = { z: 17, x: 1, y: 1 }, B = { z: 17, x: 2, y: 1 }, C = { z: 16, x: 0, y: 0 };

test("hands over the whole set once every tile has arrived, skipping missing tiles", async () => {
  const L = manualLoader();
  const ready: string[][] = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, onReady: (set) => ready.push(set.map((x) => x.data)) });
  s.update(17.2, [tileLongitude(A, 0.1), tileLatitude(B, 0.9), tileLongitude(B, 0.9), tileLatitude(A, 0.1)]);
  assert.deepEqual(L.calls, [key(A), key(B)].sort((x, y) => L.calls.indexOf(x) - L.calls.indexOf(y)));
  L.finish(A);
  await tick();
  assert.deepEqual(ready, [], "not ready while B is outstanding");
  L.finish(B, null); // B does not exist
  await tick();
  assert.deepEqual(ready, [[key(A)]]);
});

test("a newer request supersedes the older one and reuses tiles in flight and held", async () => {
  const L = manualLoader();
  const ready: Array<{ zoom: number; tiles: string[] }> = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, onReady: (set, zoom) => ready.push({ zoom, tiles: set.map((x: StreamedTile<string>) => x.data) }) });
  s.update(17, around(A));          // wants A
  s.update(17, bothOf(A, B));       // wants A and B; A is already in flight
  assert.deepEqual([...L.calls].sort(), [key(A), key(B)].sort(), "A is requested once");
  L.finish(A); L.finish(B);
  await tick();
  assert.equal(ready.length, 1);
  assert.deepEqual([...ready[0]!.tiles].sort(), [key(A), key(B)].sort());
  // The same view again changes nothing.
  s.update(17, bothOf(A, B));
  assert.equal(L.calls.length, 2);
  // Zooming out selects z16: only C is fetched; A and B are dropped from the set.
  s.update(16.4, around(C));
  assert.equal(L.calls.length, 3);
  L.finish(C);
  await tick();
  assert.deepEqual(ready[1], { zoom: 16, tiles: [key(C)] });
});

test("reports progress while tiles arrive", async () => {
  const L = manualLoader();
  const seen: string[] = [];
  const s = new TileStreamer<string>({ candidates: [A, B], load: L.load, onReady: () => seen.push("ready"), onProgress: (p) => seen.push(`${p.done}/${p.wanted}`) });
  s.update(17, bothOf(A, B));
  L.finish(A);
  await tick();
  L.finish(B);
  await tick();
  assert.deepEqual(seen, ["0/2", "1/2", "2/2", "ready"]);
});

test("reset forgets the held tiles so the next update loads them again", async () => {
  const L = manualLoader();
  const ready: number[] = [];
  const s = new TileStreamer<string>({ candidates: [A], load: L.load, onReady: (set) => ready.push(set.length) });
  s.update(17, around(A));
  L.finish(A);
  await tick();
  assert.deepEqual(ready, [1]);
  s.update(17, around(A)); // unchanged: nothing happens
  assert.equal(L.calls.length, 1);
  s.reset();
  s.update(17, around(A)); // after a reset the same view loads again
  assert.equal(L.calls.length, 2);
  L.finish(A);
  await tick();
  assert.deepEqual(ready, [1, 1]);
});
