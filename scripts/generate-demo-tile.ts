import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildDemoTile, demoTilePath } from "../demo/src/demo-tile.js";

const path = demoTilePath();
const bytes = buildDemoTile();
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, bytes);
console.log(`wrote ${path} (${bytes.byteLength} bytes)`);
