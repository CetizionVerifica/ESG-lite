// N4 (F-04/F-09): after a factor's value is corrected, the Superadmin recalculates the entries
// calculated with it. GET counts, POST writes; statuses stay, each change is audit-logged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const FACTOR = 9401;
const NAME = "CI N4 Grid";
const SMALL = 9402; // #209: a correction of a few kg
const SMALL_NAME = "CI N4 Small";
const LEGACY = 9403; // #209: a row whose kg was back-filled from its 2-dp total
const LEGACY_NAME = "CI N4 Legacy";
const created = [];

const add = async (date, mwh, name = NAME) => {
  const res = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 1, date_of_reporting: date, activity_data_unit: "MWh", activity_data: { emission_category: name, activity_value: String(mwh) },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  created.push(res.json.emission.pk_id);
  return res.json.emission.pk_id;
};

test.before(async () => {
  // Stored the way the bug left it: 0.71 per MWh where the engine expects kg (710 kg/MWh).
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
           VALUES (${FACTOR}, 1, 1, 2024, 0.7100, 'MWh', 'CI CEA', '${NAME}', '${NAME}')`);
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
           VALUES (${SMALL}, 1, 1, 2024, 233.0000, 'MWh', 'CI CEA', '${SMALL_NAME}', '${SMALL_NAME}')`);
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
           VALUES (${LEGACY}, 1, 1, 2024, 1230.4000, 'MWh', 'CI CEA', '${LEGACY_NAME}', '${LEGACY_NAME}')`);
});

test.after(async () => {
  await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1)`, [created]);
  await q(`DELETE FROM emission WHERE pk_id = ANY($1)`, [created]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id IN (${FACTOR}, ${SMALL}, ${LEGACY})`);
});

test("a corrected factor's entries are counted, then recalculated with statuses kept", async () => {
  const march = await add("2025-03-31", 100); // 100 MWh × 0.71 / 1000 = 0.071 t
  const april = await add("2025-04-30", 200);
  await q(`UPDATE emission SET status = 'approved' WHERE pk_id = $1`, [april]);
  const totals = async () => (await q(`SELECT pk_id, total_emission, status, emission_factor_snapshot->>'factor_value' AS fv FROM emission WHERE pk_id = ANY($1) ORDER BY pk_id`, [[march, april]]));
  assert.deepEqual((await totals()).map((r) => Number(r.total_emission)), [0.071, 0.142]); // #209: 3 dp

  // Nothing to change while the value is the old one.
  const before = await call("GET", `/admin/emission-factors/${FACTOR}/recalculate`, "superadmin");
  assert.equal(before.status, 200, JSON.stringify(before.json));
  assert.equal(before.json.uses_factor, 2);
  assert.equal(before.json.changed, 0);

  await q(`UPDATE emission_factors SET factor_value = 710 WHERE emission_factor_id = ${FACTOR}`);
  const preview = await call("GET", `/admin/emission-factors/${FACTOR}/recalculate`, "superadmin");
  assert.equal(preview.json.recalculated, false);
  assert.equal(preview.json.changed, 2);
  assert.equal(preview.json.before_tco2e, 0.213); // 0.071 + 0.142
  assert.equal(preview.json.after_tco2e, 213);
  assert.deepEqual((await totals()).map((r) => Number(r.total_emission)), [0.071, 0.142], "a preview writes nothing");

  const done = await call("POST", `/admin/emission-factors/${FACTOR}/recalculate`, "superadmin");
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.recalculated, true);
  assert.equal(done.json.changed, 2);
  const after = await totals();
  assert.deepEqual(after.map((r) => Number(r.total_emission)), [71, 142]);
  assert.deepEqual(after.map((r) => r.status), ["pending", "approved"], "statuses stay");
  assert.ok(after.every((r) => Number(r.fv) === 710), "the snapshot records the corrected value");
  const audit = await q(`SELECT entity_id, changed_fields, reason FROM audit_log WHERE entity_type = 'emission' AND action = 'factor_recalculation' AND entity_id = ANY($1) ORDER BY entity_id`, [[march, april]]);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[1].changed_fields, { total_emission: { old: 0.142, new: 142 }, total_kgco2e: { old: 142, new: 142000 } });
  assert.match(audit[0].reason, /CI N4 Grid, 2024/);

  const again = await call("POST", `/admin/emission-factors/${FACTOR}/recalculate`, "superadmin");
  assert.equal(again.json.changed, 0);
  assert.equal(again.json.unchanged, 2, "a second run changes nothing");
});

test("#209: a correction that moves a row by under 5 kg is recalculated (totals are 3 dp)", async () => {
  const row = await add("2025-05-31", 1, SMALL_NAME); // 1 MWh × 233 kg/MWh = 0.233 t
  const stored = async () => (await q(`SELECT total_emission, total_kgco2e, emission_factor_snapshot->>'factor_value' AS fv FROM emission WHERE pk_id = $1`, [row]))[0];
  assert.equal(Number((await stored()).total_emission), 0.233);

  await q(`UPDATE emission_factors SET factor_value = 236 WHERE emission_factor_id = ${SMALL}`); // 3 kg more: 0.236 t
  const preview = await call("GET", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.uses_factor, 1);
  assert.equal(preview.json.changed, 1);
  assert.equal(preview.json.unchanged, 0);
  assert.equal(preview.json.before_tco2e, 0.233);
  assert.equal(preview.json.after_tco2e, 0.236);

  const done = await call("POST", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.changed, 1);
  const after = await stored();
  assert.equal(Number(after.total_emission), 0.236);
  assert.equal(Number(after.total_kgco2e), 236);
  assert.equal(Number(after.fv), 236);
  const audit = await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'emission' AND action = 'factor_recalculation' AND entity_id = $1`, [row]);
  assert.deepEqual(audit.map((a) => a.changed_fields), [{ total_emission: { old: 0.233, new: 0.236 }, total_kgco2e: { old: 233, new: 236 } }]);

  const again = await call("GET", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(again.json.changed, 0);
  assert.equal(again.json.unchanged, 1);
});

test("#209: a correction under 0.5 kg a row, which leaves the 3-dp tonnes where they were, still updates the kg and the snapshot", async () => {
  const row = await add("2025-06-30", 1, SMALL_NAME); // 1 MWh × 236 kg/MWh (the value the test above left) = 0.236 t
  const stored = async () => (await q(`SELECT total_emission, total_kgco2e, emission_factor_snapshot->>'factor_value' AS fv FROM emission WHERE pk_id = $1`, [row]))[0];
  assert.equal(Number((await stored()).total_kgco2e), 236);

  await q(`UPDATE emission_factors SET factor_value = 236.4 WHERE emission_factor_id = ${SMALL}`); // 0.4 kg more: still 0.236 t
  const preview = await call("GET", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.changed, 2, "both rows of the factor: the kg moves although the tonnes don't");
  assert.equal(preview.json.unchanged, 0);

  const done = await call("POST", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(done.json.changed, 2);
  const after = await stored();
  assert.equal(Number(after.total_emission), 0.236);
  assert.equal(Number(after.total_kgco2e), 236.4);
  assert.equal(Number(after.fv), 236.4);
  const audit = await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'emission' AND action = 'factor_recalculation' AND entity_id = $1`, [row]);
  assert.deepEqual(audit.map((a) => a.changed_fields), [{ total_emission: { old: 0.236, new: 0.236 }, total_kgco2e: { old: 236, new: 236.4 } }]);

  const again = await call("GET", `/admin/emission-factors/${SMALL}/recalculate`, "superadmin");
  assert.equal(again.json.changed, 0);
  assert.equal(again.json.unchanged, 2);
});

test("#209: a row that already has the factor's figures is left alone, whatever its stored kg; a real correction still reaches it", async () => {
  const row = await add("2025-07-31", 1, LEGACY_NAME); // 1 MWh × 1230.4 kg/MWh = 1.230 t
  // Stored the way a row saved before kg totals looks after the back-fill: 2-dp tonnes, kg worked out from them.
  await q(`UPDATE emission SET total_emission = 1.23, total_kgco2e = 1230.0000 WHERE pk_id = $1`, [row]);
  const stored = async () => (await q(`SELECT total_emission, total_kgco2e, emission_factor_snapshot->>'factor_value' AS fv FROM emission WHERE pk_id = $1`, [row]))[0];

  const same = await call("GET", `/admin/emission-factors/${LEGACY}/recalculate`, "superadmin");
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(same.json.uses_factor, 1);
  assert.equal(same.json.changed, 0, "the factor didn't change for this row");
  assert.equal(same.json.unchanged, 1);
  const kept = await call("POST", `/admin/emission-factors/${LEGACY}/recalculate`, "superadmin");
  assert.equal(kept.json.changed, 0);
  assert.equal(Number((await stored()).total_kgco2e), 1230, "nothing written");
  assert.equal((await q(`SELECT 1 FROM audit_log WHERE entity_type = 'emission' AND action = 'factor_recalculation' AND entity_id = $1`, [row])).length, 0);

  await q(`UPDATE emission_factors SET factor_value = 1231 WHERE emission_factor_id = ${LEGACY}`);
  const done = await call("POST", `/admin/emission-factors/${LEGACY}/recalculate`, "superadmin");
  assert.equal(done.json.changed, 1);
  const after = await stored();
  assert.equal(Number(after.total_emission), 1.231);
  assert.equal(Number(after.total_kgco2e), 1231);
  assert.equal(Number(after.fv), 1231);
});

test("only the Superadmin recalculates; an unknown factor is a 404", async () => {
  for (const who of ["manager", "admin", "user"]) {
    assert.equal((await call("POST", `/admin/emission-factors/${FACTOR}/recalculate`, who)).status, 403, who);
  }
  assert.equal((await call("GET", "/admin/emission-factors/999999/recalculate", "superadmin")).status, 404);
  assert.equal((await call("GET", "/admin/emission-factors/abc/recalculate", "superadmin")).status, 400);
});
