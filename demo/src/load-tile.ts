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

/**
 * Fetch several tiles in parallel; resolves in the order of `urls`. With
 * allowMissing, a 204 or 404 (or an empty body) yields null instead of an error.
 */
export function fetchTilesBytes(urls: readonly string[], signal?: AbortSignal): Promise<Uint8Array[]>;
export function fetchTilesBytes(urls: readonly string[], signal: AbortSignal | undefined, options: { allowMissing: boolean }): Promise<Array<Uint8Array | null>>;
export function fetchTilesBytes(urls: readonly string[], signal?: AbortSignal, options?: { allowMissing: boolean }): Promise<Array<Uint8Array | null>> {
  return Promise.all(
    urls.map(async (url) => {
      if (!options?.allowMissing) return fetchTileBytes(url, signal);
      const response = await fetch(url, signal ? { signal } : {});
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > 0 ? bytes : null;
    }),
  );
}
