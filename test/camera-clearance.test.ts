import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraPosition, pitchForClearance, type ClearanceView } from "../demo/src/camera-clearance.js";

const view: ClearanceView = { lng: 138.94, lat: 34.79, zoom: 20, pitch: 78, bearing: 90, heightPx: 800, centreElevation: 250 };

test("camera is behind and above the center", () => {
  const c = cameraPosition(view);
  assert.ok(c.lng < view.lng, "bearing 90 looks east, so the camera is west");
  assert.ok(c.altitude > view.centreElevation);
  assert.equal(cameraPosition({ ...view, pitch: 0 }).lng, view.lng);
});

test("pitch is kept where the clearance is enough", () => {
  assert.equal(pitchForClearance(view, () => 0, 5), 78);
  assert.equal(pitchForClearance(view, () => null, 5), 78);
});

test("pitch is lowered until the clearance is reached", () => {
  const ground = (): number => 300; // the camera at pitch 78 is 5 m above it
  const pitch = pitchForClearance({ ...view, centreElevation: 290 }, ground, 10);
  assert.ok(pitch < 78 && pitch > 0);
  const c = cameraPosition({ ...view, centreElevation: 290, pitch });
  assert.ok(c.altitude - ground() >= 10 - 1e-3);
  assert.ok(c.altitude - ground() < 10.5, "the largest such pitch, not much lower");
});

test("pitch 0 when no pitch gives the clearance", () => {
  assert.equal(pitchForClearance(view, () => 10_000, 5), 0);
});
