// #209 · migrate:kpi-tonnes-decimals on the database: KPIs in tonnes of CO₂e show 3 decimals.
//   - the applySeed rule: a row no person saved (`edited_at` null) moves to 3; a row a person saved
//     (a Superadmin's library edit, an Admin's own KPI) keeps the decimals they chose;
//   - every spelling of tonnes of CO₂e (normaliseUnit → "tco2e"), library and company rows alike;
//     kilograms and intensities are left alone;
//   - only `decimals` changes (edited_at is not stamped); a second run changes nothing; a re-seed
//     afterwards keeps the result.
//
//   Library   GHG_SCOPE1    decimals 2, unedited  → 3
//             GHG_SCOPE2_LB decimals 2, edited    → 2 (the Superadmin's choice)
//             GHG_SCOPE3    decimals 1, unedited  → 3
//             GHG_SCOPE2_MB decimals 3            → 3 (already there)
//             GHG_INTENSITY_REVENUE ("tCO2e per INR crore") 4 → 4
//   Company 1 T209_EDITED  tCO2e   2, edited   → 2
//             T209_SUB     tCO₂e   2, unedited → 3
//             T209_SPACED  t CO2e  0, unedited → 3
//             T209_KG      kgCO2e  2, unedited → 2
//   Company 2 T209_OTHER   tCO2e   2, unedited → 3
const test = require("node:test");
const assert = require("node:assert/strict");
const { withDb } = require("../helpers.cjs");
const { runScript } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const migrate = () => {
  const r = runScript("migrateKpiTonnesDecimals");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const n = /#209 kpi_definition: (\d+) tCO2e KPI\(s\) set to 3 decimals\./.exec(r.stdout);
  assert.ok(n, r.stdout);
  return Number(n[1]);
};
const snapshot = async () => {
  const rows = await q(`SELECT * FROM kpi_definition ORDER BY id`);
  return new Map(rows.map((r) => [r.code + "|" + (r.company_id ?? ""), r]));
};
const decimalsOf = async (code, companyId = null) =>
  (await q(`SELECT decimals FROM kpi_definition WHERE code = $1 AND company_id IS NOT DISTINCT FROM $2`, [code, companyId]))[0].decimals;
const own = (companyId, code, unit, decimals, edited) =>
  q(
    `INSERT INTO kpi_definition (code, name, question, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, company_id, active, decimals, pillar, edited_at)
     VALUES ($1, $1, 'How much?', 'climate', 'number', 'mass', $2, $3, 'sum', 'site', 'annual', 'manual', $4, true, $5, 'environment', ${edited ? "now() - interval '1 day'" : "NULL"})`,
    [code, unit, JSON.stringify([unit]), companyId, decimals],
  );
const wipe = () => q(`DELETE FROM kpi_definition WHERE code LIKE 'T209\\_%'`);
const reseedLibrary = () => {
  const r = runScript("seedKpiLibrary");
  assert.equal(r.status, 0, r.stderr + r.stdout);
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "migrateKpiPillars", "seedKpiLibrary"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
});
test.after(async () => {
  await wipe();
  // The library as the seed leaves it.
  await q(`UPDATE kpi_definition SET decimals = 3, edited_at = NULL WHERE company_id IS NULL AND code IN ('GHG_SCOPE1', 'GHG_SCOPE2_LB', 'GHG_SCOPE2_MB', 'GHG_SCOPE3')`);
});

test("a fresh seed already has the tCO₂e library KPIs at 3; the migration then has nothing to do", async () => {
  for (const code of ["GHG_SCOPE1", "GHG_SCOPE2_LB", "GHG_SCOPE2_MB", "GHG_SCOPE3"]) assert.equal(await decimalsOf(code), 3, code);
  assert.equal(await decimalsOf("GHG_INTENSITY_REVENUE"), 4);
  assert.equal(migrate(), 0);
});

test("unedited tCO₂e KPIs move to 3, a person's decimals stay; twice clean; a re-seed keeps it", async () => {
  // A database from before #209 (the seed had 2), with a Superadmin's edit and company KPIs.
  await q(`UPDATE kpi_definition SET decimals = 2 WHERE company_id IS NULL AND code = 'GHG_SCOPE1'`);
  await q(`UPDATE kpi_definition SET decimals = 2, edited_at = now() - interval '1 day' WHERE company_id IS NULL AND code = 'GHG_SCOPE2_LB'`);
  await q(`UPDATE kpi_definition SET decimals = 1 WHERE company_id IS NULL AND code = 'GHG_SCOPE3'`);
  await own(1, "T209_EDITED", "tCO2e", 2, true);
  await own(1, "T209_SUB", "tCO₂e", 2, false);
  await own(1, "T209_SPACED", "t CO2e", 0, false);
  await own(1, "T209_KG", "kgCO2e", 2, false);
  await own(2, "T209_OTHER", "tCO2e", 2, false);
  const before = await snapshot();

  assert.equal(migrate(), 5, "GHG_SCOPE1, GHG_SCOPE3, T209_SUB, T209_SPACED, T209_OTHER");
  const after = await snapshot();
  const moved = [...after].filter(([k, r]) => before.get(k).decimals !== r.decimals).map(([k, r]) => `${k} ${before.get(k).decimals}→${r.decimals}`).sort();
  assert.deepEqual(moved, ["GHG_SCOPE1| 2→3", "GHG_SCOPE3| 1→3", "T209_OTHER|2 2→3", "T209_SPACED|1 0→3", "T209_SUB|1 2→3"]);
  // Nothing but decimals: edited_at is not stamped, so a later re-seed still refreshes these rows.
  for (const [k, r] of after) assert.deepEqual({ ...r, decimals: null }, { ...before.get(k), decimals: null }, k);
  assert.equal(await decimalsOf("GHG_SCOPE2_LB"), 2, "the Superadmin's choice");
  assert.equal(await decimalsOf("T209_EDITED", 1), 2, "the Admin's choice");
  assert.equal(await decimalsOf("T209_KG", 1), 2, "kilograms are not tonnes");
  assert.equal(await decimalsOf("GHG_INTENSITY_REVENUE"), 4, "an intensity keeps its decimals");
  assert.equal(await decimalsOf("GHG_SCOPE2_MB"), 3);

  // Twice: nothing changes.
  assert.equal(migrate(), 0, "the second run changes nothing");
  assert.deepEqual(await snapshot(), after);

  // The library re-seed (migrate:kpi-library-seed runs on every deploy) keeps the result and the edit.
  reseedLibrary();
  for (const [code, d] of [["GHG_SCOPE1", 3], ["GHG_SCOPE2_LB", 2], ["GHG_SCOPE3", 3], ["GHG_SCOPE2_MB", 3], ["GHG_INTENSITY_REVENUE", 4]]) assert.equal(await decimalsOf(code), d, code);
  assert.equal(migrate(), 0);
});
