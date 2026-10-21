/**
 * PE-1 · the background-remover engine interface (decision E1). An engine
 * turns a square RGB image (BG_MODEL_INPUT_PX a side, 3 bytes a pixel, row
 * major) into a mask of the same size (1 byte a pixel, 255 = keep, 0 = clear).
 * Pre- and post-processing (resize, apply the mask as alpha, PNG) live in
 * ../process.ts, so every engine sees the same input.
 *
 * Which engine runs (`bgEngine()`):
 *  - STUDIO_BG_MODEL_PATH names a readable .onnx file → the onnxruntime-node
 *    engine (./onnx.ts), loaded once per path;
 *  - else under NODE_ENV=test → the deterministic stub (./stub.ts);
 *  - else none → 503 DS_BG_UNAVAILABLE ("Background remover isn't set up on
 *    this server yet"). Nothing is ever downloaded.
 */
import fs from "fs";
import path from "path";
import { BG_MODEL_ENV, BG_MODEL_INPUT_PX } from "../../contracts";
import { onnxEngine } from "./onnx";
import { stubEngine } from "./stub";

export interface BgEngine {
  /** "onnx:<file name>" or "stub" (stored on the job; never a path). */
  readonly name: string;
  /** The square side the engine wants (BG_MODEL_INPUT_PX unless the model says otherwise). */
  readonly side: number;
  /** rgb.length = side × side × 3 → side × side mask bytes. */
  mask(rgb: Buffer, side: number): Promise<Uint8Array>;
}

/** The model input side: STUDIO_BG_MODEL_SIZE (64..2048) or the contract's 320. */
export const modelSide = (): number => {
  const n = Number(process.env.STUDIO_BG_MODEL_SIZE);
  return Number.isInteger(n) && n >= 64 && n <= 2048 ? n : BG_MODEL_INPUT_PX;
};

let warned = "";

/** The configured engine, or null when the server has none (→ DS_BG_UNAVAILABLE). */
export function bgEngine(): BgEngine | null {
  const file = (process.env[BG_MODEL_ENV] || "").trim();
  if (file) {
    const full = path.resolve(file);
    let ok = false;
    try {
      ok = fs.statSync(full).isFile();
    } catch {
      ok = false;
    }
    if (ok) return onnxEngine(full, modelSide());
    if (warned !== full) {
      warned = full;
      console.error(`[studio] ${BG_MODEL_ENV} is set but the file can't be read; the background remover is off.`);
    }
    return null;
  }
  if (process.env.NODE_ENV === "test") return stubEngine;
  return null;
}
