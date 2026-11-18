import assert from "node:assert/strict";
import { test } from "node:test";

import { keepZoomAcrossPans, type PanZoomMap } from "../demo/src/pan-zoom-keeper.js";

type EventType = "dragstart" | "zoomstart" | "moveend";

/** A map that keeps a zoom, counts `jumpTo` calls and fires `zoomstart` and `moveend` from `jumpTo`, as MapLibre does. */
class FakeMap implements PanZoomMap {
  zoom: number;
  jumps: number[] = [];
  private listeners: Record<EventType, Array<() => void>> = { dragstart: [], zoomstart: [], moveend: [] };

  constructor(zoom: number) {
    this.zoom = zoom;
  }
  on(type: EventType, listener: () => void): void {
    this.listeners[type].push(listener);
  }
  off(type: EventType, listener: () => void): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }
  fire(type: EventType): void {
    for (const listener of [...this.listeners[type]]) listener();
  }
  getZoom(): number {
    return this.zoom;
  }
  jumpTo({ zoom }: { zoom: number }): void {
    this.jumps.push(zoom);
    this.zoom = zoom;
    this.fire("zoomstart");
    this.fire("moveend");
  }
  /** A pan drag whose end leaves the map at `zoomAfter`, as MapLibre's re-solve over terrain does. */
  panDrag(zoomAfter: number): void {
    this.fire("dragstart");
    this.zoom = zoomAfter;
    this.fire("moveend");
  }
}

test("a pan drag that ends at another zoom is put back to the zoom it started at", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.panDrag(17.373);
  assert.deepEqual(map.jumps, [17.72]);
  assert.equal(map.getZoom(), 17.72);
});

test("eight pan drags toward higher ground keep the zoom", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  for (const after of [17.373, 18.048, 18.091, 18.371, 18.448, 18.299, 19.073, 18.831]) map.panDrag(after);
  assert.equal(map.getZoom(), 17.72);
  assert.equal(map.jumps.length, 8);
});

test("a pan drag that ends at the zoom it started at is left alone", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.panDrag(17.72);
  assert.deepEqual(map.jumps, []);
});

test("a zoom the user asks for during the drag is kept", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.fire("dragstart");
  map.fire("zoomstart");
  map.zoom = 19;
  map.fire("moveend");
  assert.deepEqual(map.jumps, []);
  assert.equal(map.getZoom(), 19);
});

test("a move that is not a pan drag keeps its zoom", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.zoom = 16;
  map.fire("moveend");
  assert.deepEqual(map.jumps, []);
});

test("the zoom of one drag is not applied to a later move", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.panDrag(17.373);
  map.zoom = 15;
  map.fire("moveend");
  assert.deepEqual(map.jumps, [17.72]);
  assert.equal(map.getZoom(), 15);
});

test("stopping it leaves the map as MapLibre moves it", () => {
  const map = new FakeMap(17.72);
  const stop = keepZoomAcrossPans(map);
  stop();
  map.panDrag(17.373);
  assert.deepEqual(map.jumps, []);
  assert.equal(map.getZoom(), 17.373);
});
