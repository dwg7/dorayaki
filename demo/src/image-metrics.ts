/**
 * Compare two software-rendered images of the same view (cpu-render.ts):
 * the reference (finer tiles) and a candidate (coarser or more merged tiles).
 * Pure functions on typed arrays.
 *
 * `holes`: share of the reference's covered pixels that the candidate leaves
 * empty. `extra`: candidate-covered pixels where the reference is empty,
 * relative to the reference's covered pixels. `mae`, `psnr`: colour error over
 * pixels both cover. `depthMedian`, `depthP95`: absolute difference of the
 * depths of those pixels, in metres. With `block` > 1 both images are first
 * reduced by averaging block x block pixels (a block counts as covered when at
 * least half its pixels are), which compares how the views look at a coarser
 * scale and ignores texture noise at pixel level.
 */
import type { Image } from "./cpu-render.js";

export interface ImageComparison {
  referencePixels: number;
  holes: number;
  extra: number;
  mae: number;
  psnr: number;
  depthMedian: number;
  depthP95: number;
}

export function downsample(image: Image, block: number): Image {
  if (block === 1) return image;
  const w = Math.floor(image.width / block);
  const h = Math.floor(image.height / block);
  const out: Image = { width: w, height: h, rgb: new Uint8Array(w * h * 3), depth: new Float32Array(w * h).fill(Infinity) };
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      let n = 0, r = 0, g = 0, b = 0, d = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const o = (by * block + y) * image.width + bx * block + x;
          if (image.depth[o] === Infinity) continue;
          n++;
          r += image.rgb[o * 3]!; g += image.rgb[o * 3 + 1]!; b += image.rgb[o * 3 + 2]!; d += image.depth[o]!;
        }
      }
      if (n * 2 < block * block) continue;
      const o = by * w + bx;
      out.rgb[o * 3] = Math.round(r / n); out.rgb[o * 3 + 1] = Math.round(g / n); out.rgb[o * 3 + 2] = Math.round(b / n);
      out.depth[o] = d / n;
    }
  }
  return out;
}

export function compareImages(reference: Image, candidate: Image, block = 1): ImageComparison {
  if (reference.width !== candidate.width || reference.height !== candidate.height) throw new RangeError("images differ in size");
  const a = downsample(reference, block);
  const c = downsample(candidate, block);
  let refPixels = 0, holes = 0, extra = 0, both = 0, abs = 0, sq = 0;
  const dd: number[] = [];
  for (let i = 0; i < a.depth.length; i++) {
    const inRef = a.depth[i] !== Infinity;
    const inCand = c.depth[i] !== Infinity;
    if (inRef) refPixels++;
    if (inRef && !inCand) holes++;
    else if (!inRef && inCand) extra++;
    else if (inRef && inCand) {
      both++;
      for (let k = 0; k < 3; k++) {
        const d = a.rgb[i * 3 + k]! - c.rgb[i * 3 + k]!;
        abs += Math.abs(d);
        sq += d * d;
      }
      dd.push(Math.abs(a.depth[i]! - c.depth[i]!));
    }
  }
  dd.sort((x, y) => x - y);
  const rmse = both > 0 ? Math.sqrt(sq / (both * 3)) : NaN;
  return {
    referencePixels: refPixels,
    holes: refPixels > 0 ? holes / refPixels : 0,
    extra: refPixels > 0 ? extra / refPixels : 0,
    mae: both > 0 ? abs / (both * 3) : NaN,
    psnr: rmse === 0 ? Infinity : 20 * Math.log10(255 / rmse),
    depthMedian: dd.length > 0 ? dd[Math.floor(dd.length / 2)]! : NaN,
    depthP95: dd.length > 0 ? dd[Math.min(dd.length - 1, Math.floor(dd.length * 0.95))]! : NaN,
  };
}
