/**
 * A guess at which splats are vegetation, from the splats alone (E019). The tiles carry no classification, so this is a
 * heuristic: a splat is vegetation when it is well above the local ground and not part of a flat surface.
 *
 * Local ground: the tile is cut into cells of about `cellMetres`; the ground of a cell is the lowest splat in it and
 * its eight neighbours (airborne laser pulses that go through a canopy reach the ground, so the lowest splat under
 * trees is the ground; a cell with no ground splat borrows from the neighbours). A splat is above ground by its height
 * minus that. Vegetation: above ground by more than `minHeight` metres and (unless `roundOnly` is false) roughly
 * round or thick: its largest scale is less than 1.5 times its smallest, the test that draws a splat as a camera-facing
 * disc. A bridge deck, a wall or a roof is flat and stays; a tree crown is a blob and goes. Near tile edges the ground
 * is the lowest splat of the tile's own cells only, so a cell next to the edge can be wrong.
 */
import { readBits, RECORD_FIELDS, SCALE_STEPS_PER_OCTAVE, SURFEL_RECORD_BYTES } from "../../src/surfel-block.js";

export interface VegetationOptions {
  /** Cell size of the ground estimate, metres (default 4). */
  cellMetres?: number;
  /** Height above the local ground from which a splat may be vegetation, metres (default 2). */
  minHeight?: number;
  /** Only round splats count as vegetation (default true); false: anything above `minHeight` does. */
  roundOnly?: boolean;
}

export interface PackedForVegetation {
  count: number;
  records: Uint8Array;
  zOrigin: number;
  zStep: number;
}

export function vegetationFlags(block: PackedForVegetation, tileWidthMetres: number, options: VegetationOptions = {}): Uint8Array {
  const { count, records: r } = block;
  const cellMetres = options.cellMetres ?? 4;
  const minHeight = options.minHeight ?? 2;
  const roundOnly = options.roundOnly ?? true;
  const n = Math.max(1, Math.min(256, Math.round(tileWidthMetres / cellMetres)));
  const flags = new Uint8Array(count);
  if (count === 0) return flags;

  // Fields of every splat: cell, height, roundness.
  const cell = new Int32Array(count);
  const z = new Float32Array(count);
  const round = new Uint8Array(count);
  const F = RECORD_FIELDS;
  const roundDiff = Math.floor(Math.log2(1.5) * SCALE_STEPS_PER_OCTAVE + 1e-9); // a ratio below 1.5: 3 codes at 6 steps per octave
  for (let i = 0; i < count; i++) {
    const o = i * SURFEL_RECORD_BYTES;
    const x = readBits(r, o, F.x.off, F.x.len) / 2 ** F.x.len;
    const y = readBits(r, o, F.y.off, F.y.len) / 2 ** F.y.len;
    const zu = readBits(r, o, F.z.off, F.z.len);
    const c0 = readBits(r, o, F.sx.off, F.sx.len), c1 = readBits(r, o, F.sy.off, F.sy.len), c2 = readBits(r, o, F.sz.off, F.sz.len);
    cell[i] = Math.min(n - 1, Math.floor(y * n)) * n + Math.min(n - 1, Math.floor(x * n));
    z[i] = block.zOrigin + zu * block.zStep;
    round[i] = Math.max(c0, c1, c2) - Math.min(c0, c1, c2) <= roundDiff ? 1 : 0;
  }

  const low = new Float32Array(n * n).fill(Infinity);
  for (let i = 0; i < count; i++) if (z[i]! < low[cell[i]!]!) low[cell[i]!] = z[i]!;
  const ground = new Float32Array(n * n).fill(Infinity);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let g = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < n && ny >= 0 && ny < n) g = Math.min(g, low[ny * n + nx]!);
      }
      ground[cy * n + cx] = g;
    }
  }
  for (let i = 0; i < count; i++) {
    const above = z[i]! - ground[cell[i]!]!;
    if (above > minHeight && (!roundOnly || round[i] === 1)) flags[i] = 1;
  }
  return flags;
}
