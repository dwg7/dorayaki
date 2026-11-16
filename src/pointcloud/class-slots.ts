/**
 * Class slots of the tileset builder for the class plane (E021). The builder counts the points of a voxel by slot, the merge sums
 * them, and the dominant slot of a splat travels in its opacity byte until the tile is written; then it becomes a class code.
 *
 * Slots: LAS class 0..15 are their own slot; 16 = class 1 on a pulse with several returns (airborne canopy, code 64); 17 = any other
 * LAS class (16 and up, stored as code 1, unclassified).
 */
import { CLASS_DERIVED_CANOPY, CLASS_UNCLASSIFIED } from "../class-plane.js";

export const PLANE_CLASS_SLOTS = 18;
const SLOT_CANOPY = 16;
const SLOT_OTHER = 17;

/** The slot of a LAS point: its classification (0..31) and the raw return byte (bits 3-5: number of returns). */
export function planeClassSlot(classification: number, returnByte: number): number {
  if (classification === 1 && ((returnByte >> 3) & 7) > 1) return SLOT_CANOPY;
  return classification <= 15 ? classification : SLOT_OTHER;
}

/** The slot with the most points (the lowest on a tie) as an opacity, `slot / 255`: the opacity byte of the splat is then the slot. */
export function planeOpacityOf(counts: readonly number[]): number {
  let best = 0;
  counts.forEach((c, i) => { if (c > counts[best]!) best = i; });
  return best / 255;
}

/** The class code written to the plane for the slot a splat carries (its opacity byte). */
export function planeSlotToCode(slot: number): number {
  if (slot === SLOT_CANOPY) return CLASS_DERIVED_CANOPY;
  if (slot === SLOT_OTHER || slot >= PLANE_CLASS_SLOTS) return CLASS_UNCLASSIFIED;
  return slot;
}
