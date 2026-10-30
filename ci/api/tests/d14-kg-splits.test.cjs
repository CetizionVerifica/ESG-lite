// D14 review fixes (30 Oct 2026): a report's parts (a site, a site × scope
// cell, a month, a quarter, a scope in a month, the renewable "saved" figure)
// each add their own rows' kg and round once, like the totals. Adding parts
// that were rounded on their own can miss the figure by 0.001 per part, so
// the GHG PDF, the studio and EDE read per-part figures from the server.
//
// Every row here is 1,234.4 kgCO₂e, stored as 1.234 t (1.2344 to 3 dp, #209),
// unless it says otherwise. Worked by hand:
//
//   CY 2038, site 1: Scope 1 rows on 10 Jan, 10 Feb, 10 Mar; a Scope 2 row on 11 Jan.
//     total     4 × 1,234.4 = 4,937.6 kg → 4.938 t
//     Scope 1   3 × 1,234.4 = 3,703.2 kg → 3.703 t;  Scope 2 1,234.4 kg → 1.234 t
//     site 1    4,937.6 kg → 4.938 t   (its category cells 3.703 + 1.234 = 4.937)
//     January   1,234.4 + 1,234.4 = 2,468.8 kg → 2.469 t   (scopes 1.234 + 1.234 = 2.468)
//     Feb, Mar  1,234.4 kg → 1.234 t each
//     Q1        4,937.6 kg → 4.938 t   (months 2.469 + 1.234 + 1.234 = 4.937)
//     Q1 Scope 1  3,703.2 kg → 3.703 t (months 1.234 × 3 = 3.702);  Q1 Scope 2 1.234 t
//
//   CY 2041, sites 1 and 2: one row of Stationary Combustion (category 1) and
//   one of "D14 Mobile Combustion" (Scope 1, category 9841) at each site, 10 Mar.
//     each site 2 × 1,234.4 = 2,468.8 kg → 2.469 t   (its cells 1.234 + 1.234 = 2.468)
//     Scope 1 = total = 4 × 1,234.4 = 4,937.6 kg → 4.938 t
//     (sites added: 2.469 + 2.469 = 4.938; cells added: 4 × 1.234 = 4.936)
//
//   CY 2043, sites 1 and 2: one Renewable Electricity row (no scope, category 4)
//   of 100.45 kg at each site (0.10045 t → stored 0.1 t).
//     saved = 2 × 100.45 = 200.9 kg → 0.201 t   (sites 0.1 + 0.1 = 0.2)
//
// Rows use pk_id 82100–82119, years no other test writes to.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio } = require("./ds-lib.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const SPLIT_YEAR = 2038;
const SITES_YEAR = 2041;
const SAVED_YEAR = 2043;
const MOBILE = 9841; // a second Scope 1 category

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const reset = async () => {
  await q(`DELETE FROM emission WHERE pk_id BETWEEN 82100 AND 82119`);
  await q(`DELETE FROM category WHERE category_id = $1`, [MOBILE]);
};
const insert = (id, category, site, date, tonnes, kg) =>
  q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, total_kgco2e, unit, date_of_reporting, status, category_id, site_id, reporting_period)
     VALUES ($1, '{"activity_value": 1}', $2, $3, 'tCO2e', $4, 'approved', $5, $6, 'monthly')`,
    [id, tonnes, kg, date, category, site],
  );

test.before(async () => {
  await reset();
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES ($1, 'D14 Mobile Combustion', 'Scope 1')`, [MOBILE]);
  await insert(82100, 1, 1, `${SPLIT_YEAR}-01-10`, 1.234, "1234.4");
  await insert(82101, 1, 1, `${SPLIT_YEAR}-02-10`, 1.234, "1234.4");
  await insert(82102, 1, 1, `${SPLIT_YEAR}-03-10`, 1.234, "1234.4");
  await insert(82103, 2, 1, `${SPLIT_YEAR}-01-11`, 1.234, "1234.4");
  await insert(82104, 1, 1, `${SITES_YEAR}-03-10`, 1.234, "1234.4");
  await insert(82105, MOBILE, 1, `${SITES_YEAR}-03-10`, 1.234, "1234.4");
  await insert(82106, 1, 2, `${SITES_YEAR}-03-10`, 1.234, "1234.4");
  await insert(82107, MOBILE, 2, `${SITES_YEAR}-03-10`, 1.234, "1234.4");
  await insert(82108, 4, 1, `${SAVED_YEAR}-04-10`, 0.1, "100.45");
  await insert(82109, 4, 2, `${SAVED_YEAR}-04-10`, 0.1, "100.45");
});
test.after(async () => {
  await reset();
  await setStudio(1, false);
});

const ok = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const tables = async (body) => ok(await call("POST", "/user/ghg/tables", "manager", { yearType: "CY", ...body }), "ghg tables");

test("GHG tables: each site's Scope 1, 2, 3 and total is its own kg rounded once, as EDE and Overview show it", async () => {
  const one = await tables({ siteIds: [1], year: SPLIT_YEAR });
  assert.deepEqual(one.tables.table_overviewByLocations_selectedYear.siteTotals, [
    { siteId: 1, siteName: "CI Plant A", scope1: 3.703, scope2: 1.234, scope3: 0, total: 4.938 },
  ]);
  assert.deepEqual(one.tables.table_overviewByLocations_compareYear.siteTotals, [], "no rows in the compare year");

  const two = await tables({ siteIds: [1, 2], year: SITES_YEAR });
  const sites = two.tables.table_overviewByLocations_selectedYear.siteTotals;
  assert.deepEqual(sites, [
    { siteId: 1, siteName: "CI Plant A", scope1: 2.469, scope2: 0, scope3: 0, total: 2.469 },
    { siteId: 2, siteName: "CI Plant B", scope1: 2.469, scope2: 0, scope3: 0, total: 2.469 },
  ]);
  // The category cells stay as they are (each its own kg rounded once): 1.234 each.
  for (const r of two.tables.table_overviewByLocations_selectedYear.rows) assert.deepEqual(r.bySite.map((b) => b.value), [1.234, 1.234], r.category);

  const ede = ok(await call("POST", "/user/reports/ede", "manager", { siteIds: [1, 2], frequency: "yearly", year: SITES_YEAR }), "EDE");
  assert.deepEqual(ede.bySite.map((s) => [s.siteId, s.scope1, s.total]), sites.map((s) => [s.siteId, s.scope1, s.total]), "EDE bySite");
  const ov = ok(await call("GET", `/manager/overview?period=${SITES_YEAR}&siteIds=1,2`, "manager"), "overview");
  const bySiteId = [...ov.by_site].sort((a, b) => a.site_id - b.site_id);
  assert.deepEqual(bySiteId.map((s) => [s.site_id, s.gross]), sites.map((s) => [s.siteId, s.total]), "Overview by_site");
});

test("GHG PDF: the site table, its Total row, the site chart and the site status agree with Table 1, EDE and Overview", async () => {
  const { AppDataSource } = require(path.join(ROOT, "dist/config/data-source.js"));
  const render = require(path.join(ROOT, "dist/reporting/render.js"));
  const print = require(path.join(ROOT, "dist/reporting/print.js"));
  const { generateGhgReport } = require(path.join(ROOT, "dist/reporting/ghg.js"));
  const real = { renderDocument: render.renderDocument, htmlToPdf: print.htmlToPdf };
  let doc = null;
  // The blocks are what this test reads: no HTML, no Chromium.
  render.renderDocument = (d) => ((doc = d), "<html></html>");
  print.htmlToPdf = async () => ({ pageCount: 1 });
  await AppDataSource.initialize();
  try {
    const r = await generateGhgReport({ siteIds: [1, 2], yearType: "CY", year: SITES_YEAR, frequency: "yearly" }, 1);
    assert.equal(r.total, 4.938);
  } finally {
    render.renderDocument = real.renderDocument;
    print.htmlToPdf = real.htmlToPdf;
    await AppDataSource.destroy();
  }
  const block = (type, title) => doc.blocks.find((b) => b.type === type && (title === undefined || b.title === title));
  const tiles = block("kpiRow").tiles;
  assert.deepEqual(tiles.slice(0, 2).map((t) => t.value), ["4.938", "4.938"], "Total and Scope 1 tiles (Table 1)");
  assert.deepEqual(block("table", "Site × scope").rows, [
    ["CI Plant A", "2.469", "2.469", "50.0%"],
    ["CI Plant B", "2.469", "2.469", "50.0%"],
    ["Total", "4.938", "4.938", "100.0%"],
  ]);
  const bars = block("stackedBars");
  assert.equal(bars.total, 4.938, "the chart's total is Table 1's");
  assert.deepEqual(bars.rows.map((r) => [r.label, r.values]), [["CI Plant A", [2.469]], ["CI Plant B", [2.469]]]);
  const status = block("table", "Site reporting status").rows;
  assert.deepEqual(status.slice(0, 2).map((r) => [r[0], r[2]]), [["CI Plant A", "2.469"], ["CI Plant B", "2.469"]]);
  const scope1 = doc.blocks.find((b) => b.type === "groupBars" && b.name === "Scope 1");
  assert.equal(scope1.total, "4.938 tCO₂e · 100.0%", "Scope 1's chart total is Table 1's");
});

test("GHG PDF: the share bar's 100% and each site bar's label are Table 1's and the site's own figures, not rounded scopes added up", async () => {
  // CY 2038, site 1: Scope 1 3,703.2 kg → 3.703 t, Scope 2 1,234.4 kg → 1.234 t;
  // total 4,937.6 kg → 4.938 t (the rounded scopes add to 4.937).
  // Shares of 4.938: 3.703 / 4.938 = 74.99 % → 75.0 %; 1.234 / 4.938 = 24.99 % → 25.0 %.
  const { AppDataSource } = require(path.join(ROOT, "dist/config/data-source.js"));
  const render = require(path.join(ROOT, "dist/reporting/render.js"));
  const print = require(path.join(ROOT, "dist/reporting/print.js"));
  const { generateGhgReport } = require(path.join(ROOT, "dist/reporting/ghg.js"));
  const real = { renderDocument: render.renderDocument, htmlToPdf: print.htmlToPdf };
  let html = "";
  // The real HTML (the SVG charts are drawn on the server); no Chromium.
  render.renderDocument = (...a) => ((html = real.renderDocument(...a)), html);
  print.htmlToPdf = async () => ({ pageCount: 1 });
  await AppDataSource.initialize();
  try {
    const r = await generateGhgReport({ siteIds: [1], yearType: "CY", year: SPLIT_YEAR, frequency: "yearly" }, 1);
    assert.equal(r.total, 4.938);
  } finally {
    render.renderDocument = real.renderDocument;
    print.htmlToPdf = real.htmlToPdf;
    await AppDataSource.destroy();
  }
  const figure = (title) => {
    const at = html.indexOf(`>${title}<`);
    assert.ok(at >= 0, `figure "${title}"`);
    const svg = html.slice(html.indexOf("<svg", at), html.indexOf("</svg>", at));
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  };
  const share = figure("Scope 1 drives the footprint");
  assert.ok(share.includes("100% = 4.938 tCO₂e"), `share bar: ${JSON.stringify(share)}`);
  assert.ok(share.includes("3.703  ·  75.0%") && share.includes("1.234  ·  25.0%"), `share bar parts: ${JSON.stringify(share)}`);
  const sites = figure("Emissions by site and scope");
  assert.ok(sites.includes("4.938  ·  100.0%"), `site bar label: ${JSON.stringify(sites)}`);
  assert.ok(!sites.some((t) => t.startsWith("4.937")), "no label adds the rounded scopes");
});

test("SBTi targets: the Scope-wise table's total is the Pathway table's in every year", async () => {
  // Base CY 2038, site 1: Scope 1 3.703 t, Scope 2 1.234 t; Scope 1 + 2 = 4,937.6 kg → 4.938 t
  // (no Scope 3, so the boundary is Scope 1 + 2). The rounded scopes add to 4.937.
  // At the default 4.2 %/yr: year 0 4.938; year 1 4.938 × 0.958 = 4.730604 → 4.731
  // (the scope targets added: 3.703 × 0.958 + 1.234 × 0.958 = 3.547474 + 1.182172 = 4.729646 → 4.730).
  const r = ok(await call("POST", "/user/targets/tables", "manager", { siteIds: [1], baseYear: SPLIT_YEAR, targetYear: SPLIT_YEAR + 5 }), "targets");
  assert.equal(r.targetBoundaryBase, 4.938);
  assert.deepEqual([r.baseTotals.scope1, r.baseTotals.scope2], [3.703, 1.234]);
  const { table1, table2 } = r.tables;
  assert.deepEqual(table1.slice(0, 2).map((x) => x.targetEmission), [4.938, 4.731]);
  assert.deepEqual(table2.map((x) => [x.year, x.totalTarget]), table1.map((x) => [x.year, x.targetEmission]), "Scope-wise total = Pathway target, every year");
  assert.deepEqual([table2[1].scope1Target, table2[1].scope2Target], [3.547, 1.182], "the scope columns are each rounded on their own");

  // Net zero from the same base: the boundary and year 0 are the same 4.938.
  const lt = ok(await call("POST", "/user/targets/long-term-chart", "manager", { siteIds: [1], baseYear: SPLIT_YEAR }), "long-term");
  assert.equal(lt.baseEmissions, 4.938);
  assert.equal(lt.rows[0].targetEmission, 4.938);
});

const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const resolve = async (year, sites, bindings) =>
  ok(await call("POST", "/studio/resolve", "manager", { kind: "ghg", year, yearType: "CY", sites, bindings, tokens: [] }), "resolve").values;
const points = (v) => Object.fromEntries(v.series[0].values.map((p) => [p.key, p.value]));

test("studio: site, month, quarter and scope-stack points are /user/ghg/tables' figures for that site or period", async () => {
  await setStudio(1, true);
  const [site, month, quarter, s1Quarter, s1Month] = await resolve(SPLIT_YEAR, [1], [
    ghg("total", { breakdown: "site" }),
    ghg("total", { breakdown: "month" }),
    ghg("total", { breakdown: "quarter" }),
    ghg("scope1", { breakdown: "quarter" }),
    ghg("scope1", { breakdown: "month" }),
  ]);
  assert.equal(site.value, 4.938);
  assert.deepEqual(points(site), { "CI Plant A": 4.938 });
  const m = points(month);
  assert.deepEqual([m[`${SPLIT_YEAR}-01`], m[`${SPLIT_YEAR}-02`], m[`${SPLIT_YEAR}-03`], m[`${SPLIT_YEAR}-04`]], [2.469, 1.234, 1.234, 0]);
  assert.deepEqual(points(quarter), { Q1: 4.938, Q2: 0, Q3: 0, Q4: 0 });
  assert.deepEqual(points(s1Quarter), { Q1: 3.703, Q2: 0, Q3: 0, Q4: 0 });
  assert.equal(points(s1Month)[`${SPLIT_YEAR}-01`], 1.234);
  const stack = (v, label, key) => v.stacks.find((s) => s.label === label).values.find((p) => p.key === key).value;
  assert.deepEqual(["Scope 1", "Scope 2", "Scope 3"].map((sc) => stack(quarter, sc, "Q1")), [3.703, 1.234, 0]);
  assert.deepEqual(["Scope 1", "Scope 2"].map((sc) => stack(month, sc, `${SPLIT_YEAR}-01`)), [1.234, 1.234]);

  // The same figures from the GHG tables for that month or quarter, and from Overview.
  const jan = await tables({ siteIds: [1], year: SPLIT_YEAR, frequency: "monthly", month: 1 });
  assert.equal(jan.totals[String(SPLIT_YEAR)].total, m[`${SPLIT_YEAR}-01`]);
  const q1 = await tables({ siteIds: [1], year: SPLIT_YEAR, frequency: "quarterly", quarter: 1 });
  const t = q1.totals[String(SPLIT_YEAR)];
  assert.deepEqual([t.total, t.scope1, t.scope2], [points(quarter).Q1, points(s1Quarter).Q1, stack(quarter, "Scope 2", "Q1")]);
  const ov = ok(await call("GET", `/manager/overview?period=${SPLIT_YEAR}&siteIds=1`, "manager"), "overview");
  assert.equal(ov.by_month.find((x) => x.month === `${SPLIT_YEAR}-01`).gross, m[`${SPLIT_YEAR}-01`]);

  // Two sites, two Scope 1 categories each: each site's figure is EDE's and Overview's.
  const [bySite] = await resolve(SITES_YEAR, [1, 2], [ghg("total", { breakdown: "site" })]);
  assert.equal(bySite.value, 4.938);
  assert.deepEqual(points(bySite), { "CI Plant A": 2.469, "CI Plant B": 2.469 });
});

test("EDE: totals.saved is the renewable rows' kg rounded once, as Overview and the GHG tables show it", async () => {
  const ede = ok(await call("POST", "/user/reports/ede", "manager", { siteIds: [1, 2], frequency: "yearly", year: SAVED_YEAR }), "EDE");
  assert.deepEqual(ede.savedBySite.map((s) => s.saved), [0.1, 0.1], "each site on its own: 100.45 kg → 0.1 t");
  assert.equal(ede.totals.saved, 0.201);
  const ov = ok(await call("GET", `/manager/overview?period=${SAVED_YEAR}&siteIds=1,2`, "manager"), "overview");
  assert.equal(ov.kpis.saved, ede.totals.saved);
  const t = await tables({ siteIds: [1, 2], year: SAVED_YEAR });
  assert.equal(t.tables.table_overviewByLocations_selectedYear.rows.find((r) => r.category === "Renewable Electricity").total, ede.totals.saved);
});
