/**
 * E022 step 3: do the mesh seams show in the tiles? The Kawazu area is a 3 x 3 grid of meshes (400 m x 300 m, JGD2011 zone VIII; edges at
 * E 40,400 and 40,800 and at N -133,800 and -134,100). Built mesh by mesh (build:tileset + merge:tilesets), a voxel cut by a mesh edge is fitted in each mesh,
 * so splats double up there and each mesh places the same ground point up to ~1.8 m apart (E022). This counts, for the z17 splats of a tileset, along the four
 * interior mesh edges: splats per square meter by distance from the edge (1 m bins, relative to the level 8 to 14 m away), and an overlap index
 * (other splats within 0.25 m, 3D) in the strip next to the edge against the level 8 to 14 m away. A seam that shows as a ridge or a gap in the splat density
 * is a ratio far from 1; an even surface is near 1.
 *
 *   npm run measure:seam -- <tileset dir> [<tileset dir> ...]
 */
import { existsSync, readFileSync } from "node:fs";

import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";
import { fitAffine, planePointOfTileUnits } from "../src/geodesy/tile-frame.js";

const ZONE = 8;
// Interior mesh edges: [axis, value, from, to] (axis "e": the line E = value for N in from..to; axis "n": N = value for E in from..to).
const LINES: Array<["e" | "n", number, number, number]> = [["e", 40400, -134400, -133500], ["e", 40800, -134400, -133500], ["n", -133800, 40000, 41200], ["n", -134100, 40000, 41200]];
const BIN = 1, RANGE = 14, R = 0.25;

for (const dir of process.argv.slice(2)) {
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as { tiles: Array<{ z: number; x: number; y: number }> };
  const pts: Array<[number, number, number, number, number]> = []; // e, n, up, signed distance, line
  for (const t of manifest.tiles.filter((t) => t.z === 17)) {
    const path = `${dir}/17/${t.x}/${t.y}.mlt`;
    if (!existsSync(path)) continue;
    const [ce, cn] = planePointOfTileUnits(ZONE, 17, t.x + 0.5, t.y + 0.5);
    const f = fitAffine(ZONE, 17, ce, cn);
    const det = f.ue * f.vn - f.un * f.ve;
    for (const s of decodeSurfelTileWithLevels(new Uint8Array(readFileSync(path))).splats) {
      const du = t.x + s.x - f.u0, dv = t.y + s.y - f.v0;
      const e = f.e0 + (f.vn * du - f.un * dv) / det, n = f.n0 + (-f.ve * du + f.ue * dv) / det;
      LINES.forEach(([axis, value, from, to], li) => {
        const along = axis === "e" ? n : e, d = (axis === "e" ? e : n) - value;
        if (along >= from && along <= to && Math.abs(d) < RANGE) pts.push([e, n, s.z, d, li]);
      });
    }
  }
  // Density by distance, per line, relative to the far level.
  const bins = new Map<number, number>(); // bin -> count over all lines
  for (const p of pts) { const b = Math.floor(p[3] / BIN); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const far = [...bins].filter(([b]) => Math.abs(b + 0.5) >= 8).reduce((n, [, c]) => n + c, 0) / [...bins].filter(([b]) => Math.abs(b + 0.5) >= 8).length;
  // Overlap index.
  const H = 1, grid = new Map<string, number[]>();
  const key = (e: number, n: number, z: number) => `${Math.floor(e / H)},${Math.floor(n / H)},${Math.floor(z / H)}`;
  pts.forEach((p, i) => { const k = key(p[0], p[1], p[2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const near = (i: number): number => {
    const p = pts[i]!; let c = 0;
    const [a, b, d] = [Math.floor(p[0] / H), Math.floor(p[1] / H), Math.floor(p[2] / H)];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const j of grid.get(`${a + x},${b + y},${d + z}`) ?? []) {
      if (j !== i && Math.hypot(pts[j]![0] - p[0], pts[j]![1] - p[1], pts[j]![2] - p[2]) < R) c++;
    }
    return c;
  };
  const sums = { strip: [0, 0], far: [0, 0] };
  pts.forEach((p, i) => { const a = Math.abs(p[3]); const g = a < 1.5 ? sums.strip : a >= 8 ? sums.far : undefined; if (g) { g[0]! += near(i); g[1]!++; } });
  console.log(`${dir}: ${pts.length} splat-line pairs within ${RANGE} m of the four interior mesh edges`);
  console.table([...bins].sort((a, b) => a[0] - b[0]).filter(([b]) => Math.abs(b + 0.5) <= 6).map(([b, c]) => ({ "distance m": `${b}..${b + 1}`, splats: c, "ratio to far": +(c / far).toFixed(3) })));
  console.log(`overlap index (neighbors within ${R} m per splat): strip |d|<1.5 m ${(sums.strip[0] / sums.strip[1]).toFixed(3)} (${sums.strip[1]} splats), far |d|>=8 m ${(sums.far[0] / sums.far[1]).toFixed(3)} (${sums.far[1]} splats)`);
}
