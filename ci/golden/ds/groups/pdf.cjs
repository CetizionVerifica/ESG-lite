// DS-14F golden group "pdf" (DS-11, DS-12): preview equals PDF, and the print PDF's boxes.
// On a copy of the cement company's GHG Inventory (POST /docs/:id/duplicate, so the seed doc
// the "checks" group reads stays as built), with the report details a final needs:
//   pdf/proof-vs-final   a proof and a final of the same rev: the same page count, the same text
//                        on every page, every text run within 0.5 mm (pdfjs-dist text positions).
//                        A difference throws; the golden keeps page count and text per page.
//   pdf/print-bleed-box  a print PDF (3 mm bleed, crop marks): MediaBox, TrimBox and BleedBox per
//                        page in mm (pdf-lib), the same on every page, the trim box the format.
// Needs Chromium: run.cjs skips the group, named, where it can't start ("chromium" in cases.json).
const path = require("path");
const { ensureSeed } = require("../lib/seed.cjs");

const PT_MM = 25.4 / 72;
const mm1 = (pt) => Math.round(pt * PT_MM * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scope 3 categories without data excluded with a reason; the other details a final needs. */
const readyInputs = (withData) => ({
  consolidation_approach: { value: "Operational control" },
  responsible_person: { value: "Head of Sustainability, DS Seed Cement" },
  uncertainty_statement: { value: "Activity data is metered or invoiced; factor uncertainty follows the published factor sources." },
  verification: { value: { status: "none" } },
  exclusions: {
    value: Array.from({ length: 15 }, (_, i) => i + 1)
      .filter((n) => !withData.includes(n))
      .map((n) => ({ what: `Category ${n}`, reason: "Not relevant for a cement producer in the Scope 3 screening." })),
  },
});

async function waitJob(ctx, who, id) {
  const until = Date.now() + 5 * 60 * 1000;
  for (;;) {
    const r = await ctx.call("GET", `/studio/jobs/${id}`, who);
    if (r.status !== 200) throw new Error(`GET /studio/jobs/${id}: ${r.status}`);
    if (r.json.status === "done") return r.json;
    if (r.json.status === "failed") throw new Error(`job ${id} (${r.json.kind}) failed: ${JSON.stringify(r.json).slice(0, 400)}`);
    if (Date.now() > until) throw new Error(`job ${id} still ${r.json.status}`);
    await sleep(500);
  }
}

async function render(ctx, who, docId, body) {
  const r = await ctx.call("POST", `/studio/docs/${docId}/jobs`, who, body);
  if (r.status !== 202) throw new Error(`${body.kind} job: ${r.status} ${JSON.stringify(r.json).slice(0, 600)}`);
  const job = await waitJob(ctx, who, r.json.id);
  const f = await ctx.call("GET", `/studio/jobs/${job.id}/file`, who);
  if (f.status !== 200 || !f.buffer?.length) throw new Error(`${body.kind} file: ${f.status}`);
  return { job, pdf: f.buffer };
}

/** Text runs per page: [{str, x, y}] in mm, from pdfjs-dist (legacy build: Node, no worker, no canvas). */
async function textRuns(root, buf) {
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs", { paths: [root] }));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.filter((i) => typeof i.str === "string" && i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4] * PT_MM, y: i.transform[5] * PT_MM })));
  }
  await doc.destroy();
  return pages;
}

async function prepare(ctx) {
  if (ctx.pdfSeed) return ctx.pdfSeed;
  const { docs } = await ensureSeed(ctx);
  const src = docs["cement/ghg-inventory-classic"];
  const who = src.company.who;
  const dup = await ctx.call("POST", `/studio/docs/${src.id}/duplicate`, who, { title: "DS golden PDF Inventory" });
  if (dup.status !== 201) throw new Error(`duplicate: ${dup.status} ${JSON.stringify(dup.json)}`);
  const id = dup.json.id;
  const withData = (await ctx.q(`SELECT DISTINCT c.ghg_category AS n FROM emission e JOIN category c ON c.category_id = e.category_id JOIN site s ON s.site_id = e.site_id WHERE s.company_id = 11 AND e.status = 'approved' AND c.ghg_category IS NOT NULL`)).map((r) => r.n);
  const cur = await ctx.call("GET", `/studio/docs/${id}/inputs`, who);
  const p = await ctx.call("PATCH", `/studio/docs/${id}/inputs`, who, { rev: cur.json.rev, inputs: readyInputs(withData) });
  if (p.status !== 200) throw new Error(`inputs: ${p.status} ${JSON.stringify(p.json).slice(0, 300)}`);
  let rev = p.json.rev;
  // A person removes the template's empty placeholders (signature, offsets, targets, statement) before a final.
  const pre = await ctx.call("POST", `/studio/docs/${id}/checks`, who, { rev });
  const empty = new Set(pre.json.checks.filter((x) => x.id === "EMPTY_PLACEHOLDER" && x.elementId).map((x) => x.elementId));
  if (empty.size) {
    const cur = (await ctx.call("GET", `/studio/docs/${id}`, who)).json;
    const doc = cur.doc;
    for (const page of doc.pages) if (page.kind !== "flow") page.elements = page.elements.filter((e) => !empty.has(e.id));
    const patched = await ctx.call("PATCH", `/studio/docs/${id}`, who, { rev: cur.rev, doc });
    if (patched.status !== 200) throw new Error(`removing the empty placeholders: ${patched.status} ${JSON.stringify(patched.json).slice(0, 300)}`);
    rev = patched.json.rev;
  }
  const proof = await render(ctx, who, id, { kind: "proof", rev });
  // The proof's measurements now count in the gate (layout checks): ask again, acknowledge the warnings.
  const c = await ctx.call("POST", `/studio/docs/${id}/checks`, who, { rev });
  const errors = c.json.checks.filter((x) => x.severity === "error");
  if (errors.length) throw new Error(`a final is blocked: ${errors.map((e) => `${e.id}@${e.elementId ?? e.pageId ?? ""}`).join(", ")}`);
  const final = await render(ctx, who, id, { kind: "final", rev, acknowledgedWarnings: c.json.warnings });
  ctx.pdfSeed = { id, rev, who, proof, final, layout: c.json.layout, warnings: c.json.warnings, removedPlaceholders: [...empty].sort() };
  return ctx.pdfSeed;
}

module.exports = async function pdf(ctx, kase) {
  const s = await prepare(ctx);
  if (kase.id === "pdf/proof-vs-final") {
    const a = await textRuns(ctx.root, s.proof.pdf);
    const b = await textRuns(ctx.root, s.final.pdf);
    if (a.length !== b.length) throw new Error(`proof has ${a.length} pages, final ${b.length}`);
    let worst = 0;
    const pages = a.map((runs, i) => {
      const other = b[i];
      const ta = runs.map((r) => r.str).join(" ");
      const tb = other.map((r) => r.str).join(" ");
      if (ta !== tb) throw new Error(`page ${i + 1}: the text differs\n  proof: ${ta.slice(0, 300)}\n  final: ${tb.slice(0, 300)}`);
      runs.forEach((r, j) => (worst = Math.max(worst, Math.abs(r.x - other[j].x), Math.abs(r.y - other[j].y))));
      return `${i + 1}: ${runs.length} runs | ${ta.replace(/\s+/g, " ").slice(0, 90)}`;
    });
    if (worst > 0.5) throw new Error(`a text run moved ${worst.toFixed(3)} mm between proof and final`);
    return {
      doc: "cement GHG Inventory (Classic), FY 2026",
      removedPlaceholders: s.removedPlaceholders,
      layoutChecks: s.layout,
      acknowledgedWarnings: s.warnings,
      proof: { pages: s.proof.job.pageCount ?? a.length },
      final: { pages: s.final.job.pageCount ?? b.length, versionKind: "final" },
      sameText: true,
      positionsWithinHalfMm: true,
      textPerPage: pages,
    };
  }
  // pdf/print-bleed-box
  const { PDFDocument } = require(require.resolve("pdf-lib", { paths: [ctx.root] }));
  const print = await render(ctx, s.who, s.id, { kind: "print", rev: s.rev, options: { cropMarks: true } });
  const doc = await PDFDocument.load(print.pdf);
  const box = (b) => [mm1(b.x), mm1(b.y), mm1(b.width), mm1(b.height)];
  const pages = doc.getPages().map((p) => ({ media: box(p.getMediaBox()), trim: box(p.getTrimBox()), bleed: box(p.getBleedBox()) }));
  const first = JSON.stringify(pages[0]);
  const same = pages.every((p) => JSON.stringify(p) === first);
  if (!same) throw new Error(`pages differ in their boxes: ${JSON.stringify(pages.slice(0, 3))}`);
  const proofPages = (await PDFDocument.load(s.proof.pdf)).getPageCount();
  return {
    doc: "cement GHG Inventory (Classic), FY 2026, A4",
    pages: pages.length,
    sameAsProof: pages.length === proofPages,
    boxesMm: pages[0],
    allPagesSame: same,
    trimIsA4: Math.abs(pages[0].trim[2] - 210) <= 0.5 && Math.abs(pages[0].trim[3] - 297) <= 0.5, // Chromium sizes pages in whole CSS px (0.1 mm short)
    bleedMm: Math.round((pages[0].media[2] - pages[0].trim[2]) * 5) / 10,
  };
};
