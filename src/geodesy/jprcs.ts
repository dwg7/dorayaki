/**
 * Japan Plane Rectangular Coordinate System (JGD2011, GRS80) to latitude
 * and longitude: the Gauss–Krüger inverse in the series form published by
 * the Geospatial Information Authority of Japan (Kawase 2011).
 *
 * Coordinates follow the survey convention: `x` is northing and `y` is
 * easting, in metres from the zone origin. (LAS files usually store X =
 * easting, Y = northing; swap when reading.)
 */

const A = 6378137;
const F = 298.257222101;
const M0 = 0.9999;
const DEG = Math.PI / 180;

/** Zone origins (latitude, longitude in degrees), zones I–XIX. */
export const JPRCS_ORIGINS: Readonly<Record<number, readonly [number, number]>> = {
  1: [33, 129.5], 2: [33, 131], 3: [36, 132 + 10 / 60], 4: [33, 133.5], 5: [36, 134 + 20 / 60],
  6: [36, 136], 7: [36, 137 + 10 / 60], 8: [36, 138.5], 9: [36, 139 + 50 / 60], 10: [40, 140 + 50 / 60],
  11: [44, 140.25], 12: [44, 142.25], 13: [44, 144.25], 14: [26, 142], 15: [26, 127.5],
  16: [26, 124], 17: [26, 131], 18: [20, 136], 19: [26, 154],
};

const n = 1 / (2 * F - 1);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const A0 = 1 + n2 / 4 + n4 / 64;
const AJ = [
  -1.5 * (n - n3 / 8 - n5 / 64),
  (15 / 16) * (n2 - n4 / 4),
  (-35 / 48) * (n3 - (5 / 16) * n5),
  (315 / 512) * n4,
  (-693 / 1280) * n5,
];
const BETA = [
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - n4 / 360 - (81 / 512) * n5,
  n2 / 48 + n3 / 15 - (437 / 1440) * n4 + (46 / 105) * n5,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5,
  (4397 / 161280) * n4 - (11 / 504) * n5,
  (4583 / 161280) * n5,
];
const DELTA = [
  2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4 + (26 / 45) * n5 - (2854 / 675) * n6,
  (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4 + (2704 / 315) * n5 + (2323 / 945) * n6,
  (56 / 15) * n3 - (136 / 35) * n4 - (1262 / 105) * n5 + (73814 / 2835) * n6,
  (4279 / 630) * n4 - (332 / 35) * n5 - (399572 / 14175) * n6,
  (4174 / 315) * n5 - (144838 / 6237) * n6,
  (601676 / 22275) * n6,
];
const ABAR = ((M0 * A) / (1 + n)) * A0;

function meridianArc(phi0: number): number {
  let s = A0 * phi0;
  AJ.forEach((a, j) => (s += a * Math.sin(2 * (j + 1) * phi0)));
  return ((M0 * A) / (1 + n)) * s;
}

/** Plane rectangular (northing x, easting y, metres) in a zone -> { lat, lng } in degrees. */
export function jprcsToLatLng(zone: number, x: number, y: number): { lat: number; lng: number } {
  const origin = JPRCS_ORIGINS[zone];
  if (!origin) throw new RangeError(`unknown plane rectangular zone ${zone}`);
  const phi0 = origin[0] * DEG;
  const lambda0 = origin[1] * DEG;
  const xi = (x + meridianArc(phi0)) / ABAR;
  const eta = y / ABAR;
  let xi1 = xi;
  let eta1 = eta;
  BETA.forEach((b, j) => {
    const k = 2 * (j + 1);
    xi1 -= b * Math.sin(k * xi) * Math.cosh(k * eta);
    eta1 -= b * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  DELTA.forEach((d, j) => (phi += d * Math.sin(2 * (j + 1) * chi)));
  const lambda = lambda0 + Math.atan(Math.sinh(eta1) / Math.cos(xi1));
  return { lat: phi / DEG, lng: lambda / DEG };
}
