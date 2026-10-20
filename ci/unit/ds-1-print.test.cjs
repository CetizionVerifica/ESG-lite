// DS-1 output (Playwright + Chromium): PDF (screen and print), PNG pages,
// pagination of a 300-row table with a repeating header, window.__measure
// (overflow, safe area, positions within 0.5 mm), proof vs final positions,
// crop marks, fonts and the present shell. Skips when no Chromium is
// installed (GitHub CI sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD); runs locally
// and in the render worker image.
//   npm run build && node --test ci/unit/ds-1-print.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const H = require(path.resolve("dist/reporting/studio/html.js"));
const P = require(path.resolve("dist/reporting/studio/print.js"));
const F = require(path.resolve("ci/golden/ds/render/fixture.cjs"));
const { chromium } = require("playwright");

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
/** A browser test: skipped when Chromium can't launch (GitHub CI sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD). */
const btest = (name, fn) =>
  test(name, async (t) => {
    if (!browser) return t.skip(why);
    await fn(t);
  });

const data = F.fixtureData(R.renderData);
const a4 = F.fixtureDoc("a4");
const opts = (extra = {}) => ({ browser, assets: F.assets, ...extra });

/** Loads a document in a fresh page and returns the page (caller closes it). */
async function open(doc, d, htmlOpts) {
  const page = await browser.newPage();
  const { document } = H.documentHtml(doc, d, { assets: F.assets, inlineFonts: true, ...htmlOpts });
  await P.loadDocument(page, document);
  return page;
}

const pdfInfo = (buf) => {
  const s = buf.toString("latin1");
  const boxes = [...s.matchAll(/\/MediaBox \[([\d. ]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  return {
    pages: boxes.length,
    box: boxes[0],
    fonts: (s.match(/\/FontFile2|\/FontFile3/g) || []).length,
    tagged: s.includes("/StructTreeRoot"),
    outline: s.includes("/Outlines"),
    toUnicode: (s.match(/\/ToUnicode/g) || []).length,
  };
};
const ptToMm = (pt) => (pt / 72) * 25.4;

btest("PDF (screen): one A4 page per page, tagged, with bookmarks, embedded fonts and extractable text", async () => {
  const r = await P.renderPdf(a4, data, "screen", opts());
  const info = pdfInfo(r.pdf);
  assert.equal(r.pageCount, 16);
  assert.equal(info.pages, 16);
  assert.ok(Math.abs(ptToMm(info.box[2]) - 210) < 0.3 && Math.abs(ptToMm(info.box[3]) - 297) < 0.3, String(info.box));
  assert.ok(info.fonts >= 2, "fonts embedded");
  assert.ok(info.tagged, "tagged");
  assert.ok(info.outline, "bookmarks");
  assert.ok(info.toUnicode >= 2, "text maps to Unicode");
});

btest("PDF (print): 3 mm bleed on every edge of a print format; none on a slide", async () => {
  const r = await P.renderPdf(a4, data, "print", opts({ cropMarks: true }));
  const info = pdfInfo(r.pdf);
  assert.equal(r.pageCount, 16);
  assert.ok(Math.abs(ptToMm(info.box[2]) - 216) < 0.3 && Math.abs(ptToMm(info.box[3]) - 303) < 0.3, String(info.box));
  const slide = await P.renderPdf(F.fixtureDoc("slide_16_9"), data, "print", opts({ cropMarks: true }));
  const s = pdfInfo(slide.pdf);
  assert.ok(Math.abs(ptToMm(s.box[2]) - 338.7) < 0.3 && Math.abs(ptToMm(s.box[3]) - 190.5) < 0.3, String(s.box));
});

btest("every format renders: one sheet per free-form page, the page box is the format", async () => {
  for (const f of Object.keys(F.SIZES)) {
    const doc = F.fixtureDoc(f);
    const page = await open(doc, data, { mode: "paged" });
    try {
      const sizes = await page.evaluate(() => Array.from(document.querySelectorAll(".pagedjs_page")).map((p) => [p.getBoundingClientRect().width, p.getBoundingClientRect().height]));
      const [w, h] = F.SIZES[f];
      for (const [pw, ph] of sizes) {
        assert.ok(Math.abs(pw / R.PX_PER_MM - w) < 0.5 && Math.abs(ph / R.PX_PER_MM - h) < 0.5, `${f}: ${pw}×${ph}`);
      }
      // Free-form sheets never split: each lands whole on one page.
      const sheetPages = await page.evaluate(() => Array.from(document.querySelectorAll(".ds-sheet")).map((s) => s.closest(".pagedjs_page")?.getAttribute("data-page-number")));
      assert.equal(new Set(sheetPages).size, sheetPages.length, `${f}: a sheet split across pages`);
      assert.equal(sheetPages.length, 4, f);
    } finally {
      await page.close();
    }
  }
});

btest("a 300-row table paginates: every row once, none split, the header repeated on each page", async () => {
  const big = F.fixtureData(R.renderData, { dataRows: 300 });
  const page = await open(a4, big, { mode: "paged" });
  try {
    const res = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll(".pagedjs_page")).filter((p) => p.querySelector('[data-page-id="f-data"], [data-split-from]') && p.querySelector(".ds-data-table"));
      const rows = [];
      const perPage = pages.map((p) => {
        const t = p.querySelector(".ds-data-table");
        const r = Array.from(t.querySelectorAll("tbody tr")).map((tr) => tr.textContent);
        rows.push(...r);
        const area = p.querySelector(".pagedjs_area").getBoundingClientRect();
        const last = t.querySelector("tbody tr:last-child").getBoundingClientRect();
        return { head: !!t.querySelector("thead th"), n: r.length, inside: last.bottom <= area.bottom + 1 };
      });
      return { perPage, rows };
    });
    assert.ok(res.perPage.length >= 8, `pages: ${res.perPage.length}`);
    for (const [i, p] of res.perPage.entries()) {
      assert.ok(p.head, `page ${i + 1} of the table has no header`);
      assert.ok(p.inside, `page ${i + 1} overflows its area`);
    }
    const dataRows = res.rows.filter((t) => /^Row \d+/.test(t));
    assert.equal(dataRows.length, 300);
    assert.equal(new Set(dataRows).size, 300);
  } finally {
    await page.close();
  }
});

btest("__measure: text overflow, safe-area breaches, small fonts, and elements within 0.5 mm of their frames", async () => {
  const page = await open(a4, data, { mode: "sheet" });
  try {
    const m = await page.evaluate(() => window.__measure());
    const by = Object.fromEntries(m.map((x) => [x.elementId, x]));
    assert.ok(by["p-el.overflow"].overflowMm > 2, JSON.stringify(by["p-el.overflow"]));
    assert.equal(by["p-summary.body"].overflowMm, 0);
    assert.equal(by["p-el.unsafe"].outsideSafe, true);
    assert.equal(by["p-cover.bg"].outsideSafe, false, "a bleed frame is exempt");
    assert.equal(by["p-cover.bg"].bleed, true);
    assert.equal(by["p-summary.tile1"].outsideSafe, false);
    assert.ok(by["p-el.tiny"].minFontPt < 8);
    assert.ok(by["p-cover.title"].contrast > 4.5, "white title on the dark cover");
    assert.ok(!("p-el.hidden" in by));
    for (const page of a4.pages) {
      if (page.kind !== "freeform" || page.hidden) continue;
      for (const e of page.elements) {
        if (e.hidden || e.frame.rotation) continue;
        const r = by[e.id].rectMm;
        for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(r[k] - e.frame[k]) < 0.5, `${e.id}.${k}: ${r[k]} vs ${e.frame[k]}`);
      }
    }
  } finally {
    await page.close();
  }
});

btest("proof and final place every element identically; screen and print PDFs too", async () => {
  const rect = (ms) => Object.fromEntries(ms.map((m) => [m.elementId, m.rectMm]));
  const proof = await P.renderPdf(a4, data, "screen", opts({ watermark: "PROOF" }));
  const final = await P.renderPdf(a4, data, "screen", opts());
  const print = await P.renderPdf(a4, data, "print", opts({ cropMarks: true }));
  assert.equal(proof.pageCount, final.pageCount);
  assert.equal(print.pageCount, final.pageCount);
  assert.deepEqual(rect(proof.measurements), rect(final.measurements));
  assert.deepEqual(rect(print.measurements), rect(final.measurements));
  // The text content stream of the final is the proof's minus the watermark.
  const text = (buf) => {
    const s = buf.toString("latin1");
    let out = "";
    for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        out += zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
      } catch {
        /* not deflated */
      }
    }
    return (out.match(/BT[\s\S]*?ET/g) || []).length;
  };
  assert.ok(text(proof.pdf) >= text(final.pdf));
});

btest("print mode draws crop marks only when asked", async () => {
  for (const marks of [true, false]) {
    const page = await open(a4, data, { mode: "print", cropMarks: marks });
    try {
      const shown = await page.evaluate(() => Array.from(document.querySelectorAll(".pagedjs_marks-crop")).some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
      assert.equal(shown, marks);
    } finally {
      await page.close();
    }
  }
});

btest("the bundled fonts load (no system fonts) and page numbers are filled after pagination", async () => {
  const page = await open(a4, data, { mode: "paged" });
  try {
    const fonts = await page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
    assert.ok(fonts.includes("Fraunces"), fonts.join());
    assert.ok(fonts.includes("Source Sans 3"), fonts.join());
    const pn = await page.evaluate(() => {
      const el = document.querySelector('[data-el-id="p-summary.pn"]');
      return el.textContent.replace(/\s+/g, " ").trim();
    });
    assert.equal(pn, "3 of 16");
    const toc = await page.evaluate(() => getComputedStyle(document.querySelector(".ds-toc-link"), "::after").content);
    // Paged.js resolved target-counter() into a per-target counter (the page number is drawn from it).
    assert.match(toc, /^counter\(target-counter-/);
  } finally {
    await page.close();
  }
});

btest("PNG: one image per paginated page at the device scale; a page range selects", async () => {
  const all = await P.renderPng(a4, data, null, 1, opts());
  assert.equal(all.length, 16);
  assert.equal(all[0].pageId, "p-cover");
  const two = await P.renderPng(a4, data, [1, 3], 2, opts());
  assert.deepEqual(two.map((p) => p.n), [1, 3]);
  const size = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
  const [w1, h1] = size(all[0].png);
  const [w2, h2] = size(two[0].png);
  assert.ok(Math.abs(w1 - 794) <= 2 && Math.abs(h1 - 1123) <= 2, `${w1}×${h1}`);
  assert.ok(Math.abs(w2 - 2 * w1) <= 2 && Math.abs(h2 - 2 * h1) <= 2, `${w2}×${h2}`);
  assert.equal(two[1].pageId, "p-summary");
});

btest("present mode shows one page at a time and moves with the arrow keys", async () => {
  const page = await open(a4, data, { mode: "present" });
  try {
    const current = () => page.evaluate(() => Array.from(document.querySelectorAll(".is-current")).map((e) => e.getAttribute("data-page-id")));
    assert.deepEqual(await current(), ["p-cover"]);
    await page.keyboard.press("ArrowRight");
    assert.deepEqual(await current(), ["f-toc"]);
    await page.keyboard.press("End");
    assert.deepEqual(await current(), ["f-s3"]);
    await page.keyboard.press("Home");
    assert.deepEqual(await current(), ["p-cover"]);
    assert.equal(await page.evaluate(() => document.body.textContent.includes("Speaker notes")), false);
  } finally {
    await page.close();
  }
});
