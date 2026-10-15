// S3-2: factor metadata on create, update and bulk upload, the list filter,
// a factor's 8-decimal precision through a calculation, and the
// migrate:scope3-factor-meta backfill run twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const NAME = "S3-2 meta check";
const created = [];
const batches = [];

test.after(async () => {
  for (const id of created) await call("DELETE", `/admin/emission-factors/${id}`, "superadmin");
  for (const id of batches) await call("DELETE", `/admin/emission-factors/batch/${id}`, "superadmin");
});

const create = (body) =>
  call("POST", "/admin/emission-factors", "superadmin", {
    site_id: 1, category_id: 3, year: 2017, factor_value: "0.5", denominator_unit: "km", emission_category_name: NAME, ...body,
  });

test("create stores the metadata and returns it", async () => {
  const res = await create({
    factor_type: "life_cycle", gwp_set: "ar6", geography: "gb", dataset: "DEFRA", dataset_version: "2017",
    co2_kg: "0.49", ch4_kg: "0.0001", n2o_kg: "0.00999999", includes_wtt: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const f = res.json.emissionFactor;
  created.push(f.emission_factor_id);
  assert.equal(f.factor_type, "life_cycle");
  assert.equal(f.gwp_set, "AR6");
  assert.equal(f.geography, "GB");
  assert.equal(f.dataset, "DEFRA");
  assert.equal(f.includes_wtt, true);
  assert.equal(Number(f.n2o_kg), 0.00999999);
  assert.deepEqual(res.json.warnings, []);
});

test("create without a unit is UNIT_REQUIRED", async () => {
  for (const denominator_unit of [undefined, "", "  "]) {
    const res = await create({ year: 2016, denominator_unit });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal(res.json.code, "UNIT_REQUIRED");
  }
});

test("bad metadata is a 400 naming the field", async () => {
  const res = await create({ year: 2015, factor_type: "scope3" });
  assert.equal(res.status, 400);
  assert.equal(res.json.field, "factor_type");
  const gas = await create({ year: 2015, co2_kg: "-2" });
  assert.equal(gas.status, 400);
  assert.equal(gas.json.field, "co2_kg");
});

test("update changes metadata alone, and clears with null", async () => {
  const id = created[0];
  const res = await call("PUT", `/admin/emission-factors/${id}`, "superadmin", { factor_type: "combustion", geography: null });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.emissionFactor.factor_type, "combustion");
  assert.equal(res.json.emissionFactor.geography, null);
  assert.equal(res.json.emissionFactor.gwp_set, "AR6");
  const noUnit = await call("PUT", `/admin/emission-factors/${id}`, "superadmin", { denominator_unit: "" });
  assert.equal(noUnit.status, 400);
  assert.equal(noUnit.json.code, "UNIT_REQUIRED");
});

test("FACTOR_TYPE_MISMATCH is a warning once the category has a GHG number", async (t) => {
  // category.ghg_category arrives with S3-1; until then no category has one.
  const hasColumn = await withDb(async (db) =>
    (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`)).rowCount > 0,
  );
  if (!hasColumn) return t.skip("category.ghg_category is added by S3-1");
  await withDb((db) => db.query(`UPDATE category SET ghg_category = 6 WHERE category_id = 3`));
  try {
    const res = await create({ year: 2014, factor_type: "wtt" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    created.push(res.json.emissionFactor.emission_factor_id);
    assert.equal(res.json.warnings[0].code, "FACTOR_TYPE_MISMATCH");
  } finally {
    await withDb((db) => db.query(`UPDATE category SET ghg_category = NULL WHERE category_id = 3`));
  }
});

test("bulk upload keeps WTT as its own factor, skips rows with no unit or bad metadata", async () => {
  const res = await call("POST", "/admin/emission-factors/bulk", "superadmin", {
    factors: [
      { site_id: 1, category_id: 3, year: 2013, factor_value: "0.17", denominator_unit: "tonne.km", emission_category_name: `${NAME} - Direct`, factor_type: "life_cycle" },
      { site_id: 1, category_id: 5, year: 2013, factor_value: "0.04", denominator_unit: "tonne.km", emission_category_name: `${NAME} - WTT`, factor_type: "wtt" },
      { site_id: 1, category_id: 3, year: 2013, factor_value: "0.2", emission_category_name: `${NAME} - no unit` },
      { site_id: 1, category_id: 3, year: 2013, factor_value: "0.2", denominator_unit: "km", emission_category_name: `${NAME} - bad`, gwp_set: "AR9" },
    ],
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  batches.push(res.json.upload_batch_id);
  assert.equal(res.json.created, 2);
  assert.equal(res.json.skipped, 2);
  assert.match(res.json.errors[0], /UNIT_REQUIRED/);
  assert.match(res.json.errors[1], /gwp_set/);
  assert.deepEqual(res.json.warnings, []);
});

test("the list filters by factor_type and stays inside company_id", async () => {
  const list = (q, who = "superadmin") => call("GET", `/admin/emission-factors?search=${encodeURIComponent(NAME)}${q}`, who);
  const wtt = await list("&factor_type=wtt");
  assert.equal(wtt.status, 200);
  assert.deepEqual(wtt.json.data.map((f) => f.emission_category_name), [`${NAME} - WTT`]);
  assert.equal((await list("&factor_type=wtt&company_id=2")).json.total, 0);
  assert.equal((await list("&factor_type=bogus")).status, 400);
  // Factors are Superadmin data: a client's admin can't list them.
  assert.equal((await list("&factor_type=wtt", "admin")).status, 403);
  assert.equal((await list("&factor_type=wtt", "otherManager")).status, 403);
});

test("a 0.00012345 factor survives upload and calculation at 8 decimals", async () => {
  const up = await call("POST", "/admin/emission-factors/bulk", "superadmin", {
    factors: [{ site_id: 1, category_id: 1, year: 2012, factor_value: "0.00012345", denominator_unit: "litre", emission_category_name: "S3-2 precision fuel" }],
  });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  batches.push(up.json.upload_batch_id);
  const stored = await withDb(async (db) =>
    (await db.query(`SELECT factor_value::text AS v FROM emission_factors WHERE upload_batch_id = $1`, [up.json.upload_batch_id])).rows[0].v,
  );
  assert.equal(stored, "0.00012345");

  const entry = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 1, date_of_reporting: "2013-01-15", activity_data_unit: "litre",
    activity_data: { emission_category: "S3-2 precision fuel", activity_value: "1000000" },
  });
  assert.equal(entry.status < 300, true, JSON.stringify(entry.json));
  const id = (entry.json.emission ?? entry.json).pk_id;
  try {
    const row = await withDb(async (db) =>
      (await db.query(`SELECT total_emission::text AS t, emission_factor_snapshot->>'factor_value' AS f FROM emission WHERE pk_id = $1`, [id])).rows[0],
    );
    assert.equal(row.f, "0.00012345");
    // 1,000,000 litre × 0.00012345 kg / 1000 = 0.12345 t, stored at 2 dp as today.
    assert.equal(row.t, "0.12");
  } finally {
    await withDb((db) => db.query(`DELETE FROM emission WHERE pk_id = $1`, [id]));
  }
});

test("migrate:scope3-factor-meta backfills untyped factors and is safe to run twice", async () => {
  const before = await withDb(async (db) =>
    (await db.query(`SELECT emission_factor_id AS id FROM emission_factors WHERE factor_type IS NULL`)).rows.map((r) => r.id),
  );
  const ids = [];
  try {
    await withDb(async (db) => {
      const add = async (category_id, name, unit, source) =>
        ids.push(
          (await db.query(
            `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name)
             VALUES (1, $1, 2011, 1, $2, $3, $4) RETURNING emission_factor_id AS id`,
            [category_id, unit, source, name],
          )).rows[0].id,
        );
      await add(1, "S3-2 bf diesel", "litre", "DEFRA 2011 (AR5)");
      await add(3, "S3-2 bf flight", "passenger.km", "DESNZ freighting goods + WTT, summed");
      await add(5, "S3-2 bf wtt", "litre", "IEA");
      await add(4, "S3-2 bf renewable", "kwh", null);
    });
    const script = path.resolve("dist/scripts/migrateScope3FactorMeta.js");
    for (const pass of [1, 2]) {
      const run = spawnSync(process.execPath, [script], { env: process.env, encoding: "utf8" });
      assert.equal(run.status, 0, `pass ${pass}: ${run.stderr}`);
    }
    const rows = await withDb(async (db) =>
      (await db.query(
        `SELECT emission_category_name AS n, factor_type, includes_wtt, gwp_set, dataset FROM emission_factors WHERE emission_factor_id = ANY($1) ORDER BY emission_factor_id`,
        [ids],
      )).rows,
    );
    assert.deepEqual(rows, [
      { n: "S3-2 bf diesel", factor_type: "combustion", includes_wtt: false, gwp_set: "AR5", dataset: "DEFRA" },
      { n: "S3-2 bf flight", factor_type: "life_cycle", includes_wtt: true, gwp_set: null, dataset: "DEFRA" },
      { n: "S3-2 bf wtt", factor_type: "wtt", includes_wtt: false, gwp_set: null, dataset: "IEA" },
      { n: "S3-2 bf renewable", factor_type: "other", includes_wtt: false, gwp_set: null, dataset: null },
    ]);
    // A typed factor is never overwritten by a later run.
    await withDb((db) => db.query(`UPDATE emission_factors SET factor_type = 'process' WHERE emission_factor_id = $1`, [ids[3]]));
    const again = spawnSync(process.execPath, [script], { env: process.env, encoding: "utf8" });
    assert.equal(again.status, 0, again.stderr);
    const kept = await withDb(async (db) => (await db.query(`SELECT factor_type FROM emission_factors WHERE emission_factor_id = $1`, [ids[3]])).rows[0]);
    assert.equal(kept.factor_type, "process");
  } finally {
    await withDb(async (db) => {
      await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1)`, [ids]);
      // Leave the shared fixture as it was for the other test files.
      await db.query(`UPDATE emission_factors SET factor_type = NULL, includes_wtt = false, gwp_set = NULL, dataset = NULL WHERE emission_factor_id = ANY($1)`, [before]);
    });
  }
});
