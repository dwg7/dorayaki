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
 * rises with the ground. A zoom the user asks for during the drag (`zoomstart`: wheel, pinch, double click) is kept.
 * It is a workaround in the demo, not a change to MapLibre.
 */

/** The part of a MapLibre map this needs. */
export interface PanZoomMap {
  on(type: "dragstart" | "zoomstart" | "moveend", listener: () => void): unknown;
  off(type: "dragstart" | "zoomstart" | "moveend", listener: () => void): unknown;
  getZoom(): number;
  jumpTo(options: { zoom: number }): unknown;
}

/** A zoom difference below this is rounding, not a change. */
export const ZOOM_TOLERANCE = 1e-6;

/**
 * Starts keeping the zoom across pan drags on `map`.
 * @returns a function that stops it
 */
export function keepZoomAcrossPans(map: PanZoomMap): () => void {
  /** The zoom when the pan drag under way started; null when no drag is under way or the user zoomed during it. */
  let zoomAtDragStart: number | null = null;
  /** True while this puts the zoom back, so that the events of its own `jumpTo` are not taken for the user's. */
  let restoring = false;

  const onDragStart = (): void => {
    zoomAtDragStart = map.getZoom();
  };
  const onZoomStart = (): void => {
    if (!restoring) zoomAtDragStart = null;
  };
  const onMoveEnd = (): void => {
    if (restoring || zoomAtDragStart === null) return;
    const zoom = zoomAtDragStart;
    zoomAtDragStart = null;
    if (Math.abs(map.getZoom() - zoom) < ZOOM_TOLERANCE) return;
    restoring = true;
    try {
      map.jumpTo({ zoom });
    } finally {
      restoring = false;
    }
  };

  map.on("dragstart", onDragStart);
  map.on("zoomstart", onZoomStart);
  map.on("moveend", onMoveEnd);
  return () => {
    map.off("dragstart", onDragStart);
    map.off("zoomstart", onZoomStart);
    map.off("moveend", onMoveEnd);
  };
}
