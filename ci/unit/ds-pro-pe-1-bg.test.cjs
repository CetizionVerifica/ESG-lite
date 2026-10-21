// PE-1 · the background remover around its engine (src/studio/images/bgRemove/, process.ts):
// engine choice from STUDIO_BG_MODEL_PATH / NODE_ENV, the stub, tensor and mask conversion, and a
// real onnxruntime-node run on a tiny model this test writes itself (ReduceMean over the colour
// channels; no model is downloaded or committed). The cut-out keeps the subject, clears the
// background, keeps the source's own transparency and never grows past the asset limit.
//   npm run build && node --test ci/unit/ds-pro-pe-1-bg.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const E = require(path.resolve("dist/studio/images/bgRemove/engine.js"));
const O = require(path.resolve("dist/studio/images/bgRemove/onnx.js"));
const { stubEngine } = require(path.resolve("dist/studio/images/bgRemove/stub.js"));
const PR = require(path.resolve("dist/studio/images/process.js"));

// --- a minimal ONNX model, encoded by hand (protobuf wire format) -------------------------------
const varint = (n) => {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
};
const key = (field, wire) => varint((field << 3) | wire);
const vint = (field, n) => Buffer.concat([key(field, 0), varint(n)]);
const bytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);
const str = (field, s) => bytes(field, Buffer.from(s, "utf8"));
const tensorType = (dims) => bytes(1, Buffer.concat([vint(1, 1 /* FLOAT */), bytes(2, Buffer.concat(dims.map((d) => bytes(1, vint(1, d)))))]));
const valueInfo = (name, dims) => Buffer.concat([str(1, name), bytes(2, tensorType(dims))]);
/** y[1,1,s,s] = mean over the channels of x[1,3,s,s] (opset 13 ReduceMean, axes as an attribute). */
function meanModel(side) {
  const axes = Buffer.concat([str(1, "axes"), vint(8, 1), vint(20, 7 /* INTS */)]);
  const keep = Buffer.concat([str(1, "keepdims"), vint(3, 1), vint(20, 2 /* INT */)]);
  const node = Buffer.concat([str(1, "x"), str(2, "y"), str(4, "ReduceMean"), bytes(5, axes), bytes(5, keep)]);
  const graph = Buffer.concat([bytes(1, node), str(2, "pe1-mean"), bytes(11, valueInfo("x", [1, 3, side, side])), bytes(12, valueInfo("y", [1, 1, side, side]))]);
  return Buffer.concat([vint(1, 8 /* ir_version */), bytes(8, Buffer.concat([str(1, ""), vint(2, 13)])), bytes(7, graph)]);
}

const env = { ...process.env };
test.afterEach(() => {
  for (const k of ["STUDIO_BG_MODEL_PATH", "STUDIO_BG_MODEL_SIZE", "STUDIO_BG_MODEL_NORM", "NODE_ENV"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

const square = async (size, bg, fg) => {
  const base = await sharp({ create: { width: size, height: size, channels: 3, background: bg } }).png().toBuffer();
  const sq = await sharp({ create: { width: size / 2, height: size / 2, channels: 3, background: fg } }).png().toBuffer();
  return sharp(base).composite([{ input: sq, left: size / 4, top: size / 4 }]).png().toBuffer();
};
const alphaOf = async (png) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  return (x, y) => data[(y * info.width + x) * 4 + 3];
};

test("engine choice: a readable model → onnx; none under NODE_ENV=test → stub; none otherwise → unavailable", () => {
  delete process.env.STUDIO_BG_MODEL_PATH;
  process.env.NODE_ENV = "test";
  assert.equal(E.bgEngine(), stubEngine);
  process.env.NODE_ENV = "production";
  assert.equal(E.bgEngine(), null, "no model on a real server: DS_BG_UNAVAILABLE");
  process.env.STUDIO_BG_MODEL_PATH = path.join(os.tmpdir(), "pe1-no-such-model.onnx");
  assert.equal(E.bgEngine(), null, "a path that can't be read is off too");
  process.env.NODE_ENV = "test";
  assert.equal(E.bgEngine(), null, "a configured but missing model never falls back to the stub");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pe1-"));
  const file = path.join(dir, "u2netp.onnx");
  fs.writeFileSync(file, meanModel(64));
  process.env.STUDIO_BG_MODEL_PATH = file;
  const e = E.bgEngine();
  assert.equal(e.name, "onnx:u2netp.onnx", "the name never carries the path");
  assert.equal(e.side, 320);
  process.env.STUDIO_BG_MODEL_SIZE = "64";
  assert.equal(E.bgEngine().side, 64);
  process.env.STUDIO_BG_MODEL_SIZE = "5";
  assert.equal(E.modelSide(), 320, "out of range → the contract's 320");
});

test("tensor and mask conversion: NCHW planes, both normalisations, min–max scaled mask", () => {
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]); // 2×2
  const half = O.toTensorData(rgb, 2, "half");
  assert.deepEqual([...half].map((v) => Math.round(v * 1000) / 1000), [0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5]);
  const imnet = O.toTensorData(rgb, 2, "imagenet");
  assert.equal(Math.round(imnet[0] * 1000) / 1000, Math.round(((1 - 0.485) / 0.229) * 1000) / 1000);
  assert.deepEqual([...O.toMask([0, 1, 2, 4], 2)], [0, 64, 128, 255]);
  assert.deepEqual([...O.toMask([5, 5, 5, 5], 2)], [0, 0, 0, 0], "a flat map clears everything without dividing by zero");
  assert.throws(() => O.toMask([1, 2], 2), /smaller than its input/);
});

test("stub engine: keeps what differs from the border colour, deterministically", async () => {
  const png = await square(80, "#ffffff", "#1f2a44");
  const a = await PR.removeBackgroundBytes(png, stubEngine);
  const b = await PR.removeBackgroundBytes(png, stubEngine);
  assert.ok(a.bytes.equals(b.bytes), "the same bytes every run");
  assert.deepEqual([a.w, a.h], [80, 80]);
  const alpha = await alphaOf(a.bytes);
  assert.equal(alpha(3, 3), 0);
  assert.equal(alpha(40, 40), 255);
});

test("onnxruntime-node: a real model run (our tiny mean model) cuts out a bright subject", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pe1-"));
  const file = path.join(dir, "mean.onnx");
  fs.writeFileSync(file, meanModel(64));
  process.env.STUDIO_BG_MODEL_PATH = file;
  process.env.STUDIO_BG_MODEL_SIZE = "64";
  process.env.STUDIO_BG_MODEL_NORM = "half";
  const engine = E.bgEngine();
  assert.match(engine.name, /^onnx:/);
  const out = await PR.removeBackgroundBytes(await square(64, "#000000", "#ffffff"), engine);
  const alpha = await alphaOf(out.bytes);
  assert.equal(alpha(2, 2), 0, "the dark background is cleared");
  assert.equal(alpha(32, 32), 255, "the bright subject is kept");
});

test("processing: the source's own transparency is kept; a failing or slow engine names its reason", async () => {
  const half = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 30, g: 40, b: 50, alpha: 0.5 } } }).png().toBuffer();
  const keepAll = { name: "all", side: 32, mask: async (_rgb, s) => new Uint8Array(s * s).fill(255) };
  const r = await PR.removeBackgroundBytes(half, keepAll);
  assert.equal((await alphaOf(r.bytes))(20, 20), 128);

  const broken = { name: "x", side: 32, mask: async () => new Uint8Array(3) };
  await assert.rejects(PR.removeBackgroundBytes(half, broken), (e) => e instanceof PR.BgProcessError && e.reason === "model");
  const throws = { name: "x", side: 32, mask: async () => Promise.reject(new Error("boom")) };
  await assert.rejects(PR.removeBackgroundBytes(half, throws), (e) => e.reason === "model");
  const slow = { name: "x", side: 32, mask: () => new Promise(() => undefined) };
  await assert.rejects(PR.removeBackgroundBytes(half, slow, { timeoutMs: 50 }), (e) => e.reason === "timeout");
  await assert.rejects(PR.removeBackgroundBytes(Buffer.from("not an image"), keepAll), (e) => e.reason === "image");
});
