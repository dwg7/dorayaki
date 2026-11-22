/** The query string of the demo's look controls. No DOM here. */

/** The flags whose value differs from the default, as `key=value` pairs (numbers without trailing zeros). */
export function changedParams(values: Readonly<Record<string, number>>, defaults: Readonly<Record<string, number>>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, v] of Object.entries(values)) {
    if (Math.abs(v - (defaults[key] ?? NaN)) > 1e-9 || !(key in defaults)) out.push([key, String(Number(v.toFixed(4)))]);
  }
  return out;
}
