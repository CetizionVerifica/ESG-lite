// DS-7 text and flow through the API (DS-7 adds no endpoint; it adds the
// footnote mark to the doc contract and `approvedEntries` to GHG values):
//   - autosave (PATCH /studio/docs/:id) keeps a text element with data chips of
//     both sources and footnote marks, and a flow section's GHG settings;
//   - a footnote without a note, or with an unknown attribute, is DS_DOC_INVALID;
//   - POST /studio/resolve returns approvedEntries for GHG chips (the hover card's
//     "Approved entries: n"), equal to the approved Scope 1–3 rows in the period;
//   - the switch-off, role and tenant rules of those routes still hold for a doc
//     carrying footnotes (DS_STUDIO_OFF, DS_ROLE, another company's doc → 404).
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3), company 2 (site 3; manager 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, runScript } = require("./ds-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const fn = (note) => ({ type: "footnote", attrs: { note } });
const ghg = (metric) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all" });
const kpi = (code) => ({ source: "kpi", kpis: [code], years: { last: 1 }, sites: "all" });
const chip = (binding) => ({ type: "data", attrs: { binding, measure: "value", format: "auto" } });

const textElement = (id) => ({
  id,
  type: "text",
  frame: { x: 20, y: 40, w: 150, h: 30, rotation: 0 },
  z: 10,
  props: {
    style: "body",
    align: "left",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Scope 1 was " },
            chip(ghg("scope1")),
            { type: "text", text: " tCO₂e", marks: [fn("Approved entries, DEFRA 2024 factors")] },
            { type: "text", text: "; renewable share " },
            chip(kpi("ENV-ENERGY-RENEW-SHARE")),
            { type: "text", text: "." },
          ],
        },
      ],
    },
  },
});

const cleanup = () => q(`DELETE FROM report_doc WHERE title LIKE 'DS-7%'`).catch(() => {});

test.before(async () => {
  const r = runScript("migrateDs5Docs");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  await cleanup();
});
test.after(async () => {
  await cleanup();
  await setStudio(1, false);
  await setStudio(2, false);
});

async function blankDoc(who = "manager", title = "DS-7 Text") {
  await setStudio(1, true);
  const r = await call("POST", "/studio/docs", who, { kind: "ghg", templateId: "blank", format: "a4", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, title });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

test("autosave keeps chips of both sources, footnote marks and GHG flow settings", async () => {
  const { id, doc, rev } = await blankDoc();
  const next = JSON.parse(JSON.stringify(doc));
  const pg = next.pages.find((p) => p.kind === "freeform");
  pg.elements.push(textElement("ds7-text"));
  next.pages.push({ id: "ds7-s3", kind: "flow", name: "Scope 3 categories", flowType: "scope3_categories", options: { categories: [1, 4, 6], showDq: false, showMethod: true, columns: 1 } });
  next.pages.push({ id: "ds7-meth", kind: "flow", name: "Methodology", flowType: "methodology", options: { columns: 2 }, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "GWP", marks: [{ type: "bold" }, fn("IPCC AR6")] }] }] } });
  const r = await call("PATCH", `/studio/docs/${id}`, "admin", { rev, doc: next });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const saved = r.json.doc;
  const el = saved.pages.find((p) => p.id === pg.id).elements.find((e) => e.id === "ds7-text");
  const para = el.props.doc.content[0].content;
  assert.deepEqual(para[1].attrs.binding, ghg("scope1"));
  assert.deepEqual(para[4].attrs.binding, kpi("ENV-ENERGY-RENEW-SHARE"));
  assert.deepEqual(para[2].marks, [fn("Approved entries, DEFRA 2024 factors")]);
  assert.deepEqual(saved.pages.find((p) => p.id === "ds7-s3").options, { categories: [1, 4, 6], showDq: false, showMethod: true, columns: 1 });
  assert.deepEqual(saved.pages.find((p) => p.id === "ds7-meth").content.content[0].content[0].marks, [{ type: "bold" }, fn("IPCC AR6")]);
});

test("a footnote needs a note; unknown attributes and other categories are refused (DS_DOC_INVALID)", async () => {
  const { id, doc, rev } = await blankDoc("manager", "DS-7 Invalid");
  const withMarks = (marks, options) => {
    const d = JSON.parse(JSON.stringify(doc));
    const el = textElement("bad");
    el.props.doc.content[0].content[2].marks = marks;
    d.pages.find((p) => p.kind === "freeform").elements.push(el);
    if (options) d.pages.push({ id: "bad-s3", kind: "flow", name: "S3", flowType: "scope3_categories", options });
    return d;
  };
  for (const [marks, options] of [[[{ type: "footnote", attrs: { note: "" } }]], [[{ type: "footnote" }]], [[{ type: "footnote", attrs: { note: "a", onclick: "x" } }]], [[fn("ok")], { categories: [0] }], [[fn("ok")], { showDq: "yes" }]]) {
    const r = await call("PATCH", `/studio/docs/${id}`, "manager", { rev, doc: withMarks(marks, options) });
    assert.equal(r.status, 422, JSON.stringify(marks));
    assert.equal(r.json.code, "DS_DOC_INVALID");
  }
});

test("resolve: a GHG chip carries approvedEntries = approved Scope 1–3 rows of the period and sites", async () => {
  await setStudio(1, true);
  const r = await call("POST", "/studio/resolve", "manager", { kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings: [], tokens: [chip(ghg("scope1")), chip(ghg("total"))] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [expected] = await q(
    `SELECT COUNT(*)::int AS n FROM emission e JOIN category c ON c.category_id = e.category_id
      WHERE e.site_id IN (1, 2) AND e.status = 'approved' AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3')
        AND e.date_of_reporting >= '2025-01-01' AND e.date_of_reporting < '2026-01-01'`,
  );
  assert.ok(expected.n > 0, "the API fixture has approved 2025 rows");
  for (const t of r.json.tokens) assert.equal(t.approvedEntries, expected.n, "the approved rows behind the figure");
  // Site 1 only reads fewer or equal rows.
  const one = await call("POST", "/studio/resolve", "manager", { kind: "ghg", year: 2025, yearType: "CY", sites: [1], bindings: [], tokens: [chip({ ...ghg("scope1"), sites: [1] })] });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.ok(one.json.tokens[0].approvedEntries <= r.json.tokens[0].approvedEntries);
});

test("switch off, roles and tenant isolation hold for a doc with footnotes", async () => {
  const { id, doc, rev } = await blankDoc("manager", "DS-7 Guarded");
  const d = JSON.parse(JSON.stringify(doc));
  d.pages.find((p) => p.kind === "freeform").elements.push(textElement("guarded"));
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "user", { rev, doc: d })).json.code, "DS_ROLE");
  await setStudio(2, true);
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "otherManager", { rev, doc: d })).status, 404, "company 2 can't write company 1's doc");
  await setStudio(1, false);
  const off = await call("PATCH", `/studio/docs/${id}`, "manager", { rev, doc: d });
  assert.equal(off.status, 403);
  assert.equal(off.json.code, "DS_STUDIO_OFF");
  const offResolve = await call("POST", "/studio/resolve", "manager", { kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings: [], tokens: [chip(ghg("scope1"))] });
  assert.equal(offResolve.json.code, "DS_STUDIO_OFF");
});
