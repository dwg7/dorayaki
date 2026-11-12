import assert from "node:assert/strict";
import { test } from "node:test";

import { RADIUS_CELL_FACTOR, drawPlan, selectZoom } from "../demo/src/tile-selection.js";

test("selectZoom picks the deepest loaded zoom not deeper than the view", () => {
  const zs = [18, 19, 20, 20];
  assert.equal(selectZoom(zs, 16.2), 18);
  assert.equal(selectZoom(zs, 18.9), 18);
  assert.equal(selectZoom(zs, 19.0), 19);
  assert.equal(selectZoom(zs, 21.7), 20);
  assert.equal(selectZoom([18], 22), 18);
  assert.throws(() => selectZoom([], 18));
});

test("drawPlan draws a prefix of levels growing with the display zoom", () => {
  const t = { tile: { z: 20 }, levels: [10, 30, 60], widthMetres: 32 };
  assert.deepEqual(drawPlan(t, 20.4), { count: 10, levelsDrawn: 1, minRadius: RADIUS_CELL_FACTOR * (32 / 512) });
  assert.deepEqual(drawPlan(t, 21.0), { count: 40, levelsDrawn: 2, minRadius: RADIUS_CELL_FACTOR * (32 / 1024) });
  assert.deepEqual(drawPlan(t, 22.5), { count: 100, levelsDrawn: 3, minRadius: RADIUS_CELL_FACTOR * (32 / 2048) });
  assert.deepEqual(drawPlan(t, 25), drawPlan(t, 22.5)); // clamped to the level count
  assert.deepEqual(drawPlan(t, 18), drawPlan(t, 20.4)); // at least level 0
});

test("single-level tiles are drawn whole with their stored radii", () => {
  assert.deepEqual(drawPlan({ tile: { z: 18 }, levels: [123], widthMetres: 125 }, 19.5), { count: 123, levelsDrawn: 1, minRadius: 0 });
});
