// #218: an edit that changes only an entry's date gets what a new entry at
// that date gets. It's recalculated with the new year's factor, refused onto a
// date that already holds the same activity, and its FERA twin moves with it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const ids = [9811, 9812, 9813, 9814];
const factors = [9811, 9812, 9813, 9814];
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

test.before(async () => {
  // Site 1: Diesel at 2.68 kg/litre in factor year 2024 and 3.00 in 2025 (factor year = reporting year − 1);
  // its FERA (category 5) WTT factor 0.61 and 0.70.
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES
    (9811, 'Diesel', 2.68, 'litre', 2024, 1, 1), (9812, 'Diesel', 3.00, 'litre', 2025, 1, 1),
    (9813, 'Diesel', 0.61, 'litre', 2024, 1, 5), (9814, 'Diesel', 0.70, 'litre', 2025, 1, 5)`);
});

const reset = async () => {
  await q(`UPDATE emission SET fera_linked_id = NULL WHERE pk_id = ANY($1)`, [ids]);
  await q(`DELETE FROM emission WHERE pk_id = ANY($1)`, [ids]);
  await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::bigint[])`, [ids]);
};
test.beforeEach(reset);
test.after(async () => {
  await reset();
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1)`, [factors]);
});

/** A pending Diesel entry of User 1 on site 1 (100 litre, June 2025 → 0.268 t), optionally with its FERA twin. */
async function diesel(pk, date = "2025-06-30", twin = null) {
  await q(
    `INSERT INTO emission (pk_id, activity_data, activity_data_unit, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, created_at)
     VALUES ($1, '{"activity_value": 100, "emission_category": "Diesel"}', 'litre', 0.268, 'tCO2e', $2, 'pending', 1, 1, 1, 'monthly', now())`,
    [pk, date],
  );
  if (twin) {
    await q(
      `INSERT INTO emission (pk_id, activity_data, activity_data_unit, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, fera_linked_id, created_at)
       VALUES ($1, '{"activity_value": 100, "emission_category": "Diesel"}', 'litre', 0.061, 'tCO2e', $2, 'pending', 1, 5, 1, 'monthly', $3, now())`,
      [twin, date, pk],
    );
    await q(`UPDATE emission SET fera_linked_id = $2 WHERE pk_id = $1`, [pk, twin]);
  }
}

test("a date-only edit into another year recalculates with that year's factor and logs the new total", async () => {
  await diesel(9811);
  const r = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "2026-01-31" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [row] = await q(`SELECT total_emission, date_of_reporting FROM emission WHERE pk_id = 9811`);
  assert.equal(ymd(row.date_of_reporting), "2026-01-31");
  assert.equal(Number(row.total_emission), 0.3); // 100 litre × 3.00 kg ÷ 1000, not the 2024 factor's 0.268
  const [audit] = await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'emission' AND entity_id = 9811 AND action = 'user_edit'`);
  assert.equal(Number(audit.changed_fields.total_emission.new), 0.3);
  assert.ok(audit.changed_fields.date_of_reporting);
});

test("a moved entry's FERA twin moves and is recalculated with it", async () => {
  await diesel(9811, "2025-06-30", 9812);
  const r = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "2026-01-31" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [twin] = await q(`SELECT total_emission, date_of_reporting FROM emission WHERE pk_id = 9812`);
  assert.equal(ymd(twin.date_of_reporting), "2026-01-31");
  assert.equal(Number(twin.total_emission), 0.07); // 100 × 0.70 ÷ 1000
});

test("an entry can't be moved onto a date that already holds the same activity, by a User or a Manager", async () => {
  await diesel(9811, "2025-06-30");
  await diesel(9813, "2025-07-31");
  for (const [route, who, body] of [
    ["/user/emissions/9811", "user", { date_of_reporting: "2025-07-31" }],
    ["/user/emissions/manager-edit/9811", "manager", { date_of_reporting: "2025-07-31", reason: "Wrong month" }],
  ]) {
    const r = await call("PUT", route, who, body);
    assert.equal(r.status, 409, `${who}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.duplicate, true);
    assert.equal(Number(r.json.existing_emission.pk_id ?? r.json.existing_emission.id), 9813);
  }
  const [row] = await q(`SELECT total_emission, date_of_reporting FROM emission WHERE pk_id = 9811`);
  assert.equal(ymd(row.date_of_reporting), "2025-06-30");
  assert.equal(Number(row.total_emission), 0.268);
  // A date without that activity still takes the move.
  const ok = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "2025-08-31" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("changing an entry's activity onto one already saved for its date is refused; a kept-both pair stays editable", async () => {
  await diesel(9811, "2025-07-31");
  await q(
    `INSERT INTO emission (pk_id, activity_data, activity_data_unit, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, created_at)
     VALUES (9813, '{"activity_value": 50, "emission_category": "Petrol"}', 'litre', 0.1, 'tCO2e', '2025-07-31', 'pending', 1, 1, 1, 'monthly', now())`,
  );
  const clash = await call("PUT", "/user/emissions/9813", "user", { activity_data: { activity_value: 50, emission_category: "Diesel" } });
  assert.equal(clash.status, 409, JSON.stringify(clash.json));
  assert.equal(clash.json.duplicate, true);
  assert.equal((await q(`SELECT activity_data FROM emission WHERE pk_id = 9813`))[0].activity_data.emission_category, "Petrol");

  // Two Diesel entries the person chose to keep: editing one's amount isn't a new duplicate.
  await diesel(9814, "2025-07-31");
  const amount = await call("PUT", "/user/emissions/9814", "user", { activity_data: { activity_value: 120, emission_category: "Diesel" } });
  assert.equal(amount.status, 200, JSON.stringify(amount.json));
});

test("a save over a change someone made since the form opened is refused as a warning; an approved entry too", async () => {
  await diesel(9811);
  const [{ updated_at: opened }] = await q(`SELECT updated_at FROM emission WHERE pk_id = 9811`);
  // A Manager edits the entry while the User's form is open (its status stays pending).
  const mgr = await call("PUT", "/user/emissions/manager-edit/9811", "manager", { activity_data: { activity_value: 150, emission_category: "Diesel" }, reason: "Meter re-read" });
  assert.equal(mgr.status, 200, JSON.stringify(mgr.json));
  const stale = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "2025-08-31", expected_updated_at: new Date(opened).toISOString() });
  assert.equal(stale.status, 409, JSON.stringify(stale.json));
  assert.equal(stale.json.code, "ENTRY_CHANGED");
  assert.equal(stale.json.severity, "warning");
  const [kept] = await q(`SELECT activity_data, date_of_reporting FROM emission WHERE pk_id = 9811`);
  assert.equal(Number(kept.activity_data.activity_value), 150);
  assert.equal(ymd(kept.date_of_reporting), "2025-06-30");

  // Approved meanwhile: refused as a warning that ends the edit.
  await q(`UPDATE emission SET status = 'approved', reviewed_by = 2 WHERE pk_id = 9811`);
  const approved = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "2025-08-31" });
  assert.equal(approved.status, 403);
  assert.equal(approved.json.code, "ENTRY_APPROVED");
  assert.equal(approved.json.severity, "warning");
});

test("an invalid date is refused and nothing changes", async () => {
  await diesel(9811);
  const r = await call("PUT", "/user/emissions/9811", "user", { date_of_reporting: "not a date" });
  assert.equal(r.status, 400);
  const [row] = await q(`SELECT date_of_reporting FROM emission WHERE pk_id = 9811`);
  assert.equal(ymd(row.date_of_reporting), "2025-06-30");
});
