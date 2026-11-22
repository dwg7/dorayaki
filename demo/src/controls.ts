/**
 * The demo's look controls: sliders for the drawing parameters (the page part; the DOM-free part is tune-params.ts).
 */

/** One slider. `key` is the URL flag (`?vivid=`), `value` the value now, `fallback` the one a page without the flag has. */
export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  title?: string;
}

/** Builds one labelled range input per spec in `container`; `onChange(key, value)` runs on every input event. Returns a function that sets a slider's value (and its readout) from outside. */
export function buildSliders(container: HTMLElement, specs: readonly SliderSpec[], onChange: (key: string, value: number) => void): (key: string, value: number) => void {
  const setters = new Map<string, (v: number) => void>();
  for (const s of specs) {
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:6.2em 1fr 3.2em;align-items:center;gap:4px";
    if (s.title) row.title = s.title;
    const name = document.createElement("span");
    name.textContent = s.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(s.value);
    input.style.minWidth = "0";
    const out = document.createElement("output");
    out.style.cssText = "text-align:right;font-variant-numeric:tabular-nums";
    const show = (v: number): void => { out.textContent = String(Number(v.toFixed(3))); };
    show(s.value);
    input.addEventListener("input", () => { const v = Number(input.value); show(v); onChange(s.key, v); });
    setters.set(s.key, (v) => { input.value = String(v); show(v); });
    row.append(name, input, out);
    container.append(row);
  }
  return (key, value) => setters.get(key)?.(value);
}
