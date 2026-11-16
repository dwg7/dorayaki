/**
 * E022: how far apart does the build put the same ground point when two neighbouring meshes are built on their own? Each mesh is placed in
 * a flat east/north frame around its own centre (src/gaussian/to-surfels.ts placeGaussians), which ignores that grid north of the plane
 * rectangular system differs from true north (the meridian convergence, 0.25 degrees at Kawazu). This places one plane point halfway
 * between the two meshes from each mesh's frame with the real placeGaussians and prints the difference.
 *
 *   npm run measure:frame -- <zone> <meshA.las> <meshB.las>
 */
import { closeSync, openSync, readSync } from "node:fs";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { placeGaussians, type Gaussian } from "../src/gaussian/to-surfels.js";
import { parseLasHeader } from "../src/pointcloud/las.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const [zoneArg, fileA, fileB] = process.argv.slice(2);
if (!zoneArg || !fileA || !fileB) { console.error("usage: measure-frame <zone> <meshA.las> <meshB.las>"); process.exit(1); }
const zone = Number(zoneArg);
const centre = (file: string) => {
  const fd = openSync(file, "r");
  const head = new Uint8Array(375); readSync(fd, head, 0, 375, 0); closeSync(fd);
  const h = parseLasHeader(head);
  return { e0: (h.min[0] + h.max[0]) / 2, n0: (h.min[1] + h.max[1]) / 2 }; // LAS X is the easting, Y the northing
};
const a = centre(fileA), b = centre(fileB);
const P = { E: (a.e0 + b.e0) / 2, N: (a.n0 + b.n0) / 2 };
const world = (o: { e0: number; n0: number }) => {
  const origin = jprcsToLatLng(zone, o.n0, o.e0);
  const at = (position: [number, number, number]): Gaussian => ({ position, scales: [1, 1, 1], rotation: [1, 0, 0, 0], colour: [0.5, 0.5, 0.5], opacity: 0.95 });
  const { block, splats } = placeGaussians([at([P.E - o.e0, P.N - o.n0, 200]), at([10, 10, 200])], origin, 17);
  // Tile units (not metres: a metre factor times a tile index of 29 million would amplify the width's last digits).
  return { u: block.origin.x + splats[0]!.x, v: block.origin.y + splats[0]!.y, w: tileWidthMetres({ z: 17, x: block.origin.x, y: block.origin.y }) };
};
const pa = world(a), pb = world(b);
const g1 = jprcsToLatLng(zone, a.n0, a.e0), g2 = jprcsToLatLng(zone, a.n0 + 1000, a.e0);
const convergence = (Math.atan2((g2.lng - g1.lng) * Math.cos((g1.lat * Math.PI) / 180), g2.lat - g1.lat) * 180) / Math.PI;
console.log(`grid north is ${convergence.toFixed(4)} degrees from true north here; the meshes' centres are ${(b.e0 - a.e0).toFixed(0)} m east and ${(b.n0 - a.n0).toFixed(0)} m north of each other`);
console.log(`the same plane point placed from mesh B's frame minus from mesh A's: ${((pb.u - pa.u) * pa.w).toFixed(3)} m east, ${(-(pb.v - pa.v) * pa.w).toFixed(3)} m north`);
