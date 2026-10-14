// XI5 review polish (docs/excel-import/modules/XI5-review-polish/CLAUDE.md):
// GET /user/emissions?batchId=&attention=1 returns the batch's rows whose plan
// row was matched below 0.8, flagged LOW_CONFIDENCE_MATCH or edited before
// commit; the summary counts them; site scoping still applies; approving
// one's own upload is audited as "Approved by the uploader".
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const ids = (res) => res.json.data.map((e) => e.pk_id).sort((a, b) => a - b);
const PLAN_1 = "11111111-1111-4111-8111-000000000005";
const PLAN_2 = "22222222-2222-4222-8222-000000000005";
const PLAN_API = "33333333-3333-4333-8333-000000000005";
const meta = (confidence, extra = {}) => JSON.stringify({ row_ref: "x", site_id: 1, category_id: 1, period: { kind: "monthly", date: "2025-05-01" }, activity_name: "Diesel", activity_value: 1, activity_unit: "litre", meta: { source: "llm", confidence, ...extra } });
const noMeta = JSON.stringify({ row_ref: "x", site_id: 1, category_id: 1, period: { kind: "monthly", date: "2025-05-01" }, activity_name: "Diesel", activity_value: 1, activity_unit: "litre" });
const emission = (id, batch, site, creator, ref) =>
  `(${id}, '{"activity_value": ${id}}', ${id}, 'tCO2e', '2025-05-31', 'pending', ${creator}, 1, ${site}, 'monthly', '${batch}', '{"import": {"channel": "bulk_upload", "row_ref": "${ref}"}}')`;

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO import_plan (plan_id, company_id, created_by, channel, source_name, status, version, upload_batch_id, expires_at)
                    VALUES ($1, 1, 2, 'bulk_upload', 'messy.xlsx', 'committed', 3, 'xi5-batch', now()), ($2, 2, 6, 'bulk_upload', 'other.xlsx', 'committed', 3, 'xi5-other', now()),
                           ($3, 1, 2, 'api', 'api.json', 'committed', 3, 'xi5-api', now())`, [PLAN_1, PLAN_2, PLAN_API]);
    await db.query(`INSERT INTO import_plan_row (plan_id, row_ref, position, input, state, issues, result) VALUES
      ($1, 'Fuel!B2', 0, $3::jsonb, 'ready', '[]', '{}'),
      ($1, 'Fuel!B3', 1, $4::jsonb, 'ready', '[]', '{}'),
      ($1, 'Fuel!B4', 2, $5::jsonb, 'ready', '[{"code":"LOW_CONFIDENCE_MATCH","severity":"warning","message":"m"}]', '{}'),
      ($1, 'Fuel!B5', 3, $5::jsonb, 'ready', '[]', '{}'),
      ($1, 'Fuel!B6', 4, $6::jsonb, 'ready', '[]', '{}'),
      ($2, 'Fuel!B2', 0, $3::jsonb, 'ready', '[]', '{}')`, [PLAN_1, PLAN_2, meta(0.5), meta(0.95, { edited: true }), meta(0.95), noMeta]);
    await db.query(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id, extra_data) VALUES
      ${emission(971, "xi5-batch", 1, 2, "Fuel!B2")}, ${emission(972, "xi5-batch", 1, 2, "Fuel!B3")}, ${emission(973, "xi5-batch", 1, 2, "Fuel!B4")},
      ${emission(974, "xi5-batch", 1, 2, "Fuel!B5")}, ${emission(975, "xi5-batch", 1, 2, "Fuel!B6")},
      ${emission(976, "xi5-other", 3, 6, "Fuel!B2")},
      ${emission(977, "xi5-batch", 1, 2, "Fuel!B7")}, ${emission(978, "xi5-api", 1, 2, "Fuel!B2")}, ${emission(979, "xi5-batch", 1, 2, "Fuel!B8")}`);
    await db.query(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES
      (980, '{"activity_value": 980}', 980, 'tCO2e', '2025-05-31', 'pending', 5, 1, 1, 'monthly')`);
  });
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id BETWEEN 971 AND 980`);
    await db.query(`DELETE FROM emission WHERE pk_id BETWEEN 971 AND 980`);
    await db.query(`DELETE FROM import_plan WHERE plan_id IN ($1, $2, $3)`, [PLAN_1, PLAN_2, PLAN_API]);
  });
});

test("attention=1 lists the low-confidence, flagged and edited rows of a batch; the summary counts them", async () => {
  const all = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-batch", "manager");
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.deepEqual(ids(all), [971, 972, 973, 974, 975, 977, 979]);
  assert.equal(all.json.summary.attention_count, 3);
  assert.equal(all.json.summary.attention, 3, "the spec's name, read by ESG-lite_FE #176");
  assert.equal(all.json.summary.pending_count, 7);

  const some = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-batch&attention=1", "manager");
  assert.equal(some.status, 200, JSON.stringify(some.json));
  assert.deepEqual(ids(some), [971, 972, 973], "0.5 confidence, edited, LOW_CONFIDENCE_MATCH; not the clean row or the row without meta");
  assert.deepEqual([some.json.total, some.json.summary.attention_count, some.json.summary.pending_count], [3, 3, 3]);

  // Combined with the other filters.
  const pending = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-batch&attention=1&status=approved", "manager");
  assert.deepEqual(ids(pending), []);
  // Without batchId the flag is ignored and the count is 0.
  const noBatch = await call("GET", "/user/emissions?page=1&limit=5&attention=1&siteIds=1", "manager");
  assert.equal(noBatch.status, 200);
  assert.equal(noBatch.json.summary.attention_count, undefined);
  assert.equal(noBatch.json.summary.attention, undefined);
  assert.ok(noBatch.json.total > 3);
  // Plain (unpaged) shape still works with the flag.
  const plain = await call("GET", "/user/emissions?batchId=xi5-batch&attention=1", "manager");
  assert.deepEqual(plain.json.map((e) => e.pk_id).sort(), [971, 972, 973]);
});

test("attention is scoped like everything else: another company's batch is empty, and so is a batch id probed from company 2", async () => {
  const other = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-batch&attention=1", "otherManager");
  assert.deepEqual([other.status, ids(other), other.json.summary.attention_count], [200, [], 0]);
  const mine = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-other&attention=1", "manager");
  assert.deepEqual([ids(mine), mine.json.summary.attention_count], [[], 0]);
  const theirs = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-other&attention=1", "otherManager");
  assert.deepEqual([ids(theirs), theirs.json.summary.attention_count], [[976], 1]);
  const superadmin = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-other&attention=1", "superadmin");
  assert.deepEqual(ids(superadmin), [976]);
});

test("approving your own upload is allowed and audited as 'Approved by the uploader'; typed entries stay four-eyes", async () => {
  // A typed entry of the manager's own (no upload batch) is still refused (audit F-01/F-02).
  await q(`UPDATE emission SET created_by = 2 WHERE pk_id = 11`);
  try {
    assert.equal((await call("PUT", "/user/emissions/11/approve", "manager", {})).status, 403);
    assert.equal((await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [11] })).status, 403);
  } finally {
    await q(`UPDATE emission SET created_by = 7 WHERE pk_id = 11`);
  }
  // 971 was uploaded by the manager (user 2); the manager approves it.
  const own = await call("PUT", "/user/emissions/971/approve", "manager", {});
  assert.equal(own.status, 200, JSON.stringify(own.json));
  let [row] = await q(`SELECT action, reason, changed_fields FROM audit_log WHERE entity_type = 'emission' AND entity_id = 971 ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([row.action, row.reason, row.changed_fields.approved_by_uploader], ["approve", "Approved by the uploader", { old: null, new: true }]);
  // With a comment the note comes first; the comment is kept.
  const withComment = await call("PUT", "/user/emissions/972/approve", "manager", { comment: "Checked the invoice" });
  assert.equal(withComment.status, 200);
  [row] = await q(`SELECT reason FROM audit_log WHERE entity_type = 'emission' AND entity_id = 972 ORDER BY id DESC LIMIT 1`);
  assert.equal(row.reason, "Approved by the uploader. Checked the invoice");
  // Batch approve: only the rows the approver uploaded get the note.
  await q(`UPDATE emission SET created_by = 1 WHERE pk_id = 974`);
  const batch = await call("PUT", "/user/emissions/batch/xi5-batch/approve", "manager", {});
  assert.equal(batch.status, 200, JSON.stringify(batch.json));
  const rows = await q(`SELECT entity_id, reason FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (973, 974, 975) ORDER BY entity_id`);
  assert.deepEqual(rows, [{ entity_id: 973, reason: "Approved by the uploader" }, { entity_id: 974, reason: null }, { entity_id: 975, reason: "Approved by the uploader" }]);
  // The uploader may not reject their own rows: decision 6 is about approving only.
  await q(`UPDATE emission SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE pk_id = 973`);
  const reject = await call("PUT", "/user/emissions/973/reject", "manager", { comment: "Wrong unit" });
  assert.equal(reject.status, 403, JSON.stringify(reject.json));
  assert.equal((await call("PUT", "/user/emissions/bulk-reject", "manager", { ids: [973], comment: "Wrong unit" })).status, 403);
});

test("review fixes: an edit after commit keeps the row's import link, flags it and ends the uploader's right to approve it", async () => {
  // The batch approve above approved 977 and 979; back to pending for this test.
  await q(`UPDATE emission SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE pk_id IN (977, 979)`);
  // The uploader edits their uploaded row 977: the import provenance survives the new extra_data.
  const edit = await call("PUT", "/user/emissions/977", "manager", { extra_data: { note: "fixed by hand" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  const [after] = await q(`SELECT extra_data FROM emission WHERE pk_id = 977`);
  assert.deepEqual(after.extra_data, { note: "fixed by hand", import: { channel: "bulk_upload", row_ref: "Fuel!B7", edited: true, edited_by: 2 } });
  // It now needs attention, though its plan row (none here) says nothing.
  const some = await call("GET", "/user/emissions?page=1&limit=50&batchId=xi5-batch&attention=1&status=pending", "manager");
  assert.ok(ids(some).includes(977), JSON.stringify(ids(some)));
  assert.ok(!ids(some).includes(979));
  // And the uploader may no longer approve it, alone or with the batch.
  assert.equal((await call("PUT", "/user/emissions/977/approve", "manager", {})).status, 403);
  assert.equal((await call("PUT", "/user/emissions/batch/xi5-batch/approve", "manager", {})).status, 403);
  // An untouched row of the same batch still may be approved by the uploader.
  assert.equal((await call("PUT", "/user/emissions/979/approve", "manager", {})).status, 200);
  // A typed edit of a row that never came from an import adds no import key.
  const typed = await call("PUT", "/user/emissions/980", "superadmin", { extra_data: { note: "x" } });
  assert.equal(typed.status, 200, JSON.stringify(typed.json));
  assert.deepEqual((await q(`SELECT extra_data FROM emission WHERE pk_id = 980`))[0].extra_data, { note: "x" });
});

test("review fixes: the uploader exception is for bulk uploads only, and the audit note needs an uploaded row", async () => {
  // A row of an API batch the manager sent is not theirs to approve.
  assert.equal((await call("PUT", "/user/emissions/978/approve", "manager", {})).status, 403);
  assert.equal((await call("PUT", "/user/emissions/batch/xi5-api/approve", "manager", {})).status, 403);
  // A Superadmin approving their own typed entry is not "Approved by the uploader".
  const sa = await call("PUT", "/user/emissions/980/approve", "superadmin", {});
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  const [row] = await q(`SELECT reason, changed_fields FROM audit_log WHERE entity_type = 'emission' AND entity_id = 980 AND action = 'approve' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([row.reason, row.changed_fields.approved_by_uploader], [null, undefined]);
});

test("commit copies a smart-import row's meta (source, confidence) onto extra_data.import for Review rows' 'Matched by'", async () => {
  await withDb((db) => db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES (941, 1, 1, 2017, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel')`));
  let batch = null;
  try {
    const base = { site_id: 1, category_id: 1, activity_name: "Diesel", activity_value: 100, activity_unit: "litre" };
    const created = await call("POST", "/imports/plans", "manager", {
      source_name: "meta.xlsx",
      channel: "bulk_upload",
      rows: [
        { ...base, row_ref: "Fuel!B2", period: { kind: "monthly", date: "2018-01-01" }, meta: { source: "llm", confidence: 0.7 } },
        { ...base, row_ref: "Fuel!B3", period: { kind: "monthly", date: "2018-02-01" } },
      ],
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const patched = await call("PATCH", `/imports/plans/${created.json.plan_id}`, "manager", { version: created.json.version, changes: [{ row_ref: "Fuel!B2", set: { activity_value: 110 } }] });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    const res = await call("POST", `/imports/plans/${created.json.plan_id}/commit`, "manager", { version: patched.json.version, skip_rows_with_issues: false, idempotency_key: "xi5-meta-" + created.json.plan_id });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    batch = res.json.committed.upload_batch_id;
    const rows = await q(`SELECT extra_data FROM emission WHERE upload_batch_id = $1 ORDER BY extra_data -> 'import' ->> 'row_ref'`, [batch]);
    assert.deepEqual(rows.map((r) => r.extra_data.import), [
      { channel: "bulk_upload", row_ref: "Fuel!B2", meta: { source: "llm", confidence: 0.7 } },
      { channel: "bulk_upload", row_ref: "Fuel!B3" },
    ], "edited stays on the plan row; rows without meta get none");
  } finally {
    await withDb(async (db) => {
      if (batch) {
        await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE upload_batch_id = $1)`, [batch]);
        await db.query(`DELETE FROM notification WHERE meta ->> 'upload_batch_id' = $1`, [batch]);
        await db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [batch]);
      }
      await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = 941`);
    });
  }
});

test("PATCH /imports/plans marks an edited smart-import row (meta.edited) so Review rows can flag it", async () => {
  await withDb((db) => db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES (940, 1, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel')`));
  try {
    const base = { site_id: 1, category_id: 1, activity_name: "Diesel", activity_value: 100, activity_unit: "litre" };
    const created = await call("POST", "/imports/plans", "manager", {
      source_name: "x.xlsx",
      channel: "bulk_upload",
      rows: [
        { ...base, row_ref: "a", period: { kind: "monthly", date: "2019-01-01" }, meta: { source: "llm", confidence: 0.9 } },
        { ...base, row_ref: "b", period: { kind: "monthly", date: "2019-02-01" } },
        { ...base, row_ref: "c", activity_name: "HSD", period: { kind: "monthly", date: "2019-03-01" }, meta: { source: "rules", confidence: 0.95 } },
        { ...base, row_ref: "d", activity_name: "Petrol", period: { kind: "monthly", date: "2019-04-01" }, meta: { source: "rules", confidence: 0.95 } },
      ],
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const patched = await call("PATCH", `/imports/plans/${created.json.plan_id}`, "manager", {
      version: created.json.version,
      changes: [{ row_ref: "a", set: { activity_value: 120 } }, { row_ref: "b", set: { activity_value: 130 } }],
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    const a = patched.json.rows.find((r) => r.row_ref === "a");
    const b = patched.json.rows.find((r) => r.row_ref === "b");
    assert.deepEqual(a.input.meta, { source: "llm", confidence: 0.9, edited: true });
    assert.equal(b.input.meta, undefined, "rows without smart-import meta are not flagged");
    // Correcting an activity match flags the rows it applies to (same site, category and wording).
    const matched = await call("PATCH", `/imports/plans/${created.json.plan_id}`, "manager", {
      version: patched.json.version,
      activity_matches: [{ site_id: 1, category_id: 1, sheet_name: " hsd ", factor_name: "Diesel" }],
    });
    assert.equal(matched.status, 200, JSON.stringify(matched.json));
    assert.equal(matched.json.rows.find((r) => r.row_ref === "c").input.meta.edited, true);
    assert.equal(matched.json.rows.find((r) => r.row_ref === "d").input.meta.edited, undefined);
    // Un-edited rows keep their meta as sent.
    assert.equal(created.json.rows.find((r) => r.row_ref === "a").input.meta.edited, undefined);
    await call("POST", `/imports/plans/${created.json.plan_id}/cancel`, "manager");
  } finally {
    await withDb((db) => db.query(`DELETE FROM emission_factors WHERE emission_factor_id = 940`));
  }
});
