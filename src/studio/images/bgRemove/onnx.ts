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

// onnxruntime-node is optional at build time (declared in package.json, not always installed):
// a minimal local shape of the parts used here, so tsc never needs its types.
interface OrtTensor {
  readonly data: unknown;
}
interface Session {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  InferenceSession: { create(file: string, opts?: Record<string, unknown>): Promise<Session> };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let ort: Ort | null = null;
let ortMissing = false;
const sessions = new Map<string, Promise<Session>>();

/** Test hook: the module id to require (a missing name simulates a server without the package). */
let ORT_MODULE = "onnxruntime-node";
export function setOrtModuleForTest(name: string | null): void {
  ORT_MODULE = name ?? "onnxruntime-node";
  ort = null;
  ortMissing = false;
  sessions.clear();
}

/** onnxruntime-node, required lazily at use time; null when the package isn't installed. */
export function loadOrt(): Ort | null {
  if (ort) return ort;
  if (ortMissing) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ort = require(ORT_MODULE) as Ort;
    return ort;
  } catch {
    ortMissing = true;
    return null;
  }
}

/** True when onnxruntime-node can be loaded on this server. */
export const ortAvailable = (): boolean => loadOrt() !== null;

function session(file: string): Promise<Session> {
  let s = sessions.get(file);
  if (!s) {
    const o = loadOrt();
    if (!o) return Promise.reject(Object.assign(new Error("onnxruntime-node isn't installed"), { reason: "model" }));
    s = o.InferenceSession.create(file, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
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
      let out: Record<string, OrtTensor>;
      try {
        out = await sess.run({ [sess.inputNames[0]]: input });
      } catch (err) {
        throw Object.assign(new Error(`model: ${(err as Error)?.message ?? "run failed"}`), { reason: "model" });
      }
      const first = out[sess.outputNames[0]];
      return toMask(first.data as ArrayLike<number>, s);
    },
  };
}
