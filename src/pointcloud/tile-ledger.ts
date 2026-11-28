/**
 * D26: a work area that grows. Sheets are scattered as they arrive into one work area for the whole prefecture; a z17 tile is built
 * from the shard files (one per sheet) in its shard directory. When a later sheet adds a shard file to a tile that was already built,
 * that tile must be built again, and its pieces of the lower zooms replaced; the lower zooms are gathered again from all pieces.
 * A tile's marker records the shard files it was built from (`sources`); a tile is stale when its shard directory now holds a file
 * that is not among them. Markers written before `sources` existed fall back to modification times. No file access here.
 */

/** Whether a built tile must be built again: its shard files now include one it was not built from. */
export function isStale(shardFiles: readonly string[], marker: { sources?: readonly string[] } | undefined, newestShardMs: number, markerMs: number): boolean {
  if (!marker) return true; // never built
  if (marker.sources) {
    const had = new Set(marker.sources);
    return shardFiles.some((f) => !had.has(f));
  }
  return newestShardMs > markerMs;
}

/** The pieces a z17 tile contributes to its ancestors: `pieces/<z>/<X>/<Y>/<x>_<y>.f64.gz` for each lower zoom. */
export function piecePaths(x: number, y: number, lowerZooms: readonly number[], tileZoom = 17): string[] {
  return lowerZooms.map((z) => {
    const d = tileZoom - z;
    return `pieces/${z}/${x >> d}/${y >> d}/${x}_${y}.f64.gz`;
  });
}
