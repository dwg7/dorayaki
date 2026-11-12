import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEMO_TILESETS, buildDemoTile, demoTilePath } from "../demo/src/demo-tile.js";

for (const tileset of DEMO_TILESETS) {
  const path = demoTilePath(tileset);
  const bytes = buildDemoTile(tileset);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (${bytes.byteLength} bytes)`);
}
