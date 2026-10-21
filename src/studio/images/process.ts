/**
 * PE-1 · background removal around an engine (sharp only, no engine code):
 *   source bytes → orientation applied → RGB → resized to the engine's square
 *   (fill) → mask → mask resized back to the image → joined as the alpha
 *   channel (multiplied with any alpha the source had) → PNG.
 * Large images are scaled down to BG_MAX_SIDE first; a PNG over the asset cap
 * is scaled down again (at most three times) before giving up.
 */
import sharp from "sharp";
import { ASSET_MAX_BYTES } from "../contracts";
import type { BgEngine } from "./bgRemove/engine";

/** The longest side of a background-removed image. */
export const BG_MAX_SIDE = 4000;

export class BgProcessError extends Error {
  constructor(
    readonly reason: "image" | "model" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new BgProcessError("timeout", `the engine took longer than ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

export interface BgResult {
  bytes: Buffer;
  w: number;
  h: number;
}

export async function removeBackgroundBytes(input: Buffer, engine: BgEngine, opts: { timeoutMs?: number } = {}): Promise<BgResult> {
  let rgb: Buffer;
  let alphaIn: Buffer | null = null;
  let w: number;
  let h: number;
  try {
    const base = sharp(input, { failOn: "error", limitInputPixels: 100_000_000 }).rotate().resize(BG_MAX_SIDE, BG_MAX_SIDE, { fit: "inside", withoutEnlargement: true });
    const { data, info } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    w = info.width;
    h = info.height;
    rgb = Buffer.alloc(w * h * 3);
    let opaque = true;
    const a = Buffer.alloc(w * h);
    for (let p = 0; p < w * h; p++) {
      rgb[p * 3] = data[p * 4];
      rgb[p * 3 + 1] = data[p * 4 + 1];
      rgb[p * 3 + 2] = data[p * 4 + 2];
      a[p] = data[p * 4 + 3];
      if (a[p] !== 255) opaque = false;
    }
    if (!opaque) alphaIn = a;
  } catch {
    throw new BgProcessError("image", "the image couldn't be read");
  }

  const side = engine.side;
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(side, side, { fit: "fill" }).raw().toBuffer();
  let mask: Uint8Array;
  try {
    mask = await withTimeout(engine.mask(small, side), opts.timeoutMs ?? 60_000);
  } catch (err) {
    if (err instanceof BgProcessError) throw err;
    throw new BgProcessError("model", (err as Error)?.message ?? "the engine failed");
  }
  if (mask.length !== side * side) throw new BgProcessError("model", "the engine's mask has the wrong size");
  const alpha = await sharp(Buffer.from(mask), { raw: { width: side, height: side, channels: 1 } }).resize(w, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
  if (alphaIn) for (let p = 0; p < w * h; p++) alpha[p] = Math.round((alpha[p] * alphaIn[p]) / 255);

  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    rgba[p * 4] = rgb[p * 3];
    rgba[p * 4 + 1] = rgb[p * 3 + 1];
    rgba[p * 4 + 2] = rgb[p * 3 + 2];
    rgba[p * 4 + 3] = alpha[p];
  }
  let cw = w;
  let ch = h;
  for (let attempt = 0; attempt < 4; attempt++) {
    const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .resize(cw, ch, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (png.length <= ASSET_MAX_BYTES) return { bytes: png, w: cw, h: ch };
    cw = Math.max(1, Math.round(cw * 0.7));
    ch = Math.max(1, Math.round(ch * 0.7));
  }
  throw new BgProcessError("image", "the cut-out is larger than the asset limit");
}
