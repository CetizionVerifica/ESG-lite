// P07 "Review rows" on an upload batch: GET /user/emissions?batchId=<upload_batch_id>
// lists only that batch's rows, with the summary counted on the same rows, and
// never rows of a site the caller can't see.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const ids = (res) => res.json.data.map((e) => e.pk_id).sort((a, b) => a - b);

test("batchId narrows the list and its summary to one upload batch", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id)
           VALUES (961, '{"activity_value": 1}', 1, 'tCO2e', '2025-05-31', 'pending',  1, 1, 1, 'monthly', 'ci-review-batch'),
                  (962, '{"activity_value": 2}', 2, 'tCO2e', '2025-05-31', 'pending',  1, 1, 1, 'monthly', 'ci-review-batch'),
                  (963, '{"activity_value": 3}', 3, 'tCO2e', '2025-05-31', 'approved', 1, 1, 1, 'monthly', 'ci-review-batch'),
                  (964, '{"activity_value": 4}', 4, 'tCO2e', '2025-05-31', 'pending',  1, 1, 1, 'monthly', 'ci-other-batch'),
                  (965, '{"activity_value": 5}', 5, 'tCO2e', '2025-05-31', 'pending',  6, 1, 3, 'monthly', 'ci-review-batch')`);
  try {
    const all = await call("GET", "/user/emissions?page=1&limit=50&batchId=ci-review-batch", "manager");
    assert.equal(all.status, 200);
    // 965 is on site 3, outside the manager's sites.
    assert.deepEqual(ids(all), [961, 962, 963]);
    assert.equal(all.json.total, 3);
    assert.equal(all.json.summary.pending_count, 2);
    assert.equal(all.json.summary.approved_count, 1);
    assert.equal(all.json.summary.total_emission, 6);

    const pending = await call("GET", "/user/emissions?page=1&limit=50&batchId=ci-review-batch&status=pending", "manager");
    assert.deepEqual(ids(pending), [961, 962]);

    const superadmin = await call("GET", "/user/emissions?page=1&limit=50&batchId=ci-review-batch", "superadmin");
    assert.deepEqual(ids(superadmin), [961, 962, 963, 965]);

    const none = await call("GET", "/user/emissions?page=1&limit=50&batchId=no-such-batch", "manager");
    assert.deepEqual(ids(none), []);
    assert.equal(none.json.total, 0);
  } finally {
    await q("DELETE FROM emission WHERE pk_id IN (961, 962, 963, 964, 965)");
  }
});
