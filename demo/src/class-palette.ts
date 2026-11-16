/**
 * Colours and names of the class codes (src/class-plane.ts) for the "colour by class" view (E021): vivid, close to the usual LAS
 * point class palettes (ground brown to orange, vegetation greens, buildings red, water blue, ...), made saturated so that the
 * classes are told apart at a glance, like a false-colour satellite image. No DOM or WebGL here.
 */
export interface ClassStyle { name: string; rgb: [number, number, number] }

/** Palette slot of a class code in the shader: codes 0 to 30 are their own slot, 64 and above share slot 31 (see classIndex in gpu-surfels.ts). */
export const CLASS_PALETTE_SLOTS = 32;

const STYLES = new Map<number, ClassStyle>([
  [0, { name: "never classified", rgb: [120, 120, 130] }],
  [1, { name: "unclassified", rgb: [200, 200, 210] }],
  [2, { name: "ground", rgb: [255, 150, 0] }],
  [3, { name: "low vegetation", rgb: [190, 255, 0] }],
  [4, { name: "medium vegetation", rgb: [0, 255, 90] }],
  [5, { name: "high vegetation", rgb: [0, 170, 70] }],
  [6, { name: "building", rgb: [255, 40, 60] }],
  [7, { name: "low point (noise)", rgb: [255, 0, 255] }],
  [9, { name: "water", rgb: [0, 120, 255] }],
  [10, { name: "rail", rgb: [255, 255, 255] }],
  [11, { name: "road surface", rgb: [255, 235, 0] }],
  [13, { name: "wire guard", rgb: [0, 255, 255] }],
  [17, { name: "bridge deck", rgb: [200, 60, 255] }],
  [64, { name: "canopy (several returns)", rgb: [0, 220, 170] }],
]);
const UNKNOWN: ClassStyle = { name: "other", rgb: [255, 0, 200] };

export const classStyle = (code: number): ClassStyle => STYLES.get(code) ?? UNKNOWN;

/** Slot of a class code in the palette array: codes 0 to 30 map to themselves, 31 and above (64 and up) to slot 31. */
export const classSlotOf = (code: number): number => (code >= 64 ? 31 : Math.min(code, 30));

/** The palette as 32 rgb triples in 0..1, indexed by classSlotOf. */
export function classPaletteArray(): Float32Array {
  const out = new Float32Array(CLASS_PALETTE_SLOTS * 3);
  for (let slot = 0; slot < CLASS_PALETTE_SLOTS; slot++) {
    const code = slot === 31 ? 64 : slot;
    const [r, g, b] = classStyle(code).rgb;
    out.set([r / 255, g / 255, b / 255], slot * 3);
  }
  return out;
}
