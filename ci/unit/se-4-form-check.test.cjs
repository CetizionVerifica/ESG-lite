// SE-4 · The form check (src/forms/check.ts): every rule, on a transport form in the
// client's words, plus what a version stores and the check year. No database.
// Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { checkForm, CHECK_CODES } = require(path.resolve("dist/forms/check.js"));
const versions = require(path.resolve("dist/forms/versions.js"));

// "What does your record show?" picks the method; each answer has its formula.
const form = () => ({
  columns: [
    { pk_id: 11, column_name: "record_type", column_type: "select" },
    { pk_id: 12, column_name: "Vehicle", column_type: "select" },
    { pk_id: 13, column_name: "Distance", column_type: "number" },
    { pk_id: 14, column_name: "Weight", column_type: "number" },
    { pk_id: 15, column_name: "Litres", column_type: "number" },
  ],
  extra_fields: [{ key: "po_number", label: "PO number", type: "text", required: false }],
  column_options: {
    11: [
      { id: "fuel_bill", label: "Fuel bill" },
      { id: "trip", label: "Trip distance" },
    ],
    12: [{ id: "hgv", label: "HGV" }],
  },
  dependent_options: {},
  emission_category_mapping: { "fuel_bill|hgv": "Diesel", "trip|hgv": "HGV all rigids" },
  calculation: {
    mode: "per_method",
    method_column: "record_type",
    methods: { fuel_bill: { multiply: ["Litres"] }, trip: { multiply: ["Distance", "Weight"] } },
  },
  method_options: [
    { method: "fuel_based", units: ["litre"] },
    { method: "distance_based", units: ["tonne.km"] },
  ],
  method_by_choice: { column: "record_type", map: { fuel_bill: "fuel_based", trip: "distance_based" } },
  field_settings: { Vehicle: { hidden: true, required: true, default: "hgv" } },
  units: {},
  currency: {},
});
let id = 0;
const factor = (name, year, unit, type = null) => ({ emission_factor_id: ++id, emission_category_name: name, global_category_name: null, year, denominator_unit: unit, factor_type: type });
const factors = [factor("Diesel", 2025, "litre"), factor("HGV all rigids", 2025, "tonne.km"), factor("HGV all rigids", 2024, "tonne.km")];
const run = (f, opts = {}) => checkForm({ form: f, factors: opts.factors ?? factors, year: opts.year ?? 2025, companyDefaultCurrency: "currency" in opts ? opts.currency : "INR" });
const codes = (list) => list.map((i) => `${i.code} ${i.field}`);

test("a form set up in full passes with no errors or warnings", () => {
  const r = run(form());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("a choice path with no factor is an error; only an older year is a warning", () => {
  const f = form();
  f.emission_category_mapping["trip|hgv"] = "Ship";
  const r = run(f);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r.errors), ["NO_FACTOR_FOR_YEAR emission_category_mapping.trip|hgv"]);
  assert.match(r.errors[0].message, /trip › hgv points to "Ship", which has no emission factor/);

  const older = run(form(), { year: 2026 });
  assert.equal(older.ok, true, "the 2025 factors are used, with a warning");
  assert.deepEqual(codes(older.warnings), ["FACTOR_FALLBACK_YEAR emission_category_mapping.fuel_bill|hgv", "FACTOR_FALLBACK_YEAR emission_category_mapping.trip|hgv"]);
  assert.match(older.warnings[0].message, /no 2026 factor for "Diesel"; the 2025 factor is used/);
});

test("a formula field that is missing or not a number field is an error", () => {
  const f = form();
  f.calculation.methods.trip = { multiply: ["Distance", "Tonnes"], divide: ["Vehicle"] };
  assert.deepEqual(codes(run(f).errors), ["FIELD_MISSING calculation.methods.trip", "FIELD_MISSING calculation.methods.trip"]);
  assert.match(run(f).errors[0].message, /uses "Tonnes", which isn't a number field/);
});

test("every answer of the question picks a method, and has a formula when the formula follows the answer", () => {
  const f = form();
  f.column_options[11].push({ id: "spend", label: "Invoice amount" });
  const r = run(f);
  assert.deepEqual(codes(r.errors), ["METHOD_UNMAPPED method_by_choice.map.spend"]);
  assert.match(r.errors[0].message, /The answer "Invoice amount" picks no method/);

  const g = form();
  delete g.calculation.methods.trip;
  assert.deepEqual(codes(run(g).errors), ["FIELD_MISSING calculation.methods.trip"]);
  // A dependent list's answers count too, once each.
  const h = form();
  h.dependent_options = { record_type: { road: [{ id: "trip", label: "Trip distance" }, { id: "rail", label: "Rail ticket" }] } };
  assert.deepEqual(codes(run(h).errors), ["METHOD_UNMAPPED method_by_choice.map.rail"]);
});

test("spend needs a currency (the form's or the client's) and a spend factor", () => {
  const f = form();
  f.method_options.push({ method: "spend_based", units: ["USD"] });
  const none = run(f, { currency: null });
  assert.deepEqual(codes(none.errors), ["CURRENCY_MISSING currency.fixed", "SPEND_FACTOR_MISSING method_options"]);
  assert.equal(run(f, { currency: "INR" }).errors.some((e) => e.code === "CURRENCY_MISSING"), false, "the client's default currency is enough");
  f.currency = { fixed: "USD" };
  assert.equal(run(f, { currency: null }).errors.some((e) => e.code === "CURRENCY_MISSING"), false, "or the form's own");
  const withSpend = run(f, { factors: [...factors, factor("Freight services", 2025, "USD", "eeio_spend")] });
  assert.equal(withSpend.ok, true);
});

test("a fixed unit must convert to every factor the form's choices reach", () => {
  const f = form();
  f.method_options = [{ method: "distance_based", units: ["tonne.km"] }];
  f.method_by_choice.map = { fuel_bill: "distance_based", trip: "distance_based" };
  f.units = { fixed: "tonne.km" };
  const r = run(f);
  assert.deepEqual(codes(r.errors), ["UNIT_NOT_CONVERTIBLE units.fixed"]);
  assert.match(r.errors[0].message, /takes tonne\.km, but "Diesel" is per litre/);
  const g = form();
  g.emission_category_mapping = { "fuel_bill|hgv": "Diesel" };
  g.units = { fixed: "m3" };
  assert.deepEqual(codes(run(g).errors), [], "m3 converts to litre");
});

test("a hidden required field needs a default", () => {
  const f = form();
  f.field_settings = { Vehicle: { hidden: true, required: true }, po_number: { hidden: true, required: true, default: " " } };
  assert.deepEqual(codes(run(f).errors), ["DEFAULT_MISSING field_settings.Vehicle", "DEFAULT_MISSING field_settings.po_number"]);
  f.field_settings = { Vehicle: { hidden: true } };
  assert.equal(run(f).ok, true, "hidden and optional needs none");
});

test("the codes are the ones the check can return", () => {
  assert.deepEqual([...CHECK_CODES].sort(), ["CURRENCY_MISSING", "DEFAULT_MISSING", "FACTOR_FALLBACK_YEAR", "FIELD_MISSING", "METHOD_UNMAPPED", "NO_FACTOR_FOR_YEAR", "SPEND_FACTOR_MISSING", "UNIT_NOT_CONVERTIBLE"]);
});

test("a version stores the form's settings and its columns by id, and the check year defaults to last year", () => {
  const snap = versions.snapshotOf({ ...form(), config_name: "Transport", pk_id: 9, version: 3, site: { site_id: 1 }, columns: [...form().columns].reverse() });
  assert.deepEqual(Object.keys(snap).sort(), [...versions.VERSIONED_KEYS, "columns"].sort(), "no ids, relations or version inside");
  assert.deepEqual(snap.columns.map((c) => c.pk_id), [11, 12, 13, 14, 15]);
  assert.equal(snap.config_name, "Transport");
  assert.equal(versions.defaultCheckYear(new Date("2026-10-17T00:00:00Z")), 2025);
  assert.deepEqual(versions.parseCheckYear("2024"), { ok: true, year: 2024 });
  assert.equal(versions.parseCheckYear("twenty").ok, false);
  assert.equal(versions.parseCheckYear("1800").ok, false);
});

test("an unchanged form compares equal to its stored version whatever the key order (jsonb sorts keys)", () => {
  const snap = versions.snapshotOf({ ...form(), config_name: "Transport" });
  const stored = JSON.parse(JSON.stringify(snap, Object.keys(snap).sort().reverse()));
  const reordered = Object.fromEntries(Object.entries(snap).reverse().map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v]));
  assert.equal(versions.stableJson(reordered), versions.stableJson(snap));
  assert.notEqual(versions.stableJson({ ...snap, config_name: "Transport 2" }), versions.stableJson(snap));
  assert.equal(versions.stableJson({ a: 1, b: undefined }), versions.stableJson({ a: 1 }), "an absent key and an undefined one are the same");
  assert.ok(stored);
});
