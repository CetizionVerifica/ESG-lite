// E1 part 4: allocation preview, calculate, review flow and reconciliation.
// Plant data mirrors the PCF-0 golden pilot (placeholder numbers): S1+S2
// 60,750 t, the product makes 120,000 t of the site's 300,000 t, so A3 energy
// is 0.2025 kg CO2e per kg. Uses site 2 in 2023 so other tests' months stay untouched.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const ids = { products: [], emissions: [], production: [] };
let rod, alloy, alu;

test.before(async () => {
  await withDb(async (db) => {
    const p = await db.query(
      `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES
         ('Flow rod', 'tonnes', 2, 'kg', 1, 1), ('Flow alloy', 'tonnes', 2, NULL, NULL, NULL) RETURNING product_id`,
    );
    [rod, alloy] = p.rows.map((r) => r.product_id);
    ids.products = [rod, alloy];
    const pr = await db.query(
      `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
         ($1, 2, 120000, 'tonnes', '2023-01-01', '2023-12-31', 'approved', 7),
         ($2, 2, 180000, 't',      '2023-01-01', '2023-12-31', 'approved', 7),
         ($2, 2, 999,    't',      '2021-01-01', '2021-06-30', 'approved', 7),
         ($1, 2, 5000,   't',      '2023-02-01', '2023-02-28', 'pending',  7)
       RETURNING production_id`,
      [rod, alloy],
    );
    ids.production = pr.rows.map((r) => r.production_id);
    const em = await db.query(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type) VALUES
         ('{}', 18000, 'tCO2e', '2023-05-31', 'approved', 7, 1, 2, 'monthly', NULL),
         ('{}', 750,   'tCO2e', '2023-11-30', 'approved', 7, 1, 2, 'monthly', NULL),
         ('{}', 42000, 'tCO2e', '2023-12-31', 'approved', 7, 2, 2, 'yearly',  'CY'),
         ('{}', 100,   'tCO2e', '2023-06-30', 'approved', 7, 3, 2, 'monthly', NULL),
         ('{}', 70,    'tCO2e', '2023-06-30', 'approved', 7, 4, 2, 'monthly', NULL),
         ('{}', 5000,  'tCO2e', '2021-03-31', 'approved', 7, 2, 2, 'yearly',  'FY'),
         ('{}', 9999,  'tCO2e', '2023-07-31', 'pending',  7, 1, 2, 'monthly', NULL)
       RETURNING pk_id`,
    );
    ids.emissions = em.rows.map((r) => r.pk_id);
  });
  const f = await call("POST", "/pcf/material-factors", "manager", { name: "Flow primary alu", material_group: "aluminium", unit: "kg", value_kgco2e: 8.6 });
  alu = f.json.material_factor_id;
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM pcf_study WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [ids.emissions]);
    await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [ids.production]);
    await db.query("DELETE FROM product WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = $1", [alu]);
  });
});

const newStudy = async (extra = {}) => {
  const res = await call("POST", "/pcf/studies", "manager", { product_id: rod, reference_start: "2023-01-01", reference_end: "2023-12-31", ...extra });
  assert.equal(res.status, 201);
  return res.json.pcf_study_id;
};
const setLines = (id) =>
  call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu }],
  });

test("allocation preview: approved Scope 1+2 only, mass key", async () => {
  const id = await newStudy();
  const res = await call("GET", `/pcf/studies/${id}/allocation-preview`, "manager");
  assert.equal(res.status, 200);
  const p = res.json;
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.sources.map((s) => [s.category_id, s.scope, s.period_total_tco2e]), [[1, 1, 18750], [2, 2, 42000]]);
  assert.equal(p.plant_s1_s2_tco2e, 60750);
  assert.equal(p.key_value_product, 120000);
  assert.equal(p.key_value_site_total, 300000);
  close(p.share_pct, 40, "share");
  assert.equal(p.product_output_units, 120000000);
  close(p.a3_energy_kg_per_unit, 0.2025, "A3 energy");
  assert.deepEqual(p.excluded, []);
  assert.deepEqual(p.production_ids_used, ids.production.slice(0, 2));

  assert.equal((await call("GET", `/pcf/studies/${id}/allocation-preview`, "otherManager")).status, 404);
  assert.equal((await call("GET", `/pcf/studies/${id}/allocation-preview`, "user")).status, 403);
  await call("DELETE", `/pcf/studies/${id}`, "manager");
});

test("rows only partly inside the period are listed and block the calculation", async () => {
  const id = await newStudy();
  await setLines(id);
  const extra = await withDb(async (db) => ({
    e: (await db.query(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type)
          VALUES ('{}', 5000, 'tCO2e', '2023-03-31', 'approved', 7, 2, 2, 'yearly', 'FY') RETURNING pk_id`)).rows[0].pk_id,
    p: (await db.query(`INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
          VALUES ($1, 2, 999, 't', '2022-07-01', '2023-06-30', 'approved', 7) RETURNING production_id`, [alloy])).rows[0].production_id,
  }));
  try {
    const p = (await call("GET", `/pcf/studies/${id}/allocation-preview`, "manager")).json;
    assert.deepEqual(p.excluded.map((e) => [e.kind, e.id]), [["emission", extra.e], ["production", extra.p]]);
    assert.equal(p.blockers.length, 2);
    assert.equal(p.a3_energy_kg_per_unit, null);
    assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 400);
  } finally {
    await withDb(async (db) => {
      await db.query("DELETE FROM emission WHERE pk_id = $1", [extra.e]);
      await db.query("DELETE FROM production_data WHERE production_id = $1", [extra.p]);
    });
  }
  await call("DELETE", `/pcf/studies/${id}`, "manager");
});

test("licensed (ecoinvent) line values stay hidden from managers", async () => {
  const lic = await call("POST", "/pcf/material-factors", "superadmin", {
    name: "Flow licensed alloy", material_group: "aluminium", unit: "kg", value_kgco2e: 12.345, licence: "ecoinvent",
  });
  const id = await newStudy();
  await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [
      { stage: "A1", name: "Licensed alloy", unit: "kg", quantity: 1, material_factor_id: lic.json.material_factor_id },
      { stage: "A3_packaging", name: "Pallet", unit: "kg", quantity: 1, material_factor_id: alu },
    ],
  });
  const calc = await call("POST", `/pcf/studies/${id}/calculate`, "manager", {});
  assert.equal(calc.status, 200);
  assert.equal(JSON.stringify(calc.json).includes("12.345"), false);
  const line = calc.json.result.lines.find((l) => l.name === "Licensed alloy");
  assert.equal(line.kgco2e_per_unit, null);
  assert.equal(line.value_hidden, true);
  assert.equal(calc.json.result.by_stage.A1, null);
  assert.deepEqual(calc.json.result.hidden_stages, ["A1"]);
  assert.equal(calc.json.result.by_stage.A3_packaging, 8.6);
  close(calc.json.result.total_kg_per_unit, 12.345 + 8.6 + 0.2025, "total");
  for (const k of ["primary_data_share_pct", "dqr", "fossil_kg_per_unit", "biogenic_kg_per_unit"]) assert.equal(calc.json.result[k], null, k);
  assert.equal(calc.json.result.cut_off.below_threshold_ids, null);
  assert.equal(calc.json.result.cut_off.below_threshold_total_pct, null);
  assert.equal(line.cut_off_candidate, null);
  const asManager = (await call("GET", `/pcf/studies/${id}`, "manager")).json.result;
  assert.equal(asManager.by_stage.A1, null);
  assert.equal(asManager.primary_data_share_pct, null);
  assert.equal(asManager.dqr_overall, null);
  const asSuper = (await call("GET", `/pcf/studies/${id}`, "superadmin")).json.result;
  close(asSuper.by_stage.A1, 12.345, "A1 for superadmin");
  assert.deepEqual(asSuper.hidden_stages, []);
  assert.equal(typeof asSuper.primary_data_share_pct, "number");
  await call("DELETE", `/pcf/studies/${id}`, "manager");
  await withDb((db) => db.query("DELETE FROM material_factor WHERE material_factor_id = $1", [lic.json.material_factor_id]));
});

test("AI lines without a confirmed confidence block the calculation", async () => {
  const id = await newStudy();
  await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu, ai_suggested: true }],
  });
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 400);
  await call("DELETE", `/pcf/studies/${id}`, "manager");
});

test("allocation preview: other keys need the key values", async () => {
  const id = await newStudy({ allocation_key: "energy" });
  const none = await call("GET", `/pcf/studies/${id}/allocation-preview`, "manager");
  assert.equal(none.json.blockers.length, 1);
  assert.equal(none.json.a3_energy_kg_per_unit, null);
  const given = await call("GET", `/pcf/studies/${id}/allocation-preview?key_value_product=25&key_value_site_total=100`, "manager");
  assert.deepEqual(given.json.blockers, []);
  close(given.json.share_pct, 25, "share");
  close(given.json.a3_energy_kg_per_unit, (60750 * 1000 * 0.25) / 120000000, "A3 energy");
  const bad = await call("GET", `/pcf/studies/${id}/allocation-preview?key_value_product=200&key_value_site_total=100`, "manager");
  assert.equal(bad.json.blockers.length, 1);
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 400);
  await call("DELETE", `/pcf/studies/${id}`, "manager");
});

test("a product without declared unit data cannot be calculated", async () => {
  const res = await call("POST", "/pcf/studies", "manager", { product_id: alloy, reference_start: "2023-01-01", reference_end: "2023-12-31" });
  const p = await call("GET", `/pcf/studies/${res.json.pcf_study_id}/allocation-preview`, "manager");
  assert.match(p.json.blockers[0], /declared unit/);
  await call("DELETE", `/pcf/studies/${res.json.pcf_study_id}`, "manager");
});

test("calculate, review, publish, reconcile, then a new version supersedes it", async () => {
  const id = await newStudy();
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 400); // no lines yet
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 409); // not calculated

  await setLines(id);
  const calc = await call("POST", `/pcf/studies/${id}/calculate`, "manager", {});
  assert.equal(calc.status, 200);
  const r = calc.json.result;
  close(r.total_kg_per_unit, 8.6 + 0.2025, "total");
  close(r.by_stage.A1, 8.6, "A1");
  close(r.by_stage.A3_energy, 0.2025, "A3 energy");
  assert.equal(r.is_draft, true);
  assert.equal(r.lines.filter((l) => l.stage === "A3_energy").length, 2);

  await withDb(async (db) => {
    const row = (await db.query("SELECT * FROM pcf_result WHERE pcf_study_id = $1", [id])).rows[0];
    assert.deepEqual(row.emission_ids_used, ids.emissions.slice(0, 3));
    assert.deepEqual(row.production_ids_used, ids.production.slice(0, 2));
    assert.equal(row.factor_snapshot.engine_version, "pcf-1.0.0");
    const allocs = (await db.query("SELECT * FROM pcf_allocation WHERE pcf_study_id = $1 ORDER BY scope", [id])).rows;
    assert.deepEqual(allocs.map((a) => [a.category_name, Number(a.period_total_tco2e), Number(a.share_pct)]), [
      ["Stationary Combustion", 18750, 40],
      ["Purchased Electricity", 42000, 40],
    ]);
  });

  // A result that no longer matches its lines can't go for review.
  await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1.01, material_factor_id: alu }],
  });
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 409);
  await setLines(id);
  await call("POST", `/pcf/studies/${id}/calculate`, "manager", {});

  const submitted = await call("POST", `/pcf/studies/${id}/submit`, "manager");
  assert.equal(submitted.status, 200);
  assert.equal(submitted.json.status, "in_review");
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 409);
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 409);

  // Approver must differ from the creator; reject needs a reason.
  const self = await call("POST", `/pcf/studies/${id}/approve`, "manager");
  assert.equal(self.status, 403);
  assert.equal((await call("POST", `/pcf/studies/${id}/approve`, "otherManager")).status, 404);
  assert.equal((await call("POST", `/pcf/studies/${id}/reject`, "superadmin", { comment: "no" })).status, 400);
  const rejected = await call("POST", `/pcf/studies/${id}/reject`, "superadmin", { comment: "Check the alloy share" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.status, "draft");
  assert.equal(rejected.json.review_comment, "Check the alloy share");

  // Nothing changed, so the same result can be sent again without recalculating.
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 200);
  const approved = await call("POST", `/pcf/studies/${id}/approve`, "superadmin", { comment: "OK" });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");
  assert.equal(approved.json.reviewed_by.user_id, 5);
  assert.equal(approved.json.result.is_draft, false);
  assert.equal((await call("PUT", `/pcf/studies/${id}/inputs`, "manager", { inputs: [] })).status, 409);

  const published = await call("POST", `/pcf/studies/${id}/publish`, "manager");
  assert.equal(published.status, 200);
  assert.equal(published.json.status, "published");

  const rec = await call("GET", "/pcf/reconciliation?siteId=2&start=2023-01-01&end=2023-12-31", "manager");
  assert.equal(rec.status, 200);
  assert.equal(rec.json.plant_s1_s2_tco2e, 60750);
  close(rec.json.covered_tco2e, 24300, "covered");
  close(rec.json.coverage_pct, 40, "coverage");
  assert.deepEqual(rec.json.products.map((p) => [p.pcf_study_id, p.status]), [[id, "published"]]);
  assert.equal((await call("GET", "/pcf/reconciliation?siteId=2&start=2023-01-01&end=2023-12-31", "otherManager")).status, 404);
  assert.equal((await call("GET", "/pcf/reconciliation?siteId=2", "manager")).status, 400);

  // Version 2 goes through the same flow and supersedes version 1 on publish.
  const v2 = (await call("POST", "/pcf/studies", "manager", { copy_from_id: id })).json.pcf_study_id;
  assert.equal((await call("POST", `/pcf/studies/${v2}/calculate`, "manager", {})).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v2}/submit`, "manager")).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v2}/approve`, "superadmin")).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v2}/publish`, "superadmin")).status, 200);
  assert.equal((await call("GET", `/pcf/studies/${id}`, "manager")).json.status, "superseded");

  // Whoever calculated the result can't approve it either.
  const v3 = (await call("POST", "/pcf/studies", "manager", { copy_from_id: v2 })).json.pcf_study_id;
  assert.equal((await call("POST", `/pcf/studies/${v3}/calculate`, "superadmin", {})).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v3}/submit`, "manager")).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v3}/approve`, "superadmin")).status, 403);

  await withDb(async (db) => {
    const actions = (await db.query("SELECT action FROM audit_log WHERE entity_type = 'pcf_study' AND entity_id = $1 ORDER BY id", [id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ["calculate", "calculate", "submit", "reject", "submit", "approve", "publish", "superseded"]);
  });
});

test("two licensed lines in different stages can't be solved for from the cut-off, primary share or DQR", async () => {
  const mk = (name, value) =>
    call("POST", "/pcf/material-factors", "superadmin", { name, material_group: "m", unit: "kg", value_kgco2e: value, licence: "ecoinvent" })
      .then((r) => r.json.material_factor_id);
  const big = await mk("Flow licensed big", 3.71);
  const small = await mk("Flow licensed small", 6.83);
  const id = await newStudy();
  await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [
      { stage: "A1", name: "Licensed big", unit: "kg", quantity: 1, material_factor_id: big, data_type: "primary", dqr_technology: 1 },
      { stage: "A1", name: "Visible alu", unit: "kg", quantity: 1, material_factor_id: alu },
      { stage: "A3_packaging", name: "Licensed small", unit: "kg", quantity: 0.001, material_factor_id: small },
    ],
  });
  const calc = await call("POST", `/pcf/studies/${id}/calculate`, "manager", {});
  assert.equal(calc.status, 200);
  const r = calc.json.result;
  const body = JSON.stringify(calc.json);
  assert.equal(body.includes("3.71"), false);
  assert.equal(body.includes("6.83"), false);
  assert.deepEqual(r.hidden_stages.sort(), ["A1", "A3_packaging"]);
  assert.equal(r.by_stage.A1, null);
  assert.equal(r.by_stage.A3_packaging, null);
  assert.equal(r.cut_off.below_threshold_total_pct, null);
  assert.equal(r.cut_off.below_threshold_ids, null);
  assert.equal(typeof r.cut_off.within_limit, "boolean");
  assert.equal(r.primary_data_share_pct, null);
  assert.equal(r.dqr, null);
  assert.equal(r.lines.find((l) => l.name === "Visible alu").kgco2e_per_unit, 8.6);
  const asSuper = (await call("GET", `/pcf/studies/${id}`, "superadmin")).json.result;
  close(asSuper.by_stage.A3_packaging, 0.00683, "small for superadmin");
  await call("DELETE", `/pcf/studies/${id}`, "manager");
  await withDb((db) => db.query("DELETE FROM material_factor WHERE material_factor_id = ANY($1)", [[big, small]]));
});

test("approve re-checks the result against today's factors; a non-text comment is ignored", async () => {
  const own = (await call("POST", "/pcf/material-factors", "manager", { name: "Flow changing alu", material_group: "m", unit: "kg", value_kgco2e: 2 })).json
    .material_factor_id;
  const id = await newStudy();
  await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
    inputs: [{ stage: "A1", name: "Changing", unit: "kg", quantity: 1, material_factor_id: own }],
  });
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager", { comment: { not: "text" } })).status, 200);
  assert.equal((await call("PATCH", `/pcf/material-factors/${own}`, "manager", { value_kgco2e: 2.5 })).status, 200);
  const res = await call("POST", `/pcf/studies/${id}/approve`, "superadmin");
  assert.equal(res.status, 409);
  assert.match(res.json.message, /send it back to draft/);
  assert.equal((await call("GET", `/pcf/studies/${id}`, "manager")).json.status, "in_review");
  await withDb(async (db) => {
    const reasons = (await db.query("SELECT reason FROM audit_log WHERE entity_type = 'pcf_study' AND entity_id = $1 AND action = 'submit'", [id])).rows;
    assert.deepEqual(reasons, [{ reason: null }]);
    await db.query("DELETE FROM pcf_study WHERE pcf_study_id = $1", [id]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = $1", [own]);
  });
});

// The PCF-0 pilot entered through the API (site 2, CY 2019) must give the
// golden spreadsheet's figures within its tolerance.
test("golden: the PCF-0 pilot through /pcf gives the spreadsheet's numbers", async () => {
  const g = JSON.parse(require("node:fs").readFileSync(require("node:path").resolve("docs/pcf/phase0/pilot-golden.json"), "utf8"));
  const tol = g.tolerance_pct;
  const near = (a, b, msg) =>
    b === 0 ? assert.ok(Math.abs(a) < 1e-12, `${msg}: ${a}`) : assert.ok((Math.abs(a - b) / Math.abs(b)) * 100 <= tol, `${msg}: ${a} vs ${b}`);
  const made = { factors: [], products: [], emissions: [], production: [] };
  try {
    for (const f of g.factors) {
      const res = await call("POST", "/pcf/material-factors", "manager", { name: `Golden ${f.id}`, material_group: f.material_group, unit: f.unit, value_kgco2e: f.value_kgco2e });
      assert.equal(res.status, 201);
      made.factors.push([f.id, res.json.material_factor_id]);
    }
    const fid = Object.fromEntries(made.factors);
    await withDb(async (db) => {
      const pilot = g.production_approved_t.find((p) => p.is_pilot);
      const others = g.production_approved_t.filter((p) => !p.is_pilot);
      made.products = (await db.query(
        `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES
           ('Golden pilot rod', 'tonnes', 2, $1, 1, $2), ('Golden other products', 'tonnes', 2, NULL, NULL, NULL) RETURNING product_id`,
        [g.study.declared_unit, g.study.mass_per_unit_kg],
      )).rows.map((r) => r.product_id);
      for (const [product, qty] of [[made.products[0], pilot.quantity_t], [made.products[1], others.reduce((s, p) => s + p.quantity_t, 0)]]) {
        made.production.push((await db.query(
          `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
           VALUES ($1, 2, $2, 'tonnes', '2019-01-01', '2019-12-31', 'approved', 7) RETURNING production_id`, [product, qty],
        )).rows[0].production_id);
      }
      for (const e of g.plant_emissions_approved) {
        made.emissions.push((await db.query(
          `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type)
           VALUES ('{}', $1, 'tCO2e', '2019-12-31', 'approved', 7, $2, 2, 'yearly', 'CY') RETURNING pk_id`, [e.period_total_tco2e, e.scope === 1 ? 1 : 2],
        )).rows[0].pk_id);
      }
    });
    const study = await call("POST", "/pcf/studies", "manager", {
      product_id: made.products[0], reference_start: "2019-01-01", reference_end: "2019-12-31", cut_off_rule_pct: g.study.cut_off_rule_pct,
    });
    assert.equal(study.status, 201);
    const id = study.json.pcf_study_id;
    const dqr = (x) => ({ dqr_technology: x.dqr_technology, dqr_geography: x.dqr_geography, dqr_time: x.dqr_time });
    const inputs = [
      ...g.inputs.map((i) => ({
        stage: i.stage, name: i.name, unit: i.unit, quantity: i.quantity, material_factor_id: fid[i.material_factor_id],
        recycled_material_factor_id: i.recycled_factor_id ? fid[i.recycled_factor_id] : null, recycled_share_pct: i.recycled_share_pct,
        data_type: i.data_type, ...dqr(i),
      })),
      ...g.transport_legs.map((t) => ({
        stage: "A2", name: t.name, unit: "t", material_factor_id: fid[t.factor_id], payload_t: t.mass_t_per_unit, distance_km: t.distance_km,
        data_type: t.data_type, ...dqr(t),
      })),
    ];
    const put = await call("PUT", `/pcf/studies/${id}/inputs`, "manager", { inputs });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const calc = await call("POST", `/pcf/studies/${id}/calculate`, "manager", {});
    assert.equal(calc.status, 200, JSON.stringify(calc.json));
    const r = calc.json.result;
    const x = g.expected;
    for (const k of ["total_kg_per_unit", "fossil_kg_per_unit", "biogenic_kg_per_unit", "aircraft_kg_per_unit", "luc_kg_per_unit", "primary_data_share_pct"]) near(r[k], x[k], k);
    for (const [k, v] of Object.entries(x.by_stage)) near(r.by_stage[k], v, `by_stage.${k}`);
    for (const [k, v] of Object.entries(x.dqr)) near(r.dqr[k], v, `dqr.${k}`);
    near(r.allocation.share_pct, x.allocation.share_pct, "allocation.share_pct");
    near(r.allocation.product_output_units, x.allocation.product_output_units, "allocation.product_output_units");
    near(r.cut_off.below_threshold_total_pct, x.cut_off.below_threshold_total_pct, "cut_off.below_threshold_total_pct");
    assert.equal(r.cut_off.within_limit, x.cut_off.within_limit);
    assert.equal(r.cut_off.below_threshold_ids.length, x.cut_off.below_threshold_ids.length);
  } finally {
    await withDb(async (db) => {
      await db.query("DELETE FROM pcf_study WHERE product_id = ANY($1)", [made.products]);
      await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [made.emissions]);
      await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [made.production]);
      await db.query("DELETE FROM product WHERE product_id = ANY($1)", [made.products]);
      await db.query("DELETE FROM material_factor WHERE material_factor_id = ANY($1)", [made.factors.map(([, v]) => v)]);
    });
  }
});
