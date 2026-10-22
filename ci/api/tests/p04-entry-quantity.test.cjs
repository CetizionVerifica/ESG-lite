// P04 / P07: every row of GET /user/emissions carries `quantity`, the number the
// My entries and approvals "Quantity" columns show. Same rule as the Breakdown
// panel: a canonical key, then the number fields of the entry's own site ×
// category form, then a spend amount.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb((db) => db.query(sql, params)).then((r) => r.rows);

async function quantities(query, who) {
  const res = await call("GET", `/user/emissions?${query}`, who);
  assert.equal(res.status, 200);
  const rows = Array.isArray(res.json) ? res.json : res.json.data;
  return new Map(rows.map((r) => [r.pk_id, r.quantity]));
}

test("every listed entry carries its quantity, paged or not", async () => {
  const paged = await quantities("page=1&limit=50", "manager");
  assert.equal(paged.get(1), 1600);
  assert.equal(paged.get(2), 441242);
  const unpaged = await quantities("", "manager");
  assert.equal(unpaged.get(3), 10);
});

test("a form's own number field is the quantity (Fugitive's \"Amount of gas\")", async () => {
  await q("INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (9911, 'Refrigerant', 'select'), (9912, 'Amount of gas', 'number')");
  await q("INSERT INTO column_config (pk_id, config_name, site_id, category_id) VALUES (9911, 'CI refrigerant', 1, 3)");
  await q("INSERT INTO column_config_columns (column_config_id, column_id) VALUES (9911, 9911), (9911, 9912)");
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (911, '{"Refrigerant": "6", "Amount of gas": "1000"}', 3943, 'tCO2e', '2025-06-30', 'pending', 1, 3, 1, 'monthly'),
                  (912, '{"Refrigerant": "R-32"}', 0, 'tCO2e', '2025-06-30', 'pending', 1, 3, 1, 'monthly')`);
  try {
    const rows = await quantities("page=1&limit=50&categoryId=3", "user");
    assert.equal(rows.get(911), 1000); // not the select's option id 6
    assert.equal(rows.get(912), null); // nothing to show: the column says "—"
  } finally {
    await q("DELETE FROM emission WHERE pk_id IN (911, 912)");
    await q("DELETE FROM column_config_columns WHERE column_config_id=9911");
    await q("DELETE FROM column_config WHERE pk_id=9911");
    await q("DELETE FROM column_entity WHERE pk_id IN (9911, 9912)");
  }
});
