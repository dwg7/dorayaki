import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_LIFT, terrainLift } from "../demo/src/terrain-lift.js";

test("no lift at or above zoom 15", () => {
  assert.equal(terrainLift(15), 0);
  assert.equal(terrainLift(17.5), 0);
});

test("lift grows linearly below zoom 15 and is about 21 m at 12.7", () => {
  assert.ok(terrainLift(14.5) > 0 && terrainLift(14.5) < 5);
  assert.ok(Math.abs(terrainLift(12.7) - 20.7) < 0.1);
  assert.ok(terrainLift(12) > terrainLift(13));
});

test("lift is capped", () => {
  assert.equal(terrainLift(0), MAX_LIFT);
  assert.equal(terrainLift(-2), MAX_LIFT);
});

test("a non-number zoom does not lift the splats", () => {
  assert.equal(terrainLift(NaN), 0);
});
