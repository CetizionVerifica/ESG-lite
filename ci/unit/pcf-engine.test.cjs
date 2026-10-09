// Unit tests for the PCF engine (E1). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const {
  computePcf,
  canonicalJson,
  makeSnapshot,
  regenerateFromSnapshot,
  PcfInputError,
} = require(path.resolve("dist/pcf/engine/computePcf.js"));

const DQR = { technology: 2, geography: 2, time: 2 };
const study = { cut_off_rule_pct: 1, cut_off_max_total_pct: 5 };
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b}`);

const factors = [
  { id: "AL", name: "Primary Al", unit: "kg", value_kgco2e: 10 },
  { id: "ALR", name: "Recycled Al", unit: "kg", value_kgco2e: 1 },
  { id: "ROAD", name: "Road", unit: "tonne.km", value_kgco2e: 0.2 },
  { id: "BOX", name: "Box", unit: "kg", value_kgco2e: 2 },
];
const line = (o) => ({ data_type: "secondary", dqr: DQR, recycled_share_pct: 0, unit: "kg", ...o });

test("A1: quantity × factor", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 2, factor_id: "AL" })] });
  close(r.by_stage.A1, 20);
  close(r.total_kg_per_unit, 20);
});

test("A1: recycled share splits the line (cut-off)", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 1, factor_id: "AL", recycled_factor_id: "ALR", recycled_share_pct: 25 })] });
  close(r.by_input.a, 0.75 * 10 + 0.25 * 1);
});

test("A1: tonnes convert to the factor's kg", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 0.001, unit: "t", factor_id: "AL" })] });
  close(r.by_input.a, 10);
});

test("A1: a unit that can't convert is refused, not guessed", () => {
  assert.throws(() => computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 1, unit: "m2", factor_id: "AL" })] }), PcfInputError);
});

test("A1: supplier PCF replaces the factor", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 2, factor_id: "AL", supplier_pcf_kgco2e: 4, data_type: "primary" })] });
  close(r.by_input.a, 8);
  close(r.primary_data_share_pct, 100);
});

test("A2: payload_t × distance_km × tonne.km factor", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "t", stage: "A2", name: "Leg", quantity: 0, unit: "tonne.km", factor_id: "ROAD", payload_t: 0.001, distance_km: 500 })] });
  close(r.by_stage.A2, 0.001 * 500 * 0.2);
});

test("A2: a leg without distance is refused", () => {
  assert.throws(() => computePcf({ study, factors, energy: [], allocation: null,
    inputs: [line({ id: "t", stage: "A2", name: "Leg", quantity: 0, factor_id: "ROAD", payload_t: 1 })] }), PcfInputError);
});

test("A3 packaging and waste: quantity × factor in their own stages", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null, inputs: [
    line({ id: "p", stage: "A3_packaging", name: "Box", quantity: 0.5, factor_id: "BOX" }),
    line({ id: "w", stage: "A3_waste", name: "Waste", quantity: 0.25, factor_id: "BOX" }),
  ] });
  close(r.by_stage.A3_packaging, 1);
  close(r.by_stage.A3_waste, 0.5);
});

test("A3 energy: one product takes the whole plant", () => {
  const r = computePcf({ study, factors, inputs: [],
    energy: [{ id: "e", category_name: "Gas", scope: 1, period_total_tco2e: 100 }],
    allocation: { key_value_product: 50, key_value_site_total: 50, product_output_units: 50000, dqr: { technology: 1, geography: 1, time: 1 } } });
  close(r.by_stage.A3_energy, 100 * 1000 / 50000);
  close(r.allocation.share_pct, 100);
});

test("A3 energy: many products share by the key, and the shares add up to the plant", () => {
  const energy = [{ id: "e1", category_name: "Gas", scope: 1, period_total_tco2e: 60 }, { id: "e2", category_name: "Power", scope: 2, period_total_tco2e: 40 }];
  const products = [30, 50, 20]; // tonnes; declared unit 1 kg
  const site = products.reduce((a, b) => a + b, 0);
  let covered = 0;
  for (const t of products) {
    const r = computePcf({ study, factors, inputs: [], energy,
      allocation: { key_value_product: t, key_value_site_total: site, product_output_units: t * 1000, dqr: DQR } });
    covered += r.by_stage.A3_energy * t * 1000 / 1000; // kg/unit × units → t
  }
  close(covered, 100, 1e-9);
});

test("A3 energy: Scope 3 is never allocated", () => {
  assert.throws(() => computePcf({ study, factors, inputs: [],
    energy: [{ id: "e", category_name: "Travel", scope: 3, period_total_tco2e: 1 }],
    allocation: { key_value_product: 1, key_value_site_total: 1, product_output_units: 1, dqr: DQR } }), PcfInputError);
});

test("cut-off: small lines are listed, stay in the total, and energy is never a candidate", () => {
  const r = computePcf({ study, factors,
    inputs: [line({ id: "big", stage: "A1", name: "Al", quantity: 1, factor_id: "AL" }),
             line({ id: "tiny", stage: "A3_packaging", name: "Box", quantity: 0.01, factor_id: "BOX" })],
    energy: [{ id: "e", category_name: "Gas", scope: 1, period_total_tco2e: 0.001 }],
    allocation: { key_value_product: 1, key_value_site_total: 1, product_output_units: 1000, dqr: DQR } });
  assert.deepEqual(r.cut_off.below_threshold_ids, ["tiny"]);
  close(r.total_kg_per_unit, 10 + 0.02 + 0.001);
  assert.equal(r.cut_off.within_limit, true);
});

test("primary share and emission-weighted DQR", () => {
  const r = computePcf({ study, factors, energy: [], allocation: null, inputs: [
    line({ id: "a", stage: "A1", name: "Al", quantity: 1, factor_id: "AL", data_type: "primary", dqr: { technology: 1, geography: 1, time: 1 } }),
    line({ id: "b", stage: "A1", name: "Al2", quantity: 3, factor_id: "AL", dqr: { technology: 3, geography: 3, time: 3 } }),
  ] });
  close(r.primary_data_share_pct, 25);
  close(r.dqr.overall, 0.25 * 1 + 0.75 * 3);
});

test("snapshot regenerates a byte-identical result", () => {
  const input = { study, factors, energy: [{ id: "e", category_name: "Gas", scope: 1, period_total_tco2e: 7 }],
    allocation: { key_value_product: 1, key_value_site_total: 3, product_output_units: 1000, dqr: DQR },
    inputs: [line({ id: "a", stage: "A1", name: "Al", quantity: 1.012, factor_id: "AL", recycled_factor_id: "ALR", recycled_share_pct: 5 })] };
  const first = canonicalJson(computePcf(input));
  const snap = JSON.parse(JSON.stringify(makeSnapshot(input))); // as stored in jsonb and read back
  assert.equal(canonicalJson(regenerateFromSnapshot(snap)), first);
});

test("a snapshot from another engine version is refused", () => {
  assert.throws(() => regenerateFromSnapshot({ engine_version: "pcf-0.0.1", input: {} }), PcfInputError);
});

// ---- Golden: the PCF-0 pilot (placeholder numbers, not Midal data) ----------
const golden = JSON.parse(fs.readFileSync(path.resolve("docs/pcf/phase0/pilot-golden.json"), "utf8"));

function goldenInput(g) {
  const qty = Object.fromEntries(g.inputs.map((i) => [i.id, i.quantity]));
  const pilot = g.production_approved_t.find((p) => p.is_pilot);
  const siteT = g.production_approved_t.reduce((s, p) => s + p.quantity_t, 0);
  return {
    study: { cut_off_rule_pct: g.study.cut_off_rule_pct, cut_off_max_total_pct: g.study.cut_off_max_total_pct },
    factors: g.factors.map((f) => ({ id: f.id, name: f.name, unit: f.unit, value_kgco2e: f.value_kgco2e })),
    inputs: [
      ...g.inputs.map((i) => ({ id: i.id, stage: i.stage, name: i.name, quantity: i.quantity, unit: i.unit,
        factor_id: i.material_factor_id, recycled_factor_id: i.recycled_factor_id, recycled_share_pct: i.recycled_share_pct,
        data_type: i.data_type, dqr: { technology: i.dqr_technology, geography: i.dqr_geography, time: i.dqr_time } })),
      ...g.transport_legs.map((t) => {
        assert.equal(t.mass_t_per_unit, qty[t.carried_input_id] / 1000);
        return { id: t.id, stage: "A2", name: t.name, quantity: 0, unit: "tonne.km", factor_id: t.factor_id,
          payload_t: t.mass_t_per_unit, distance_km: t.distance_km, data_type: t.data_type,
          dqr: { technology: t.dqr_technology, geography: t.dqr_geography, time: t.dqr_time } };
      }),
    ],
    energy: g.plant_emissions_approved.map((e, n) => ({ id: `A3E${n + 1}`, category_name: e.category, scope: e.scope, period_total_tco2e: e.period_total_tco2e })),
    allocation: { key_value_product: pilot.quantity_t, key_value_site_total: siteT,
      product_output_units: (pilot.quantity_t * 1000) / g.study.mass_per_unit_kg, dqr: g.allocation_dqr },
  };
}

// Every number in `expected` (except the reconciliation, which is not part of
// one study's result) must match within the golden tolerance.
function compareAll(expected, actual, tolPct, at = "expected") {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", `${at} missing`);
    if (expected === 0) assert.ok(Math.abs(actual) < 1e-12, `${at}: ${actual} !== 0`);
    else assert.ok(Math.abs(actual - expected) / Math.abs(expected) * 100 <= tolPct, `${at}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${at} missing`);
    if (expected.every((v) => typeof v !== "object")) assert.deepEqual(actual, expected, at);
    else {
      assert.equal(actual.length, expected.length, `${at} length`);
      expected.forEach((v, i) => compareAll(v, actual[i], tolPct, `${at}[${i}]`));
    }
  } else if (expected && typeof expected === "object") {
    for (const [k, v] of Object.entries(expected)) compareAll(v, actual?.[k], tolPct, `${at}.${k}`);
  } else {
    assert.equal(actual, expected, at);
  }
}

test("golden: the PCF-0 pilot, every expected value within tolerance", () => {
  const r = computePcf(goldenInput(golden));
  const { reconciliation, allocation, ...expected } = golden.expected;
  assert.equal(golden.tolerance_pct, 0.5);
  // site_total_t is an input (the key's site total), not a result field.
  const { site_total_t, ...allocationResult } = allocation;
  assert.equal(site_total_t, golden.production_approved_t.reduce((s, p) => s + p.quantity_t, 0));
  compareAll(allocationResult, r.allocation, golden.tolerance_pct, "expected.allocation");
  compareAll(expected, r, golden.tolerance_pct);
  // Reconciliation for the single pilot product: covered S1+S2 equals A3 energy × output.
  close(r.by_stage.A3_energy * r.allocation.product_output_units / 1000, reconciliation.covered_tco2e, 1e-6);
});
