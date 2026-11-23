import assert from "node:assert/strict";
import { test } from "node:test";

import { keepZoomAcrossPans, type PanZoomMap } from "../demo/src/pan-zoom-keeper.js";

type EventType = "dragstart" | "dragend" | "zoomstart" | "moveend";

/**
 * A map that keeps a zoom and records `easeTo` calls. Like MapLibre it fires `zoomstart` when an ease begins and
 * `moveend` when it ends (`finishEase`) or is stopped (`stopEase`); the zoom is already at the target when it ends.
 */
class FakeMap implements PanZoomMap {
  zoom: number;
  /** The zooms asked for by `easeTo`, and their durations. */
  jumps: number[] = [];
  durations: number[] = [];
  private easing: number | null = null;
  private listeners: Record<EventType, Array<() => void>> = { dragstart: [], dragend: [], zoomstart: [], moveend: [] };

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
  easeTo({ zoom, duration }: { zoom: number; duration: number }): void {
    this.jumps.push(zoom);
    this.durations.push(duration);
    this.easing = zoom;
    this.fire("zoomstart");
  }
  /** The ease in progress runs to its end. */
  finishEase(): void {
    assert.notEqual(this.easing, null, "no ease in progress");
    this.zoom = this.easing!;
    this.easing = null;
    this.fire("moveend");
  }
  /** The ease in progress is stopped half way (by the user starting something else). */
  stopEase(halfWay: number): void {
    this.zoom = halfWay;
    this.easing = null;
    this.fire("moveend");
  }
  /** A pan drag whose end leaves the map at `zoomAfter`, as MapLibre's re-solve over terrain does; any restore is run out. */
  panDrag(zoomAfter: number): void {
    this.fire("dragstart");
    this.fire("dragend");
    this.zoom = zoomAfter;
    this.fire("moveend");
    if (this.easing !== null) this.finishEase();
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
  map.fire("dragend");
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

test("the zoom is put back with an ease, not a jump", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.fire("dragstart");
  map.fire("dragend");
  map.zoom = 18.3;
  map.fire("moveend");
  assert.deepEqual(map.jumps, [17.72]);
  assert.ok(map.durations[0]! >= 200, "an ease long enough to be seen as one");
  assert.equal(map.getZoom(), 18.3, "the zoom is still MapLibre's until the ease runs");
  map.finishEase();
  assert.equal(map.getZoom(), 17.72);
  assert.deepEqual(map.jumps, [17.72], "the end of the ease does not start another");
});

test("a drag that interrupts the ease heads for the zoom the ease was heading for", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.fire("dragstart");
  map.fire("dragend");
  map.zoom = 18.3;
  map.fire("moveend");             // the ease towards 17.72 starts
  map.fire("dragstart");           // the user drags again, half way ...
  map.stopEase(18.0);              // ... which stops the ease at 18.0 (a moveend during the drag)
  assert.deepEqual(map.jumps, [17.72], "no new ease while the drag is under way");
  map.fire("dragend");
  map.zoom = 18.4;                 // MapLibre's re-solve at the end of this drag
  map.fire("moveend");
  assert.deepEqual(map.jumps, [17.72, 17.72]);
});

test("a zoom the user asks for during the ease is not undone afterwards", () => {
  const map = new FakeMap(17.72);
  keepZoomAcrossPans(map);
  map.fire("dragstart");
  map.fire("dragend");
  map.zoom = 18.3;
  map.fire("moveend");             // ease starts
  map.stopEase(19);                // the wheel stops it at the user's zoom
  assert.equal(map.getZoom(), 19);
  map.zoom = 18;
  map.fire("moveend");             // a later plain move
  assert.deepEqual(map.jumps, [17.72]);
});
