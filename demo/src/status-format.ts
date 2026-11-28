/**
 * The panel's status figures in a bounded width, so the panel keeps its size while a tour plays (the old free-text line
 * grew and shrank with every set, and the panel flickered). No DOM here: the cells are laid out by main.ts in a grid with
 * tabular figures.
 */

/** Megabytes with one decimal: "21.9 MB". At most 8 characters up to 9,999.9 MB. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Splat counts in three significant figures or so: "842", "35.1 k", "1.83 M". At most 7 characters below 1,000 M. */
export function formatSplats(n: number): string {
  if (n < 1e3) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e5 ? 1 : 0)} k`;
  return `${(n / 1e6).toFixed(n < 1e8 ? 2 : 0)} M`;
}

/** Tile counts: "15 tiles", "1 tile". */
export function formatTiles(n: number): string {
  return `${n} ${n === 1 ? "tile" : "tiles"}`;
}
