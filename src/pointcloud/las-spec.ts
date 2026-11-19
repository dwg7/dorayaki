/** A LAS input spec, `path@c2+1@first`: the path and a point filter (all points when no filter is given). */
export interface LasSpec { path: string; keep: (cls: number, returns: number) => boolean }

/** `@c<n>[+<n>...]` keeps only those classifications, `@first` / `@last` only first / last returns. */
export function parseLasSpec(spec: string): LasSpec {
  const [path, ...filters] = spec.split("@");
  let classes: Set<number> | undefined;
  let which: "first" | "last" | undefined;
  for (const f of filters) {
    if (f.startsWith("c")) classes = new Set(f.slice(1).split("+").map(Number));
    else if (f === "first" || f === "last") which = f;
    else throw new Error(`unknown filter @${f}; use @c<class>[+<class>...], @first or @last`);
  }
  return {
    path: path!,
    keep: (cls, returns) => {
      if (classes && !classes.has(cls)) return false;
      const n = returns & 7, of = (returns >> 3) & 7;
      return which === undefined || (which === "first" ? n === 1 : n === of);
    },
  };
}
