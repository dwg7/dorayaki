import assert from "node:assert/strict";
import { test } from "node:test";

import { changedParams } from "../demo/src/tune-params.js";

test("only the values that differ from the defaults are listed", () => {
  const defaults = { vivid: 1.5, shade: 1, clearance: 15 };
  assert.deepEqual(changedParams({ vivid: 1.5, shade: 1, clearance: 15 }, defaults), []);
  assert.deepEqual(changedParams({ vivid: 2, shade: 1, clearance: 15 }, defaults), [["vivid", "2"]]);
});

test("numbers are written without float noise or trailing zeros", () => {
  const defaults = { vivid: 1.5 };
  assert.deepEqual(changedParams({ vivid: 0.1 + 0.2 }, defaults), [["vivid", "0.3"]]);
  assert.deepEqual(changedParams({ vivid: 1.25 }, defaults), [["vivid", "1.25"]]);
});

test("a key with no default is always listed", () => {
  assert.deepEqual(changedParams({ extra: 3 }, {}), [["extra", "3"]]);
});
