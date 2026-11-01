// D14 (30 Oct 2026, "Sum kg in every report"): every report adds the rows'
// exact kgCO₂e and rounds once (src/reporting/kgTotals.ts), so the GHG
// tables, the Scope 3 section, EDE, Overview, targets, the entries list and
// the Breakdown panel show the same figure for the same approved rows.
//
// Worked by hand:
//   A row of 1,234.4 kgCO₂e is stored as total_kgco2e 1234.4000 and
//   total_emission 1.234 t (1.2344 rounded to 3 dp, #209).
//   Two such rows: 1,234.4 + 1,234.4 = 2,468.8 kg = 2.4688 t → 2.469 t.
//   (Adding the stored tonnes would give 1.234 + 1.234 = 2.468 t: the figure
//   the GHG tables showed while the Scope 3 section showed 2.469.)
//   A legacy row saved before kg totals (total_kgco2e NULL, 1.23 t at 2 dp)
//   counts as 1.23 × 1000 = 1,230 kg. With the two rows above:
//   1,230 + 2,468.8 = 3,698.8 kg = 3.6988 t → 3.699 t
//   (stored tonnes would add to 1.23 + 1.234 + 1.234 = 3.698; dropping the
//   legacy row would give 2.469).
//
// Fixture: company 1, site 1 has Scope 3 category 3 "Business Travel".
// Rows here use pk_id 82090–82099 and years no other test writes to.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const KG_YEAR = 2036; // the two 1,234.4 kg rows
const LEGACY_YEAR = 2037; // the same two rows plus one legacy row without kg

const reset = () => withDb((db) => db.query(`DELETE FROM emission WHERE pk_id BETWEEN 82090 AND 82099`));

const insert = (db, id, year, tonnes, kg) =>
  db.query(
    `INSERT INTO emission (pk_id, activity_data, total_emission, total_kgco2e, unit, date_of_reporting, status, category_id, site_id, reporting_period)
     VALUES ($1, '{"activity_value": 1, "emission_category": "Air"}', $2, $3, 'tCO2e', $4, 'approved', 3, 1, 'monthly')`,
    [id, tonnes, kg, `${year}-05-15`],
  );

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await insert(db, 82090, KG_YEAR, 1.234, "1234.4000");
    await insert(db, 82091, KG_YEAR, 1.234, "1234.4000");
    await insert(db, 82092, LEGACY_YEAR, 1.234, "1234.4000");
    await insert(db, 82093, LEGACY_YEAR, 1.234, "1234.4000");
    await insert(db, 82094, LEGACY_YEAR, 1.23, null); // saved before kg totals
  });
});
test.after(reset);

/** Every report's figure for the approved Scope 3 rows of `year` on site 1. */
async function figures(year) {
  const ok = (r, what) => {
    assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const tables = ok(await call("POST", "/user/ghg/tables", "manager", { siteIds: [1], year, yearType: "CY", frequency: "yearly" }), "ghg tables");
  const details = ok(await call("POST", "/user/ghg/details", "manager", { siteIds: [1], year, yearType: "CY", frequency: "yearly" }), "ghg details");
  const scope3 = ok(await call("GET", `/reports/ghg/scope3?siteIds=1&year=${year}&yearType=CY`, "manager"), "scope 3 section");
  const ede = ok(await call("POST", "/user/reports/ede", "manager", { siteIds: [1], frequency: "yearly", year }), "EDE");
  const overview = ok(await call("GET", `/manager/overview?period=${year}&siteIds=1`, "manager"), "overview");
  const list = ok(await call("GET", `/user/emissions?page=1&limit=10&siteIds=1&year=${year}&status=approved`, "manager"), "entries list");
  const breakdown = ok(await call("GET", `/user/emissions/breakdown?categoryId=3&siteIds=1&year=${year}&status=approved`, "manager"), "breakdown");
  const targets = ok(await call("POST", "/user/targets/tables", "manager", { siteIds: [1], baseYear: year, targetYear: year + 5 }), "targets");
  const t = tables.totals[String(year)];
  const overviewRow = tables.tables.table_overviewByLocations_selectedYear.rows.find((r) => r.scope === "Scope 3");
  return {
    "GHG tables Scope 3": t.scope3,
    "GHG tables total": t.total,
    "GHG tables category row": overviewRow?.total,
    "GHG tables category × site": overviewRow?.bySite[0]?.value,
    "GHG details": details.rows.find((r) => r.scope === "Scope 3")?.selected.emissions,
    "Scope 3 section total": scope3.total_tco2e,
    "Scope 3 section category row": scope3.rows.find((r) => r.mapped_categories.some((m) => m.category_id === 3))?.tco2e,
    "EDE Scope 3": ede.totals.scope3,
    "EDE total": ede.totals.total,
    "EDE site": ede.bySite[0]?.total,
    "EDE month × site": ede.monthlyBySite[0]?.total,
    "Overview Scope 3": overview.kpis.scope_3,
    "Overview gross": overview.kpis.gross,
    "Overview net": overview.kpis.net,
    "Overview category": overview.by_category[0]?.total,
    "Overview month": overview.by_month.find((m) => m.month === `${year}-05`)?.gross,
    "entries list total": list.summary.total_emission,
    "Breakdown group": breakdown.groups[0]?.total_emission,
    "targets base Scope 3": targets.baseTotals.scope3,
    "targets base total": targets.baseTotals.total,
  };
}

test("two approved 1,234.4 kg rows (1.234 t each): every report shows 2.469 t, not 2.468", async () => {
  const stored = await withDb((db) => db.query(`SELECT total_emission::float8 AS t, total_kgco2e::float8 AS kg FROM emission WHERE pk_id IN (82090, 82091)`));
  assert.deepEqual(stored.rows, [{ t: 1.234, kg: 1234.4 }, { t: 1.234, kg: 1234.4 }], "each row keeps its own stored total");
  const got = await figures(KG_YEAR);
  const want = Object.fromEntries(Object.keys(got).map((k) => [k, 2.469])); // 2,468.8 kg → 2.469 t
  assert.deepEqual(got, want);
});

test("legacy rows without kg count as their stored tonnes × 1000: 1,230 + 2 × 1,234.4 kg = 3.699 t", async () => {
  const got = await figures(LEGACY_YEAR);
  const want = Object.fromEntries(Object.keys(got).map((k) => [k, 3.699])); // 3,698.8 kg → 3.699 t
  assert.deepEqual(got, want);
});
