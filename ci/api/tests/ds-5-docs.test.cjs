// DS-5 designs: GET /studio/readiness, GET/POST /studio/docs, GET/PATCH/DELETE
// /studio/docs/:id, POST /docs/:id/rebuild, /presence, /duplicate.
//
//   - switch off (DS_STUDIO_OFF) on every route; Users get DS_ROLE;
//   - tenant isolation: another company's docs, templates and sites are not found,
//     for every route; a Superadmin names the company; a site-scoped Manager
//     can't build or open a company-wide design;
//   - readiness: GHG counts, sites, months and gaps for the period; kind off;
//   - auto-build from a fixture template (DS-4 seeds come with DS-4): the empty
//     market-based page is left out, the kept Scope 3 page says so, placeholders
//     are filled, figures equal POST /user/ghg/tables, rev 1 + an autosave version;
//     the background build (wait=0) is polled to done; blank designs;
//   - autosave: rev conflict, invalid / too large / kind change, title rename, an
//     autosave version every 10 minutes; finals can't be changed or deleted;
//   - DS_KIND_OFF for a sustainability design after KPI tracking is turned off;
//   - rebuild keeps people's edits; duplicate copies pages and inputs; presence;
//     soft delete; migrate:ds-5-docs running twice.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2 on both sites, admin 3),
// company 2 (site 3; other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const TEMPLATE_DOC = require(path.resolve(__dirname, "../../fixtures/studio/ds-5-template-ghg.json"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const texts = (node, out = []) => {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text") out.push(node.text);
  (node.content ?? []).forEach((c) => texts(c, out));
  return out;
};
const page = (doc, id) => doc.pages.find((p) => p.id === id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// report_template ships with DS-4; until then the test makes it the 01-contracts §3 way.
const ensureTemplateTable = () =>
  q(`CREATE TABLE IF NOT EXISTS report_template (
       id serial PRIMARY KEY, company_id integer, kind varchar(20) NOT NULL, purpose varchar(20) NOT NULL DEFAULT 'report', format varchar(20) NOT NULL DEFAULT 'a4',
       name varchar(200) NOT NULL, tags text[] NOT NULL DEFAULT '{}', theme jsonb NOT NULL DEFAULT '{}', doc jsonb NOT NULL, thumbnail_key varchar(300),
       version integer NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT true, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
const addTemplate = async (companyId, kind, name, doc, format = "a4", version = 1) =>
  (await q(`INSERT INTO report_template (company_id, kind, purpose, format, name, doc, version) VALUES ($1, $2, 'report', $3, $4, $5, $6) RETURNING id`, [companyId, kind, format, name, JSON.stringify(doc), version]))[0].id;

const SUSTAINABILITY_DOC = {
  schemaVersion: 2,
  kind: "sustainability",
  purpose: "report",
  format: "a4",
  meta: { title: "x", year: 2025, yearType: "CY", sites: "all", frameworks: ["GRI"], language: "en" },
  design: { templateId: "x", templateVersion: 1, theme: {} },
  assets: [],
  pages: [
    {
      id: "s-cover",
      kind: "freeform",
      name: "Cover",
      background: {},
      elements: [{ id: "s-cover.t", type: "text", frame: { x: 20, y: 20, w: 170, h: 20, rotation: 0 }, z: 0, source: "layout", props: { style: "title", align: "left", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "{{company.name}} sustainability report {{meta.year}}" }] }] } } }],
    },
  ],
};

let T = {}; // template ids
const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE company_id IN (1, 2) AND title LIKE 'DS-5%')`);
  await q(`DELETE FROM report_doc WHERE company_id IN (1, 2) AND title LIKE 'DS-5%'`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'report_doc'`);
  await q(`INSERT INTO user_sites (user_id, site_id) SELECT 2, 2 WHERE NOT EXISTS (SELECT 1 FROM user_sites WHERE user_id = 2 AND site_id = 2)`);
};

test.before(async () => {
  const r = runScript("migrateDs5Docs");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  await ensureTemplateTable();
  await q(`DELETE FROM report_template WHERE name LIKE 'DS-5%'`);
  T = {
    ghg: await addTemplate(null, "ghg", "DS-5 Inventory", TEMPLATE_DOC, "a4", 2),
    other: await addTemplate(2, "ghg", "DS-5 Company 2 only", TEMPLATE_DOC),
    sus: await addTemplate(null, "sustainability", "DS-5 Annual", SUSTAINABILITY_DOC),
    inactive: await addTemplate(null, "ghg", "DS-5 Retired", TEMPLATE_DOC),
  };
  await q(`UPDATE report_template SET is_active = false WHERE id = $1`, [T.inactive]);
  await reset();
});
test.after(async () => {
  await reset();
  await q(`DELETE FROM report_template WHERE name LIKE 'DS-5%'`);
});

const createBody = (extra = {}) => ({ kind: "ghg", templateId: T.ghg, year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, ...extra });
const create = async (who = "manager", extra = {}, query = "") => {
  const r = await call("POST", `/studio/docs${query}`, who, createBody(extra));
  return r;
};
const built = async (extra = {}) => {
  const r = await create("manager", extra);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};

test("switch off: every DS-5 route answers DS_STUDIO_OFF; Users get DS_ROLE once it's on", async () => {
  await setStudio(1, true);
  const doc = await built();
  await setStudio(1, false);
  const routes = [
    ["GET", "/studio/readiness?kind=ghg&year=2025"],
    ["GET", "/studio/docs"],
    ["POST", "/studio/docs", createBody()],
    ["GET", `/studio/docs/${doc.id}`],
    ["PATCH", `/studio/docs/${doc.id}`, { rev: 1, title: "DS-5 x" }],
    ["DELETE", `/studio/docs/${doc.id}`],
    ["POST", `/studio/docs/${doc.id}/rebuild`, {}],
    ["POST", `/studio/docs/${doc.id}/presence`, {}],
    ["POST", `/studio/docs/${doc.id}/duplicate`, {}],
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
  }
  assert.equal((await call("GET", "/studio/docs")).status, 401);
});

test("readiness (GHG): approved, pending and rejected counts, sites, months, Scope 3 and linked gaps", async () => {
  await setStudio(1, true);
  const r = await call("GET", "/studio/readiness?kind=ghg&year=2025&yearType=CY", "manager");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = r.json;
  assert.equal(g.kind, "ghg");
  assert.equal(g.periodLabel, "2025");
  // CY 2025, Scope 1–3 rows on sites 1 and 2 (company 2's 999 t row never counts).
  assert.equal(g.approvedRows, 4);
  assert.equal(g.pendingRows, 2);
  assert.equal(g.rejectedRows, 1);
  assert.equal(g.sitesCovered, 2);
  assert.equal(g.sitesTotal, 2);
  assert.equal(g.monthsCovered, 3, "Feb, Aug and Sep 2025");
  assert.equal(g.monthsExpected, 12);
  assert.deepEqual(g.monthsMissing.map((m) => [m.siteId, m.months.length]), [[1, 10], [2, 11]]);
  assert.match(g.scope3Addressed, /^\d{1,2}\/15$/);
  const pending = g.gaps.find((x) => x.kind === "pending_entries");
  assert.equal(pending.count, 2);
  assert.equal(pending.link, "/data/approvals");
  assert.ok(g.gaps.some((x) => x.kind === "scope3_unaddressed" && x.link === "/settings/scope3/screening"));
  assert.equal(g.state, "almost");
  // One site; another company's site is not found; 'all' needs every site.
  const one = await call("GET", "/studio/readiness?kind=ghg&year=2025&sites=1", "admin");
  assert.equal(one.json.approvedRows, 3);
  assert.equal(one.json.sitesTotal, 1);
  assert.equal((await call("GET", "/studio/readiness?kind=ghg&year=2025&sites=3", "manager")).status, 404);
  assert.equal((await call("GET", "/studio/readiness?kind=ghg&year=2025", "superadmin")).json.code, "DS_COMPANY_REQUIRED");
  const sa = await call("GET", "/studio/readiness?kind=ghg&year=2025&company_id=1", "superadmin");
  assert.equal(sa.json.approvedRows, 4);
  // Excluding categories in screening counts them as addressed.
  await q(`INSERT INTO company_scope3_category (company_id, ghg_category, status, reason) VALUES (1, 8, 'excluded', 'No leased assets') ON CONFLICT (company_id, ghg_category) DO UPDATE SET status = 'excluded'`).catch(async () => {
    await q(`UPDATE company_scope3_category SET status = 'excluded' WHERE company_id = 1 AND ghg_category = 8`);
  });
  const after = await call("GET", "/studio/readiness?kind=ghg&year=2025", "manager");
  assert.ok(after.json.scope3.excluded.includes(8));
  assert.ok(!after.json.scope3.unaddressed.includes(8));
  await q(`DELETE FROM company_scope3_category WHERE company_id = 1 AND ghg_category = 8`);
  // Validation and kind.
  assert.equal((await call("GET", "/studio/readiness?kind=ghg", "manager")).json.code, "DS_VALIDATION");
  assert.equal((await call("GET", "/studio/readiness?kind=sustainability&year=2025", "manager")).json.code, "DS_KIND_OFF");
  await setKpi(1, true);
  const sus = await call("GET", "/studio/readiness?kind=sustainability&year=2025", "manager");
  assert.equal(sus.status, 200, JSON.stringify(sus.json));
  assert.equal(sus.json.kind, "sustainability");
  assert.equal(typeof sus.json.locked, "boolean");
  assert.ok(Array.isArray(sus.json.coverage) && Array.isArray(sus.json.missing));
  await setKpi(1, false);
});

test("auto-build: empty pages left out, kept pages say so, placeholders filled, figures equal the GHG report", async () => {
  await setStudio(1, true);
  const r = await create("manager", { inputs: { responsible_person: { value: "Asha Rao" } }, compareYear: 2024 });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const { id, doc, rev, status, build } = r.json;
  assert.equal(rev, 1);
  assert.equal(status, "draft");
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.meta.title, "DS-5 Inventory 2025");
  assert.equal(doc.meta.compareYear, 2024);
  assert.deepEqual(doc.design, { templateId: String(T.ghg), templateVersion: 2, theme: { look: "classic" } });
  assert.deepEqual(doc.pages.map((p) => p.id), ["p-cover", "p-summary", "p-cat9", "p-method"], "market-based Scope 2 isn't recorded: page left out");
  assert.equal(build.state, "done");
  assert.deepEqual(build.dropped.map((d) => d.pageId), ["p-market"]);
  assert.equal(build.pageCount, 4);
  assert.deepEqual(build.steps.map((s) => [s.id, s.state]), [["template", "done"], ["data", "done"], ["layout", "done"], ["inputs", "done"], ["ai", "skipped"], ["save", "done"]]);
  assert.deepEqual(texts(page(doc, "p-cover").elements[1].props.doc), ["CI Steel Co · 2025"]);
  assert.match(texts(page(doc, "p-summary").elements[1].props.doc).join(""), /Prepared by Asha Rao\.$/);
  assert.deepEqual(texts(page(doc, "p-cat9").elements[1].props.doc), ["Category 9 is not reported yet."]);
  assert.match(texts(page(doc, "p-method").content).join(""), /^Consolidation approach: .+\.$/);
  assert.doesNotMatch(JSON.stringify(doc), /\{\{/, "no placeholder left");
  assert.match(r.json.dataHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(page(doc, "p-cover").elements[2].basedOnHash, r.json.dataHash);
  // rev 1 and an autosave version.
  const versions = await q(`SELECT n, kind, rev, design_version, page_count FROM report_doc_version WHERE doc_id = $1`, [id]);
  assert.deepEqual(versions, [{ n: 1, kind: "autosave", rev: 1, design_version: 2, page_count: 4 }]);
  const stored = (await q(`SELECT inputs, template_id, kind, format, purpose, year, year_type FROM report_doc WHERE id = $1`, [id]))[0];
  assert.equal(stored.inputs.responsible_person.value, "Asha Rao");
  assert.equal(stored.template_id, T.ghg);
  // The figures the design shows are the GHG report's.
  const tables = await call("POST", "/user/ghg/tables", "manager", { siteIds: [1, 2], yearType: "CY", year: 2025 });
  const t = tables.json.totals["2025"];
  const bindings = [page(doc, "p-cover").elements[2].props.binding, page(doc, "p-summary").elements[0].props.binding];
  const res = await call("POST", "/studio/resolve", "manager", { kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings, tokens: [], docId: id });
  close(res.json.values[0].value, t.total, "total");
  close(res.json.values[1].value, t.scope1, "scope1");
  // GET returns the same.
  const got = await call("GET", `/studio/docs/${id}`, "admin");
  assert.equal(got.status, 200);
  assert.deepEqual(got.json.doc, doc);
});

test("background build: 202 at once, then polled with ?build=1 until done", async () => {
  await setStudio(1, true);
  const r = await create("manager", { title: "DS-5 Background" }, "?wait=0");
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.build.state, "running");
  let poll;
  for (let i = 0; i < 100; i++) {
    poll = await call("GET", `/studio/docs/${r.json.id}?build=1`, "manager");
    assert.equal(poll.status, 200);
    if (poll.json.build.state !== "running") break;
    await wait(100);
  }
  assert.equal(poll.json.build.state, "done", JSON.stringify(poll.json.build));
  assert.equal(poll.json.doc, undefined, "polling carries only the progress");
  const full = await call("GET", `/studio/docs/${r.json.id}`, "manager");
  assert.equal(full.json.doc.meta.title, "DS-5 Background");
  assert.equal(full.json.doc.pages.length, 4);
});

test("create: blank designs, template and site checks, inputs validation, role R", async () => {
  await setStudio(1, true);
  const before = (await q(`SELECT COUNT(*)::int AS n FROM report_doc WHERE company_id = 1`))[0].n;
  const blank = await create("admin", { templateId: "blank", format: "slide_16_9", title: "DS-5 Blank deck" });
  assert.equal(blank.status, 201, JSON.stringify(blank.json));
  assert.equal(blank.json.doc.format, "slide_16_9");
  assert.equal(blank.json.doc.purpose, "deck");
  assert.equal(blank.json.doc.pages.length, 1);
  for (const [extra, status, code] of [
    [{ templateId: T.other }, 404, "DS_LAYOUT_NOT_FOUND"], // company 2's own template
    [{ templateId: T.inactive }, 404, "DS_LAYOUT_NOT_FOUND"],
    [{ templateId: 999999 }, 404, "DS_LAYOUT_NOT_FOUND"],
    [{ format: "slide_16_9" }, 422, "DS_FORMAT_INVALID"],
    [{ sites: [3] }, 404, "DS_DOC_NOT_FOUND"],
    [{ inputs: { leadership_message: { value: "Not a GHG input" } } }, 400, "DS_VALIDATION"],
    [{ inputs: { base_year: { value: "last year" } } }, 400, "DS_VALIDATION"],
    [{ year: 1800 }, 400, "DS_VALIDATION"],
    [{ kind: "sustainability", templateId: T.sus, frameworks: ["GRI"] }, 403, "DS_KIND_OFF"],
  ]) {
    const r = await create("manager", extra);
    assert.equal(r.status, status, `${JSON.stringify(extra)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, code);
  }
  const count = await q(`SELECT COUNT(*)::int AS n FROM report_doc WHERE company_id = 1`);
  assert.equal(count[0].n, before + 1, "a refused build leaves nothing behind");
  // Company 2 uses its own template; a Superadmin names the company.
  await setStudio(2, true);
  const other = await create("otherManager", { templateId: T.other });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  const sa = await call("POST", "/studio/docs?company_id=1", "superadmin", createBody({ company_id: 1, title: "DS-5 By superadmin" }));
  assert.equal(sa.status, 201, JSON.stringify(sa.json));
  // A GHG template can't make a sustainability design.
  await setKpi(1, true);
  const mismatch = await create("manager", { kind: "sustainability", frameworks: ["GRI"] });
  assert.equal(mismatch.json.code, "DS_LAYOUT_NOT_FOUND");
  const sus = await create("manager", { kind: "sustainability", templateId: T.sus, frameworks: ["GRI"] });
  assert.equal(sus.status, 201, JSON.stringify(sus.json));
  assert.deepEqual(texts(sus.json.doc.pages[0].elements[0].props.doc), ["CI Steel Co sustainability report 2025"]);
});

test("tenant isolation: another company's designs are not found on every route; the list is the company's own", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await built({ title: "DS-5 Tenant" });
  const routes = [
    ["GET", `/studio/docs/${doc.id}`],
    ["GET", `/studio/docs/${doc.id}?build=1`],
    ["PATCH", `/studio/docs/${doc.id}`, { rev: 1, title: "DS-5 hijack" }],
    ["DELETE", `/studio/docs/${doc.id}`],
    ["POST", `/studio/docs/${doc.id}/rebuild`, {}],
    ["POST", `/studio/docs/${doc.id}/presence`, {}],
    ["POST", `/studio/docs/${doc.id}/duplicate`, {}],
    ["GET", "/studio/docs/abc"],
    ["PATCH", `/studio/docs/${doc.id}`, {}], // an invalid body still answers 404 first
  ];
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "otherManager", b);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND", `${m} ${p}`);
    const sa = await call(m, `${p}${p.includes("?") ? "&" : "?"}company_id=2`, "superadmin", b ? { ...b, company_id: 2 } : undefined);
    assert.equal(sa.status, 404, `superadmin as company 2: ${m} ${p}`);
  }
  assert.equal((await call("GET", `/studio/docs/${doc.id}?company_id=1`, "superadmin")).status, 200);
  const list = await call("GET", "/studio/docs", "otherManager");
  assert.ok(!list.json.some((d) => d.id === doc.id));
  const mine = await call("GET", "/studio/docs?kind=ghg&year=2025", "manager");
  const row = mine.json.find((d) => d.id === doc.id);
  assert.ok(row);
  assert.equal(row.title, "DS-5 Tenant");
  assert.equal(row.pageCount, 4);
  assert.equal(row.status, "draft");
  assert.equal(row.buildState, "done");
  assert.equal(row.updatedBy, "CI Manager");
  assert.equal(row.finalVersion, null);
  assert.ok(!(await call("GET", "/studio/docs?year=2024", "manager")).json.some((d) => d.id === doc.id));
  // A site-scoped Manager can't open or build a company-wide design.
  await q(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`);
  try {
    assert.equal((await call("GET", `/studio/docs/${doc.id}`, "manager")).status, 404);
    assert.ok(!(await call("GET", "/studio/docs", "manager")).json.some((d) => d.id === doc.id));
    const r = await create("manager");
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "DS_SITES_SCOPE");
    assert.equal((await create("manager", { sites: [1], title: "DS-5 Site 1" })).status, 201);
  } finally {
    await q(`INSERT INTO user_sites (user_id, site_id) VALUES (2, 2)`);
  }
});

test("autosave: rev conflict, validation, rename, an autosave version every 10 minutes; finals are immutable", async () => {
  await setStudio(1, true);
  const { id, doc } = await built({ title: "DS-5 Autosave" });
  const edited = JSON.parse(JSON.stringify(doc));
  edited.pages[1].elements[0].frame.x = 30;
  const ok = await call("PATCH", `/studio/docs/${id}`, "admin", { rev: 1, doc: edited });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.rev, 2);
  assert.equal(ok.json.doc.pages[1].elements[0].frame.x, 30);
  const stale = await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 1, doc: edited });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  assert.equal(stale.json.details.rev, 2);
  // The first autosave was just made by the build: no new one yet.
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM report_doc_version WHERE doc_id = $1`, [id]))[0].n, 1);
  await q(`UPDATE report_doc_version SET created_at = now() - interval '11 minutes' WHERE doc_id = $1`, [id]);
  const later = await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 2, title: "DS-5 Renamed" });
  assert.equal(later.status, 200, JSON.stringify(later.json));
  assert.equal(later.json.title, "DS-5 Renamed");
  assert.equal(later.json.doc.meta.title, "DS-5 Renamed");
  assert.equal(later.json.doc.pages[1].elements[0].frame.x, 30, "a rename keeps the doc");
  const versions = await q(`SELECT n, kind, rev FROM report_doc_version WHERE doc_id = $1 ORDER BY n`, [id]);
  assert.deepEqual(versions, [{ n: 1, kind: "autosave", rev: 1 }, { n: 2, kind: "autosave", rev: 3 }]);
  // Invalid, too large, another kind or format.
  const bad = JSON.parse(JSON.stringify(later.json.doc));
  bad.pages[0].elements[0].frame.x = 500;
  const invalid = await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3, doc: bad });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.code, "DS_DOC_INVALID");
  assert.ok(invalid.json.details.issues.length);
  const big = JSON.parse(JSON.stringify(later.json.doc));
  big.pages.push(...Array.from({ length: 120 }, (_, i) => ({ id: `big${i}`, kind: "freeform", name: "x", background: {}, notes: "x".repeat(19000), elements: [] })));
  const tooLarge = await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3, doc: big });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.json.code, "DS_DOC_TOO_LARGE");
  const kind = { ...later.json.doc, kind: "sustainability", meta: { ...later.json.doc.meta, frameworks: ["GRI"] } };
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3, doc: kind })).json.code, "DS_DOC_INVALID");
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3 })).json.code, "DS_VALIDATION");
  const sitesOther = { ...later.json.doc, meta: { ...later.json.doc.meta, sites: [3] } };
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3, doc: sitesOther })).status, 404);
  // A final can't be changed or deleted.
  await q(`UPDATE report_doc SET status = 'final' WHERE id = $1`, [id]);
  assert.equal((await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 3, title: "DS-5 x" })).json.code, "DS_FINAL_IMMUTABLE");
  assert.equal((await call("DELETE", `/studio/docs/${id}`, "manager")).json.code, "DS_FINAL_IMMUTABLE");
  assert.equal((await call("POST", `/studio/docs/${id}/rebuild`, "manager", {})).json.code, "DS_FINAL_IMMUTABLE");
});

test("DS_KIND_OFF: a sustainability design can't be reached by id once KPI tracking is off", async () => {
  await setStudio(1, true);
  await setKpi(1, true);
  const r = await create("manager", { kind: "sustainability", templateId: T.sus, frameworks: ["GRI"], title: "DS-5 Sustainability" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await setKpi(1, false);
  for (const [m, p, b] of [
    ["GET", `/studio/docs/${r.json.id}`],
    ["PATCH", `/studio/docs/${r.json.id}`, { rev: 1, title: "DS-5 x" }],
    ["DELETE", `/studio/docs/${r.json.id}`],
    ["POST", `/studio/docs/${r.json.id}/duplicate`, {}],
    ["POST", `/studio/docs/${r.json.id}/presence`, {}],
    ["POST", `/studio/docs/${r.json.id}/rebuild`, {}],
    ["GET", "/studio/docs?kind=sustainability"],
  ]) {
    const res = await call(m, p, "manager", b);
    assert.equal(res.status, 403, `${m} ${p}`);
    assert.equal(res.json.code, "DS_KIND_OFF", `${m} ${p}`);
  }
  assert.ok(!(await call("GET", "/studio/docs", "manager")).json.some((d) => d.id === r.json.id), "hidden from the list");
  await setKpi(1, true);
  assert.equal((await call("GET", `/studio/docs/${r.json.id}`, "manager")).status, 200, "turning it back on shows the design again");
});

test("rebuild keeps people's edits; duplicate copies pages and inputs; presence; soft delete", async () => {
  await setStudio(1, true);
  const { id, doc } = await built({ title: "DS-5 Rebuild", inputs: { responsible_person: { value: "Asha Rao" } } });
  const edited = JSON.parse(JSON.stringify(doc));
  const summary = page(edited, "p-summary");
  summary.elements[0].frame.y = 25; // moved by a person
  summary.elements.push({ id: "u-note", type: "text", frame: { x: 20, y: 200, w: 100, h: 10, rotation: 0 }, z: 9, source: "user", props: { style: "caption", align: "left", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Our note" }] }] } } });
  page(edited, "p-cover").elements[0].props.align = "center"; // an unreviewed template element: the rebuild restores it
  const saved = await call("PATCH", `/studio/docs/${id}`, "manager", { rev: 1, doc: edited });
  assert.equal(saved.status, 200);
  const rb = await call("POST", `/studio/docs/${id}/rebuild`, "manager", {});
  assert.equal(rb.status, 200, JSON.stringify(rb.json));
  assert.equal(rb.json.rev, 3);
  assert.deepEqual(rb.json.rebuilt.sort(), ["p-cat9", "p-cover", "p-method", "p-summary"]);
  const s = page(rb.json.doc, "p-summary").elements;
  assert.equal(s[0].frame.y, 25);
  assert.ok(s.some((e) => e.id === "u-note"));
  assert.equal(page(rb.json.doc, "p-cover").elements[0].props.align, "left");
  const onlyCover = await call("POST", `/studio/docs/${id}/rebuild`, "admin", { pageIds: ["p-cover"] });
  assert.deepEqual(onlyCover.json.rebuilt, ["p-cover"]);
  // Duplicate.
  const dup = await call("POST", `/studio/docs/${id}/duplicate`, "admin", {});
  assert.equal(dup.status, 201, JSON.stringify(dup.json));
  const copy = await call("GET", `/studio/docs/${dup.json.id}`, "manager");
  assert.equal(copy.json.title, "DS-5 Rebuild (copy)");
  assert.equal(copy.json.rev, 1);
  assert.deepEqual(copy.json.doc.pages.map((p) => p.id), onlyCover.json.doc.pages.map((p) => p.id));
  const inputs = await call("GET", `/studio/docs/${dup.json.id}/inputs`, "manager");
  assert.equal(inputs.json.inputs.responsible_person.value, "Asha Rao");
  const named = await call("POST", `/studio/docs/${id}/duplicate`, "manager", { title: "DS-5 Named copy" });
  assert.equal((await call("GET", `/studio/docs/${named.json.id}`, "manager")).json.doc.meta.title, "DS-5 Named copy");
  // Presence.
  assert.deepEqual((await call("POST", `/studio/docs/${id}/presence`, "manager", {})).json, { others: 0 });
  assert.deepEqual((await call("POST", `/studio/docs/${id}/presence`, "admin", {})).json, { others: 1 });
  // Soft delete.
  const del = await call("DELETE", `/studio/docs/${dup.json.id}`, "admin");
  assert.equal(del.status, 204);
  assert.equal((await call("GET", `/studio/docs/${dup.json.id}`, "manager")).status, 404);
  assert.ok(!(await call("GET", "/studio/docs", "manager")).json.some((d) => d.id === dup.json.id));
  const row = (await q(`SELECT deleted_at FROM report_doc WHERE id = $1`, [dup.json.id]))[0];
  assert.ok(row.deleted_at, "the row is kept");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_type = 'report_doc' AND entity_id = $1`, [dup.json.id]))[0].n, 1);
  // A blank design has no template to rebuild from.
  const blank = await create("manager", { templateId: "blank", title: "DS-5 Blank" });
  assert.equal((await call("POST", `/studio/docs/${blank.json.id}/rebuild`, "manager", {})).json.code, "DS_LAYOUT_NOT_FOUND");
});

test("migrate:ds-5-docs runs twice and changes nothing", async () => {
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateDs5Docs");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'report_doc' ORDER BY column_name`);
  for (const c of ["kind", "purpose", "format", "inputs", "source_doc_id", "template_id", "data_hash", "build", "draft", "rev", "deleted_at"]) {
    assert.ok(cols.some((r) => r.column_name === c), c);
  }
});
