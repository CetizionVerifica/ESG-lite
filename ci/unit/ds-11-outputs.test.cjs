// DS-11 pure logic and output goldens:
//   - zip (STORE): CRC-32, layout readable by `unzip`-style parsing, deterministic;
//   - storage keys: format, randomness, no path escape;
//   - worker helpers: failure reasons, retry rule, PNG scale, page ranges, the time limit;
//   - view-link tokens: 32 random bytes, sha256, states, the link base;
//   - file names, the viewer page (escaping, CSP-safe), the preview bridge (CSP meta);
//   - goldens (Chromium; skipped without it): the print PDF has a 3 mm bleed
//     MediaBox, a TrimBox and BleedBox, and crop marks only when asked; PNG
//     page dimensions per format at 2×.
//   npm run build && node --test ci/unit/ds-11-outputs.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");

const Z = require(path.resolve("dist/studio/jobs/zip.js"));
const S = require(path.resolve("dist/studio/jobs/storage.js"));
const W = require(path.resolve("dist/studio/jobs/worker.js"));
const J = require(path.resolve("dist/studio/jobs/service.js"));
const SH = require(path.resolve("dist/studio/share/service.js"));
const V = require(path.resolve("dist/studio/share/viewer.js"));
const PV = require(path.resolve("dist/studio/jobs/preview.js"));
const PB = require(path.resolve("dist/studio/jobs/printBoxes.js"));
const C = require(path.resolve("dist/studio/contracts/index.js"));
const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const P = require(path.resolve("dist/reporting/studio/print.js"));
const F = require(path.resolve("ci/golden/ds/render/fixture.cjs"));
const { chromium } = require("playwright");

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

function unzip(buf) {
  const out = [];
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
    const data = buf.subarray(i + 30 + nameLen, i + 30 + nameLen + size);
    out.push({ method, crc, name, data });
    i += 30 + nameLen + size;
  }
  const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return { entries: out, count: buf.readUInt16LE(cd + 10), cdOffset: buf.readUInt32LE(cd + 16), localEnd: i };
}

test("zip: CRC-32 check value, stored entries round-trip, central directory consistent, deterministic", () => {
  assert.equal(Z.crc32(Buffer.from("123456789")), 0xcbf43926);
  if (zlib.crc32) assert.equal(Z.crc32(Buffer.from("hello world")), zlib.crc32(Buffer.from("hello world")));
  const a = Buffer.from("first page");
  const b = crypto.randomBytes(5000);
  const zip = Z.zipStore([
    { name: "page-01.png", data: a },
    { name: "page-02.png", data: b },
  ]);
  const u = unzip(zip);
  assert.equal(u.count, 2);
  assert.equal(u.cdOffset, u.localEnd, "the central directory follows the entries");
  assert.deepEqual(u.entries.map((e) => [e.name, e.method]), [["page-01.png", 0], ["page-02.png", 0]]);
  assert.ok(u.entries[0].data.equals(a) && u.entries[1].data.equals(b));
  assert.equal(u.entries[1].crc, Z.crc32(b));
  assert.ok(Z.zipStore([{ name: "x", data: a }]).equals(Z.zipStore([{ name: "x", data: a }])), "same input, same bytes");
  assert.equal(unzip(Z.zipStore([{ name: "../../etc/passwd", data: a }])).entries[0].name, ".._.._etc_passwd", "names are flattened");
  assert.equal(unzip(Z.zipStore([])).count, 0);
});

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

test("storage: keys are studio/<company>/<doc>/<n>-<kind>-<random>.<ext>, unique, and never escape the folder", () => {
  const k = S.outputKey(7, 42, 3, "final", "pdf");
  assert.match(k, /^studio\/7\/42\/3-final-[0-9a-f]{32}\.pdf$/);
  assert.notEqual(S.outputKey(7, 42, 3, "final", "pdf"), k, "random part");
  assert.match(S.outputKey(1, 2, "j9", "png", "zip"), /^studio\/1\/2\/j9-png-[0-9a-f]{32}\.zip$/);
  assert.match(S.outputKey(1, 2, "../x", "pro/of", "p.df"), /^studio\/1\/2\/x-proof-[0-9a-f]{32}\.pdf$/, "no user text or separators");
  assert.ok(S.localOutputPath(k).endsWith(path.join("local-private", "studio", "7", "42", path.basename(k))));
  for (const bad of ["../x.pdf", "studio/../../x", "/etc/passwd", "studio//x", "studio/a b.pdf", ""]) assert.equal(S.localOutputPath(bad), null, bad);
});

// ---------------------------------------------------------------------------
// worker helpers
// ---------------------------------------------------------------------------

test("worker: failure reasons, retry rule, PNG scale, page ranges and the time limit", async () => {
  const timeout = new W.JobTimeout(10);
  assert.equal(W.failureReason(timeout), "timeout");
  assert.equal(W.failureReason(new Error("page.waitForFunction: Timeout 120000ms exceeded")), "timeout");
  assert.equal(W.failureReason(new Error("browserType.launch: Executable doesn't exist at /x")), "chromium");
  assert.equal(W.failureReason(new Error("Studio render failed in the page: boom")), "measure");
  assert.equal(W.failureReason(new Error("Failed to decode downloaded font")), "font");
  assert.equal(W.failureReason(new Error("ENOSPC: no space left on device")), "storage");
  assert.equal(W.failureReason(new C.DsError("DS_KIND_OFF")), "data");
  assert.equal(W.retryable("data"), false);
  assert.equal(W.retryable("timeout"), true);
  assert.equal(W.pngScale(144), 2);
  assert.equal(W.pngScale(undefined), 2);
  assert.equal(W.pngScale(300), 300 / 96);
  assert.deepEqual(W.pageRange([2, 5]), [2, 3, 4, 5]);
  assert.equal(W.pageRange(undefined), null);
  let fired = false;
  await assert.rejects(W.withTimeout(() => new Promise((r) => setTimeout(r, 200)), 20, () => (fired = true)), (e) => e.name === "TimeoutError");
  assert.ok(fired, "onTimeout runs (the worker closes Chromium)");
  assert.equal(await W.withTimeout(async () => 7, 1000), 7);
  await assert.rejects(W.withTimeout(async () => Promise.reject(new Error("x")), 1000), /x/);
  assert.equal(W.JOB_MAX_ATTEMPTS, 2, "retry once");
});

// ---------------------------------------------------------------------------
// view links
// ---------------------------------------------------------------------------

test("view links: 32-byte base64url tokens stored as sha256; states; where links point", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = SH.newToken();
    assert.match(t, SH.TOKEN_RE);
    assert.equal(Buffer.from(t, "base64url").length, 32);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  assert.equal(SH.tokenHash("abc"), crypto.createHash("sha256").update("abc").digest("hex"));
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(SH.shareState({ revoked_at: null, expires_at: "2026-10-21T00:00:00Z" }, now), "active");
  assert.equal(SH.shareState({ revoked_at: null, expires_at: "2026-10-20T12:00:00Z" }, now), "expired");
  assert.equal(SH.shareState({ revoked_at: "2026-10-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" }, now), "revoked");
  const keep = { SHARE_BASE_URL: process.env.SHARE_BASE_URL, FRONTEND_URL: process.env.FRONTEND_URL };
  try {
    delete process.env.SHARE_BASE_URL;
    delete process.env.FRONTEND_URL;
    assert.equal(SH.shareBase("http://api.local:3000"), "http://api.local:3000");
    process.env.FRONTEND_URL = "https://app.example/";
    assert.equal(SH.shareBase("http://api.local:3000"), "https://app.example");
    process.env.SHARE_BASE_URL = "https://view.example";
    assert.equal(SH.shareBase("http://api.local:3000"), "https://view.example");
  } finally {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
  // Contract: 14 days by default, at most 90, one target.
  assert.equal(C.CreateShareBodySchema.parse({ versionId: 1 }).expiresInDays, 14);
  assert.equal(C.CreateShareBodySchema.safeParse({ versionId: 1, expiresInDays: 91 }).success, false);
  assert.equal(C.CreateShareBodySchema.safeParse({ versionId: 1, jobId: 2 }).success, false);
  assert.equal(C.CreateShareBodySchema.safeParse({}).success, false);
});

test("names and pages: file stems, the viewer page escapes text, the preview carries its CSP", () => {
  assert.equal(J.fileStem("Acme Ltd. (India)", "ghg", 2025), "Acme-Ltd-India-GHG-Report-2025");
  assert.equal(J.fileStem("Énergie Verte", "sustainability", 2026), "Energie-Verte-Sustainability-Report-2026");
  assert.equal(J.fileStem("!!!", "ghg", 2025), "Report-GHG-Report-2025");
  const share = { title: `<script>alert(1)</script>`, company: `A & "B"`, label: "Final v2", expiresAt: "2026-11-03T00:00:00Z", pageCount: 22 };
  const html = V.viewerHtml(share, null, "/s/tok/file");
  assert.ok(!html.includes("<script>alert"), "title escaped");
  assert.ok(html.includes("&lt;script&gt;") && html.includes("A &amp; &quot;B&quot;"));
  assert.ok(!/<script/i.test(html), "the viewer runs no script");
  assert.ok(html.includes('src="/s/tok/file"') && html.includes("3 November 2026") && html.includes("22 pages"));
  assert.ok(V.messageHtml(410).includes("This link has expired"));
  assert.match(V.VIEWER_CSP, /default-src 'none'/);
  const doc = PV.withBridge("<!doctype html><html><head><title>x</title></head><body><p>x</p></body></html>");
  assert.ok(doc.indexOf('http-equiv="Content-Security-Policy"') < doc.indexOf("<title>"), "the CSP meta comes first in head");
  assert.ok(doc.indexOf("ds-preview") < doc.indexOf("</body>"));
  assert.match(PV.PREVIEW_CSP, /default-src 'none'; img-src data:; font-src data:/);
});

// ---------------------------------------------------------------------------
// Goldens (Chromium)
// ---------------------------------------------------------------------------

let browser = null;
let why = "";
test.before(async () => {
  try {
    browser = await chromium.launch();
  } catch (err) {
    why = `Chromium is not installed (${String(err.message).split("\n")[0]})`;
  }
});
test.after(async () => {
  if (browser) await browser.close();
});
const btest = (name, fn) =>
  test(name, async (t) => {
    if (!browser) return t.skip(why);
    await fn(t);
  });

const data = F.fixtureData(R.renderData);
const boxes = (buf, name) =>
  [...buf.toString("latin1").matchAll(new RegExp(`/${name} \\[([\\d. ]+)\\]`, "g"))].map((m) => m[1].trim().split(/\s+/).map((n) => (Number(n) / 72) * 25.4));
/** Line-drawing operators in the PDF's (deflated) content streams. */
function lineOps(buf) {
  const s = buf.toString("latin1");
  let n = 0;
  for (let i = 0; ; ) {
    const a = s.indexOf("stream\n", i);
    if (a < 0) break;
    const b = s.indexOf("endstream", a);
    try {
      n += (zlib.inflateSync(buf.subarray(a + 7, b)).toString("latin1").match(/ l\n/g) || []).length;
    } catch {
      /* not a deflated stream */
    }
    i = b + 9;
  }
  return n;
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

btest("golden: the print PDF has a 3 mm bleed MediaBox, TrimBox and BleedBox, and crop marks only when asked", async () => {
  const doc = F.fixtureDoc("a4");
  const plain = await P.renderPdf(doc, data, "print", { browser, assets: F.assets, cropMarks: false });
  const marked = await P.renderPdf(doc, data, "print", { browser, assets: F.assets, cropMarks: true });
  const pdf = await PB.setPrintBoxes(marked.pdf, 3);
  const media = boxes(pdf, "MediaBox");
  const trim = boxes(pdf, "TrimBox");
  const bleed = boxes(pdf, "BleedBox");
  assert.equal(media.length, marked.pageCount);
  assert.equal(trim.length, marked.pageCount);
  assert.equal(bleed.length, marked.pageCount);
  for (let i = 0; i < media.length; i++) {
    close(media[i][2] - media[i][0], 216, 0.3, "media width");
    close(media[i][3] - media[i][1], 303, 0.3, "media height");
    close(trim[i][0], 3, 0.05, "trim x");
    close(trim[i][2] - trim[i][0], 210, 0.3, "trim width");
    close(trim[i][3] - trim[i][1], 297, 0.3, "trim height");
    assert.deepEqual(bleed[i], media[i]);
  }
  // Crop marks are vector lines outside the trim: each page gains them only when asked.
  assert.ok(lineOps(marked.pdf) - lineOps(plain.pdf) >= 8 * marked.pageCount, `${lineOps(marked.pdf)} vs ${lineOps(plain.pdf)}`);
  // Post-processing keeps the text, tags and bookmarks.
  const s = pdf.toString("latin1");
  assert.ok(s.includes("/StructTreeRoot") && s.includes("/Outlines"));
  // Screen formats have no bleed, so nothing changes.
  const same = await PB.setPrintBoxes(plain.pdf, 0);
  assert.equal(same, plain.pdf);
});

btest("golden: PNG pages are the format's size at 2× for every format", async () => {
  for (const f of Object.keys(F.SIZES)) {
    const doc = F.fixtureDoc(f);
    const pages = await P.renderPng(doc, data, [1], W.pngScale(144), { browser, assets: F.assets });
    assert.equal(pages.length, 1, f);
    const png = pages[0].png;
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    const want = R.formatPx(f);
    close(w, want.w * 2, 4, `${f} width`);
    close(h, want.h * 2, 4, `${f} height`);
  }
});
