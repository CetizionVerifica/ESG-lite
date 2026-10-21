/**
 * PE-1 · the onnxruntime-node engine: a salient-object segmentation model
 * (u2net / u2netp / ISNet style: one image input NCHW float32, the first
 * output a single-channel saliency map of the same side). The model file
 * comes from STUDIO_BG_MODEL_PATH (an operator puts it on the server; this
 * code never downloads anything). onnxruntime-node is loaded lazily, so a
 * server without a model never loads the native library.
 *
 * Input normalisation, STUDIO_BG_MODEL_NORM:
 *   imagenet (default, u2net/u2netp): (x/255 − mean) / std, mean .485 .456 .406, std .229 .224 .225
 *   half     (ISNet / DIS):           x/255 − 0.5
 * The output is min–max scaled to 0..255 (as rembg does).
 */
import path from "path";
import type { BgEngine } from "./engine";

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let ort: Ort | null = null;
const sessions = new Map<string, Promise<Session>>();

function session(file: string): Promise<Session> {
  let s = sessions.get(file);
  if (!s) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ort = ort ?? (require("onnxruntime-node") as Ort);
    s = ort.InferenceSession.create(file, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    // A model that can't be opened stays failed for this path until restart; drop it so a fixed file loads.
    // data-loss-reviewed: removes an entry from an in-memory Map, no record is deleted.
    s.catch(() => sessions.delete(file));
    sessions.set(file, s);
  }
  return s;
}

/** RGB bytes (side × side × 3) → the model's NCHW float input. Exported for the unit test. */
export function toTensorData(rgb: Buffer, side: number, norm: "imagenet" | "half"): Float32Array {
  const plane = side * side;
  const out = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      const v = rgb[p * 3 + c] / 255;
      out[c * plane + p] = norm === "half" ? v - 0.5 : (v - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** The first side × side values of a saliency map → mask bytes (min–max scaled). Exported for the unit test. */
export function toMask(map: ArrayLike<number>, side: number): Uint8Array {
  const plane = side * side;
  if (map.length < plane) throw Object.assign(new Error("the model's output is smaller than its input"), { reason: "model" });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = Number(map[i]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const out = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) out[i] = Math.max(0, Math.min(255, Math.round(((Number(map[i]) - lo) / span) * 255)));
  return out;
}

export function onnxEngine(file: string, side: number): BgEngine {
  const norm = process.env.STUDIO_BG_MODEL_NORM === "half" ? "half" : "imagenet";
  return {
    name: `onnx:${path.basename(file).slice(0, 70)}`,
    side,
    async mask(rgb: Buffer, s: number): Promise<Uint8Array> {
      let sess: Session;
      try {
        sess = await session(file);
      } catch (err) {
        throw Object.assign(new Error(`model: ${(err as Error)?.message ?? "load failed"}`), { reason: "model" });
      }
      const O = ort as Ort;
      const input = new O.Tensor("float32", toTensorData(rgb, s, norm), [1, 3, s, s]);
      let out: Record<string, { data: unknown }>;
      try {
        out = (await sess.run({ [sess.inputNames[0]]: input })) as unknown as Record<string, { data: unknown }>;
      } catch (err) {
        throw Object.assign(new Error(`model: ${(err as Error)?.message ?? "run failed"}`), { reason: "model" });
      }
      const first = out[sess.outputNames[0]];
      return toMask(first.data as ArrayLike<number>, s);
    },
  };
}
