/**
 * Build the static demo site into docs/ for GitHub Pages
 * (dwg7 convention: Pages served from main:docs/, published at
 * https://dwg7.unopengis.org/dorayaki/).
 *
 * Single-file page, no content hashes in file names:
 *   docs/index.html               demo page with all JS (app + MapLibre GL JS)
 *                                 and all CSS inlined
 *   docs/maplibre-gl-worker.mjs   MapLibre's Web Worker (cannot be inlined)
 *   docs/tiles/<tileset>/z/x/y.mlt  synthetic demo tiles
 *   docs/.nojekyll                serve files as-is
 * docs/ is wiped and rewritten; it holds only the site.
 *
 * MapLibre GL JS 6 derives its worker URL from its own import.meta.url.
 * Bundled into the page, that is the page URL, so the build defines the
 * worker's page-relative path and the demo passes it to setWorkerUrl
 * (dwg7/cafebabe patterns/maplibre-gl-js-embedding.md). The worker must be
 * self-contained; the build fails if it mentions another maplibre-gl*.mjs
 * (true up to 6.12.x, which imported maplibre-gl-shared.mjs).
 *
 * The Numazu point-cloud tileset (VIRTUAL SHIZUOKA, CC BY) is not copied
 * into docs/. It is hosted as dorayaki-numazu.pmtiles on stars, where Martin
 * serves it as z/x/y. Set DORAYAKI_NUMAZU_TILEJSON to its TileJSON URL
 * (https://stars.optgeo.org/dorayaki-numazu) to list it on the site; without
 * it the site omits Numazu and hides its link.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { build } from "esbuild";

import { DEMO_TILESETS, buildDemoTiles, tileUrlPath } from "../demo/src/demo-tile.js";

const OUT = "docs";
const MAPLIBRE_DIST = "node_modules/maplibre-gl/dist";
const WORKER = "maplibre-gl-worker.mjs";

const numazuTileJson = process.env.DORAYAKI_NUMAZU_TILEJSON;
const externals: Record<string, string> = numazuTileJson ? { numazu: numazuTileJson } : {};
console.log(numazuTileJson ? `Numazu from ${numazuTileJson}` : "DORAYAKI_NUMAZU_TILEJSON not set: the site omits Numazu");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. One bundle: the demo with MapLibre GL JS inside.
const result = await build({
  entryPoints: ["demo/src/main.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  logLevel: "warning",
  define: {
    __DORAYAKI_EXTERNAL_TILESETS__: JSON.stringify(externals),
    __DORAYAKI_WORKER_URL__: JSON.stringify(WORKER),
  },
});
const js = result.outputFiles[0]!.text.replaceAll("</script", "<\\/script");

// 2. The worker, which must stand alone.
const worker = readFileSync(join(MAPLIBRE_DIST, WORKER), "utf8");
const deps = [...worker.matchAll(/["'`/](maplibre-gl[a-z-]*\.mjs)["'`?]/g)].map((m) => m[1]).filter((n) => n !== WORKER);
if (deps.length > 0 || /\bfrom\s*["']\.\//.test(worker)) {
  throw new Error(`${WORKER} is not self-contained (mentions ${deps.join(", ") || "a relative import"}); copy its closure`);
}
copyFileSync(join(MAPLIBRE_DIST, WORKER), join(OUT, WORKER));

// 3. Synthetic demo tiles.
let tiles = 0;
for (const tileset of DEMO_TILESETS) {
  for (const { tile, bytes } of buildDemoTiles(tileset)) {
    const path = join(OUT, tileUrlPath(tileset, tile));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    tiles++;
  }
}

// 4. Page: demo/index.html with the stylesheet link, import map and module
//    script replaced by inline CSS and JS.
const css = readFileSync(join(MAPLIBRE_DIST, "maplibre-gl.css"), "utf8");
let html = readFileSync("demo/index.html", "utf8");
const swaps: Array<[RegExp, string]> = [
  [/\s*<link rel="stylesheet" href="\/node_modules\/maplibre-gl\/dist\/maplibre-gl\.css" \/>/, `\n    <style>${css}</style>`],
  [/\s*<script type="importmap">[\s\S]*?<\/script>/, ""],
  [/<script type="module" src="\/demo\/build\/main\.js"><\/script>/, `<script type="module">${js}</script>`],
];
for (const [pattern, replacement] of swaps) {
  if (!pattern.test(html)) throw new Error(`demo/index.html no longer matches ${pattern}`);
  html = html.replace(pattern, () => replacement);
}
if (/(src|href)="\//.test(html)) throw new Error("site index.html still has a root-absolute path");
writeFileSync(join(OUT, "index.html"), html);
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`wrote ${OUT}/index.html (${html.length} chars, JS and CSS inline), ${OUT}/${WORKER}, ${tiles} tiles, ${OUT}/.nojekyll`);
