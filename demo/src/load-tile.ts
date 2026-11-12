/**
 * Tile loading: fetch tiles over ordinary HTTP. No decoding here.
 */
export async function fetchTileBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Fetch several tiles in parallel; resolves in the order of `urls`. */
export function fetchTilesBytes(urls: readonly string[], signal?: AbortSignal): Promise<Uint8Array[]> {
  return Promise.all(urls.map((url) => fetchTileBytes(url, signal)));
}
