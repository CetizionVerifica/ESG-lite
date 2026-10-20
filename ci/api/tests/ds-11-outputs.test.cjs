// DS-11 outputs: GET /studio/docs/:id/preview.html, POST /docs/:id/jobs,
// GET /docs/:id/jobs, GET /jobs/:id(/file), versions (list, snapshot,
// restore, pdf), view links (POST/GET /docs/:id/shares, DELETE /shares/:id)
// and the public /s/:token, /s/:token/meta, /s/:token/file.
//
//   - switch off (DS_STUDIO_OFF) on every route; Users get DS_ROLE;
//   - tenant isolation: another company's docs, jobs, versions and links are
//     not found; a Superadmin names the company;
//   - preview: modes, CSP, one page, the doc's text; rev conflicts on jobs;
//   - jobs (rendered in-process under NODE_ENV=test): proof, print (bleed),
//     PNG (zip, page range, dimensions), the file is the stored bytes and no
//     storage key ever reaches a response;
//   - finals: Manager only, the GHG gate (pending entries), a note when a final
//     exists, DS_JOB_RUNNING, the version keeps doc, data snapshot, hashes and
//     the PDF; the earlier final is superseded;
//   - versions: named snapshot, restore (rev checked), stored PDF;
//   - view links: Manager only, token shown once and stored hashed, 14 days by
//     default and at most 90, views counted, revoked/expired/studio off → 410,
//     unknown → 404, the viewer only ever gets the stored PDF (not live data),
//     audit rows for create, view and revoke;
//   - migrate:ds-11-outputs runs twice.
//
// Render tests need Chromium (Playwright); they skip when it can't launch, as
// ci/unit/ds-1-print.test.cjs does.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3), company 2
// (site 3; other manager 6), superadmin 5. CY 2025 has 2 pending entries on
// company 1; CY 2023 has none.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/ghg-doc.json"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let chromiumOk = false;
let why = "";
test.before(async () => {
  for (const name of ["migrateDs5Docs", "migrateDs11Outputs", "migrateDs11Outputs"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await reset();
  try {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    await b.close();
    chromiumOk = true;
  } catch (err) {
    why = `Chromium is not installed (${String(err.message).split("\n")[0]})`;
  }
});
test.after(async () => {
  await reset();
  await setStudio(1, false);
  await setStudio(2, false);
});

async function reset() {
  await q(`DELETE FROM report_share WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-11%')`);
  await q(`DELETE FROM report_job WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-11%')`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-11%')`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'DS-11%'`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'report_share'`);
  await setKpi(1, false);
}

/** A render test: skipped without Chromium. */
const rtest = (name, fn) =>
  test(name, async (t) => {
    if (!chromiumOk) return t.skip(why);
    await fn(t);
  });

/** The fixture doc (5 pages: 3 sheets, 2 flow sections), for a year, without its sample images. */
const fixtureDoc = (year, title) => {
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.meta = { ...d.meta, year, title, compareYear: year - 1 };
  d.assets = [];
  for (const p of d.pages) if (p.elements) p.elements = p.elements.filter((e) => !(e.props && e.props.assetId));
  return d;
};

/** A company-1 design with the fixture pages, made through the DS-5 API. */
async function makeDoc(year = 2025, title = `DS-11 Doc ${year}`, who = "manager") {
  const c = await call("POST", "/studio/docs", who, { kind: "ghg", templateId: "blank", year, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, format: "a4", title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const p = await call("PATCH", `/studio/docs/${c.json.id}`, who, { rev: c.json.rev, doc: fixtureDoc(year, title) });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return { id: c.json.id, rev: p.json.rev };
}

async function waitJob(id, who = "manager", ms = 120_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await call("GET", `/studio/jobs/${id}`, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (r.json.status === "done" || r.json.status === "failed") return r.json;
    if (Date.now() > until) throw new Error(`job ${id} still ${r.json.status}`);
    await wait(400);
  }
}

const job = async (docId, body, who = "manager") => call("POST", `/studio/docs/${docId}/jobs`, who, body);

const pdfBoxesMm = (buf) =>
  [...buf.toString("latin1").matchAll(/\/MediaBox \[([\d. ]+)\]/g)].map((m) =>
    m[1]
      .trim()
      .split(/\s+/)
      .map(Number)
      .slice(2)
      .map((pt) => Math.round(((pt / 72) * 25.4) * 10) / 10),
  );

/** Entries of a STORE zip: [{name, data}]. */
function unzip(buf) {
  const out = [];
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extra;
    out.push({ name, data: buf.subarray(start, start + size), crc: buf.readUInt32LE(i + 14) });
    i = start + size;
  }
  return out;
}
const pngSize = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

// ---------------------------------------------------------------------------

test("switch off: every DS-11 route answers DS_STUDIO_OFF; Users get DS_ROLE once it's on", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Switch");
  await setStudio(1, false);
  const routes = [
    ["GET", `/studio/docs/${doc.id}/preview.html?mode=paged`],
    ["POST", `/studio/docs/${doc.id}/jobs`, { kind: "proof", rev: doc.rev }],
    ["GET", `/studio/docs/${doc.id}/jobs`],
    ["GET", `/studio/jobs/1`],
    ["GET", `/studio/jobs/1/file`],
    ["GET", `/studio/docs/${doc.id}/versions`],
    ["POST", `/studio/docs/${doc.id}/versions`, { note: "x" }],
    ["POST", `/studio/docs/${doc.id}/versions/1/restore`, { rev: doc.rev }],
    ["GET", `/studio/docs/${doc.id}/versions/1/pdf`],
    ["POST", `/studio/docs/${doc.id}/shares`, { versionId: 1 }],
    ["GET", `/studio/docs/${doc.id}/shares`],
    ["DELETE", `/studio/shares/1`],
  ];
  for (const [m, p, b] of routes) {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call(m, p, who, b);
      assert.equal(r.status, 403, `${who} ${m} ${p}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF", `${who} ${m} ${p}`);
    }
  }
  await setStudio(1, true);
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "user", b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.code, "DS_ROLE", `${m} ${p}`);
    assert.equal((await call(m, p, undefined, b)).status, 401, `no session ${m} ${p}`);
  }
});

test("preview.html: paged, sheet, present and print modes from the one renderer, with a CSP and the bridge", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Preview");
  for (const mode of ["paged", "sheet", "present", "print"]) {
    const r = await call("GET", `/studio/docs/${doc.id}/preview.html?mode=${mode}`, mode === "sheet" ? "admin" : "manager");
    assert.equal(r.status, 200, mode);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(r.headers.get("x-doc-rev"), String(doc.rev));
    const html = r.buffer.toString("utf8");
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "the CSP also sits in a meta for srcdoc frames");
    assert.ok(html.includes("ds-preview"), "the bridge script");
    assert.ok(html.includes("DS-11 Preview"), "the doc's title");
    assert.ok(html.includes('data-page-id="p-summary"'));
    assert.ok(!/\/studio\/fonts\//.test(html), "fonts are inlined");
    if (mode === "paged" || mode === "print") assert.ok(html.includes("PagedPolyfill"), mode);
    if (mode === "present") assert.ok(html.includes("window.__present"), mode);
  }
  const one = await call("GET", `/studio/docs/${doc.id}/preview.html?mode=sheet&pageId=p-scope3`, "manager");
  assert.equal(one.status, 200);
  const html = one.buffer.toString("utf8");
  assert.ok(html.includes('data-page-id="p-scope3"') && !html.includes('data-page-id="p-summary"'), "one page only");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/preview.html?mode=sheet&pageId=nope`, "manager")).status, 404);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/preview.html?mode=poster`, "manager")).json.code, "DS_VALIDATION");
});

test("tenant isolation: another company's design, jobs, versions and links are not found", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc(2025, "DS-11 Tenant");
  const [j] = await q(
    `INSERT INTO report_job (company_id, doc_id, kind, status, rev, options, requested_by, finished_at, file_key, content_type, bytes, proof_expires_at) VALUES (1, $1, 'proof', 'done', $2, '{}', 2, now(), 'studio/1/0/x-proof-0.pdf', 'application/pdf', 1, now() + interval '7 days') RETURNING id`,
    [doc.id, doc.rev],
  );
  await q(`INSERT INTO report_doc_version (doc_id, n, kind, rev, doc, pdf_r2_key, created_by) VALUES ($1, 90, 'final', $2, '{}'::jsonb, 'studio/1/0/x-final-0.pdf', 2)`, [doc.id, doc.rev]);
  const [v] = await q(`SELECT id FROM report_doc_version WHERE doc_id = $1 AND n = 90`, [doc.id]);
  const [s] = await q(`INSERT INTO report_share (company_id, doc_id, version_id, token_hash, expires_at, created_by) VALUES (1, $1, $2, $3, now() + interval '1 day', 2) RETURNING id`, [doc.id, v.id, sha("tenant-" + doc.id)]);
  const routes = [
    ["GET", `/studio/docs/${doc.id}/preview.html?mode=paged`],
    ["POST", `/studio/docs/${doc.id}/jobs`, { kind: "proof", rev: doc.rev }],
    ["GET", `/studio/docs/${doc.id}/jobs`],
    ["GET", `/studio/jobs/${j.id}`],
    ["GET", `/studio/jobs/${j.id}/file`],
    ["GET", `/studio/docs/${doc.id}/versions`],
    ["POST", `/studio/docs/${doc.id}/versions`, { note: "x" }],
    ["POST", `/studio/docs/${doc.id}/versions/90/restore`, { rev: doc.rev }],
    ["GET", `/studio/docs/${doc.id}/versions/90/pdf`],
    ["POST", `/studio/docs/${doc.id}/shares`, { versionId: v.id }],
    ["GET", `/studio/docs/${doc.id}/shares`],
    ["DELETE", `/studio/shares/${s.id}`],
  ];
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "otherManager", b);
    assert.equal(r.status, 404, `otherManager ${m} ${p}: ${r.status}`);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND", `${m} ${p}`);
    const sep = p.includes("?") ? "&" : "?";
    const sa = await call(m, `${p}${sep}company_id=2`, "superadmin", b ? { ...b, company_id: 2 } : undefined);
    assert.equal(sa.status, 404, `superadmin as company 2: ${m} ${p}`);
  }
  const [still] = await q(`SELECT revoked_at FROM report_share WHERE id = $1`, [s.id]);
  assert.equal(still.revoked_at, null, "another company can't revoke");
  // The Superadmin as company 1 sees them.
  assert.equal((await call("GET", `/studio/docs/${doc.id}/versions?company_id=1`, "superadmin")).status, 200);
  assert.equal((await call("GET", `/studio/jobs/${j.id}?company_id=1`, "superadmin")).status, 200);
  // A site-scoped Manager can't reach a company-wide design's outputs.
  await q(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`);
  try {
    assert.equal((await call("GET", `/studio/jobs/${j.id}`, "manager")).status, 404);
    assert.equal((await call("GET", `/studio/docs/${doc.id}/preview.html`, "manager")).status, 404);
  } finally {
    await q(`INSERT INTO user_sites (user_id, site_id) SELECT 2, 2 WHERE NOT EXISTS (SELECT 1 FROM user_sites WHERE user_id = 2 AND site_id = 2)`);
  }
  await q(`DELETE FROM report_share WHERE id = $1`, [s.id]);
  await q(`DELETE FROM report_job WHERE id = $1`, [j.id]);
});

test("jobs: validation, rev conflicts, roles and options", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Validate");
  const stale = await job(doc.id, { kind: "proof", rev: doc.rev - 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  assert.equal(stale.json.details.rev, doc.rev);
  assert.equal((await job(doc.id, { kind: "poster", rev: doc.rev })).json.code, "DS_VALIDATION");
  assert.equal((await job(doc.id, { kind: "png", rev: doc.rev, options: { pages: [3, 1] } })).json.code, "DS_VALIDATION");
  assert.equal((await job(doc.id, { kind: "png", rev: doc.rev, options: { dpi: 96 } })).json.code, "DS_VALIDATION");
  assert.equal((await job(doc.id, { kind: "thumbnail", rev: doc.rev, options: { pageId: "nope" } })).json.code, "DS_VALIDATION");
  assert.equal((await job(doc.id, { kind: "proof", rev: doc.rev, extra: 1 })).json.code, "DS_VALIDATION");
  const fin = await job(doc.id, { kind: "final", rev: doc.rev }, "admin");
  assert.equal(fin.status, 403, "an Admin can't make a final");
  assert.equal(fin.json.code, "DS_ROLE");
  assert.equal((await call("GET", "/studio/jobs/999999", "manager")).status, 404);
  assert.equal((await call("GET", "/studio/jobs/abc", "manager")).status, 404);
});

rtest("proof: queued at once (202), rendered by the worker, the file is the stored PDF and no storage key leaks", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Proof");
  const r = await job(doc.id, { kind: "proof", rev: doc.rev }, "admin");
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.kind, "proof");
  assert.ok(["queued", "running", "done"].includes(r.json.status));
  const done = await waitJob(r.json.id, "admin");
  assert.equal(done.status, "done", JSON.stringify(done));
  assert.equal(done.downloadUrl, `/studio/jobs/${done.id}/file`);
  assert.match(done.fileName, /-GHG-Report-2025-proof\.pdf$/);
  assert.ok(done.pageCount >= 5, String(done.pageCount));
  assert.ok(done.expiresAt && Date.parse(done.expiresAt) > Date.now() + 6 * 86_400_000, "kept 7 days");
  const [row] = await q(`SELECT file_key, sha256, doc, measurements FROM report_job WHERE id = $1`, [done.id]);
  assert.equal(row.doc, null, "the job's doc copy is cleared when done");
  assert.ok(Array.isArray(row.measurements) && row.measurements.length > 0, "__measure() is kept for checks");
  for (const body of [JSON.stringify(done), JSON.stringify((await call("GET", `/studio/docs/${doc.id}/jobs`, "admin")).json)]) {
    assert.ok(!body.includes(row.file_key), "the storage key never reaches a response");
    assert.ok(!/file_?key|r2/i.test(body), body.slice(0, 200));
  }
  const f = await call("GET", done.downloadUrl, "admin");
  assert.equal(f.status, 200);
  assert.equal(f.headers.get("content-type"), "application/pdf");
  assert.match(f.headers.get("content-disposition"), /^attachment; filename=".*-proof\.pdf"$/);
  assert.equal(f.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(sha(f.buffer), row.sha256);
  const [w0, h0] = pdfBoxesMm(f.buffer)[0];
  assert.ok(Math.abs(w0 - 210) < 0.3 && Math.abs(h0 - 297) < 0.3, `A4 without bleed: ${w0}×${h0}`);
  assert.ok(f.buffer.toString("latin1").includes("/Outlines"), "bookmarks");
  // A report_ready notification for the requester.
  const [n] = await q(`SELECT title, link FROM notification WHERE type = 'report_ready' AND user_id = 3 ORDER BY id DESC LIMIT 1`);
  assert.equal(n.title, "PDF proof is ready");
  assert.equal(n.link, `/studio/${doc.id}/preview`);
  // Expired proofs aren't served.
  await q(`UPDATE report_job SET proof_expires_at = now() - interval '1 minute' WHERE id = $1`, [done.id]);
  assert.equal((await call("GET", done.downloadUrl, "admin")).status, 404);
  assert.equal((await call("GET", `/studio/jobs/${done.id}`, "admin")).json.downloadUrl, null);
});

rtest("print PDF: 3 mm bleed on every edge; PNG pages: a zip of the range at 144 dpi (2×) and 300 dpi", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Print");
  const pr = await job(doc.id, { kind: "print", rev: doc.rev, options: { cropMarks: true } });
  assert.equal(pr.status, 202);
  const png = await job(doc.id, { kind: "png", rev: doc.rev, options: { pages: [1, 2] } });
  const png300 = await job(doc.id, { kind: "png", rev: doc.rev, options: { pages: [1, 1], dpi: 300 } });
  const p = await waitJob(pr.json.id);
  assert.equal(p.status, "done", JSON.stringify(p));
  assert.deepEqual(p.options, { cropMarks: true });
  const pdf = (await call("GET", p.downloadUrl, "manager")).buffer;
  const boxes = pdfBoxesMm(pdf);
  assert.ok(boxes.length >= 5);
  for (const [w, h] of boxes) assert.ok(Math.abs(w - 216) < 0.3 && Math.abs(h - 303) < 0.3, `A4 + 2 × 3 mm bleed: ${w}×${h}`);
  const z = await waitJob(png.json.id);
  assert.equal(z.status, "done", JSON.stringify(z));
  assert.match(z.fileName, /-pages\.zip$/);
  assert.equal(z.pageCount, 2);
  const zip = await call("GET", z.downloadUrl, "manager");
  assert.equal(zip.headers.get("content-type"), "application/zip");
  const entries = unzip(zip.buffer);
  assert.deepEqual(entries.map((e) => e.name), ["page-01.png", "page-02.png"]);
  for (const e of entries) {
    assert.equal(e.data.subarray(1, 4).toString(), "PNG");
    const [w, h] = pngSize(e.data);
    assert.ok(Math.abs(w - 1587) <= 4 && Math.abs(h - 2245) <= 4, `A4 at 2× (±0.5 mm): ${w}×${h}`);
    assert.equal(zlib.crc32 ? zlib.crc32(e.data) : e.crc, e.crc, "crc");
  }
  const z3 = await waitJob(png300.json.id);
  const e3 = unzip((await call("GET", z3.downloadUrl, "manager")).buffer);
  assert.equal(e3.length, 1);
  const [w3, h3] = pngSize(e3[0].data);
  assert.ok(Math.abs(w3 - 2480) <= 6 && Math.abs(h3 - 3508) <= 6, `A4 at 300 dpi (±0.5 mm): ${w3}×${h3}`);
});

rtest("finals: Manager only, the GHG gate, a version with the doc, data snapshot, hashes and stored PDF; notes; supersede", async () => {
  await setStudio(1, true);
  // CY 2025 has pending entries → the gate refuses.
  const blocked = await makeDoc(2025, "DS-11 Final blocked");
  const g = await job(blocked.id, { kind: "final", rev: blocked.rev });
  assert.equal(g.status, 409);
  assert.equal(g.json.code, "DS_CHECKS_BLOCKING");
  assert.equal(g.json.details.checks[0].id, "GHG_PENDING_ENTRIES");
  assert.equal(g.json.details.checks[0].count, 2);
  // CY 2023: nothing pending.
  const doc = await makeDoc(2023, "DS-11 Final");
  const r = await job(doc.id, { kind: "final", rev: doc.rev });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const done = await waitJob(r.json.id);
  assert.equal(done.status, "done", JSON.stringify(done));
  // n counts every version of the design (the build's autosave is 1), so the first final is v2 here.
  const n1 = done.versionN;
  assert.ok(n1 >= 2, String(n1));
  assert.ok(done.fileName.endsWith(`-GHG-Report-2023-v${n1}.pdf`), done.fileName);
  assert.equal(done.expiresAt, null, "finals never expire");
  const [v] = await q(`SELECT id, n, kind, rev, doc, data_snapshot, data_hash, renderer_hash, pdf_r2_key, pdf_sha256, page_count, created_by FROM report_doc_version WHERE id = $1`, [done.versionId]);
  assert.equal(v.kind, "final");
  assert.equal(v.rev, doc.rev);
  assert.equal(v.doc.meta.title, "DS-11 Final");
  assert.ok(Array.isArray(v.data_snapshot.values) && Array.isArray(v.data_snapshot.tokens));
  assert.match(v.data_hash, /^[0-9a-f]{64}$|^sha256:/);
  assert.ok(v.renderer_hash && v.renderer_hash.length >= 8);
  assert.ok(v.page_count >= 5);
  assert.equal(v.created_by, 2);
  const pdf = await call("GET", `/studio/docs/${doc.id}/versions/${n1}/pdf`, "admin");
  assert.equal(pdf.status, 200, "role R downloads finals");
  assert.equal(sha(pdf.buffer), v.pdf_sha256);
  assert.ok(pdf.headers.get("content-disposition").endsWith(`-GHG-Report-2023-v${n1}.pdf"`));
  assert.equal(sha((await call("GET", done.downloadUrl, "manager")).buffer), v.pdf_sha256);
  // The design stays editable; a second final needs a note and supersedes the first.
  const cur = (await call("GET", `/studio/docs/${doc.id}`, "manager")).json;
  assert.notEqual(cur.status, "final");
  const noNote = await job(doc.id, { kind: "final", rev: cur.rev });
  assert.equal(noNote.json.code, "DS_VALIDATION");
  assert.equal(noNote.json.details.issues[0].path, "note");
  const second = await job(doc.id, { kind: "final", rev: cur.rev, note: "Corrected the title" });
  assert.equal(second.status, 202);
  const d2 = await waitJob(second.json.id);
  assert.ok(d2.versionN > n1);
  const versions = (await call("GET", `/studio/docs/${doc.id}/versions?kind=final`, "manager")).json;
  assert.deepEqual(versions.map((x) => [x.n, x.superseded, x.note]), [[d2.versionN, false, "Corrected the title"], [n1, true, null]]);
  assert.equal(versions[0].pdfUrl, `/studio/docs/${doc.id}/versions/${d2.versionN}/pdf`);
  // The list shows the design's newest final.
  const list = (await call("GET", "/studio/docs", "manager")).json.find((d) => d.id === doc.id);
  assert.equal(list.finalVersion, d2.versionN);
});

test("DS_JOB_RUNNING: a final in flight blocks another", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2023, "DS-11 Running");
  await q(`INSERT INTO report_job (company_id, doc_id, kind, status, rev, options, requested_by, started_at) VALUES (1, $1, 'final', 'running', $2, '{}', 2, now())`, [doc.id, doc.rev]);
  const r = await job(doc.id, { kind: "final", rev: doc.rev });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "DS_JOB_RUNNING");
});

test("versions: named snapshot, restore with rev, autosaves listed; finals immutable through restore", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-11 Versions");
  const snap = await call("POST", `/studio/docs/${doc.id}/versions`, "admin", { note: "Before the board" });
  assert.equal(snap.status, 201, JSON.stringify(snap.json));
  assert.equal(snap.json.kind, "snapshot");
  assert.equal(snap.json.note, "Before the board");
  assert.equal(snap.json.rev, doc.rev);
  assert.equal(snap.json.pdfUrl, null);
  assert.equal((await call("POST", `/studio/docs/${doc.id}/versions`, "admin", {})).json.code, "DS_VALIDATION");
  // Change the title, then restore the snapshot.
  const cur = (await call("GET", `/studio/docs/${doc.id}`, "manager")).json;
  const renamed = await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: cur.rev, title: "DS-11 Versions renamed" });
  assert.equal(renamed.status, 200);
  const stale = await call("POST", `/studio/docs/${doc.id}/versions/${snap.json.n}/restore`, "manager", { rev: cur.rev });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  const back = await call("POST", `/studio/docs/${doc.id}/versions/${snap.json.n}/restore`, "manager", { rev: renamed.json.rev });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(back.json.rev, renamed.json.rev + 1);
  assert.equal(back.json.doc.meta.title, "DS-11 Versions");
  const all = (await call("GET", `/studio/docs/${doc.id}/versions`, "admin")).json;
  assert.equal(all[0].kind, "autosave");
  assert.equal(all[0].note, `Restored from version ${snap.json.n}`);
  assert.ok(all.some((v) => v.kind === "snapshot"));
  assert.equal((await call("GET", `/studio/docs/${doc.id}/versions/${snap.json.n}/pdf`, "manager")).status, 404, "a snapshot has no PDF");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/versions/999/restore`, "manager", { rev: back.json.rev })).status, 404);
});

rtest("view links: Manager only; token once and hashed; views; stored PDF only; revoke, expiry and switch-off → 410; audit", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc(2023, "DS-11 Share");
  const fin = await waitJob((await job(doc.id, { kind: "final", rev: doc.rev })).json.id);
  assert.equal(fin.status, "done", JSON.stringify(fin));
  const admin = await call("POST", `/studio/docs/${doc.id}/shares`, "admin", { versionId: fin.versionId });
  assert.equal(admin.status, 403, "an Admin can't create a link");
  assert.equal(admin.json.code, "DS_ROLE");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/shares`, "admin")).json.code, "DS_ROLE");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { versionId: fin.versionId, expiresInDays: 91 })).json.code, "DS_VALIDATION");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/shares`, "manager", {})).json.code, "DS_VALIDATION");
  const [snapRow] = await q(`INSERT INTO report_doc_version (doc_id, n, kind, rev, doc) VALUES ($1, 50, 'snapshot', 1, '{}'::jsonb) RETURNING id`, [doc.id]);
  assert.equal((await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { versionId: snapRow.id })).json.code, "DS_VALIDATION", "a version without a PDF");

  const r = await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { versionId: fin.versionId });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const url = new URL(r.json.url);
  const token = url.pathname.split("/").pop();
  assert.equal(url.pathname, `/s/${token}`);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  const days = (Date.parse(r.json.expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 13.9 && days <= 14, `default 14 days: ${days}`);
  assert.equal(r.json.label, `Final v${fin.versionN}`);
  assert.equal(r.json.state, "active");
  const [row] = await q(`SELECT token_hash FROM report_share WHERE id = $1`, [r.json.id]);
  assert.equal(row.token_hash, sha(token), "stored as sha256");
  const [leak] = await q(`SELECT count(*)::int AS n FROM report_share WHERE token_hash = $1`, [token]);
  assert.equal(leak.n, 0, "the token itself is never stored");
  const listed = (await call("GET", `/studio/docs/${doc.id}/shares`, "manager")).json;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].url, undefined, "the url is shown once");
  assert.ok(!JSON.stringify(listed).includes(token));

  // Logged out: the viewer page, its meta and the stored PDF.
  const page = await call("GET", `/s/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("x-robots-tag"), /noindex/);
  const html = page.buffer.toString("utf8");
  assert.ok(html.includes("DS-11 Share") && html.includes(`Final v${fin.versionN}`) && html.includes(`/s/${token}/file`));
  const meta = await call("GET", `/s/${token}/meta`);
  assert.equal(meta.status, 200);
  assert.equal(meta.json.label, `Final v${fin.versionN}`);
  assert.equal(meta.json.fileUrl, `/s/${token}/file`);
  const file = await call("GET", `/s/${token}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "application/pdf");
  assert.match(file.headers.get("content-disposition"), /^inline;/);
  const [v] = await q(`SELECT pdf_sha256 FROM report_doc_version WHERE id = $1`, [fin.versionId]);
  assert.equal(sha(file.buffer), v.pdf_sha256, "the stored final PDF, byte for byte");
  // Live data never reaches a viewer: changing the draft changes nothing behind the link.
  const cur = (await call("GET", `/studio/docs/${doc.id}`, "manager")).json;
  await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: cur.rev, title: "DS-11 Share edited" });
  assert.equal(sha((await call("GET", `/s/${token}/file`)).buffer), v.pdf_sha256);
  assert.match((await call("GET", `/s/${token}/file?download=1`)).headers.get("content-disposition"), /^attachment;/);
  const views = (await call("GET", `/studio/docs/${doc.id}/shares`, "manager")).json[0];
  assert.equal(views.views, 2, "the page and the meta call count; the file does not");
  assert.ok(views.lastViewedAt);

  // Tenant: another company's Manager can't revoke it.
  assert.equal((await call("DELETE", `/studio/shares/${r.json.id}`, "otherManager")).status, 404);
  assert.equal((await call("GET", `/s/${token}`)).status, 200);
  // Studio switched off → 410; back on → works again.
  await setStudio(1, false);
  assert.equal((await call("GET", `/s/${token}`)).status, 410);
  assert.equal((await call("GET", `/s/${token}/file`)).json.code, "DS_SHARE_EXPIRED");
  await setStudio(1, true);
  assert.equal((await call("GET", `/s/${token}/meta`)).status, 200);
  // Revoke → 410 everywhere (HTML page, meta, file); twice is fine.
  assert.equal((await call("DELETE", `/studio/shares/${r.json.id}`, "admin")).json.code, "DS_ROLE");
  assert.equal((await call("DELETE", `/studio/shares/${r.json.id}`, "manager")).status, 204);
  assert.equal((await call("DELETE", `/studio/shares/${r.json.id}`, "manager")).status, 204);
  const gone = await call("GET", `/s/${token}`);
  assert.equal(gone.status, 410);
  assert.ok(gone.buffer.toString("utf8").includes("This link has expired"));
  assert.equal((await call("GET", `/s/${token}/meta`)).json.code, "DS_SHARE_EXPIRED");
  assert.equal((await call("GET", `/s/${token}/file`)).status, 410);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/shares`, "manager")).json[0].state, "revoked");

  // Expired → 410. Unknown and malformed tokens → 404.
  const r2 = await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { versionId: fin.versionId, expiresInDays: 90 });
  const t2 = new URL(r2.json.url).pathname.split("/").pop();
  assert.ok((Date.parse(r2.json.expiresAt) - Date.now()) / 86_400_000 > 89.9);
  assert.equal((await call("GET", `/s/${t2}/meta`)).status, 200);
  await q(`UPDATE report_share SET expires_at = now() - interval '1 second' WHERE id = $1`, [r2.json.id]);
  assert.equal((await call("GET", `/s/${t2}`)).status, 410);
  assert.equal((await call("GET", `/s/${t2}/file`)).status, 410);
  assert.equal((await call("GET", `/s/${"A".repeat(43)}`)).status, 404);
  assert.equal((await call("GET", `/s/not-a-token/meta`)).status, 404);

  // A link to a proof: capped by the proof's own expiry.
  const proof = await waitJob((await job(doc.id, { kind: "proof", rev: (await call("GET", `/studio/docs/${doc.id}`, "manager")).json.rev })).json.id);
  const r3 = await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { jobId: proof.id, expiresInDays: 30 });
  assert.equal(r3.status, 201, JSON.stringify(r3.json));
  assert.match(r3.json.label, /^Proof · /);
  assert.ok(Date.parse(r3.json.expiresAt) <= Date.parse(proof.expiresAt) + 1000, "capped at the proof's expiry");
  const t3 = new URL(r3.json.url).pathname.split("/").pop();
  const pf = await call("GET", `/s/${t3}/file`);
  assert.equal(pf.status, 200);
  const [pj] = await q(`SELECT sha256 FROM report_job WHERE id = $1`, [proof.id]);
  assert.equal(sha(pf.buffer), pj.sha256);
  assert.equal((await call("POST", `/studio/docs/${doc.id}/shares`, "manager", { jobId: 999999 })).status, 404);

  // Audit: create, view, revoke.
  const audit = await q(`SELECT action, changed_by FROM audit_log WHERE entity_type = 'report_share' AND entity_id = $1 ORDER BY id`, [r.json.id]);
  assert.deepEqual([...new Set(audit.map((a) => a.action))], ["create", "view", "revoke"]);
  assert.equal(audit.find((a) => a.action === "view").changed_by, null, "viewers are anonymous");
  // A deleted design's links stop.
  await q(`UPDATE report_doc SET deleted_at = now() WHERE id = $1`, [doc.id]);
  assert.equal((await call("GET", `/s/${t3}`)).status, 410);
});

test("migrate:ds-11-outputs is idempotent and leaves the tables in place", async () => {
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateDs11Outputs");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const cols = await q(`SELECT table_name, count(*)::int AS n FROM information_schema.columns WHERE table_name IN ('report_job', 'report_share') AND table_schema = current_schema() GROUP BY table_name ORDER BY table_name`);
  assert.deepEqual(cols.map((c) => c.table_name), ["report_job", "report_share"]);
});
