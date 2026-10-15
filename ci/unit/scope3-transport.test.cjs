// S3-8 transport and warehousing form (src/scope3/transport/configs.ts): every
// option chain maps to a factor, the pre-S3-8 chains are unchanged, each unit
// key computes through the engine, and the guidance's worked examples come out
// right. No database. Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const cfg = require(path.resolve("dist/scope3/transport/configs.js"));
const { TRANSPORT_FACTORS } = require(path.resolve("dist/scope3/transport/factors.js"));
const { normalizeUnitKey, computeSpecActivityValue } = require(path.resolve("dist/services/calculationSpec.js"));
const { computeTotal } = require(path.resolve("dist/services/emissionWrite/compute.js"));

const unitOf = (cls) => (/\[([^\]]+)\]$/.exec(cls) || [])[1];

test("every Mode → Vehicle → Class chain maps to a factor name, and nothing else is mapped", () => {
  const mapping = cfg.buildMapping();
  const chains = [];
  for (const [mode, vehicles] of Object.entries(cfg.VEHICLES_BY_MODE)) {
    for (const vehicle of vehicles) {
      assert.ok(cfg.CLASSES_BY_VEHICLE[vehicle], `classes for ${vehicle}`);
      for (const cls of cfg.CLASSES_BY_VEHICLE[vehicle]) chains.push(`${mode}|${vehicle}|${cls}`);
    }
  }
  assert.deepEqual(Object.keys(mapping).sort(), chains.sort());
  for (const k of chains) assert.ok(mapping[k], k);
});

test("the pre-S3-8 chains keep their factor names, so old rows still resolve", () => {
  const mapping = cfg.buildMapping();
  // The mapping repairTransportConfigs.ts wrote before S3-8 (spot checks across every mode).
  const before = {
    "Road|HGV (all diesel)|All rigids [tonne.km]": "Road - HGV (all diesel) - All rigids [tonne.km]",
    "Road|HGV refrigerated (all diesel)|All rigids [km]": "Road - HGV refrigerated (all diesel) - All rigids [km]",
    "Road|Van|Battery electric vehicle [km]": "Road - Van - Battery electric vehicle [km]",
    "Road|Van|LPG [tonne.km]": "Road - Van - LPG [tonne.km]",
    "Road|Van|Unknown [km]": "Road - Van - Unknown [km]",
    "Rail|Freight train|Rail freight [tonne.km]": "Road - Rail",
    "Air|Flight|Domestic": "Air - flight - Domestic",
    "Air|Flight|International": "Air - flight - International",
    "Sea|Cargo ship|General Cargo": "Sea - Cargo ship - General Cargo",
  };
  for (const [k, v] of Object.entries(before)) assert.equal(mapping[k], v, k);
  // Old spec keys and the legacy field are unchanged.
  assert.deepEqual(cfg.CALCULATION.methods["tonne.km"], { multiply: ["Weight (tonne)", "Distance travelled"], activity_unit: "tonne.km" });
  assert.deepEqual(cfg.CALCULATION.methods.km, { multiply: ["Distance travelled"], activity_unit: "km" });
  assert.equal(cfg.CALCULATION.legacy_field, "Distance travelled");
  assert.deepEqual(cfg.CALCULATION.identity_columns, ["Shipment Ref"]);
});

test("every class that names a unit has a spec method for it and a unit row; refrigerant only on refrigerated HGV and warehouse", () => {
  const keys = new Set(Object.keys(cfg.CALCULATION.methods));
  const units = new Set(cfg.UNITS.map(normalizeUnitKey));
  for (const [vehicle, classes] of Object.entries(cfg.CLASSES_BY_VEHICLE)) {
    for (const cls of classes) {
      const unit = unitOf(cls);
      if (!unit) continue; // Air / Sea classes keep their factor's unit
      assert.ok(keys.has(normalizeUnitKey(unit)), `${vehicle}: ${cls}`);
      assert.ok(units.has(normalizeUnitKey(unit)), `unit row for ${cls}`);
      if (normalizeUnitKey(unit) === "kg") assert.match(vehicle, /refrigerated|Warehouse/, cls);
    }
  }
  assert.ok(!cfg.STRAY_UNITS.includes("kg"), "kg is a real unit now");
});

test("seeded factors are the ones the mapping names, in the unit the class is entered in", () => {
  const mapping = cfg.buildMapping();
  const classByFactor = new Map();
  for (const [k, name] of Object.entries(mapping)) classByFactor.set(name, k.split("|")[2]);
  for (const f of TRANSPORT_FACTORS) {
    const cls = classByFactor.get(f.name);
    assert.ok(cls, `${f.name} is mapped`);
    assert.equal(normalizeUnitKey(f.unit), normalizeUnitKey(unitOf(cls)), f.name);
    assert.deepEqual(Object.keys(f.values).sort(), ["2024", "2025"], f.name);
    for (const v of Object.values(f.values)) assert.ok(v.value > 0 && v.from, f.name);
  }
  const diesel = TRANSPORT_FACTORS.find((f) => f.name.startsWith("Fuel - Diesel"));
  assert.equal(diesel.factor_type, "life_cycle");
  assert.equal(TRANSPORT_FACTORS.find((f) => f.name === "Refrigerant - R134a [kg]").values["2025"].value, 1530);
  assert.equal(TRANSPORT_FACTORS.find((f) => f.name === "Refrigerant - R410A [kg]").values["2025"].value, 2256);
});

test("unit aliases (calculationSpec.normalizeUnitKey)", () => {
  const cases = {
    "m³.day": "m3.day", "m3 day": "m3.day", "M3_Day": "m3.day", "pallet day": "pallet.day", "Pallets-day": "pallet.day",
    "TEU day": "teu.day", kWh: "kwh", KWH: "kwh", litres: "litre", Liters: "litre", litre: "litre",
    tkm: "tonne.km", "Tonne KM": "tonne.km", kms: "km",
  };
  for (const [input, key] of Object.entries(cases)) assert.equal(normalizeUnitKey(input), key, input);
});

test("each new unit key multiplies its fields; shares are percentages up to 100", () => {
  const spec = cfg.CALCULATION;
  const value = (data, unit) => computeSpecActivityValue(spec, data, unit);
  assert.deepEqual(value({ "Fuel used (litres)": "1000", "Your share of the load (%)": "100" }, "litre"), { ok: true, value: 1000, unitKey: "litre" });
  assert.equal(value({ "Fuel used (litres)": "1000", "Your share of the load (%)": "40" }, "Litres").value, 400);
  assert.equal(value({ "Energy used (kWh)": "10000", "Your share (%)": "25" }, "kWh").value, 2500);
  assert.equal(value({ "Refrigerant leaked (kg)": "50", "Your share (%)": "100" }, "kg").value, 50);
  assert.equal(value({ "Volume stored": "4000", "Days stored": "2" }, "m³.day").value, 8000);
  assert.equal(value({ "Volume stored": "120", "Days stored": "30" }, "pallet day").value, 3600);
  assert.equal(value({ "Volume stored": "3", "Days stored": "10" }, "teu.day").value, 30);
  const over = value({ "Energy used (kWh)": "100", "Your share (%)": "150" }, "kwh");
  assert.equal(over.ok, false);
  assert.match(over.message, /cannot be more than 100/);
  // A row saved before the spec, holding only the distance product, still computes.
  assert.equal(value({ "Distance travelled": "5000" }, "tonne.km").value, 5000);
});

// The guidance's worked examples, through the engine (methods/spec via computeTotal).
const ctx = { site_id: 1, category_id: 13, category_name: "Upstream T&D", scope: "Scope 3", assigned: true, hasForm: true, spec: cfg.CALCULATION, selectColumns: new Set(), factors: null, fera: null };
const factor = (name, value, unit) => ({ emission_factor_id: 1, emission_category_name: name, global_category_name: name, year: 2025, factor_value: value.toFixed(4), denominator_unit: unit, source: "guidance" });
const kg = (rows) =>
  rows.reduce((sum, [data, unit, f]) => {
    const r = computeTotal(ctx, f, { ...data }, unit);
    assert.equal(r.ok, true, JSON.stringify(r));
    return sum + r.computed.activityValue * (r.computed.conversion ?? 1) * Number(f.factor_value);
  }, 0);

test("ex-4.1 fuel-based: 220,000 L diesel × 3 + 50 kg R410a × 2,000, all ours → 760,000 kg", () => {
  const diesel = factor("Diesel", 3, "litre");
  const r410a = factor("R410A", 2000, "kg");
  const fuel = (l) => [{ "Fuel used (litres)": String(l), "Your share of the load (%)": "100" }, "litre", diesel];
  assert.equal(kg([fuel(50000), fuel(80000), fuel(90000), [{ "Refrigerant leaked (kg)": "50", "Your share (%)": "100" }, "kg", r410a]]), 760000);
});

test("ex-4.2 distance-based: three legs → 5,000 kg; ex-9.1 downstream 4 t × 2,000 km × 0.2 → 1,600 kg", () => {
  const leg = (t, km, f) => [{ "Weight (tonne)": String(t), "Distance travelled": String(km) }, "tonne.km", factor("mode", f, "tonne.km")];
  assert.equal(kg([leg(2, 2000, 0.2), leg(1, 3000, 1.0), leg(6, 4000, 0.05)]), 5000);
  assert.equal(kg([leg(4, 2000, 0.2)]), 1600);
});

test("ex-4.5 site-specific: two warehouses' energy × 25 % share → 5,187.5 kg", () => {
  const grid = factor("Grid", 0.8, "kWh");
  const gas = factor("Gas", 0.25, "kWh");
  const row = (kwh, f) => [{ "Energy used (kWh)": String(kwh), "Your share (%)": "25" }, "kWh", f];
  assert.equal(kg([row(10000, grid), row(1000, gas), row(15000, grid), row(2000, gas)]), 5187.5);
});

test("ex-4.6 average-data storage: 4,000 m³ × 2 days at 0.01 and 0.02 → 240 kg", () => {
  const row = (f) => [{ "Volume stored": "4000", "Days stored": "2" }, "m3.day", factor("Storage", f, "m3.day")];
  assert.equal(Math.round(kg([row(0.01), row(0.02)]) * 1e6) / 1e6, 240);
});

test("a config is the standard one by name or by the S3-8 marker; Who paid? is added once", () => {
  assert.equal(cfg.isStandardConfig({ config_name: "Transport - Standard - Upstream", calculation: null }), true);
  assert.equal(cfg.isStandardConfig({ config_name: "Glochem freight", calculation: cfg.CALCULATION }), true);
  assert.equal(cfg.isStandardConfig({ config_name: "Glochem freight", calculation: { mode: "per_unit", methods: {} } }), false);
  const once = cfg.withPaidBy([{ key: "po_number", label: "PO", type: "text", required: false }]);
  assert.deepEqual(once.map((f) => f.key), ["po_number", "paid_by"]);
  assert.equal(cfg.withPaidBy(once), once, "already there: unchanged");
  assert.deepEqual(cfg.PAID_BY_FIELD.options, ["We paid", "Customer or other"]);
  assert.deepEqual(cfg.METHOD_OPTIONS[4][0], "fuel_based");
  assert.deepEqual(cfg.METHOD_OPTIONS[9][0], "distance_based");
});
