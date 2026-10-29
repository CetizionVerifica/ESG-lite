// N4 (F-04/F-09): after a factor's value is corrected, the Superadmin recalculates the entries
// calculated with it. GET counts, POST writes; statuses stay, each change is audit-logged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const FACTOR = 9401;
const NAME = "CI N4 Grid";
const created = [];

const add = async (date, mwh) => {
  const res = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 1, date_of_reporting: date, activity_data_unit: "MWh", activity_data: { emission_category: NAME, activity_value: String(mwh) },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  created.push(res.json.emission.pk_id);
  return res.json.emission.pk_id;
};

test.before(async () => {
  // Stored the way the bug left it: 0.71 per MWh where the engine expects kg (710 kg/MWh).
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
           VALUES (${FACTOR}, 1, 1, 2024, 0.7100, 'MWh', 'CI CEA', '${NAME}', '${NAME}')`);
});

test.after(async () => {
  await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1)`, [created]);
  await q(`DELETE FROM emission WHERE pk_id = ANY($1)`, [created]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ${FACTOR}`);
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
  assert.deepEqual(audit[1].changed_fields, { total_emission: { old: 0.142, new: 142 } });
  assert.match(audit[0].reason, /CI N4 Grid, 2024/);

  const again = await call("POST", `/admin/emission-factors/${FACTOR}/recalculate`, "superadmin");
  assert.equal(again.json.changed, 0);
  assert.equal(again.json.unchanged, 2, "a second run changes nothing");
});

test("only the Superadmin recalculates; an unknown factor is a 404", async () => {
  for (const who of ["manager", "admin", "user"]) {
    assert.equal((await call("POST", `/admin/emission-factors/${FACTOR}/recalculate`, who)).status, 403, who);
  }
  assert.equal((await call("GET", "/admin/emission-factors/999999/recalculate", "superadmin")).status, 404);
  assert.equal((await call("GET", "/admin/emission-factors/abc/recalculate", "superadmin")).status, 400);
});
