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

test("staged: the first delivery shows the next coarser zoom, then the target replaces it", async () => {
  const L = manualLoader();
  const ready: Array<[number, string[]]> = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, staged: true, onReady: (set, z) => ready.push([z, set.map((x) => x.data)]) });
  s.update(17.2, bothOf(A, B));
  assert.deepEqual([...L.calls].sort(), [key(A), key(B), key(C)].sort(), "both the target and the coarser tiles are requested");
  L.finish(C);
  await tick();
  assert.deepEqual(ready, [[16, [key(C)]]], "the coarser set is shown while the target loads");
  L.finish(A);
  await tick();
  assert.equal(ready.length, 1, "still waiting for B");
  L.finish(B);
  await tick();
  assert.deepEqual(ready[1], [17, [key(A), key(B)]]);
});

test("staged: nothing coarser is shown if the target arrives first, or after the first delivery", async () => {
  const L = manualLoader();
  const ready: number[] = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, staged: true, onReady: (_set, z) => ready.push(z) });
  s.update(17.2, bothOf(A, B));
  L.finish(A); L.finish(B);
  await tick();
  assert.deepEqual(ready, [17]);
  L.finish(C); // the coarse set completes late: not delivered
  await tick();
  assert.deepEqual(ready, [17]);
  // A later move to another zoom does not stage again (the layer already shows something).
  const calls = L.calls.length;
  s.update(16.2, around(C));
  assert.equal(L.calls.length, calls, "C is held, nothing new to load, and no coarser stage is requested");
});

test("staged: reset makes the next update stage again", async () => {
  const L = manualLoader();
  const ready: number[] = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, staged: true, onReady: (_set, z) => ready.push(z) });
  s.update(17.2, bothOf(A, B));
  L.finish(A); L.finish(B); L.finish(C);
  await tick();
  s.reset();
  s.update(17.2, bothOf(A, B));
  L.finish(C); // the reset dropped everything, so all three are loaded again; the coarse set arrives first
  await tick();
  L.finish(A); L.finish(B);
  await tick();
  assert.deepEqual(ready.slice(1), [16, 17], "after reset the coarse set is delivered first, then the target");
});

test("select: the streamer holds the tiles the selector returns, of mixed zooms, and reports the finest zoom", async () => {
  const L = manualLoader();
  const ready: Array<[number, string[]]> = [];
  const s = new TileStreamer<string>({
    candidates: [A, B, C], load: L.load,
    select: () => [A, C],
    onReady: (set, z) => ready.push([z, set.map((x) => x.data)]),
  });
  s.update(17.2, bothOf(A, B));
  assert.deepEqual([...L.calls].sort(), [key(A), key(C)].sort());
  L.finish(A); L.finish(C);
  await tick();
  assert.deepEqual(ready, [[17, [key(A), key(C)]]]);
});

test("select with staged: the first delivery comes from the selector capped one zoom lower", async () => {
  const L = manualLoader();
  const ready: Array<[number, string[]]> = [];
  const caps: Array<number | undefined> = [];
  const s = new TileStreamer<string>({
    candidates: [A, B, C], load: L.load, staged: true,
    select: (_z, _b, maxZoom) => { caps.push(maxZoom); return maxZoom === undefined ? [A, B] : [C]; },
    onReady: (set, z) => ready.push([z, set.map((x) => x.data)]),
  });
  s.update(17.2, bothOf(A, B));
  assert.deepEqual(caps, [undefined, 16]);
  L.finish(C);
  await tick();
  assert.deepEqual(ready, [[16, [key(C)]]]);
  L.finish(A); L.finish(B);
  await tick();
  assert.deepEqual(ready[1], [17, [key(A), key(B)]]);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("progressive: tiles that have arrived are shown before the set is complete; the old tile stays where the new one is still on its way", async () => {
  const L = manualLoader();
  const ready: string[][] = [];
  const D = { z: 17, x: 0, y: 1 }; // C (z16 0/0) covers A and D
  const s = new TileStreamer<string>({ candidates: [A, D, C], load: L.load, onReady: (set) => ready.push(set.map((x) => x.data).sort()), progressive: 5 });
  s.update(16.5, around(A));
  L.finish(C);
  await tick();
  assert.deepEqual(ready, [[key(C)]]);
  s.update(17.2, bothOf(D, A)); // now D and A
  L.finish(A);
  await wait(20);
  assert.deepEqual(ready.at(-1), [key(A), key(C)].sort(), "A shown; C kept because D, which it covers, has not arrived");
  L.finish(D);
  await tick();
  assert.deepEqual(ready.at(-1), [key(A), key(D)].sort(), "complete: C is gone");
});

test("progressive is off by default: nothing is shown until the set is complete", async () => {
  const L = manualLoader();
  const ready: string[][] = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, onReady: (set) => ready.push(set.map((x) => x.data)) });
  s.update(17.2, bothOf(A, B));
  L.finish(A);
  await wait(20);
  assert.deepEqual(ready, []);
});

test("cache: a tile that left the set is found again without loading it; prefetch loads ahead without showing", async () => {
  const L = manualLoader();
  const ready: string[][] = [];
  const s = new TileStreamer<string>({ candidates: [A, B, C], load: L.load, onReady: (set) => ready.push(set.map((x) => x.data)), cache: 8 });
  assert.equal(s.prefetch([B, B]), 1, "one load, not two");
  L.finish(B);
  await tick();
  assert.deepEqual(ready, [], "a prefetch shows nothing");
  s.update(17.2, around(A));
  L.finish(A);
  await tick();
  s.update(17.2, around(B)); // B came from the prefetch: no new load
  await tick();
  assert.deepEqual(ready.at(-1), [key(B)]);
  s.update(17.2, around(A)); // A left the set and is in the cache
  await tick();
  assert.deepEqual(ready.at(-1), [key(A)]);
  assert.equal(L.calls.filter((c) => c === key(A)).length, 1);
  assert.equal(L.calls.filter((c) => c === key(B)).length, 1);
  assert.equal(s.prefetch([A, B]), 0, "nothing new to load");
});
