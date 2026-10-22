// #191 PR 1: ids and counts reach the API as JSON numbers. The app reads bigint (int8) as a
// number, so this holds today (pk_id is int4) and after the ids are widened to bigint (PR 2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;

test("an entry's pk_id and the list's counts are JSON numbers", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id)
           VALUES (9191, '{"activity_value": 1}', 1, 'tCO2e', '2025-05-31', 'pending', 1, 1, 1, 'monthly', 'ci-bigint-batch')`);
  try {
    const res = await call("GET", "/user/emissions?page=1&limit=50&batchId=ci-bigint-batch", "superadmin");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.length, 1);
    assert.equal(typeof res.json.data[0].pk_id, "number");
    assert.equal(res.json.data[0].pk_id, 9191);
    assert.equal(typeof res.json.total, "number");
    assert.equal(typeof res.json.summary.pending_count, "number");
  } finally {
    await q("DELETE FROM emission WHERE pk_id = 9191");
  }
});
