import type { Surfel } from "../surfel-block.js";

export interface PlaneOptions {
  /** Width in metres of the tile that will carry the plane (see tileWidthMetres). */
  tileWidthMetres: number;
  /** Surfels per side; the plane has `gridSize * gridSize` surfels. */
  gridSize?: number;
}

/**
 * Deterministic `plane` fixture: a horizontal plane at z = 0.
 *
 * Surfel Block v2 frame: x and y cover the tile [0, 1] (surfel centres at
 * cell centres of a gridSize × gridSize grid), z = 0 m, all normals point
 * up (0, 0, 1). The radius, in metres, is half the cell diagonal, so
 * neighbouring discs overlap and cover the tile. Because radius is metric,
 * the fixture depends on the width of the tile that carries it.
 *
 * Colour is a gradient: r follows x, g follows y, b = 128, a = 255.
 * No randomness is used. Every float is float32-exact, so the fixture
 * survives an encode/decode round trip with strict equality.
 */
export function generatePlane(options: PlaneOptions): Surfel[] {
  const n = options.gridSize ?? 16;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`gridSize must be a positive integer, got ${n}`);
  }
  const w = options.tileWidthMetres;
  if (!Number.isFinite(w) || w <= 0) {
    throw new RangeError(`tileWidthMetres must be a positive finite number, got ${w}`);
  }
  const cell = 1 / n;
  const radius = Math.fround(w * cell * Math.SQRT1_2);
  const channel = (i: number): number => (n === 1 ? 0 : Math.round((i * 255) / (n - 1)));

  const surfels: Surfel[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      surfels.push({
        x: Math.fround((i + 0.5) * cell),
        y: Math.fround((j + 0.5) * cell),
        z: 0,
        nx: 0,
        ny: 0,
        nz: 1,
        radius,
        r: channel(i),
        g: channel(j),
        b: 128,
        a: 255,
      });
    }
  }
  return surfels;
}
