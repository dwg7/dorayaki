/**
 * Streaming PMTiles writer (Node): the same archive as `writePmtiles` (src/pmtiles.ts) without holding the tiles.
 *
 * The caller gives the tile addresses and a function that returns one tile's bytes when asked. The tiles are
 * asked for once each, in tile-ID order, and appended to a temporary file next to the output while their lengths are
 * recorded; then the header, directories and metadata are written (they need those lengths), and the tile data is copied
 * behind them in chunks. Memory is the index (a few dozen bytes per tile) plus the largest tile, however big the archive;
 * the disk holds the tile data twice for a moment. E022 step 4 (documents/build.md).
 */
import { closeSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs";

import { pmtilesHead, sortedIndex, type PmtilesIndexEntry, type PmtilesOptions } from "./pmtiles.js";

export interface PmtilesFileTile {
  z: number;
  x: number;
  y: number;
  /** The tile's stored bytes (already compressed when the archive says so). Called exactly once, in tile-ID order. */
  read: () => Uint8Array;
}

const COPY_CHUNK = 8 * 1024 * 1024;

function writeAll(fd: number, bytes: Uint8Array): void {
  let done = 0;
  while (done < bytes.byteLength) done += writeSync(fd, bytes, done, bytes.byteLength - done);
}

/**
 * Writes the archive to `path` (through `<path>.tmp` files, so a failed run leaves no half archive under the name).
 * @returns the archive's size in bytes
 */
export function writePmtilesFile(path: string, tiles: readonly PmtilesFileTile[], options: PmtilesOptions): number {
  if (tiles.length === 0) throw new RangeError("no tiles");
  const order = sortedIndex(tiles);
  const dataPath = `${path}.data.tmp`;
  const outPath = `${path}.tmp`;
  const index: PmtilesIndexEntry[] = [];
  let dataFd = -1;
  let outFd = -1;
  try {
    dataFd = openSync(dataPath, "w");
    for (const o of order) {
      const t = tiles[o.i]!;
      const data = t.read();
      writeAll(dataFd, data);
      index.push({ tileId: o.tileId, z: t.z, length: data.byteLength });
    }
    closeSync(dataFd);
    dataFd = -1;

    const { head, tileDataLength } = pmtilesHead(index, options);
    outFd = openSync(outPath, "w");
    writeAll(outFd, head);
    const src = openSync(dataPath, "r");
    try {
      const chunk = new Uint8Array(COPY_CHUNK);
      let copied = 0;
      for (;;) {
        const n = readSync(src, chunk, 0, chunk.byteLength, copied);
        if (n === 0) break;
        writeAll(outFd, n === chunk.byteLength ? chunk : chunk.subarray(0, n));
        copied += n;
      }
      if (copied !== tileDataLength) throw new Error(`tile data is ${copied} bytes, expected ${tileDataLength}`);
    } finally {
      closeSync(src);
    }
    closeSync(outFd);
    outFd = -1;
    renameSync(outPath, path);
    return head.byteLength + tileDataLength;
  } finally {
    if (dataFd >= 0) closeSync(dataFd);
    if (outFd >= 0) closeSync(outFd);
    rmSync(dataPath, { force: true });
    rmSync(outPath, { force: true });
  }
}
