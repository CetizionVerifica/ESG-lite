// Audit trail and server-side totals (audit findings F-05, F-06, F-07):
// approve, reject and delete leave an audit_log row; only reviewers delete
// approved rows; the server never stores a client-sent total; a manager edit
// keeps the FERA twin in step. Each test restores what it changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const auditRows = (entity, id) =>
  q("SELECT action, changed_fields, reason, changed_by FROM audit_log WHERE entity_type=$1 AND entity_id=$2 ORDER BY id", [entity, id]);
const clearAudit = (entity, ids) => q("DELETE FROM audit_log WHERE entity_type=$1 AND entity_id = ANY($2::int[])", [entity, ids]);

test("approve and reject write an audit row, FERA twin included", async () => {
  try {
    const r = await call("PUT", "/user/emissions/2/approve", "manager", { comment: "ok" });
    assert.equal(r.status, 200);
    const [row] = await auditRows("emission", 2);
    assert.equal(row.action, "approve");
    assert.deepEqual(row.changed_fields.status, { old: "pending", new: "approved" });
    assert.equal(row.reason, "ok");
    assert.equal(row.changed_by, 2);

    await q("UPDATE emission SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE pk_id=1");
    assert.equal((await call("PUT", "/user/emissions/1/reject", "manager", { comment: "Wrong meter" })).status, 200);
    const parent = await auditRows("emission", 1);
    const twin = await auditRows("emission", 5);
    assert.equal(parent.at(-1).action, "reject");
    assert.equal(parent.at(-1).reason, "Wrong meter");
    assert.equal(twin.at(-1).action, "reject");
  } finally {
    await q("UPDATE emission SET status='pending', reviewed_by=NULL, reviewed_at=NULL, review_comment=NULL WHERE pk_id IN (2, 5)");
    await q("UPDATE emission SET status='approved', reviewed_by=2, review_comment=NULL WHERE pk_id=1");
    await clearAudit("emission", [1, 2, 5]);
  }
});

test("a refused review writes no audit row", async () => {
  assert.equal((await call("PUT", "/user/emissions/1/approve", "manager", {})).status, 400); // already approved
  assert.equal((await auditRows("emission", 1)).length, 0);
});

test("only reviewers delete approved rows, and every delete is audited", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (901, '{"activity_value": 5}', 7.5, 'tCO2e', '2025-06-30', 'approved', 1, 1, 1, 'monthly'),
                  (902, '{"activity_value": 6}', 1.5, 'tCO2e', '2025-06-30', 'pending', 1, 3, 1, 'monthly')`);
  try {
    const refused = await call("DELETE", "/user/emissions/901", "user");
    assert.equal(refused.status, 409);
    assert.equal((await q("SELECT 1 FROM emission WHERE pk_id=901")).length, 1);
    assert.equal((await call("DELETE", "/user/emissions/bulk-delete", "user", { ids: [901, 902] })).status, 409);

    assert.equal((await call("DELETE", "/user/emissions/902", "user")).status, 200);
    const [own] = await auditRows("emission", 902);
    assert.equal(own.action, "delete");
    assert.deepEqual(own.changed_fields.total_emission, { old: "1.5", new: null });

    assert.equal((await call("DELETE", "/user/emissions/901", "manager")).status, 200);
    const [approved] = await auditRows("emission", 901);
    assert.equal(approved.action, "delete");
    assert.deepEqual(approved.changed_fields.status, { old: "approved", new: null });
    assert.equal(approved.changed_by, 2);
  } finally {
    await q("DELETE FROM emission WHERE pk_id IN (901, 902)");
    await clearAudit("emission", [901, 902]);
  }
});

test("production review and delete are audited", async () => {
  await q(`INSERT INTO product (product_id, name, unit, site_id) VALUES (903, 'CI Audit Rod', 't', 1) ON CONFLICT DO NOTHING;
           INSERT INTO production_data (production_id, product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
           VALUES (903, 903, 1, 100, 't', '2025-09-01', '2025-09-30', 'pending', 1)`);
  try {
    assert.equal((await call("PUT", "/user/production-data/903/approve", "manager", {})).status, 200);
    assert.equal((await auditRows("production_data", 903))[0].action, "approve");
    // Approved production rows can't be deleted by anyone (handler rule).
    assert.equal((await call("DELETE", "/user/production-data/903", "manager")).status, 403);
    await q("UPDATE production_data SET status='pending' WHERE production_id=903");
    assert.equal((await call("DELETE", "/user/production-data/903", "user")).status, 200);
    assert.equal((await auditRows("production_data", 903)).at(-1).action, "delete");
  } finally {
    await q("DELETE FROM production_data WHERE production_id=903; DELETE FROM product WHERE product_id=903");
    await clearAudit("production_data", [903]);
  }
});

test("the server never stores a total the client sent", async () => {
  const r = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 3, activity_data: { Trip: "Pune" }, total_emission: 999, unit: "tCO2e",
    date_of_reporting: "2025-07-31", reporting_period: "monthly",
  });
  try {
    assert.equal(r.status, 201);
    const [row] = await q("SELECT total_emission FROM emission WHERE pk_id=$1", [r.json.emission.pk_id]);
    assert.equal(Number(row.total_emission), 0);

    // An edit that drops the category drops the old total too.
    await q("UPDATE emission SET total_emission=4 WHERE pk_id=$1", [r.json.emission.pk_id]);
    assert.equal((await call("PUT", `/user/emissions/${r.json.emission.pk_id}`, "user", { activity_data: { Trip: "Pune", km: 12 } })).status, 200);
    const [edited] = await q("SELECT total_emission FROM emission WHERE pk_id=$1", [r.json.emission.pk_id]);
    assert.equal(Number(edited.total_emission), 0);
  } finally {
    if (r.json?.emission?.pk_id) {
      await q("DELETE FROM emission WHERE pk_id=$1", [r.json.emission.pk_id]);
      await clearAudit("emission", [r.json.emission.pk_id]);
    }
  }
});

test("a manager edit recalculates the FERA twin and keeps it in step with the parent", async () => {
  const before = await q("SELECT pk_id, activity_data, total_emission, activity_data_unit, emission_factor_snapshot, status, reviewed_by FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id)
           VALUES (901, 'Diesel', 2.68, 'litre', 2024, 1, 1), (902, 'Diesel', 0.61, 'litre', 2024, 1, 5)`);
  await q("UPDATE emission SET activity_data_unit='litre' WHERE pk_id IN (1, 5)");
  try {
    const r = await call("PUT", "/user/emissions/manager-edit/1", "manager", {
      activity_data: { activity_value: 2000, emission_category: "Diesel" }, reason: "Meter re-read",
    });
    assert.equal(r.status, 200);
    const rows = await q("SELECT pk_id, total_emission, status, reviewed_by FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
    assert.equal(Number(rows[0].total_emission), 5.36); // 2000 litre × 2.68 kg/litre ÷ 1000
    assert.equal(rows[0].status, "approved"); // the edit is logged, not re-reviewed (P07 spec)
    assert.equal(Number(rows[1].total_emission), 1.22); // 2000 × 0.61 ÷ 1000
    assert.equal(rows[1].status, "approved");
    assert.equal(rows[1].reviewed_by, 2);
    const [audit] = await auditRows("emission", 1);
    assert.equal(audit.action, "manager_edit");
    assert.equal(audit.reason, "Meter re-read");
    assert.deepEqual(audit.changed_fields.fera_total_emission, { old: "0.5", new: 1.22 });
  } finally {
    for (const b of before) {
      await q(
        "UPDATE emission SET activity_data=$2, total_emission=$3, activity_data_unit=$4, emission_factor_snapshot=$5, status=$6, reviewed_by=$7 WHERE pk_id=$1",
        [b.pk_id, b.activity_data, b.total_emission, b.activity_data_unit, b.emission_factor_snapshot, b.status, b.reviewed_by]
      );
    }
    await q("DELETE FROM emission_factors WHERE emission_factor_id IN (901, 902)");
    await clearAudit("emission", [1, 5]);
  }
});
