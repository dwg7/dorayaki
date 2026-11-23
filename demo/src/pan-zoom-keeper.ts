/**
 * Keeps the map's zoom across a pan drag over terrain. No DOM or WebGL here.
 *
 * With terrain on, MapLibre GL JS (observed with 6.16.0) holds the center's elevation during a pan drag and, when the
 * drag ends, moves the center onto the terrain with the camera left where it is. The camera therefore keeps its
 * height above sea level, not above the ground: panning toward higher ground brings it down onto the slope, and the
 * zoom rises with each drag until it reaches the maximum (NOTES.md, 2026-11-17). The zoom changes between `dragend`
 * and `moveend`, with no `zoomstart`.
 *
 * This puts the zoom back to what it was when the drag started, so the camera keeps its distance to the center and
 * rises with the ground. It does so with a short ease, not a jump: a jump read as a lurch right after the drag. A
 * zoom the user asks for during the drag (`zoomstart`: wheel, pinch, double click) is kept, and a new drag or zoom
 * during the ease stops it where it is. It is a workaround in the demo, not a change to MapLibre.
 */

/** The part of a MapLibre map this needs. */
export interface PanZoomMap {
  on(type: "dragstart" | "dragend" | "zoomstart" | "moveend", listener: () => void): unknown;
  off(type: "dragstart" | "dragend" | "zoomstart" | "moveend", listener: () => void): unknown;
  getZoom(): number;
  easeTo(options: { zoom: number; duration: number }): unknown;
}

/** A zoom difference below this is rounding, not a change. */
export const ZOOM_TOLERANCE = 1e-6;

/** Milliseconds the zoom takes to return: slow enough to read as a camera drift, not a lurch (450 ms was tried first). */
export const RESTORE_DURATION_MS = 1500;

/**
 * Starts keeping the zoom across pan drags on `map`.
 * @returns a function that stops it
 */
export function keepZoomAcrossPans(map: PanZoomMap, duration = RESTORE_DURATION_MS): () => void {
  /** The zoom when the pan drag under way started; null when no drag is under way or the user zoomed during it. */
  let zoomAtDragStart: number | null = null;
  /** The zoom the ease in progress is heading for; null when none is. The events of that ease are not the user's. */
  let restoringTo: number | null = null;

  /** Whether a drag is under way: a `moveend` then is the end of something it interrupted, not of the drag. */
  let dragging = false;

  const onDragStart = (): void => {
    dragging = true;
    // A drag that interrupts the ease keeps the zoom the ease was heading for, not the half-way value.
    zoomAtDragStart = restoringTo ?? map.getZoom();
    restoringTo = null;
  };
  const onDragEnd = (): void => {
    dragging = false;
  };
  const onZoomStart = (): void => {
    if (restoringTo === null) zoomAtDragStart = null;
  };
  const onMoveEnd = (): void => {
    if (dragging) return;
    if (restoringTo !== null) { restoringTo = null; return; } // the ease ended (or was stopped by the user)
    if (zoomAtDragStart === null) return;
    const zoom = zoomAtDragStart;
    zoomAtDragStart = null;
    if (Math.abs(map.getZoom() - zoom) < ZOOM_TOLERANCE) return;
    restoringTo = zoom;
    map.easeTo({ zoom, duration });
  };

  map.on("dragstart", onDragStart);
  map.on("dragend", onDragEnd);
  map.on("zoomstart", onZoomStart);
  map.on("moveend", onMoveEnd);
  return () => {
    map.off("dragstart", onDragStart);
    map.off("dragend", onDragEnd);
    map.off("zoomstart", onZoomStart);
    map.off("moveend", onMoveEnd);
  };
}
