// C03: the stored result detail and audit trail behind the footprint result page.
// Site 2 in 2020 so other tests' months stay untouched. Placeholder numbers:
// S1+S2 1,000 t, the product makes all 10,000 t, so A3 energy is 0.1 kg per kg.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const ids = { products: [], emissions: [], production: [], factors: [] };
let rod;

test.before(async () => {
  await withDb(async (db) => {
    rod = (await db.query(
      `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES ('Result rod', 'tonnes', 2, 'kg', 1, 1) RETURNING product_id`,
    )).rows[0].product_id;
    ids.products = [rod];
    ids.production = (await db.query(
      `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
         VALUES ($1, 2, 10000, 't', '2020-01-01', '2020-12-31', 'approved', 7) RETURNING production_id`, [rod],
    )).rows.map((r) => r.production_id);
    ids.emissions = (await db.query(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type) VALUES
         ('{}', 600, 'tCO2e', '2020-12-31', 'approved', 7, 1, 2, 'yearly', 'CY'),
         ('{}', 400, 'tCO2e', '2020-12-31', 'approved', 7, 2, 2, 'yearly', 'CY')
       RETURNING pk_id`,
    )).rows.map((r) => r.pk_id);
  });
  const mk = async (who, body) => (await call("POST", "/pcf/material-factors", who, { material_group: "aluminium", unit: "kg", ...body })).json.material_factor_id;
  ids.factors = [
    await mk("manager", { name: "Result primary alu", value_kgco2e: 8 }),
    await mk("manager", { name: "Result recycled alu", value_kgco2e: 0.5, recycled_variant: true }),
    await mk("manager", { name: "Result wood", value_kgco2e: 0.2 }),
    await mk("superadmin", { name: "Result licensed alloy", value_kgco2e: 3.21, licence: "ecoinvent" }),
  ];
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM audit_log WHERE entity_type = 'pcf_study' AND entity_id IN (SELECT pcf_study_id FROM pcf_study WHERE product_id = ANY($1))", [ids.products]);
    await db.query("DELETE FROM pcf_study WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [ids.emissions]);
    await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [ids.production]);
    await db.query("DELETE FROM product WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = ANY($1)", [ids.factors]);
  });
});

const study = async (lines) => {
  const res = await call("POST", "/pcf/studies", "manager", { product_id: rod, reference_start: "2020-01-01", reference_end: "2020-12-31" });
  assert.equal(res.status, 201);
  const id = res.json.pcf_study_id;
  assert.equal((await call("PUT", `/pcf/studies/${id}/inputs`, "manager", { inputs: lines })).status, 200);
  return id;
};

test("result detail: lines with shares, factors, levers, allocation rows and recycled content", async () => {
  const [alu, rec, wood] = ids.factors;
  const id = await study([
    { stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu, recycled_material_factor_id: rec, recycled_share_pct: 20 },
    { stage: "A3_packaging", name: "Pallet", unit: "kg", quantity: 0.5, material_factor_id: wood },
  ]);
  assert.equal((await call("GET", `/pcf/studies/${id}/result`, "manager")).status, 404); // not calculated yet
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);

  const res = await call("GET", `/pcf/studies/${id}/result`, "manager");
  assert.equal(res.status, 200);
  const r = res.json;
  const a1 = 0.8 * 8 + 0.2 * 0.5; // 6.5
  const total = a1 + 0.1 + 0.1;
  close(r.total_kg_per_unit, total, "total");
  close(r.by_stage.A1, a1, "A1");
  close(r.by_stage.A3_energy, 0.1, "A3 energy");
  assert.deepEqual(r.hidden_stages, []);
  close(r.recycled_input_pct, 20, "recycled content");
  assert.ok(r.dqr && typeof r.dqr.overall === "number");
  assert.equal(typeof r.primary_data_share_pct, "number");

  const alLine = r.lines.find((l) => l.name === "Aluminium");
  close(alLine.kgco2e_per_unit, a1, "line");
  close(alLine.share_pct, (a1 / total) * 100, "share");
  assert.equal(alLine.factor.name, "Result primary alu");
  assert.equal(alLine.factor.value_kgco2e, 8);
  assert.equal(alLine.recycled_factor.name, "Result recycled alu");
  assert.equal(typeof alLine.pcf_input_id, "number");
  // +10 pts recycled: 0.1 × (0.5 − 8) = −0.75 kg per kg.
  close(alLine.lever_kg_per_10pts, -0.75, "lever");
  assert.equal(r.lines.find((l) => l.name === "Pallet").lever_kg_per_10pts, null);

  close(r.allocation.share_pct, 100, "allocation share");
  assert.equal(r.allocation.key, "mass");
  assert.deepEqual(r.allocations.map((a) => [a.scope, a.period_total_tco2e]), [[1, 600], [2, 400]]);
  close(r.allocations.reduce((s, a) => s + a.allocated_kg_per_unit, 0), 0.1, "allocated");
  assert.deepEqual([...r.emission_ids_used].sort(), [...ids.emissions].sort());
  assert.deepEqual(r.production_ids_used, ids.production);
  assert.equal(r.is_draft, true);
  assert.equal(r.calculated_by.user_id, 2);

  assert.equal((await call("GET", `/pcf/studies/${id}/result`, "otherManager")).status, 404);
  assert.equal((await call("GET", `/pcf/studies/${id}/result`, "user")).status, 403);
});

test("result detail hides licensed values from managers but not from superadmins", async () => {
  const [, , wood, lic] = ids.factors;
  const id = await study([
    { stage: "A1", name: "Licensed alloy", unit: "kg", quantity: 1, material_factor_id: lic },
    { stage: "A3_packaging", name: "Pallet", unit: "kg", quantity: 1, material_factor_id: wood },
  ]);
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
  const m = await call("GET", `/pcf/studies/${id}/result`, "manager");
  assert.equal(m.status, 200);
  assert.equal(JSON.stringify(m.json).includes("3.21"), false);
  const line = m.json.lines.find((l) => l.name === "Licensed alloy");
  assert.equal(line.kgco2e_per_unit, null);
  assert.equal(line.share_pct, null);
  assert.equal(line.value_hidden, true);
  assert.equal(line.factor.name, "Result licensed alloy");
  assert.equal(line.factor.value_kgco2e, null);
  assert.equal(m.json.by_stage.A1, null);
  for (const k of ["primary_data_share_pct", "dqr", "fossil_kg_per_unit", "biogenic_kg_per_unit"]) assert.equal(m.json[k], null, k);
  assert.equal(m.json.cut_off.below_threshold_ids, null);
  close(m.json.total_kg_per_unit, 3.21 + 0.2 + 0.1, "total stays visible");

  const s = (await call("GET", `/pcf/studies/${id}/result`, "superadmin")).json;
  assert.equal(s.lines.find((l) => l.name === "Licensed alloy").factor.value_kgco2e, 3.21);
  close(s.by_stage.A1, 3.21, "A1 for superadmin");
});

test("result detail still hides the licensed stage for a result stored without engine lines", async () => {
  // Results calculated before the engine lines were kept in cut_off: the
  // redaction must fall back to the snapshot inputs, not show A1 in the open.
  const [, , wood, lic] = ids.factors;
  const id = await study([
    { stage: "A1", name: "Licensed alloy", unit: "kg", quantity: 1, material_factor_id: lic },
    { stage: "A3_packaging", name: "Pallet", unit: "kg", quantity: 1, material_factor_id: wood },
  ]);
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
  await withDb((db) => db.query("UPDATE pcf_result SET cut_off = cut_off - 'lines' WHERE pcf_study_id = $1", [id]));
  const m = await call("GET", `/pcf/studies/${id}/result`, "manager");
  assert.equal(m.status, 200);
  assert.equal(m.json.lines.length, 0);
  assert.equal(m.json.by_stage.A1, null);
  assert.deepEqual(m.json.hidden_stages, ["A1"]);
  assert.equal(JSON.stringify(m.json).includes("3.21"), false);
  close((await call("GET", `/pcf/studies/${id}/result`, "superadmin")).json.by_stage.A1, 3.21, "A1 for superadmin");
});

test("audit trail lists the study's history, newest first", async () => {
  const [alu] = ids.factors;
  const id = await study([{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu }]);
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager", { comment: "Ready" })).status, 200);
  const res = await call("GET", `/pcf/studies/${id}/audit`, "manager");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.map((l) => l.action).slice(0, 2), ["submit", "calculate"]);
  assert.equal(res.json[0].changed_by.user_id, 2);
  assert.equal((await call("GET", `/pcf/studies/${id}/audit`, "otherManager")).status, 404);
  assert.equal((await call("GET", `/pcf/studies/${id}/audit`, "user")).status, 403);
});
