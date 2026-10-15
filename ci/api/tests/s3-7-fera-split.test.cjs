// S3-7: the Category 3 split. FERA twins carry their sub-activity (3a
// upstream of fuels, 3b upstream of electricity), a Scope 2 row gets a 3c
// T&D-loss twin only when a td_loss factor exists, the twins approve,
// reject, delete and follow edits with their parent, a Cat 4 row on a
// WTT-inclusive factor is flagged WTT_ALREADY_IN_FACTOR without changing its
// total, and migrate:scope3-fera-sub backfills old twins (run twice).
//
// Figures are Example 3.1 of the GHG Protocol guidance (Australia): grid
// 0.8 kgCO₂e/kWh (Scope 2), upstream 0.12 kgCO₂e/kWh (3b), T&D loss rate
// 10 % → td_loss factor 0.8 × 0.1 = 0.08 kgCO₂e per kWh consumed (3c).
//
// Runs on company 2 / site 3 and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { planRows, insertRows } = require(path.resolve("dist/services/emissionWrite/index.js"));

const SITE = 3;
const FREIGHT = 120; // a Scope 3 Category 4 category, added below
const CTX = { user_id: 4, role: "User", company_id: 2, allowed_site_ids: [SITE], allowed_category_ids_by_site: {} };
const FACTORS = [931, 932, 933, 934, 935, 936, 937, 938, 939];

const typed = (category_id, date, unit, emission_category, activity_value) =>
  call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id, date_of_reporting: date, activity_data_unit: unit, activity_data: { emission_category, activity_value: String(activity_value) } });

const twinsOf = (parentId) =>
  withDb(async (db) =>
    (await db.query(
      `SELECT pk_id, category_id, total_emission::float8 AS total, scope3_sub, fera_linked_id, status::text AS status, emission_factor_snapshot->>'factor_type' AS factor_type
         FROM emission WHERE fera_linked_id = $1 AND category_id = 5 ORDER BY scope3_sub`,
      [parentId],
    )).rows,
  );

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO category (category_id, category_name, scope) VALUES (${FREIGHT}, 'Upstream transportation and distribution', 'Scope 3') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, 2), (${SITE}, 5), (${SITE}, ${FREIGHT}) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type, includes_wtt) VALUES
      (931, ${SITE}, 2, 2024, 0.8, 'kwh', 'CI', 'Grid AU', 'Grid AU', 'combustion', false),
      (932, ${SITE}, 5, 2024, 0.12, 'kwh', 'CI', 'Grid AU', 'Grid AU', 'wtt', false),
      (933, ${SITE}, 5, 2024, 0.08, 'kwh', 'CI', 'Grid AU T&D losses', 'Grid AU', 'td_loss', false),
      (934, ${SITE}, 2, 2024, 0.5, 'kwh', 'CI', 'Grid US', 'Grid US', 'combustion', false),
      (935, ${SITE}, 5, 2024, 0.1, 'kwh', 'CI', 'Grid US', 'Grid US', 'wtt', false),
      (936, ${SITE}, 1, 2024, 2680, 'litre', 'CI', 'Diesel S3-7', 'Diesel S3-7', 'combustion', false),
      (937, ${SITE}, 5, 2024, 610, 'litre', 'CI', 'Diesel S3-7', 'Diesel S3-7', 'combustion', false),
      (938, ${SITE}, ${FREIGHT}, 2024, 0.11, 'tonne.km', 'DEFRA freighting goods + WTT, summed', 'HGV S3-7 summed', 'HGV S3-7 summed', 'life_cycle', true),
      (939, ${SITE}, ${FREIGHT}, 2024, 0.09, 'tonne.km', 'DEFRA freighting goods', 'HGV S3-7 split', 'HGV S3-7 split', 'life_cycle', false)`);
  });
  await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE site_id = ${SITE} AND pk_id <> 8)`);
    await db.query(`DELETE FROM emission WHERE site_id = ${SITE} AND pk_id <> 8`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1)`, [FACTORS]);
    await db.query(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id IN (2, 5, ${FREIGHT})`);
    await db.query(`DELETE FROM category WHERE category_id = ${FREIGHT}`);
  });
  await AppDataSource.destroy();
});

test("a Scope 2 entry gets an upstream (3b) and a T&D-loss (3c) twin", async () => {
  const res = await typed(2, "2025-01-31", "kwh", "Grid AU", 500000);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const parent = res.json.emission;
  assert.equal(Number(parent.total_emission), 400); // 500,000 kWh × 0.8 kg
  assert.equal(parent.scope3_sub, null);
  assert.equal(res.json.fera_emission.scope3_sub, "3b_upstream_electricity");
  assert.equal(Number(res.json.fera_emission.total_emission), 60); // × 0.12 kg
  assert.equal(parent.fera_linked_id, res.json.fera_emission.pk_id, "the parent's own link stays on the upstream twin");
  assert.equal(res.json.td_loss_emission.scope3_sub, "3c_td_losses");
  assert.equal(Number(res.json.td_loss_emission.total_emission), 40); // × 0.08 kg = 0.8 × 10 %
  assert.equal(res.json.td_loss_emission.fera_linked_id, parent.pk_id);
  assert.equal(res.json.td_loss_emission.emission_factor_snapshot.factor_type, "td_loss");
  assert.equal(res.json.warnings, undefined);
});

test("no td_loss factor, no 3c twin; a Scope 1 fuel's twin is upstream of fuels (3a)", async () => {
  const us = await typed(2, "2025-02-28", "kwh", "Grid US", 5500000);
  assert.equal(us.status, 201, JSON.stringify(us.json));
  assert.equal(Number(us.json.fera_emission.total_emission), 550);
  assert.equal(us.json.td_loss_emission, undefined);
  assert.deepEqual((await twinsOf(us.json.emission.pk_id)).map((t) => t.scope3_sub), ["3b_upstream_electricity"]);

  const diesel = await typed(1, "2025-02-28", "litre", "Diesel S3-7", 1000);
  assert.equal(diesel.status, 201, JSON.stringify(diesel.json));
  assert.equal(diesel.json.fera_emission.scope3_sub, "3a_upstream_fuels");
  assert.equal(Number(diesel.json.fera_emission.total_emission), 610, "the twin's total is computed as before");
  // Its FERA factor is typed combustion: still a twin, with a warning that never blocks.
  assert.deepEqual(diesel.json.warnings.map((w) => w.code), ["FACTOR_TYPE_MISMATCH"]);
});

test("imports plan and write both twins; the T&D twin counts as a FERA row", async () => {
  const rows = [{ row_ref: "Power!B2", site_id: SITE, category_id: 2, period: { kind: "monthly", date: "2025-03-15" }, activity_name: "Grid AU", activity_value: 500000, activity_unit: "kwh" }];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.equal(planned[0].state, "ready", JSON.stringify(planned[0].issues));
  assert.deepEqual(planned[0].result.fera, { category_id: 5, total_tco2e: 60, scope3_sub: "3b_upstream_electricity" });
  assert.deepEqual(planned[0].result.td_loss, { category_id: 5, total_tco2e: 40 });
  const batch = { upload_batch_id: "s3-7-split", channel: "bulk_upload", source_name: "Power.xlsx" };
  const result = await AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, batch));
  assert.deepEqual({ inserted: result.inserted, fera_inserted: result.fera_inserted, ids: result.ids.length }, { inserted: 1, fera_inserted: 2, ids: 3 });
  const stored = await withDb(async (db) =>
    (await db.query(`SELECT category_id, total_emission::float8 AS total, scope3_sub FROM emission WHERE upload_batch_id = 's3-7-split' ORDER BY pk_id`)).rows,
  );
  assert.deepEqual(stored, [
    { category_id: 2, total: 400, scope3_sub: null },
    { category_id: 5, total: 60, scope3_sub: "3b_upstream_electricity" },
    { category_id: 5, total: 40, scope3_sub: "3c_td_losses" },
  ]);
});

test("approve and reject carry both twins; delete removes both", async () => {
  const a = await typed(2, "2025-04-30", "kwh", "Grid AU", 1000);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const ok = await call("PUT", `/user/emissions/${a.json.emission.pk_id}/approve`, "otherManager", {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual((await twinsOf(a.json.emission.pk_id)).map((t) => [t.scope3_sub, t.status]), [["3b_upstream_electricity", "approved"], ["3c_td_losses", "approved"]]);

  const r = await typed(2, "2025-05-31", "kwh", "Grid AU", 1000);
  const no = await call("PUT", `/user/emissions/${r.json.emission.pk_id}/reject`, "otherManager", { comment: "Wrong meter" });
  assert.equal(no.status, 200, JSON.stringify(no.json));
  assert.deepEqual((await twinsOf(r.json.emission.pk_id)).map((t) => t.status), ["rejected", "rejected"]);

  const d = await typed(2, "2025-06-30", "kwh", "Grid AU", 1000);
  const del = await call("DELETE", `/user/emissions/${d.json.emission.pk_id}`, "otherUser");
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.deepEqual(await twinsOf(d.json.emission.pk_id), []);
});

test("an edit recalculates the T&D twin alongside the upstream twin", async () => {
  const e = await typed(2, "2025-07-31", "kwh", "Grid AU", 1000);
  const id = e.json.emission.pk_id;
  const user = await call("PUT", `/user/emissions/${id}`, "otherUser", { activity_data: { emission_category: "Grid AU", activity_value: "2000" }, activity_data_unit: "kwh" });
  assert.equal(user.status, 200, JSON.stringify(user.json));
  assert.deepEqual((await twinsOf(id)).map((t) => [t.scope3_sub, t.total]), [["3b_upstream_electricity", 0.24], ["3c_td_losses", 0.16]]);

  // Moved to an activity with no td_loss factor: the T&D twin is zeroed and goes back to review with a note.
  const mgr = await call("PUT", `/user/emissions/manager-edit/${id}`, "otherManager", { activity_data: { emission_category: "Grid US", activity_value: "2000" }, reason: "Meter is on the US grid" });
  assert.equal(mgr.status, 200, JSON.stringify(mgr.json));
  const after = await twinsOf(id);
  assert.deepEqual(after.map((t) => [t.scope3_sub, t.total, t.status]), [["3b_upstream_electricity", 0.2, "pending"], ["3c_td_losses", 0, "pending"]]);
});

test("acting on one twin directly carries the whole family", async () => {
  const familyOf = (parentId) =>
    withDb(async (db) => (await db.query(`SELECT pk_id, status::text AS status FROM emission WHERE pk_id = $1 OR fera_linked_id = $1 ORDER BY pk_id`, [parentId])).rows);

  // Approving the T&D twin approves the parent and the upstream twin too.
  const a = await typed(2, "2025-09-30", "kwh", "Grid AU", 1000);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const ok = await call("PUT", `/user/emissions/${a.json.td_loss_emission.pk_id}/approve`, "otherManager", {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual((await familyOf(a.json.emission.pk_id)).map((r) => r.status), ["approved", "approved", "approved"]);

  // Rejecting the upstream twin rejects the T&D twin too.
  const r = await typed(2, "2025-10-31", "kwh", "Grid AU", 1000);
  const no = await call("PUT", `/user/emissions/${r.json.fera_emission.pk_id}/reject`, "otherManager", { comment: "Wrong meter" });
  assert.equal(no.status, 200, JSON.stringify(no.json));
  assert.deepEqual((await familyOf(r.json.emission.pk_id)).map((x) => x.status), ["rejected", "rejected", "rejected"]);

  // Deleting the T&D twin leaves no orphan upstream twin behind.
  const d = await typed(2, "2025-11-30", "kwh", "Grid AU", 1000);
  const del = await call("DELETE", `/user/emissions/${d.json.td_loss_emission.pk_id}`, "otherUser");
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.deepEqual(await familyOf(d.json.emission.pk_id), []);
  assert.deepEqual(await withDb(async (db) => (await db.query(`SELECT pk_id FROM emission WHERE pk_id = $1`, [d.json.fera_emission.pk_id])).rows), []);
});

test("an edit never creates a T&D twin in a mode-locked FERA category", async () => {
  const e = await typed(2, "2025-12-31", "kwh", "Grid US", 1000);
  assert.equal(e.status, 201, JSON.stringify(e.json));
  const id = e.json.emission.pk_id;
  // A yearly FERA row for CY 2025 locks monthly FERA rows in that year.
  const [{ pk_id: yearly }] = await withDb(async (db) =>
    (await db.query(
      `INSERT INTO emission (site_id, category_id, date_of_reporting, reporting_period, year_type, activity_data, activity_data_unit, total_emission, unit, status)
       VALUES (${SITE}, 5, '2025-12-31', 'yearly', 'CY', '{}', 'kwh', 0, 'tCO2e', 'pending') RETURNING pk_id`,
    )).rows,
  );
  try {
    const edit = await call("PUT", `/user/emissions/${id}`, "otherUser", { activity_data: { emission_category: "Grid AU", activity_value: "1000" }, activity_data_unit: "kwh" });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
    assert.deepEqual((await twinsOf(id)).map((t) => t.scope3_sub), ["3b_upstream_electricity"], "no 3c twin is created under the lock");
  } finally {
    await withDb((db) => db.query(`DELETE FROM emission WHERE pk_id = $1`, [yearly]));
  }
});

test("a Cat 4 row on a WTT-inclusive factor is flagged and keeps its total", async () => {
  const rows = [
    { row_ref: "Haul!B2", site_id: SITE, category_id: FREIGHT, period: { kind: "monthly", date: "2025-08-15" }, activity_name: "HGV S3-7 summed", activity_value: 1000, activity_unit: "tonne.km" },
    { row_ref: "Haul!B3", site_id: SITE, category_id: FREIGHT, period: { kind: "monthly", date: "2025-08-15" }, activity_name: "HGV S3-7 split", activity_value: 1000, activity_unit: "tonne.km" },
  ];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.equal(planned[0].state, "ready", "a warning never blocks");
  assert.deepEqual(planned[0].issues.map((i) => i.code), ["WTT_ALREADY_IN_FACTOR"]);
  assert.equal(planned[0].result.total_tco2e, 0.11, "1,000 tonne.km × 0.11 kg: nothing is recalculated (D6)");
  assert.deepEqual(planned[1].issues, []);

  const res = await call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id: FREIGHT, date_of_reporting: "2025-09-15", activity_data_unit: "tonne.km", activity_data: { emission_category: "HGV S3-7 summed", activity_value: "1000" } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.warnings.map((w) => w.code), ["WTT_ALREADY_IN_FACTOR"]);
  assert.equal(res.json.emission.emission_factor_snapshot.includes_wtt, true);
});

test("migrate:scope3-fera-sub backfills old twins, and a second run changes nothing", async () => {
  const fuel = await typed(1, "2025-10-31", "litre", "Diesel S3-7", 10);
  const power = await typed(2, "2025-10-31", "kwh", "Grid US", 10);
  const ids = [fuel.json.fera_emission.pk_id, power.json.fera_emission.pk_id];
  await withDb((db) => db.query(`UPDATE emission SET scope3_sub = NULL WHERE pk_id = ANY($1)`, [ids]));
  const script = path.resolve("dist/scripts/migrateScope3FeraSub.js");
  for (const pass of [1, 2]) {
    const run = spawnSync(process.execPath, [script], { env: process.env, encoding: "utf8" });
    assert.equal(run.status, 0, `pass ${pass}: ${run.stderr}`);
  }
  const rows = await withDb(async (db) => (await db.query(`SELECT scope3_sub FROM emission WHERE pk_id = ANY($1) ORDER BY pk_id`, [ids])).rows);
  assert.deepEqual(rows.map((r) => r.scope3_sub), ["3a_upstream_fuels", "3b_upstream_electricity"]);
  const parents = await withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE scope3_sub IS NOT NULL AND category_id <> 5`)).rows[0].n);
  assert.equal(parents, 0, "only FERA rows get a sub-activity");
});
