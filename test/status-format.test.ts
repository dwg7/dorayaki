import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMegabytes, formatSplats, formatTiles } from "../demo/src/status-format.js";

test("status figures stay within their columns", () => {
  assert.equal(formatMegabytes(21950984), "22.0 MB");
  assert.equal(formatSplats(1829151), "1.83 M");
  assert.equal(formatSplats(35120), "35.1 k");
  assert.equal(formatSplats(842), "842");
  assert.equal(formatTiles(15), "15 tiles");
  assert.equal(formatTiles(1), "1 tile");
  for (let n = 0; n < 1e9; n = n * 1.7 + 1) {
    assert.ok(formatSplats(n).length <= 7, formatSplats(n));
    assert.ok(formatMegabytes(n * 12).length <= 9, formatMegabytes(n * 12));
  }
});
