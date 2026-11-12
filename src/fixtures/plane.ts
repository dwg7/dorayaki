import type { Surfel } from "../surfel-block.js";

export interface PlaneOptions {
  /** Surfels per side; the plane has `gridSize * gridSize` surfels. */
  gridSize?: number;
}

/**
 * Deterministic `plane` fixture: a horizontal plane at z = 0.
 *
 * Coordinates are in an abstract local frame: x and y cover the unit
 * square [0, 1] (surfel centres at cell centres of a gridSize × gridSize
 * grid), z = 0, all normals point up (0, 0, 1). The radius is half the
 * cell diagonal, so neighbouring discs overlap and cover the square.
 *
 * Colour is a gradient: r follows x, g follows y, b = 128, a = 255.
 * No randomness is used. Every float is float32-exact, so the fixture
 * survives an encode/decode round trip with strict equality.
 */
export function generatePlane(options: PlaneOptions = {}): Surfel[] {
  const n = options.gridSize ?? 16;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`gridSize must be a positive integer, got ${n}`);
  }
  const cell = 1 / n;
  const radius = Math.fround(cell * Math.SQRT1_2);
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
