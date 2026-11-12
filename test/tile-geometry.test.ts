import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EARTH_CIRCUMFERENCE_METRES,
  tileLatitude,
  tileLongitude,
  tileWidthMetres,
} from "../src/tile-geometry.js";

const close = (a: number, b: number, eps: number): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("tile 0/0/0 spans the Web Mercator world", () => {
  const t = { z: 0, x: 0, y: 0 };
  assert.equal(tileLongitude(t, 0), -180);
  assert.equal(tileLongitude(t, 1), 180);
  close(tileLatitude(t, 0), 85.0511287798, 1e-9);
  close(tileLatitude(t, 0.5), 0, 1e-12);
  assert.equal(tileWidthMetres(t), EARTH_CIRCUMFERENCE_METRES);
});

test("tile width is the circumference scaled by cos(centre latitude) / 2^zoom", () => {
  const t = { z: 18, x: 232847, y: 103226 };
  const lat = (tileLatitude(t, 0.5) * Math.PI) / 180;
  close(tileWidthMetres(t), (EARTH_CIRCUMFERENCE_METRES / 2 ** 18) * Math.cos(lat), 1e-9);
  close(tileWidthMetres(t), 124.1756, 1e-4);
});
