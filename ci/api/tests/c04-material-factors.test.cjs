// C04: material factor usage counts, duplicate check and sheet import.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const made = [];
let product;

test.before(async () => {
  await withDb(async (db) => {
    const p = await db.query(
      `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg)
       VALUES ('C04 rod', 'tonnes', 1, 'kg', 1, 1) RETURNING product_id`,
    );
    product = p.rows[0].product_id;
  });
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM pcf_study WHERE product_id = $1", [product]);
    await db.query("DELETE FROM product WHERE product_id = $1", [product]);
    await db.query("DELETE FROM material_factor WHERE name ILIKE 'C04 %'");
  });
});

const factor = (extra) => ({ material_group: "aluminium", unit: "kg", value_kgco2e: 8.6, ...extra });

test("one factor per name, geography, year and company", async () => {
  const first = await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 dup alu", geography: "BH", source_year: 2024 }));
  assert.equal(first.status, 201);
  const id = first.json.material_factor_id;
  assert.equal(first.json.used_by, 0);

  const again = await call("POST", "/pcf/material-factors", "manager", factor({ name: "  c04 DUP alu ", geography: "bh ", source_year: 2024 }));
  assert.equal(again.status, 409);
  assert.equal(again.json.existing_id, id);

  // Another year, the global library and another company are all separate rows.
  const otherYear = await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 dup alu", geography: "BH", source_year: 2023 }));
  assert.equal(otherYear.status, 201);
  assert.equal((await call("POST", "/pcf/material-factors", "superadmin", factor({ name: "C04 dup alu", geography: "BH", source_year: 2024 }))).status, 201);
  assert.equal((await call("POST", "/pcf/material-factors", "otherManager", factor({ name: "C04 dup alu", geography: "BH", source_year: 2024 }))).status, 201);

  // An empty geography matches a missing one.
  assert.equal((await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 no geo" }))).status, 201);
  assert.equal((await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 no geo", geography: "  " }))).status, 409);

  // Editing into an existing key is refused; editing other fields is not.
  const clash = await call("PATCH", `/pcf/material-factors/${otherYear.json.material_factor_id}`, "manager", { source_year: 2024 });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.existing_id, id);
  assert.equal((await call("PATCH", `/pcf/material-factors/${id}`, "manager", { value_kgco2e: 9 })).status, 200);
  assert.equal((await call("PATCH", `/pcf/material-factors/${id}`, "manager", { name: "C04 dup alu", source: "IAI" })).status, 200);
});

test("import saves every row or none", async () => {
  const count = () => withDb(async (db) => Number((await db.query("SELECT count(*) FROM material_factor WHERE name LIKE 'C04 sheet%'")).rows[0].count));

  const invalid = await call("POST", "/pcf/material-factors/import", "manager", {
    rows: [
      factor({ name: "C04 sheet copper", material_group: "copper" }),
      factor({ name: "C04 sheet bad", value_kgco2e: -1 }),
      factor({ name: "C04 sheet licensed", licence: "ecoinvent" }),
      factor({ name: "c04 sheet COPPER", material_group: "copper" }),
      "not a row",
    ],
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json.errors.map((e) => e.index), [1, 2, 3, 4]);
  assert.equal(invalid.json.errors[2].duplicate_of_row, 0);
  assert.equal(await count(), 0);

  const existing = (await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 sheet steel", geography: "GLO" }))).json.material_factor_id;
  const dup = await call("POST", "/pcf/material-factors/import", "manager", {
    rows: [factor({ name: "C04 sheet copper" }), factor({ name: "C04 sheet steel", geography: "glo" })],
  });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.json.errors, [{ index: 1, message: "A factor with this name, geography and year already exists", existing_id: existing }]);
  assert.equal(await count(), 1);

  const ok = await call("POST", "/pcf/material-factors/import", "manager", {
    rows: [factor({ name: "C04 sheet copper", source: "ICA", source_year: 2022 }), factor({ name: "C04 sheet PVC", material_group: "polymer" })],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.created, 2);
  assert.deepEqual(ok.json.factors.map((f) => [f.name, f.company_id]), [["C04 sheet copper", 1], ["C04 sheet PVC", 1]]);

  assert.equal((await call("POST", "/pcf/material-factors/import", "manager", { rows: [] })).status, 400);
  assert.equal((await call("POST", "/pcf/material-factors/import", "manager", { company_id: 2, rows: [factor({ name: "C04 sheet x" })] })).status, 403);
  assert.equal((await call("POST", "/pcf/material-factors/import", "user", { rows: [factor({ name: "C04 sheet x" })] })).status, 403);

  const global = await call("POST", "/pcf/material-factors/import", "superadmin", {
    rows: [factor({ name: "C04 sheet licensed", licence: "ecoinvent" })],
  });
  assert.equal(global.status, 201);
  assert.equal(global.json.factors[0].company_id, null);
});

test("used by counts and lists only footprints the caller can see", async () => {
  const alu = (await call("POST", "/pcf/material-factors", "superadmin", factor({ name: "C04 used global", licence: "ecoinvent" }))).json
    .material_factor_id;
  const study = (await call("POST", "/pcf/studies", "manager", { product_id: product, reference_start: "2025-01-01", reference_end: "2025-12-31" })).json;
  const put = await call("PUT", `/pcf/studies/${study.pcf_study_id}/inputs`, "manager", {
    inputs: [
      { stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu },
      { stage: "A1", name: "Aluminium again", unit: "kg", quantity: 2, material_factor_id: alu },
    ],
  });
  assert.equal(put.status, 200);

  const listed = (await call("GET", "/pcf/material-factors?q=C04%20used", "manager")).json;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].used_by, 1, "two lines in one footprint count once");
  assert.equal(listed[0].used_by_approved, 0);
  assert.equal(listed[0].value_kgco2e, null, "licensed value stays hidden");

  await withDb((db) => db.query("UPDATE pcf_study SET status = 'approved' WHERE pcf_study_id = $1", [study.pcf_study_id]));
  const one = await call("GET", `/pcf/material-factors/${alu}`, "manager");
  assert.equal(one.status, 200);
  assert.equal(one.json.used_by_approved, 1);
  assert.equal(one.json.value_hidden, true);
  assert.deepEqual(one.json.used_in.map((u) => [u.pcf_study_id, u.product.name, u.status]), [[study.pcf_study_id, "C04 rod", "approved"]]);

  const theirs = await call("GET", `/pcf/material-factors/${alu}`, "otherManager");
  assert.equal(theirs.json.used_by, 0);
  assert.deepEqual(theirs.json.used_in, []);
  assert.equal((await call("GET", `/pcf/material-factors/${alu}`, "superadmin")).json.used_by, 1);

  const own = (await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 used own" }))).json.material_factor_id;
  assert.equal((await call("GET", `/pcf/material-factors/${own}`, "otherManager")).status, 404);
  assert.equal((await call("GET", "/pcf/material-factors/abc", "manager")).status, 404);
});

test("rows that were duplicates before C04 stay editable", async () => {
  const ids = await withDb(async (db) =>
    (
      await db.query(
        `INSERT INTO material_factor (company_id, name, material_group, unit, value_kgco2e, geography, source_year)
         VALUES (1, 'C04 legacy twin', 'steel', 'kg', 2, 'IN', 2020), (1, 'C04 legacy twin', 'steel', 'kg', 2.1, 'IN', 2020)
         RETURNING material_factor_id`,
      )
    ).rows.map((r) => r.material_factor_id),
  );
  // A full-form save that repeats the unchanged key goes through.
  const full = await call("PATCH", `/pcf/material-factors/${ids[1]}`, "manager", { name: "C04 legacy twin", geography: "in", source_year: 2020, value_kgco2e: 2.2 });
  assert.equal(full.status, 200);
  assert.equal(full.json.value_kgco2e, 2.2);
});

test("a dry run reports invalid and existing rows together and saves nothing", async () => {
  await call("POST", "/pcf/material-factors", "manager", factor({ name: "C04 dry existing" }));
  const before = await withDb(async (db) => Number((await db.query("SELECT count(*) FROM material_factor")).rows[0].count));
  const res = await call("POST", "/pcf/material-factors/import?dry_run=1", "manager", {
    rows: [factor({ name: "C04 dry new" }), factor({ name: "C04 dry bad", unit: "" }), factor({ name: "c04 DRY existing" })],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.valid, false);
  assert.deepEqual(res.json.errors.map((e) => [e.index, !!e.existing_id]), [[1, false], [2, true]]);
  const ok = await call("POST", "/pcf/material-factors/import?dry_run=1", "manager", { rows: [factor({ name: "C04 dry new" })] });
  assert.deepEqual(ok.json, { valid: true, rows: 1, errors: [] });
  const after = await withDb(async (db) => Number((await db.query("SELECT count(*) FROM material_factor")).rows[0].count));
  assert.equal(after, before);
});
