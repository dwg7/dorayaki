import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEMO_TILESETS, buildDemoTiles, demoTilePath } from "../demo/src/demo-tile.js";

for (const tileset of DEMO_TILESETS) {
  for (const { tile, bytes } of buildDemoTiles(tileset)) {
    const path = demoTilePath(tileset, tile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    console.log(`wrote ${path} (${bytes.byteLength} bytes)`);
  }
}
