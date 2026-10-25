// #191: bigint values reach the code and the API as JSON numbers. node-postgres
// returns int8 as a string by default; src/config/pgTypes.ts (installed by the
// data source) turns int8 and int8[] into numbers, and a generated bigint id
// keeps its number through save().
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test("the server's data source returns int8, count(*) and int8[] as numbers", async () => {
  const { AppDataSource } = require(path.resolve(__dirname, "../../../dist/config/data-source.js"));
  await AppDataSource.initialize();
  try {
    const [row] = await AppDataSource.query(
      `SELECT 9007199254740::bigint AS big, (SELECT count(*) FROM emission) AS n,
              ARRAY[1, NULL, 3000000001]::bigint[] AS ids, 9007199254740993::bigint AS beyond`,
    );
    assert.equal(row.big, 9007199254740);
    assert.equal(typeof row.n, "number");
    assert.deepEqual(row.ids, [1, null, 3000000001]);
    // Past 2^53 - 1 a Number would round, so the exact string comes back instead.
    assert.equal(row.beyond, "9007199254740993");
  } finally {
    await AppDataSource.destroy();
  }
});

test("a new entry's pk_id is a JSON number, in the create response and the list", async () => {
  const r = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 3, activity_data: { Trip: "Pune" }, unit: "tCO2e",
    date_of_reporting: "2025-07-31", reporting_period: "monthly",
  });
  const id = r.json?.emission?.pk_id;
  try {
    assert.equal(r.status, 201);
    assert.equal(typeof id, "number");
    const list = await call("GET", "/user/emissions/site/1/category/3", "user");
    assert.equal(list.status, 200);
    const mine = list.json.find((e) => e.pk_id === id);
    assert.ok(mine, "the new entry is in the list with the same numeric pk_id");
  } finally {
    if (id) {
      await q("DELETE FROM emission WHERE pk_id = $1", [id]);
      await q("DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1", [id]);
    }
  }
});

// Past the old integer limit (2,147,483,647): the widened sequences restart at
// 3,000,000,000 for these tests and are put back afterwards. The notifications a
// test leaves (approved, rejected) go too, so the next test's ids don't collide.
const BIG = 3000000000;
const SEQUENCES = [["emission", "pk_id"], ["audit_log", "id"], ["notification", "id"]];

async function pastTheLimit(fn) {
  const saved = [];
  for (const [table, column] of SEQUENCES) {
    const [{ seq }] = await q("SELECT pg_get_serial_sequence($1, $2) AS seq", [table, column]);
    const [state] = await q(`SELECT last_value, is_called FROM ${seq}`);
    saved.push({ seq, state });
    await q(`SELECT setval($1, GREATEST($2::bigint, (SELECT COALESCE(max(${column}), 0) FROM ${table})))`, [seq, BIG]);
  }
  try {
    return await fn();
  } finally {
    await q("DELETE FROM notification WHERE id > $1", [BIG]);
    for (const { seq, state } of saved) await q("SELECT setval($1, $2, $3)", [seq, state.last_value, state.is_called]);
  }
}

test("past 2^31: an entry keeps a numeric id through create, list, evidence, approval, audit and history", async () => {
  await pastTheLimit(async () => {
    let id;
    try {
      const r = await call("POST", "/user/emissions", "user", {
        site_id: 1, category_id: 3, activity_data: { Trip: "Pune" }, unit: "tCO2e",
        date_of_reporting: "2025-07-31", reporting_period: "monthly",
      });
      assert.equal(r.status, 201);
      id = r.json.emission.pk_id;
      assert.equal(typeof id, "number");
      assert.ok(id > BIG, `pk_id ${id} is past the old limit`);
      assert.ok((await call("GET", "/user/emissions/site/1/category/3", "user")).json.some((e) => e.pk_id === id));

      const form = new FormData();
      form.append("file", new Blob(["evidence"], { type: "application/pdf" }), "bigint.pdf");
      form.append("emission_id", String(id));
      assert.equal((await call("POST", "/user/documents", "user", form)).status, 201);
      const [doc] = await q("SELECT emission_id FROM emission_document WHERE emission_id = $1", [id]);
      assert.equal(doc.emission_id, id);
      const docs = await call("GET", `/user/documents/emission/${id}`, "user");
      assert.equal(docs.status, 200);
      assert.equal(docs.json.length ?? docs.json.documents?.length, 1);

      assert.equal((await call("PUT", `/user/emissions/${id}/approve`, "manager", { comment: "ok" })).status, 200);
      const [audit] = await q("SELECT id, entity_id FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1", [id]);
      assert.equal(audit.entity_id, id);
      assert.ok(audit.id > BIG);
      const history = await call("GET", `/user/audit-logs?entity_type=emission&entity_id=${id}`, "manager");
      assert.equal(history.status, 200);
      assert.equal(history.json[0].action, "approve");
      assert.equal(typeof history.json[0].id, "number");
    } finally {
      if (id) {
        await q("DELETE FROM emission_document WHERE emission_id = $1", [id]);
        await q("DELETE FROM emission WHERE pk_id = $1", [id]);
        await q("DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1", [id]);
      }
    }
  });
});

test("past 2^31: a footprint that used the entries goes stale, and its owner's notification has a numeric id", async () => {
  await pastTheLimit(async () => {
    const made = { product: null, production: null, emissions: [], material: null, study: null };
    try {
      await withDb(async (db) => {
        made.product = (await db.query(`INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES ('Bigint rod', 't', 2, 'kg', 1, 1) RETURNING product_id`)).rows[0].product_id;
        made.production = (await db.query(`INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES ($1, 2, 100, 't', '2019-01-01', '2019-12-31', 'approved', 7) RETURNING production_id`, [made.product])).rows[0].production_id;
        made.emissions = (await db.query(
          `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id) VALUES
             ('{}', 1000, 'tCO2e', '2019-06-30', 'approved', 7, 1, 2, 'monthly', 'ci-bigint-batch')
           RETURNING pk_id`,
        )).rows.map((r) => r.pk_id);
      });
      const [used] = made.emissions;
      assert.ok(used > BIG);
      made.material = (await call("POST", "/pcf/material-factors", "manager", { name: "Bigint alu", material_group: "aluminium", unit: "kg", value_kgco2e: 8.6 })).json.material_factor_id;
      made.study = (await call("POST", "/pcf/studies", "manager", { product_id: made.product, reference_start: "2019-01-01", reference_end: "2019-12-31" })).json.pcf_study_id;
      await call("PUT", `/pcf/studies/${made.study}/inputs`, "manager", { inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: made.material }] });
      assert.equal((await call("POST", `/pcf/studies/${made.study}/calculate`, "manager", {})).status, 200);
      assert.equal((await call("POST", `/pcf/studies/${made.study}/submit`, "manager")).status, 200);
      assert.equal((await call("POST", `/pcf/studies/${made.study}/approve`, "superadmin")).status, 200);
      const study = (await call("GET", `/pcf/studies/${made.study}`, "manager")).json;
      assert.equal(study.stale, false);
      const [result] = await q("SELECT emission_ids_used FROM pcf_result WHERE pcf_study_id = $1", [made.study]);
      assert.deepEqual(result.emission_ids_used, [used]);

      // Rejecting the row it used (batch reject reaches approved rows) finds it through emission_ids_used.
      assert.equal((await call("PUT", "/user/emissions/batch/ci-bigint-batch/reject", "manager", { comment: "Wrong meter" })).status, 200);
      assert.equal((await call("GET", `/pcf/studies/${made.study}`, "manager")).json.stale, true);

      const listed = (await call("GET", "/notifications?limit=50", "manager")).json;
      const notes = listed.notifications.filter((n) => n.type === "pcf_stale" && n.link?.endsWith(`/footprints/${made.study}`));
      assert.equal(notes.length, 1);
      assert.equal(typeof notes[0].id, "number");
      assert.ok(notes[0].id > BIG);
      assert.equal((await call("PATCH", `/notifications/${notes[0].id}/read`, "manager")).status, 200);
      const [read] = await q("SELECT read FROM notification WHERE id = $1", [notes[0].id]);
      assert.equal(read.read, true);
    } finally {
      await withDb(async (db) => {
        if (made.study) await db.query("DELETE FROM pcf_study WHERE pcf_study_id = $1", [made.study]);
        await db.query("DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::bigint[])", [made.emissions]);
        await db.query("DELETE FROM emission WHERE pk_id = ANY($1::bigint[])", [made.emissions]);
        if (made.production) await db.query("DELETE FROM production_data WHERE production_id = $1", [made.production]);
        if (made.product) await db.query("DELETE FROM product WHERE product_id = $1", [made.product]);
        if (made.material) await db.query("DELETE FROM material_factor WHERE material_factor_id = $1", [made.material]);
      });
    }
  });
});
