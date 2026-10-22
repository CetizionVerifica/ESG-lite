// #191 PR 2: past the old integer limit. The emission sequence is moved to 3,000,000,000, then an
// entry is created (with its Category 3 twin), given a document, approved, and the PCF staleness
// check runs on it. Every id stays a JSON number and every query that carries one still works.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const LIMIT = 2147483647;
const PRODUCT = 9191;
let seq; // the emission sequence before the test, put back after
let study;
const created = [];

const WIDENED = [
  ["emission", "pk_id", "int8"], ["emission", "fera_linked_id", "int8"], ["emission_document", "emission_id", "int8"],
  ["pcf_result", "emission_ids_used", "_int8"], ["audit_log", "id", "int8"], ["audit_log", "entity_id", "int8"],
  ["notification", "id", "int8"], ["mcp_tool_call", "id", "int8"], ["import_plan_row", "id", "int8"],
  ["import_plan_match", "id", "int8"], ["report_ai_call", "id", "int8"], ["oauth_token", "token_id", "int8"],
];

test.before(async () => {
  [seq] = await q(`SELECT pg_get_serial_sequence('emission', 'pk_id') AS name`);
  [seq] = await q(`SELECT '${seq.name}' AS name, last_value, is_called FROM ${seq.name}`);
  // Entries of 2025 use 2024 factors (targetYearFor); the FERA twin needs its factor for exactly that year.
  await q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id)
           VALUES (91911, 'Diesel', 2.68, 'litre', 2024, 1, 1), (91912, 'Diesel', 0.61, 'litre', 2024, 1, 5)`);
  await q(`INSERT INTO product (product_id, name, unit, site_id) VALUES ($1, 'CI bigint product', 'unit', 1)`, [PRODUCT]);
  [study] = await q(
    `INSERT INTO pcf_study (company_id, product_id, site_id, reference_start, reference_end, status)
     VALUES (1, $1, 1, '2025-01-01', '2025-12-31', 'approved') RETURNING pcf_study_id`,
    [PRODUCT],
  );
  await q(`SELECT setval($1, 3000000000)`, [seq.name]);
});

test.after(async () => {
  if (created.length) {
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::bigint[])`, [created]);
    await q(`DELETE FROM emission WHERE pk_id = ANY($1::bigint[])`, [created]);
  }
  await q(`DELETE FROM pcf_study WHERE product_id = $1`, [PRODUCT]);
  await q(`DELETE FROM product WHERE product_id = $1`, [PRODUCT]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id IN (91911, 91912)`);
  await q(`DELETE FROM notification WHERE type = 'pcf_stale'`);
  await q(`SELECT setval($1, $2, $3)`, [seq.name, seq.last_value, seq.is_called]);
});

test("the widened columns are bigint", async () => {
  const rows = await q(
    `SELECT table_name, column_name, udt_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND (table_name, column_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [WIDENED.map((w) => w[0]), WIDENED.map((w) => w[1])],
  );
  const got = Object.fromEntries(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.udt_name]));
  for (const [t, c, type] of WIDENED) assert.equal(got[`${t}.${c}`], type, `${t}.${c}`);
});

test("an entry past 2^31 is created, documented, approved and checked for PCF staleness", async () => {
  const res = await call("POST", "/user/emissions", "multiSiteUser", {
    site_id: 1, category_id: 1, date_of_reporting: "2025-08-31", reporting_period: "monthly",
    activity_data_unit: "litre", activity_data: { emission_category: "Diesel", activity_value: "100" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = res.json.emission.pk_id;
  created.push(id);
  assert.equal(typeof id, "number");
  assert.ok(id > LIMIT, `pk_id ${id} is past the old limit`);

  // The Category 3 twin links both ways with ids past the limit.
  const [twin] = await q(`SELECT pk_id, fera_linked_id FROM emission WHERE fera_linked_id = $1`, [id]);
  assert.ok(twin, "a FERA twin was written");
  created.push(Number(twin.pk_id));
  assert.ok(Number(twin.pk_id) > LIMIT);
  const [parent] = await q(`SELECT fera_linked_id FROM emission WHERE pk_id = $1`, [id]);
  assert.equal(Number(parent.fera_linked_id), Number(twin.pk_id));

  // The study's last result used this entry.
  await q(
    `INSERT INTO pcf_result (pcf_study_id, total_kg_per_unit, by_stage, by_input, primary_data_share_pct, dqr_overall, cut_off, factor_snapshot, emission_ids_used, engine_version, calculated_at)
     VALUES ($1, 1, '{}', '{}', 0, 1, '{}', '{}', $2::bigint[], 'ci', now())`,
    [study.pcf_study_id, [id]],
  );

  const form = new FormData();
  form.append("file", new Blob(["evidence past the limit"], { type: "application/pdf" }), "bigint.pdf");
  form.append("emission_id", String(id));
  const upload = await call("POST", "/user/documents", "superadmin", form);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const docs = await call("GET", `/user/documents/emission/${id}`, "superadmin");
  assert.equal(docs.status, 200);
  const list = Array.isArray(docs.json) ? docs.json : docs.json.documents ?? docs.json.data;
  assert.equal(list.length, 1);

  const approve = await call("PUT", `/user/emissions/${id}/approve`, "manager", {});
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  const [after] = await q(`SELECT status FROM emission WHERE pk_id = $1`, [id]);
  assert.equal(after.status, "approved");

  // pcf_result.emission_ids_used && $1::bigint[] found the study.
  const [s] = await q(`SELECT stale FROM pcf_study WHERE pcf_study_id = $1`, [study.pcf_study_id]);
  assert.equal(s.stale, true);

  // The approval's audit rows carry the ids too (entity_id is bigint).
  const audit = await q(`SELECT entity_id FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1 AND action = 'approve'`, [id]);
  assert.ok(audit.length >= 1);

  const listed = await call("GET", `/user/emissions?page=1&limit=50&site_id=1&year=2025&month=8`, "manager");
  assert.equal(listed.status, 200);
  const row = listed.json.data.find((e) => e.pk_id === id);
  assert.ok(row, "listed with a numeric pk_id");
  assert.equal(typeof row.pk_id, "number");
});
