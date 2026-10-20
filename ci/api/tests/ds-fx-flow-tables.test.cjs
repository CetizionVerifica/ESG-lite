// DS fix · the GHG flow tables are filled on the server: `ghg_factor_table`
// (emission factors used) and `scope3_categories` print real rows from
// approved data in preview.html, proofs and finals (the final also keeps the
// rows in its data snapshot), and POST /studio/resolve returns the same rows
// when asked with `flows` (for the editor).
//
// Data: CY 2021 on company 1 (no fixture rows that year): approved Scope 1
// diesel and Scope 2 grid rows with factor snapshots, an approved Scope 3
// Category 6 row, a pending row (never shown) and an approved row without a
// snapshot; the report details exclude Category 8.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, runScript, FINAL_READY_INPUTS } = require("./ds-lib.cjs");

const FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/ghg-doc.json"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const YEAR = 2021;
const TITLE = "DS-FX Flow tables";

const snap = (name, value, unit, source, version, gwp) =>
  JSON.stringify({ emission_factor_id: 0, emission_category_name: name, factor_value: value, denominator_unit: unit, source, year: Number(version) || 2021, dataset_version: version, gwp_set: gwp });

async function cleanup() {
  await q(`DELETE FROM report_job WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-FX%')`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'DS-FX%')`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'DS-FX%'`);
  await q(`DELETE FROM emission WHERE pk_id BETWEEN 9501 AND 9520`);
  await q(`DELETE FROM site_categories WHERE category_id = 951`);
  await q(`DELETE FROM category WHERE category_id = 951`);
}

let chromiumOk = false;
let why = "";
test.before(async () => {
  for (const name of ["migrateDs5Docs", "migrateDs11Outputs"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await cleanup();
  await q(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES (951, 'DS-FX Business Travel', 'Scope 3', 6)`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (1, 951)`);
  const rows = [
    // pk, total tCO2e, date, status, category, site, snapshot
    [9501, 2.68, "2021-03-31", "approved", 1, 1, snap("Diesel", "2.68000000", "litre", "DEFRA", "2021", "AR5")],
    [9502, 1.34, "2021-04-30", "approved", 1, 2, snap("Diesel", "2.68000000", "litre", "DEFRA", "2021", "AR5")],
    [9503, 71.6, "2021-05-31", "approved", 2, 1, snap("India grid", "0.71600000", "kWh", "CEA", "v17", null)],
    [9504, 3.25, "2021-06-30", "approved", 951, 1, snap("Flights - Domestic - With RF", "0.24600000", "passenger.km", "DEFRA", "2021", "AR5")],
    [9505, 900, "2021-06-30", "pending", 1, 1, snap("Pending fuel", "9.99000000", "litre", "Nowhere", "2021", "AR5")],
    [9506, 5, "2021-07-31", "approved", 1, 1, null],
  ];
  for (const [pk, total, date, status, cat, site, s] of rows) {
    await q(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, reviewed_by, created_by, category_id, site_id, reporting_period, emission_factor_snapshot, created_at)
       VALUES ($1, '{"activity_value": 1}', $2, 'tCO2e', $3, $4, 2, 1, $5, $6, 'monthly', $7::jsonb, now())`,
      [pk, total, date, status, cat, site, s],
    );
  }
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
  await cleanup();
  await setStudio(1, false);
  await setStudio(2, false);
});

const fixtureDoc = (title) => {
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.meta = { ...d.meta, year: YEAR, yearType: "CY", title, compareYear: YEAR - 1, sites: "all" };
  d.assets = [];
  for (const p of d.pages) if (p.elements) p.elements = p.elements.filter((e) => !(e.props && e.props.assetId));
  for (const p of d.pages) for (const e of p.elements ?? []) if (e.id === "p-summary.pn") e.frame.y = 281;
  return d;
};

async function makeDoc(title, inputs) {
  const c = await call("POST", "/studio/docs", "manager", { kind: "ghg", templateId: "blank", year: YEAR, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, format: "a4", title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const p = await call("PATCH", `/studio/docs/${c.json.id}`, "manager", { rev: c.json.rev, doc: fixtureDoc(title) });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const i = await call("PATCH", `/studio/docs/${c.json.id}/inputs`, "manager", { rev: p.json.rev, inputs });
  assert.equal(i.status, 200, JSON.stringify(i.json));
  return { id: c.json.id, rev: i.json.rev };
}

const EXCL8 = { exclusions: { value: [{ what: "Category 8 · Upstream leased assets", reason: "The company leases no assets." }] } };

/** One flow section's HTML from a rendered document. */
const section = (html, type) => {
  const m = new RegExp(`<section class="ds-flow ds-flow--${type}[\\s\\S]*?</section>`).exec(html);
  assert.ok(m, `section ${type} rendered`);
  return m[0];
};

function assertFlowHtml(html) {
  const s3 = section(html, "scope3_categories");
  assert.doesNotMatch(s3, /Not reported/, "the Scope 3 table has rows");
  assert.equal((s3.match(/<tr data-category=/g) || []).length, 15, "all 15 categories");
  assert.match(s3, /data-category="6" data-status="reported"/);
  assert.match(s3, /data-category="6" data-status="reported"><td>Scope 3 Category 6: Business travel<\/td><td>[^]*?<\/td><td class="num">3\.25<\/td>/, "Category 6 shows computeScope3's tCO₂e");
  assert.match(s3, /data-category="8" data-status="excluded"[^]*?The company leases no assets\./);
  assert.match(s3, /data-category="1" data-status="not_addressed"/);
  const ef = section(html, "ghg_factor_table");
  assert.doesNotMatch(ef, /Not reported/, "the factor table has rows");
  assert.match(ef, /ds-factor-table/);
  for (const t of ["Diesel", "2.68", "litre", "DEFRA 2021", "India grid", "0.716", "kWh", "CEA v17", "Flights - Domestic - With RF", "passenger.km"]) assert.ok(ef.includes(t), t);
  assert.ok(!ef.includes("Pending fuel") && !ef.includes("Nowhere"), "pending rows never show");
  assert.match(ef, /1 approved entry has no factor record/);
}

test("POST /studio/resolve with flows: factor and Scope 3 rows by section id, approved only", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc(`${TITLE} resolve`, EXCL8);
  const body = { kind: "ghg", year: YEAR, yearType: "CY", sites: "all", bindings: [], tokens: [], docId: doc.id, flows: [{ id: "p-categories", flowType: "scope3_categories" }, { id: "p-factors", flowType: "ghg_factor_table" }, { id: "x", flowType: "toc" }] };
  const r = await call("POST", "/studio/resolve", "admin", body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s3 = r.json.scope3["p-categories"];
  assert.equal(s3.length, 15);
  assert.deepEqual(s3.find((x) => x.n === 6), { n: 6, name: "Business travel", status: "reported", display: "3.25", method: s3.find((x) => x.n === 6).method, dq: s3.find((x) => x.n === 6).dq, reason: "" });
  assert.equal(s3.find((x) => x.n === 8).status, "excluded");
  assert.equal(s3.filter((x) => x.status === "reported").length, 1);
  const ef = r.json.flow["p-factors"];
  assert.deepEqual(ef.rows.filter((x) => x.group).map((x) => x.cells[0]), ["Scope 1", "Scope 2", "Scope 3"]);
  const diesel = ef.rows.find((x) => x.cells[1] === "Diesel");
  assert.deepEqual(diesel.cells, ["Stationary Combustion", "Diesel", "2.68", "litre", "DEFRA 2021", "AR5", 2], "both sites' diesel rows, one factor line");
  assert.ok(!JSON.stringify(ef).includes("Pending fuel"));
  assert.equal(r.json.flow.x, undefined, "other flow types are not filled here");
  // Without flows the response is as before.
  const plain = await call("POST", "/studio/resolve", "admin", { ...body, flows: undefined });
  assert.equal(plain.status, 200);
  assert.equal(plain.json.flow, undefined);
  assert.equal(plain.json.scope3, undefined);
  // Tenant: company 2 can't read company 1's sites, flows or not.
  const other = await call("POST", "/studio/resolve", "otherManager", { ...body, docId: undefined, sites: [1] });
  assert.equal(other.status, 404);
  assert.equal((await call("POST", "/studio/resolve", "admin", { ...body, flows: [{ id: "a", flowType: "nope" }] })).status, 400);
});

test("preview.html (paged and sheet) prints the factor and Scope 3 rows", async () => {
  await setStudio(1, true);
  const doc = await makeDoc(`${TITLE} preview`, EXCL8);
  for (const mode of ["paged", "sheet"]) {
    const r = await call("GET", `/studio/docs/${doc.id}/preview.html?mode=${mode}`, "manager");
    assert.equal(r.status, 200, mode);
    assertFlowHtml(r.buffer.toString("utf8"));
  }
  const one = await call("GET", `/studio/docs/${doc.id}/preview.html?mode=sheet&pageId=p-factors`, "manager");
  assert.equal(one.status, 200);
  assert.ok(section(one.buffer.toString("utf8"), "ghg_factor_table").includes("Diesel"), "one page alone still has its rows");
});

async function waitJob(id, ms = 120_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await call("GET", `/studio/jobs/${id}`, "manager");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (r.json.status === "done" || r.json.status === "failed") return r.json;
    if (Date.now() > until) throw new Error(`job ${id} still ${r.json.status}`);
    await wait(400);
  }
}

async function pdfText(buf) {
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs", { paths: [path.resolve(__dirname, "../../..")] }));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  let out = "";
  for (let n = 1; n <= doc.numPages; n++) out += (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ") + "\n";
  await doc.destroy();
  return out;
}

const rtest = (name, fn) =>
  test(name, async (t) => {
    if (!chromiumOk) return t.skip(why);
    await fn(t);
  });

rtest("proof and final PDFs print the rows; the final keeps them in its data snapshot", async () => {
  await setStudio(1, true);
  // Every category excluded (the final gate's report details) except that Category 6 has data and is reported.
  const doc = await makeDoc(`${TITLE} final`, FINAL_READY_INPUTS);
  const proof = await waitJob((await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "proof", rev: doc.rev })).json.id);
  assert.equal(proof.status, "done", JSON.stringify(proof));
  const text = await pdfText((await call("GET", proof.downloadUrl, "manager")).buffer);
  for (const t of ["Diesel", "DEFRA 2021", "India grid", "CEA v17", "Business travel", "3.25"]) assert.ok(text.includes(t), `proof has ${t}`);
  assert.ok(!text.includes("Pending fuel"));

  // A final needs no pending entries in the period (D6): drop the pending row, then the gate passes.
  await q(`DELETE FROM emission WHERE pk_id = 9505`);
  const c = await call("POST", `/studio/docs/${doc.id}/checks`, "manager", { rev: doc.rev });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const errors = c.json.checks.filter((x) => x.severity === "error");
  assert.deepEqual(errors.map((e) => e.id), [], JSON.stringify(errors));
  const r = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: doc.rev, acknowledgedWarnings: c.json.warnings });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const fin = await waitJob(r.json.id);
  assert.equal(fin.status, "done", JSON.stringify(fin));
  const finText = await pdfText((await call("GET", fin.downloadUrl, "manager")).buffer);
  for (const t of ["Diesel", "India grid", "Business travel", "3.25"]) assert.ok(finText.includes(t), `final has ${t}`);
  const [v] = await q(`SELECT data_snapshot FROM report_doc_version WHERE id = $1`, [fin.versionId]);
  assert.equal(v.data_snapshot.scope3["p-categories"].length, 15);
  assert.equal(v.data_snapshot.scope3["p-categories"].find((x) => x.n === 6).status, "reported");
  assert.equal(v.data_snapshot.scope3["p-categories"].find((x) => x.n === 7).status, "excluded");
  assert.ok(v.data_snapshot.flow["p-factors"].rows.some((x) => x.cells[1] === "Diesel"));
});
