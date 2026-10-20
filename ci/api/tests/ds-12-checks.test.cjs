// DS-12 checks and the final gate: POST /studio/docs/:id/checks and the
// checks gate on POST /studio/docs/:id/jobs {kind: 'final'}.
//
//   - switch off (DS_STUDIO_OFF), Users (DS_ROLE), no session (401);
//   - tenant isolation: another company's doc is not found; a Superadmin names the company;
//   - kind off: a sustainability design while KPI tracking is off → DS_KIND_OFF;
//   - rev conflicts and validation;
//   - the GHG checks on real data: pending and rejected entries, Scope 2 market-based,
//     unaddressed Scope 3 categories, a typed wrong number (NUMBER_MISMATCH with a chip fix)
//     and the fix (a chip) clearing it; live measurements give layout checks;
//   - the gate: a final is refused with an error open (pending entries first), then for
//     unacknowledged warnings, and allowed after the fix and the acknowledgement; pending
//     entries keep blocking a GHG final whatever else is fixed;
//   - sustainability: YEAR_NOT_LOCKED blocks the final;
//   - the worker: a final whose text overflows is refused before the PDF (render test).
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3), company 2 (site 3; other
// manager 6), superadmin 5. CY 2025: 2 pending and 1 rejected entry on company 1;
// CY 2023: no entries at all.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript, readyForFinal, FINAL_READY_INPUTS } = require("./ds-lib.cjs");

const FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/ghg-doc.json"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let chromiumOk = false;
let why = "";
test.before(async () => {
  for (const name of ["migrateDs5Docs", "migrateDs11Outputs"]) {
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
  await q(`DELETE FROM report_job WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-12%')`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-12%')`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'DS-12%'`);
  await setKpi(1, false);
}

const rtest = (name, fn) =>
  test(name, async (t) => {
    if (!chromiumOk) return t.skip(why);
    await fn(t);
  });

/** The fixture doc for a year, without its sample images. */
const fixtureDoc = (year, title) => {
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.meta = { ...d.meta, year, title, compareYear: year - 1 };
  d.assets = [];
  for (const p of d.pages) if (p.elements) p.elements = p.elements.filter((e) => !(e.props && e.props.assetId));
  // DS-12: the fixture's page number sits 4 mm into the 10 mm print margin (OUTSIDE_SAFE_AREA blocks a final).
  for (const p of d.pages) for (const e of p.elements ?? []) if (e.id === "p-summary.pn") e.frame.y = 281;
  return d;
};

async function makeDoc(year, title, edit = (d) => d) {
  const c = await call("POST", "/studio/docs", "manager", { kind: "ghg", templateId: "blank", year, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, format: "a4", title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const p = await call("PATCH", `/studio/docs/${c.json.id}`, "manager", { rev: c.json.rev, doc: edit(fixtureDoc(year, title)) });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return { id: c.json.id, rev: p.json.rev };
}

const checks = (id, body, who = "manager") => call("POST", `/studio/docs/${id}/checks`, who, body);
const ids = (res) => res.json.checks.map((c) => c.id);
const textEl = (id, text, frame = { x: 20, y: 120, w: 170, h: 30, rotation: 0 }) => ({
  id,
  type: "text",
  frame,
  z: 20,
  source: "user",
  props: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, style: "body", align: "left" },
});

test("switch off → DS_STUDIO_OFF; Users → DS_ROLE; no session → 401", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-12 Switch");
  await setStudio(1, false);
  for (const who of ["manager", "admin", "user"]) {
    const r = await checks(doc.id, { rev: doc.rev }, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "DS_STUDIO_OFF", who);
  }
  await setStudio(1, true);
  const u = await checks(doc.id, { rev: doc.rev }, "user");
  assert.equal(u.status, 403);
  assert.equal(u.json.code, "DS_ROLE");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/checks`, undefined, { rev: doc.rev })).status, 401);
  assert.equal((await checks(doc.id, { rev: doc.rev }, "admin")).status, 200, "Admins run checks");
});

test("tenant isolation: another company's design is not found; a Superadmin names the company", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc(2025, "DS-12 Tenant");
  const other = await checks(doc.id, { rev: doc.rev }, "otherManager");
  assert.equal(other.status, 404);
  assert.equal(other.json.code, "DS_DOC_NOT_FOUND");
  const sa = await call("POST", `/studio/docs/${doc.id}/checks?company_id=1`, "superadmin", { rev: doc.rev, company_id: 1 });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  const sa2 = await call("POST", `/studio/docs/${doc.id}/checks?company_id=2`, "superadmin", { rev: doc.rev, company_id: 2 });
  assert.equal(sa2.status, 404, "named as company 2, company 1's doc doesn't exist");
  assert.equal((await checks(999999, { rev: 1 })).status, 404);
});

test("rev and body: a stale rev is a conflict; bad bodies are DS_VALIDATION", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-12 Rev");
  const stale = await checks(doc.id, { rev: doc.rev - 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  assert.equal(stale.json.details.rev, doc.rev);
  assert.equal((await checks(doc.id, {})).json.code, "DS_VALIDATION");
  assert.equal((await checks(doc.id, { rev: doc.rev, measurements: [{ pageId: "p" }] })).json.code, "DS_VALIDATION");
});

test("kind off: a sustainability design while KPI tracking is off → DS_KIND_OFF", async () => {
  await setStudio(1, true);
  await setKpi(1, true);
  const c = await call("POST", "/studio/docs", "manager", { kind: "sustainability", templateId: "blank", year: 2025, yearType: "FY", sites: "all", frameworks: ["GRI"], inputs: {}, ai: false, format: "a4", title: "DS-12 Sustainability" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const on = await checks(c.json.id, { rev: c.json.rev });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.ok(ids(on).includes("YEAR_NOT_LOCKED"), "the year isn't locked");
  assert.ok(!ids(on).some((id) => id.startsWith("GHG_") || id === "SCOPE2_MARKET_MISSING"), "no GHG checks on a sustainability design");
  // The gate: the unlocked year blocks the final.
  const fin = await call("POST", `/studio/docs/${c.json.id}/jobs`, "manager", { kind: "final", rev: c.json.rev });
  assert.equal(fin.status, 409);
  assert.equal(fin.json.code, "DS_CHECKS_BLOCKING");
  assert.ok(fin.json.details.checks.some((x) => x.id === "YEAR_NOT_LOCKED"));
  await setKpi(1, false);
  const off = await checks(c.json.id, { rev: c.json.rev });
  assert.equal(off.status, 403);
  assert.equal(off.json.code, "DS_KIND_OFF");
});

test("GHG checks on approved data: pending and rejected entries, market-based Scope 2, Scope 3 categories, per-gas", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-12 GHG");
  const r = await checks(doc.id, { rev: doc.rev }, "admin");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rev, doc.rev);
  assert.equal(r.json.blocking, true);
  assert.equal(r.json.layout, "none", "no render of this rev yet, no live measurements");
  const first = r.json.checks[0];
  assert.equal(first.id, "GHG_PENDING_ENTRIES", "pending entries lead the list");
  assert.equal(first.severity, "error");
  assert.equal(first.details.pending, 2);
  assert.equal(first.details.rejected, 1);
  assert.equal(first.fix, "open_pending");
  assert.equal(first.details.link, "/data/approvals");
  assert.match(first.message, /Approve them in Review before the final/);
  // Severity order: errors, then warnings, then info.
  const rank = { error: 0, warning: 1, info: 2 };
  r.json.checks.reduce((prev, c) => (assert.ok(rank[c.severity] >= prev, `${c.id} out of order`), rank[c.severity]), 0);
  const market = r.json.checks.find((c) => c.id === "SCOPE2_MARKET_MISSING");
  assert.equal(market.severity, "warning");
  assert.equal(market.elementId, "p-summary.market", "points at the market-based tile");
  // The fixture names ISO 14064-1: the responsible person becomes an error (D8).
  assert.equal(r.json.checks.find((c) => c.id === "RESPONSIBLE_PERSON_MISSING").severity, "error");
  assert.equal(r.json.checks.find((c) => c.id === "UNCERTAINTY_MISSING").severity, "warning");
  // The fixture's scope3_categories section lists all 15, but nothing is reported or excluded in CY 2025 except what has data.
  const s3 = r.json.checks.filter((c) => c.id === "SCOPE3_CATEGORY_UNADDRESSED");
  assert.ok(s3.length >= 1);
  assert.ok(s3.every((c) => c.severity === "error" && c.details.category >= 1 && c.details.category <= 15));
  assert.ok(s3.some((c) => c.fix === "mark_excluded" && /Scope 3 Category \d+: .+ isn't reported or excluded/.test(c.message)));
  assert.ok(ids(r).includes("UNLINKED_DATA"), "the typed custom chart");
  assert.ok(ids(r).includes("VERIFICATION_STATEMENT_MISSING"));
  assert.ok(r.json.warnings.includes("SCOPE2_MARKET_MISSING"));
  assert.ok(!r.json.warnings.includes("UNLINKED_DATA"), "info isn't acknowledged");
});

test("typed numbers: a wrong figure is NUMBER_MISMATCH with a chip fix; the chip clears it; unknown figures are info", async () => {
  await setStudio(1, true);
  // CY 2025 Scope 1 for company 1 (sites 1, 2): approved 4.29 + 10 + 11 on Scope 1 categories in the fixture.
  const res = await call("POST", "/studio/resolve", "manager", { kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings: [{ source: "ghg", metric: "total", years: { last: 1 }, sites: "all" }] });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const total = res.json.values[0].value;
  assert.ok(total > 0, "approved data in CY 2025");
  const wrong = Math.round(total * 1.3 * 10) / 10;
  const doc = await makeDoc(2025, "DS-12 Numbers", (d) => {
    d.pages[1].elements.push(textEl("p-summary.typed", `Total emissions were ${wrong.toLocaleString("en-US")} tCO₂e and we run 22 MW of solar.`));
    return d;
  });
  const r = await checks(doc.id, { rev: doc.rev });
  const mm = r.json.checks.find((c) => c.id === "NUMBER_MISMATCH");
  assert.ok(mm, JSON.stringify(ids(r)));
  assert.equal(mm.severity, "error");
  assert.equal(mm.elementId, "p-summary.typed");
  assert.equal(mm.fix, "replace_with_token");
  assert.equal(mm.details.chip.binding.source, "ghg");
  assert.equal(mm.details.chip.measure, "value");
  assert.match(mm.message, /doesn't match your approved data/);
  assert.ok(r.json.checks.some((c) => c.id === "NUMBER_UNBOUND" && c.details.typed === "22" && c.severity === "info"));
  // The fix: the typed number becomes a chip with the suggested binding.
  const cur = (await call("GET", `/studio/docs/${doc.id}`, "manager")).json;
  const d = cur.doc;
  const el = d.pages[1].elements.find((e) => e.id === "p-summary.typed");
  el.props.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Total emissions were " }, { type: "data", attrs: { binding: mm.details.chip.binding, measure: mm.details.chip.measure } }, { type: "text", text: " tCO₂e." }] }] };
  const p = await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: cur.rev, doc: d });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const after = await checks(doc.id, { rev: p.json.rev });
  assert.ok(!ids(after).includes("NUMBER_MISMATCH"));
  // A typed number that matches at the precision typed is fine.
  const cur2 = (await call("GET", `/studio/docs/${doc.id}`, "manager")).json;
  cur2.doc.pages[1].elements.find((e) => e.id === "p-summary.typed").props.doc.content[0].content = [{ type: "text", text: `Total emissions were ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} tCO₂e.` }];
  const p2 = await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: cur2.rev, doc: cur2.doc });
  assert.ok(!ids(await checks(doc.id, { rev: p2.json.rev })).includes("NUMBER_MISMATCH"));
});

test("live measurements: overflow, margin, small and low-contrast text from the editor; unknown elements are ignored", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(2025, "DS-12 Layout", (d) => {
    d.pages[1].elements.push(textEl("p-summary.edge", "Close to the edge", { x: 4, y: 150, w: 40, h: 10, rotation: 0 }));
    return d;
  });
  const m = (elementId, over = {}) => ({ pageId: "p-summary", elementId, type: "text", rectMm: { x: 20, y: 20, w: 50, h: 10 }, overflowMm: 0, outsideSafe: false, outsidePage: false, minFontPt: 10, contrast: 12, onImage: false, bleed: false, ...over });
  const r = await checks(doc.id, {
    rev: doc.rev,
    measurements: [m("p-summary.body", { overflowMm: 4.2 }), m("p-summary.heading", { outsideSafe: true, minFontPt: 6, contrast: 2.1 }), m("p-summary.note", { contrast: 2, onImage: true }), m("nope", { overflowMm: 9 })],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.layout, "live");
  const of = r.json.checks.find((c) => c.id === "TEXT_OVERFLOW");
  assert.equal(of.elementId, "p-summary.body");
  assert.equal(of.fix, "shrink_text");
  assert.equal(r.json.checks.filter((c) => c.id === "TEXT_OVERFLOW").length, 1, "an unknown element is ignored");
  // The margin comes from the doc's frames, not from a measurement.
  const safe = r.json.checks.filter((c) => c.id === "OUTSIDE_SAFE_AREA");
  assert.deepEqual(safe.map((c) => [c.elementId, c.fix]), [["p-summary.edge", "move_inside"]]);
  assert.equal(r.json.checks.find((c) => c.id === "FONT_TOO_SMALL").severity, "error");
  const lc = r.json.checks.filter((c) => c.id === "LOW_CONTRAST");
  assert.deepEqual(lc.map((c) => [c.elementId, c.severity]).sort(), [["p-summary.heading", "error"], ["p-summary.note", "warning"]]);
});

test("the final gate: errors first, then unacknowledged warnings; allowed after the fix; pending entries block", async () => {
  await setStudio(1, true);
  // CY 2023: no entries. Errors from missing disclosures block the final.
  const doc = await makeDoc(2023, "DS-12 Gate");
  const g1 = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: doc.rev });
  assert.equal(g1.status, 409);
  assert.equal(g1.json.code, "DS_CHECKS_BLOCKING");
  assert.equal(g1.json.details.reason, "errors");
  const blocked = g1.json.details.checks.map((c) => c.id);
  for (const id of ["SCOPE3_CATEGORY_UNADDRESSED", "RESPONSIBLE_PERSON_MISSING"]) assert.ok(blocked.includes(id), id);
  assert.ok(g1.json.details.checks.every((c) => c.severity === "error"));
  assert.equal((await q(`SELECT count(*)::int AS n FROM report_job WHERE doc_id = $1`, [doc.id]))[0].n, 0, "no job was made");
  // The fix (report details), then the warnings must be acknowledged.
  const ready = await readyForFinal(doc.id);
  assert.ok(ready.acknowledgedWarnings.includes("SCOPE2_MARKET_MISSING"));
  const g2 = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings.slice(1) });
  assert.equal(g2.status, 409);
  assert.equal(g2.json.details.reason, "warnings");
  assert.deepEqual(g2.json.details.unacknowledged, [ready.acknowledgedWarnings[0]]);
  // An Admin still can't make a final, whatever the checks say.
  assert.equal((await call("POST", `/studio/docs/${doc.id}/jobs`, "admin", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings })).json.code, "DS_ROLE");
  const ok = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  const [job] = await q(`SELECT acknowledged_warnings FROM report_job WHERE id = $1`, [ok.json.id]);
  assert.deepEqual(job.acknowledged_warnings, ready.acknowledgedWarnings, "the acknowledgements are stored with the final");
  const made = await waitSettled(ok.json.id);
  if (made.status !== "done") {
    const why = await checks(doc.id, { rev: ready.rev });
    assert.fail(`final ${made.status} (${made.errorReason}): ${JSON.stringify(why.json.checks.filter((c) => c.severity === "error"))}`);
  }
  assert.ok(made.versionN >= 2, "a final version");

  // CY 2025: the same details, yet pending entries still block.
  const d25 = await makeDoc(2025, "DS-12 Gate pending");
  const cur = (await call("GET", `/studio/docs/${d25.id}/inputs`, "manager")).json;
  const patched = await call("PATCH", `/studio/docs/${d25.id}/inputs`, "manager", { rev: cur.rev, inputs: FINAL_READY_INPUTS });
  const c25 = await checks(d25.id, { rev: patched.json.rev });
  const g3 = await call("POST", `/studio/docs/${d25.id}/jobs`, "manager", { kind: "final", rev: patched.json.rev, acknowledgedWarnings: c25.json.warnings });
  assert.equal(g3.status, 409);
  assert.equal(g3.json.details.checks[0].id, "GHG_PENDING_ENTRIES");
  assert.equal(g3.json.details.checks[0].details.pending, 2);
  // A proof is never gated.
  const proof = await call("POST", `/studio/docs/${d25.id}/jobs`, "manager", { kind: "proof", rev: patched.json.rev });
  assert.equal(proof.status, 202);
  await waitSettled(proof.json.id);
});

/** Waits until a job is no longer queued or running (in-process under NODE_ENV=test). */
async function waitSettled(id, ms = 120_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await call("GET", `/studio/jobs/${id}`, "manager");
    if (r.json.status === "done" || r.json.status === "failed") return r.json;
    if (Date.now() > until) throw new Error(`job ${id} still ${r.json.status}`);
    await wait(400);
  }
}

rtest("the worker's layout gate: overflowing text stops a final before the PDF; the checks then show it", async () => {
  await setStudio(1, true);
  const long = "This sentence is far too long for its little box. ".repeat(40);
  const doc = await makeDoc(2023, "DS-12 Overflow", (d) => {
    d.pages[1].elements.push(textEl("p-summary.long", long, { x: 20, y: 200, w: 60, h: 8, rotation: 0 }));
    return d;
  });
  const ready = await readyForFinal(doc.id);
  const fin = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings });
  assert.equal(fin.status, 202, JSON.stringify(fin.json));
  const done = await waitSettled(fin.json.id);
  assert.equal(done.status, "failed");
  assert.equal(done.errorReason, "checks");
  assert.equal((await q(`SELECT count(*)::int AS n FROM report_doc_version WHERE doc_id = $1 AND kind = 'final'`, [doc.id]))[0].n, 0, "no final version");
  const after = await checks(doc.id, { rev: ready.rev });
  assert.equal(after.json.layout, "render", "the worker's measurements of this rev");
  assert.ok(after.json.checks.some((c) => c.id === "TEXT_OVERFLOW" && c.elementId === "p-summary.long"));
  // The next final request is refused at once, from the stored measurements.
  const again = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings });
  assert.equal(again.status, 409);
  assert.ok(again.json.details.checks.some((c) => c.id === "TEXT_OVERFLOW"));
});
