/**
 * A small MapLibre control that shows what the shot player is doing (playing, finished, stopped by input) with a
 * progress bar and one button: Stop while playing, Replay afterwards (which plays the script again from its first shot).
 * The text comes from `describePlayback` (shot-player.ts); this file is only the DOM. Clicks on it are not "manual
 * input" for the player: the element carries `data-shot-control`, and `isShotControlEvent` tells the player to ignore them.
 */
import type { IControl } from "maplibre-gl";
import { describePlayback, type PlaybackState } from "./shot-player.js";

export const isShotControlEvent = (event: { target: unknown }): boolean =>
  event.target instanceof Element && event.target.closest("[data-shot-control]") !== null;

export class ShotControl implements IControl {
  private readonly root = document.createElement("div");
  private readonly text = document.createElement("div");
  /** A lamp before the text: red while the tour waits for its tiles, green while it plays (describePlayback). */
  private readonly lamp = document.createElement("span");
  private readonly label = document.createElement("span");
  private readonly bar = document.createElement("div");
  private readonly button = document.createElement("button");
  /** Called when the button is pressed (Stop or Replay, as shown). */
  onButton: () => void = () => {};

  constructor() {
    this.root.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.root.dataset.shotControl = "1";
    Object.assign(this.root.style, { padding: "6px 8px", font: "12px/1.4 system-ui, sans-serif", width: "230px", background: "rgba(255,255,255,0.92)" });
    const track = document.createElement("div");
    Object.assign(track.style, { height: "4px", background: "#ddd", margin: "4px 0", borderRadius: "2px", overflow: "hidden" });
    Object.assign(this.bar.style, { height: "100%", width: "0%", background: "#2a6fdb" });
    track.append(this.bar);
    Object.assign(this.button.style, { width: "auto", height: "auto", padding: "2px 10px", font: "inherit", cursor: "pointer" });
    this.button.type = "button";
    this.button.addEventListener("click", () => this.onButton());
    Object.assign(this.lamp.style, { display: "inline-block", width: "9px", height: "9px", borderRadius: "50%", marginRight: "6px", verticalAlign: "baseline" });
    this.lamp.setAttribute("aria-hidden", "true");
    this.text.append(this.lamp, this.label);
    this.root.append(this.text, track, this.button);
    this.show({ kind: "loading" });
  }

  /** Shows a playback state. */
  show(state: PlaybackState): void {
    const d = describePlayback(state);
    this.label.textContent = d.text;
    this.lamp.hidden = d.lamp === undefined;
    this.lamp.style.background = d.lamp === "red" ? "#e0322b" : "#2fa84f";
    this.lamp.style.boxShadow = d.lamp === "red" ? "0 0 5px #e0322b" : "none";
    this.root.title = d.lamp === "red" ? "Waiting for the tour's tiles before playing (E029)" : "";
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, d.progress)) * 100)}%`;
    this.button.hidden = d.button === undefined;
    if (d.button) this.button.textContent = d.button;
  }

  onAdd(): HTMLElement { return this.root; }
  onRemove(): void { this.root.remove(); }
}
