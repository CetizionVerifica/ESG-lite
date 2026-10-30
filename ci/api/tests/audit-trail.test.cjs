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
const clearAudit = (entity, ids) => q("DELETE FROM audit_log WHERE entity_type=$1 AND entity_id = ANY($2::bigint[])", [entity, ids]);

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

test("the history API returns the reason given for a review", async () => {
  try {
    assert.equal((await call("PUT", "/user/emissions/2/approve", "manager", { comment: "Checked against the bill" })).status, 200);
    const r = await call("GET", "/user/audit-logs?entity_type=emission&entity_id=2", "manager");
    assert.equal(r.status, 200);
    const [entry] = r.json;
    assert.equal(entry.action, "approve");
    assert.equal(entry.reason, "Checked against the bill");

    // A reject's comment comes back too, as the newest entry.
    await q("UPDATE emission SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE pk_id IN (2, 5)");
    assert.equal((await call("PUT", "/user/emissions/2/reject", "manager", { comment: "Wrong meter reading" })).status, 200);
    const after = await call("GET", "/user/audit-logs?entity_type=emission&entity_id=2", "manager");
    assert.equal(after.status, 200);
    assert.equal(after.json[0].action, "reject");
    assert.equal(after.json[0].reason, "Wrong meter reading");
  } finally {
    await q("UPDATE emission SET status='pending', reviewed_by=NULL, reviewed_at=NULL, review_comment=NULL WHERE pk_id IN (2, 5)");
    await clearAudit("emission", [2, 5]);
  }
});

test("history entries written in the same instant come back newest (highest id) first", async () => {
  try {
    await q(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by, changed_at)
             VALUES ('emission', 2, 'manager_edit', '{}', 'first', 2, '2025-10-01T10:00:00Z'),
                    ('emission', 2, 'manager_edit', '{}', 'second', 2, '2025-10-01T10:00:00Z')`);
    const r = await call("GET", "/user/audit-logs?entity_type=emission&entity_id=2", "manager");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.map((e) => e.reason), ["second", "first"]);
  } finally {
    await clearAudit("emission", [2]);
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
  const before = await q("SELECT pk_id, activity_data, total_emission, total_kgco2e, activity_data_unit, emission_factor_snapshot, status, reviewed_by FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
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
    assert.deepEqual(audit.changed_fields.total_emission, { old: "4.29", new: 5.36 });
    assert.equal(r.json.fera_emission.status, "approved"); // the twin as stored

    // An approved row can't lose its category: its total would drop to 0.
    const noCategory = await call("PUT", "/user/emissions/manager-edit/1", "manager", {
      activity_data: { activity_value: 2000 }, reason: "Drop category",
    });
    assert.equal(noCategory.status, 400);
    const noUnit = await call("PUT", "/user/emissions/manager-edit/1", "manager", { activity_data_unit: "", reason: "Drop unit" });
    assert.equal(noUnit.status, 400);
    assert.equal(Number((await q("SELECT total_emission FROM emission WHERE pk_id=1"))[0].total_emission), 5.36);
  } finally {
    for (const b of before) {
      await q(
        "UPDATE emission SET activity_data=$2, total_emission=$3, activity_data_unit=$4, emission_factor_snapshot=$5, status=$6, reviewed_by=$7, total_kgco2e=$8 WHERE pk_id=$1",
        [b.pk_id, b.activity_data, b.total_emission, b.activity_data_unit, b.emission_factor_snapshot, b.status, b.reviewed_by, b.total_kgco2e]
      );
    }
    await q("DELETE FROM emission_factors WHERE emission_factor_id IN (901, 902)");
    await clearAudit("emission", [1, 5]);
  }
});

test("manager edit takes the quantity, not a select's option id (configured select names)", async () => {
  const before = await q("SELECT activity_data, total_emission, total_kgco2e, activity_data_unit, emission_factor_snapshot, date_of_reporting FROM emission WHERE pk_id=3");
  await q("INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (9901, 'Waste Type', 'select'), (9902, 'Amount of waste', 'number')");
  await q(`INSERT INTO column_config (pk_id, config_name, site_id, category_id, column_options) VALUES (9901, 'CI waste', 1, 3, '{"9901":[{"id":"6","label":"ETP Sludge"}]}')`);
  await q("INSERT INTO column_config_columns (column_config_id, column_id) VALUES (9901, 9901), (9901, 9902)");
  await q("INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (903, 'ETP Sludge - Landfill', 520, 'ton', 2024, 1, 3)");
  await q("UPDATE emission SET activity_data_unit='ton' WHERE pk_id=3");
  try {
    const r = await call("PUT", "/user/emissions/manager-edit/3", "manager", {
      activity_data: { "Waste Type": "6", "Amount of waste": "9.17", emission_category: "ETP Sludge - Landfill" },
      reason: "Corrected weight",
    });
    assert.equal(r.status, 200);
    const [row] = await q("SELECT total_emission FROM emission WHERE pk_id=3");
    assert.equal(Number(row.total_emission), 4.768); // 9.17 t × 520 kg/t ÷ 1000 at 3 dp (#209), not 6 × 520

    // A date-only edit into another year picks that year's factor.
    await q("INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (904, 'ETP Sludge - Landfill', 600, 'ton', 2025, 1, 3)");
    const moved = await call("PUT", "/user/emissions/manager-edit/3", "manager", { date_of_reporting: "2026-03-15", reason: "Wrong year" });
    assert.equal(moved.status, 200);
    assert.equal(Number((await q("SELECT total_emission FROM emission WHERE pk_id=3"))[0].total_emission), 5.502); // 9.17 × 600 ÷ 1000, 3 dp

    // No factor for the new category in any year: refuse rather than keep the old total.
    const noFactor = await call("PUT", "/user/emissions/manager-edit/3", "manager", {
      activity_data: { "Waste Type": "6", "Amount of waste": "9.17", emission_category: "Nothing like this" },
      reason: "Try a category without factors",
    });
    assert.equal(noFactor.status, 400);
    assert.equal(Number((await q("SELECT total_emission FROM emission WHERE pk_id=3"))[0].total_emission), 5.502);
  } finally {
    const [b] = before;
    await q("UPDATE emission SET activity_data=$1, total_emission=$2, activity_data_unit=$3, emission_factor_snapshot=$4, date_of_reporting=$5, total_kgco2e=$6 WHERE pk_id=3",
      [b.activity_data, b.total_emission, b.activity_data_unit, b.emission_factor_snapshot, b.date_of_reporting, b.total_kgco2e]);
    await q("DELETE FROM column_config_columns WHERE column_config_id=9901");
    await q("DELETE FROM column_config WHERE pk_id=9901");
    await q("DELETE FROM column_entity WHERE pk_id IN (9901, 9902)");
    await q("DELETE FROM emission_factors WHERE emission_factor_id IN (903, 904)");
    await clearAudit("emission", [3]);
  }
});

test("manager edit: the FERA twin takes the quantity, not a select's option id", async () => {
  const before = await q("SELECT pk_id, activity_data, total_emission, total_kgco2e, activity_data_unit, emission_factor_snapshot, status, reviewed_by FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
  await q("INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (9903, 'Fuel Name', 'select'), (9904, 'Litres', 'number')");
  await q("INSERT INTO column_config (pk_id, config_name, site_id, category_id) VALUES (9902, 'CI fuel', 1, 1)");
  await q("INSERT INTO column_config_columns (column_config_id, column_id) VALUES (9902, 9903), (9902, 9904)");
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id)
           VALUES (905, 'Diesel', 2680, 'litre', 2024, 1, 1), (906, 'Diesel', 610, 'litre', 2024, 1, 5)`);
  await q("UPDATE emission SET activity_data_unit='litre' WHERE pk_id IN (1, 5)");
  try {
    const r = await call("PUT", "/user/emissions/manager-edit/1", "manager", {
      activity_data: { "Fuel Name": "3", Litres: "80", emission_category: "Diesel" }, reason: "Meter re-read",
    });
    assert.equal(r.status, 200);
    const rows = await q("SELECT pk_id, total_emission FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
    assert.equal(Number(rows[0].total_emission), 214.4); // 80 litre × 2680 ÷ 1000
    assert.equal(Number(rows[1].total_emission), 48.8); // 80 × 610 ÷ 1000, not 3 × 610
  } finally {
    for (const b of before) {
      await q(
        "UPDATE emission SET activity_data=$2, total_emission=$3, activity_data_unit=$4, emission_factor_snapshot=$5, status=$6, reviewed_by=$7, total_kgco2e=$8 WHERE pk_id=$1",
        [b.pk_id, b.activity_data, b.total_emission, b.activity_data_unit, b.emission_factor_snapshot, b.status, b.reviewed_by, b.total_kgco2e]
      );
    }
    await q("DELETE FROM column_config_columns WHERE column_config_id=9902");
    await q("DELETE FROM column_config WHERE pk_id=9902");
    await q("DELETE FROM column_entity WHERE pk_id IN (9903, 9904)");
    await q("DELETE FROM emission_factors WHERE emission_factor_id IN (905, 906)");
    await clearAudit("emission", [1, 5]);
  }
});

test("a date-only manager edit of a row without category or unit keeps its total", async () => {
  // Fixture rows 2 (pending) and 3 (approved) have no emission_category.
  const before = await q("SELECT pk_id, total_emission, total_kgco2e, date_of_reporting, status FROM emission WHERE pk_id IN (2, 3) ORDER BY pk_id");
  try {
    for (const b of before) {
      const r = await call("PUT", `/user/emissions/manager-edit/${b.pk_id}`, "manager", { date_of_reporting: "2025-08-31", reason: "Wrong month" });
      assert.equal(r.status, 200);
      const [row] = await q("SELECT total_emission, date_of_reporting, status FROM emission WHERE pk_id=$1", [b.pk_id]);
      assert.equal(Number(row.total_emission), Number(b.total_emission));
      assert.equal(row.status, b.status);
      assert.equal(new Date(row.date_of_reporting).toISOString().slice(0, 10), "2025-08-31");
    }
    const bad = await call("PUT", "/user/emissions/manager-edit/2", "manager", { date_of_reporting: "not a date", reason: "Bad date" });
    assert.equal(bad.status, 400);
  } finally {
    for (const b of before) {
      await q("UPDATE emission SET total_emission=$2, date_of_reporting=$3, status=$4, total_kgco2e=$5 WHERE pk_id=$1", [b.pk_id, b.total_emission, b.date_of_reporting, b.status, b.total_kgco2e]);
    }
    await clearAudit("emission", [2, 3]);
  }
});

test("a manager edit with an empty, zero or negative amount is refused and keeps the entry as it was", async () => {
  const [before] = await q("SELECT activity_data, total_emission, total_kgco2e, activity_data_unit, emission_factor_snapshot FROM emission WHERE pk_id=1");
  await q("INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (901, 'Diesel', 2.68, 'litre', 2024, 1, 1)");
  await q("UPDATE emission SET activity_data_unit='litre' WHERE pk_id=1");
  try {
    for (const amount of ["", 0, "0", -50]) {
      const r = await call("PUT", "/user/emissions/manager-edit/1", "manager", {
        activity_data: { activity_value: amount, emission_category: "Diesel" }, reason: "Meter re-read",
      });
      assert.equal(r.status, 400, `amount ${JSON.stringify(amount)}: ${JSON.stringify(r.json).slice(0, 400)}`);
      assert.match(r.json.message, /greater than 0/);
    }
    const [row] = await q("SELECT activity_data, total_emission FROM emission WHERE pk_id=1");
    assert.equal(Number(row.total_emission), Number(before.total_emission));
    assert.deepEqual(row.activity_data, before.activity_data);
    assert.equal((await auditRows("emission", 1)).length, 0);
  } finally {
    await q("UPDATE emission SET activity_data=$1, total_emission=$2, activity_data_unit=$3, emission_factor_snapshot=$4, total_kgco2e=$5 WHERE pk_id=1",
      [before.activity_data, before.total_emission, before.activity_data_unit, before.emission_factor_snapshot, before.total_kgco2e]);
    await q("DELETE FROM emission_factors WHERE emission_factor_id = 901");
    await clearAudit("emission", [1]);
  }
});

test("a manager edit can't move an entry into a period filed the other way (mode lock)", async () => {
  // Site 1, category 2: row 2 is monthly (Sep 2025), row 13 is a yearly CY 2024 batch.
  const before = await q("SELECT pk_id, date_of_reporting FROM emission WHERE pk_id IN (2, 13) ORDER BY pk_id");
  try {
    const intoYearly = await call("PUT", "/user/emissions/manager-edit/2", "manager", { date_of_reporting: "2024-06-30", reason: "Wrong year" });
    assert.equal(intoYearly.status, 409);
    assert.equal(intoYearly.json.mode_lock, true);
    assert.match(intoYearly.json.message, /yearly data for CY 2024\. Delete/);

    const midYear = await call("PUT", "/user/emissions/manager-edit/13", "manager", { date_of_reporting: "2024-06-30", reason: "Wrong date" });
    assert.equal(midYear.status, 400);
    assert.match(midYear.json.message, /Dec 31|31 Dec|December/i);

    const overMonthly = await call("PUT", "/user/emissions/manager-edit/13", "manager", { date_of_reporting: "2025-12-31", reason: "Wrong year" });
    assert.equal(overMonthly.status, 409);
    assert.match(overMonthly.json.message, /monthly entr/);

    const rows = await q("SELECT pk_id, date_of_reporting FROM emission WHERE pk_id IN (2, 13) ORDER BY pk_id");
    assert.deepEqual(rows.map((r) => new Date(r.date_of_reporting).toISOString()), before.map((b) => new Date(b.date_of_reporting).toISOString()));
    assert.equal((await auditRows("emission", 2)).length + (await auditRows("emission", 13)).length, 0);

    // Another month that no yearly batch covers still saves.
    const ok = await call("PUT", "/user/emissions/manager-edit/2", "manager", { date_of_reporting: "2025-08-31", reason: "Wrong month" });
    assert.equal(ok.status, 200);
  } finally {
    for (const b of before) await q("UPDATE emission SET date_of_reporting=$2 WHERE pk_id=$1", [b.pk_id, b.date_of_reporting]);
    await clearAudit("emission", [2, 13]);
  }
});

test("legacy Excel import: totals from the engine and the site's factor, never the sheet's; unknown categories refused (S3-4)", async () => {
  const XLSX = require("xlsx");
  const upload = (rows, categoryName = "Stationary Combustion") => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Sheet1");
    const form = new FormData();
    form.append(
      "file",
      new Blob([XLSX.write(book, { type: "buffer", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "import.xlsx",
    );
    form.append("siteName", "CI Plant A");
    form.append("categoryName", categoryName);
    return call("POST", "/admin/upload/emissions", "superadmin", form);
  };
  // The site's 2017 Diesel factor applies to 2018 rows (reporting year − 1).
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (9928, 'Diesel', 2.6, 'litre', 2017, 1, 1)`);
  try {
    const r = await upload([
      { year: "2018", month: "March", fuelType: "Diesel", unit: "litre", activity: 400, emissionFactor: 2.5, emissionFactorUnit: "kg CO₂e/litre", calculatedEmission: 999 },
      // No Grid factor for this site and category: refused, not stored with the sheet's 2 t.
      { year: "2018", month: "April", fuelType: "Grid", unit: "kWh", activity: 2000, emissionFactor: 1, emissionFactorUnit: "tCO2e/MWh", calculatedEmission: 2 },
    ]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.summary.emissionsCreated, r.json.summary.emissionsSkipped], [1, 1]);
    const rows = await q("SELECT total_emission, total_kgco2e, extra_data->'import'->>'channel' AS channel FROM emission WHERE site_id = 1 AND date_of_reporting >= '2018-01-01' AND date_of_reporting < '2019-01-01'");
    assert.deepEqual(rows.map((x) => [Number(x.total_emission), x.total_kgco2e, x.channel]), [[1.04, "1040.0000", "historical"]]); // 400 x 2.6 kg, not 999 nor 400 x 2.5
    const [audit] = await auditRows("emission", (await q("SELECT pk_id FROM emission WHERE site_id = 1 AND date_of_reporting >= '2018-03-01' AND date_of_reporting < '2018-04-01'"))[0].pk_id);
    assert.match(audit.reason, /Imported via Historical import by CI Superadmin \(import.xlsx\)/);

    // An unknown category is refused, never created as "Scope 1".
    const unknown = await upload([{ year: "2018", month: "May", fuelType: "Diesel", unit: "litre", activity: 1 }], "Mystery Category");
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.code, "SCOPE_INVALID");
    assert.equal((await q(`SELECT 1 FROM category WHERE category_name = 'Mystery Category'`)).length, 0);
  } finally {
    await q("DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id::text IN (SELECT pk_id::text FROM emission WHERE site_id = 1 AND date_of_reporting >= '2018-01-01' AND date_of_reporting < '2019-01-01')");
    await q("DELETE FROM emission WHERE site_id = 1 AND date_of_reporting >= '2018-01-01' AND date_of_reporting < '2019-01-01'");
    await q("DELETE FROM emission_factors WHERE emission_factor_id = 9928");
  }
});

test("a FERA factor in a unit that cannot be converted gives no twin total from the raw value (F-12)", async () => {
  const before = await q("SELECT pk_id, activity_data, total_emission, total_kgco2e, activity_data_unit, emission_factor_snapshot, status, reviewed_by FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id)
           VALUES (903, 'Diesel', 2.68, 'litre', 2024, 1, 1), (904, 'Diesel', 0.3, 'kWh', 2024, 1, 5)`);
  await q("UPDATE emission SET activity_data_unit='litre' WHERE pk_id IN (1, 5)");
  let created;
  try {
    // Manager edit: the parent is recalculated; the twin keeps its total but
    // goes back to review with a note, and the response says why.
    await q("UPDATE emission SET status='approved', reviewed_by=2 WHERE pk_id=5");
    const r = await call("PUT", "/user/emissions/manager-edit/1", "manager", {
      activity_data: { activity_value: 2000, emission_category: "Diesel" }, reason: "Meter re-read",
    });
    assert.equal(r.status, 200);
    const rows = await q("SELECT pk_id, total_emission, status, review_comment FROM emission WHERE pk_id IN (1, 5) ORDER BY pk_id");
    assert.equal(Number(rows[0].total_emission), 5.36);
    assert.equal(rows[0].status, "approved");
    assert.equal(Number(rows[1].total_emission), 0.5); // the raw value would give 0.6
    assert.equal(rows[1].status, "pending");
    assert.match(rows[1].review_comment, /can't be converted/);
    assert.match(r.json.warning, /can't be converted/);
    const [audit] = await auditRows("emission", 1);
    assert.deepEqual(audit.changed_fields.fera_status, { old: "approved", new: "pending" });

    // Create: the parent is saved, no twin is made.
    created = await call("POST", "/user/emissions", "user", {
      site_id: 1, category_id: 1, activity_data: { activity_value: 1000, emission_category: "Diesel" }, activity_data_unit: "litre",
      date_of_reporting: "2025-05-31", reporting_period: "monthly",
    });
    assert.equal(created.status, 201);
    const [parent] = await q("SELECT total_emission, fera_linked_id FROM emission WHERE pk_id=$1", [created.json.emission.pk_id]);
    assert.equal(Number(parent.total_emission), 2.68);
    assert.equal(parent.fera_linked_id, null);
    assert.equal((await q("SELECT 1 FROM emission WHERE fera_linked_id=$1", [created.json.emission.pk_id])).length, 0);
  } finally {
    if (created?.json?.emission?.pk_id) {
      await q("DELETE FROM emission WHERE fera_linked_id=$1 OR pk_id=$1", [created.json.emission.pk_id]);
      await clearAudit("emission", [created.json.emission.pk_id]);
    }
    for (const b of before) {
      await q(
        "UPDATE emission SET activity_data=$2, total_emission=$3, activity_data_unit=$4, emission_factor_snapshot=$5, status=$6, reviewed_by=$7, review_comment=NULL, total_kgco2e=$8 WHERE pk_id=$1",
        [b.pk_id, b.activity_data, b.total_emission, b.activity_data_unit, b.emission_factor_snapshot, b.status, b.reviewed_by, b.total_kgco2e]
      );
    }
    await q("DELETE FROM emission_factors WHERE emission_factor_id IN (903, 904)");
    await clearAudit("emission", [1, 5]);
  }
});

test("a manager edit can't move an entry into a period that hasn't started", async () => {
  // Row 2: monthly, site 1 / category 2. Row 13: a yearly CY 2024 batch.
  const before = await q("SELECT pk_id, date_of_reporting FROM emission WHERE pk_id IN (2, 13) ORDER BY pk_id");
  const now = new Date();
  const nextMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
  try {
    const month = await call("PUT", "/user/emissions/manager-edit/2", "manager", { date_of_reporting: nextMonthEnd, reason: "Wrong month" });
    assert.equal(month.status, 400);
    assert.match(month.json.message, /is in the future/);
    const year = await call("PUT", "/user/emissions/manager-edit/13", "manager", { date_of_reporting: `${now.getUTCFullYear() + 1}-12-31`, reason: "Wrong year" });
    assert.equal(year.status, 400);
    assert.match(year.json.message, /has not started yet/);
    const rows = await q("SELECT pk_id, date_of_reporting FROM emission WHERE pk_id IN (2, 13) ORDER BY pk_id");
    assert.deepEqual(rows.map((r) => new Date(r.date_of_reporting).toISOString()), before.map((b) => new Date(b.date_of_reporting).toISOString()));
  } finally {
    for (const b of before) await q("UPDATE emission SET date_of_reporting=$2 WHERE pk_id=$1", [b.pk_id, b.date_of_reporting]);
    await clearAudit("emission", [2, 13]);
  }
});

test("a contributor's update with an empty, zero or negative amount is refused and keeps the total; a future month too", async () => {
  await q("INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (901, 'Diesel', 2.68, 'litre', 2024, 1, 1)");
  await q(`INSERT INTO emission (pk_id, activity_data, activity_data_unit, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, created_at)
           VALUES (990, '{"activity_value": 100, "emission_category": "Diesel"}', 'litre', 0.27, 'tCO2e', '2025-06-30', 'pending', 1, 1, 1, 'monthly', now())`);
  try {
    for (const amount of ["", 0, "0", -50]) {
      const r = await call("PUT", "/user/emissions/990", "user", { activity_data: { activity_value: amount, emission_category: "Diesel" } });
      assert.equal(r.status, 400, `amount ${JSON.stringify(amount)}: ${JSON.stringify(r.json)}`);
    }
    const now = new Date();
    const future = await call("PUT", "/user/emissions/990", "user", { date_of_reporting: `${now.getUTCFullYear() + 1}-01-31` });
    assert.equal(future.status, 400);
    assert.match(future.json.message, /is in the future/);
    const [kept] = await q("SELECT total_emission, activity_data FROM emission WHERE pk_id = 990");
    assert.equal(Number(kept.total_emission), 0.27);
    assert.equal(kept.activity_data.activity_value, 100);
    const ok = await call("PUT", "/user/emissions/990", "user", { activity_data: { activity_value: 200, emission_category: "Diesel" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(Number((await q("SELECT total_emission FROM emission WHERE pk_id = 990"))[0].total_emission), 0.536);
  } finally {
    await q("DELETE FROM emission WHERE pk_id = 990");
    await q("DELETE FROM emission_factors WHERE emission_factor_id = 901");
    await clearAudit("emission", [990]);
  }
});

test("Add data can ask how a year is filed before typing (F-13/F-27)", async () => {
  // Site 1, category 2: monthly rows in 2025, a yearly CY 2024 batch (row 13).
  const path = (query) => `/user/emissions/period-mode/site/1/category/2?${query}`;
  const [{ n }] = await q("SELECT count(*)::int AS n FROM emission WHERE site_id = 1 AND category_id = 2 AND reporting_period = 'monthly' AND date_of_reporting BETWEEN '2025-01-01' AND '2025-12-31'");
  assert.ok(n > 0, "fixture has monthly 2025 rows");

  const cy2025 = await call("GET", path("reporting_period=yearly&year_type=CY&date_of_reporting=2025-12-31"), "user");
  assert.equal(cy2025.status, 200, JSON.stringify(cy2025.json));
  assert.equal(cy2025.json.conflict.conflicting_period, "monthly");
  assert.equal(cy2025.json.conflict.conflicting_rows, n);
  assert.ok(cy2025.json.message.includes(`already filed monthly for CY 2025 (${n} monthly entr`), cy2025.json.message);

  const month2024 = await call("GET", path("reporting_period=monthly&date_of_reporting=2024-06-30"), "user");
  assert.equal(month2024.status, 200);
  assert.equal(month2024.json.conflict.conflicting_period, "yearly");
  assert.match(month2024.json.message, /yearly data for CY 2024\. Delete/);

  const free = await call("GET", path("reporting_period=yearly&year_type=CY&date_of_reporting=2019-12-31"), "user");
  assert.deepEqual(free.json, { conflict: null, message: null });

  for (const bad of ["reporting_period=weekly&date_of_reporting=2025-12-31", "reporting_period=yearly&date_of_reporting=2025-12-31", "reporting_period=monthly&date_of_reporting=soon"]) {
    assert.equal((await call("GET", path(bad), "user")).status, 400, bad);
  }
  // Another company's site, and no token.
  assert.equal((await call("GET", path("reporting_period=monthly&date_of_reporting=2025-09-30"), "otherUser")).status, 403);
  assert.equal((await call("GET", path("reporting_period=monthly&date_of_reporting=2025-09-30"), null)).status, 401);
});

test("a new entry for a month or year that hasn't started is refused and nothing is saved (F-10)", async () => {
  const now = new Date();
  const nextMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
  const before = Number((await q("SELECT count(*)::int AS n FROM emission"))[0].n);
  const month = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 1, activity_data: { activity_value: 10, emission_category: "Diesel" }, activity_data_unit: "litre", date_of_reporting: nextMonthEnd,
  });
  assert.equal(month.status, 400, JSON.stringify(month.json));
  assert.match(month.json.message, /is in the future/);
  const year = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 1, activity_data: { activity_value: 10, emission_category: "Diesel" }, activity_data_unit: "litre",
    date_of_reporting: `${now.getUTCFullYear() + 1}-12-31`, reporting_period: "yearly", year_type: "CY",
  });
  assert.equal(year.status, 400, JSON.stringify(year.json));
  assert.match(year.json.message, /has not started yet/);
  assert.equal(Number((await q("SELECT count(*)::int AS n FROM emission"))[0].n), before);
});
