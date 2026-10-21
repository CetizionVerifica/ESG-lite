/**
 * PE-1 · the deterministic test engine (NODE_ENV=test without a model). It
 * keeps every pixel whose colour is far from the mean colour of the image's
 * border and clears the rest, so a subject on a plain background comes out
 * cut out, the same way every run. Never used when a model is configured.
 */
import type { BgEngine } from "./engine";

/** Squared RGB distance below which a pixel counts as background. */
const NEAR = 48 * 48;

export const stubEngine: BgEngine = {
  name: "stub",
  side: 320,
  async mask(rgb: Buffer, side: number): Promise<Uint8Array> {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const at = (x: number, y: number) => (y * side + x) * 3;
    for (let i = 0; i < side; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, side - 1],
        [0, i],
        [side - 1, i],
      ]) {
        const k = at(x, y);
        r += rgb[k];
        g += rgb[k + 1];
        b += rgb[k + 2];
        n++;
      }
    }
    r /= n;
    g /= n;
    b /= n;
    const out = new Uint8Array(side * side);
    for (let p = 0; p < side * side; p++) {
      const dr = rgb[p * 3] - r;
      const dg = rgb[p * 3 + 1] - g;
      const db = rgb[p * 3 + 2] - b;
      out[p] = dr * dr + dg * dg + db * db > NEAR ? 255 : 0;
    }
    return out;
  },
};
