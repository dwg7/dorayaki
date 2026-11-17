import assert from "node:assert/strict";
import { test } from "node:test";

import { renderTiles, type View } from "../demo/src/cpu-render.js";
import { compareImages } from "../demo/src/image-metrics.js";
import { splatInstances } from "../demo/src/splat-instances.js";
import type { Splat } from "../src/surfel-block.js";

const tile = { z: 17, x: 116122, y: 52009 };
// The view centre at the tile's centre: Mercator of tile centre.
const lng = ((tile.x + 0.5) / 2 ** tile.z) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / 2 ** tile.z))) * 180) / Math.PI;
const view: View = { lng, lat, zoom: 19, bearing: 0, pitch: 0, width: 200, height: 160, centreZ: 100 };

/** A horizontal grid of flat splats (normal up) covering the tile's middle. */
function plane(step: number, color: [number, number, number], z = 100): Splat[] {
  const out: Splat[] = [];
  const widthM = 250; // about; the grid spans +-20 m around the centre
  for (let e = -20; e <= 20; e += step) for (let n = -20; n <= 20; n += step) {
    out.push({ x: 0.5 + e / widthM, y: 0.5 - n / widthM, z, sx: 0.4, sy: 0.4, sz: 0.01, qw: 1, qx: 0, qy: 0, qz: 0, r: color[0], g: color[1], b: color[2], a: 255 });
  }
  return out;
}

test("a plane seen from above covers the centre in its color at the stated depth", () => {
  const img = renderTiles([{ tile, instances: splatInstances(plane(1, [200, 100, 50])) }], view);
  const o = (80 * 200 + 100);
  assert.notEqual(img.depth[o], Infinity);
  assert.deepEqual([img.rgb[o * 3], img.rgb[o * 3 + 1], img.rgb[o * 3 + 2]], [200, 100, 50]);
  // The camera is far above z = 100; the depth is the distance to the plane.
  assert.ok(img.depth[o]! > 10 && Number.isFinite(img.depth[o]!));
});

test("identical renderings compare as equal", () => {
  const a = renderTiles([{ tile, instances: splatInstances(plane(1, [10, 20, 30])) }], view);
  const r = compareImages(a, a);
  assert.equal(r.holes, 0);
  assert.equal(r.extra, 0);
  assert.equal(r.mae, 0);
  assert.equal(r.psnr, Infinity);
  assert.equal(r.depthMedian, 0);
});

test("a sparser candidate leaves holes; a different color raises the error; a raised plane shows in depth", () => {
  const ref = renderTiles([{ tile, instances: splatInstances(plane(1, [100, 100, 100])) }], view);
  const sparse = renderTiles([{ tile, instances: splatInstances(plane(4, [100, 100, 100])) }], view);
  assert.ok(compareImages(ref, sparse).holes > 0.3);
  const other = renderTiles([{ tile, instances: splatInstances(plane(1, [130, 100, 100])) }], view);
  const c = compareImages(ref, other);
  assert.equal(c.holes, 0);
  assert.ok(Math.abs(c.mae - 10) < 0.01, `mae ${c.mae}`);
  const raised = renderTiles([{ tile, instances: splatInstances(plane(1, [100, 100, 100], 103)) }], view);
  assert.ok(Math.abs(compareImages(ref, raised).depthMedian - 3) < 0.05);
});

test("block comparison ignores one-pixel gaps", () => {
  const ref = renderTiles([{ tile, instances: splatInstances(plane(1, [100, 100, 100])) }], view);
  const fine = renderTiles([{ tile, instances: splatInstances(plane(1.2, [100, 100, 100])) }], view);
  assert.ok(compareImages(ref, fine, 4).holes <= compareImages(ref, fine, 1).holes);
});
