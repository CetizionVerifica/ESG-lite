// S3-9 business travel and employee commuting: the spec's `divide` and
// `method_column: "@method"`, the standard Category 6 / 7 forms, survey
// aggregation and its plan rows. The guidance's worked examples 6.1, 7.1
// (through the survey path) and 7.2 run through the real forms and the
// engine (computeRow), so the forms give the golden figures.
// Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeSpecActivityValue, resolveSpecMethod, ROW_METHOD_COLUMN } = require(path.resolve("dist/services/calculationSpec.js"));
const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const configs = require(path.resolve("dist/scope3/commuting/configs.js"));
const { matchMode, summariseSurvey, surveyRows } = require(path.resolve("dist/scope3/commuting/survey.js"));
const { CommutingSurveyBodySchema, COMMUTING_SURVEY_MAX_RESPONSES } = require(path.resolve("dist/scope3/commuting/schemas.js"));
const { TRAVEL_FACTORS } = require(path.resolve("dist/scope3/commuting/factors.js"));
const { ImportRowSchema } = require(path.resolve("dist/imports/contracts.js"));
const { GHG_CATEGORIES } = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));

const C = configs;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

// ── divide ──────────────────────────────────────────────────────────────────
test("divide: product ÷ each divide field; a percent field divides by value / 100", () => {
  const spec = { mode: "per_unit", methods: { "vehicle.km": { multiply: ["T", "D"], divide: ["P"] }, x: { multiply: ["A"], divide: ["S"], percent: ["S"] } } };
  close(computeSpecActivityValue(spec, { T: "10", D: "50", P: "2" }, "vehicle.km").value, 250);
  close(computeSpecActivityValue(spec, { A: "30", S: "75" }, "x").value, 40);
});

test("divide: 0, empty, missing or over 100 % is refused (FIELD_REQUIRED / FIELD_INVALID)", () => {
  const spec = { mode: "per_unit", methods: { "vehicle.km": { multiply: ["T", "D"], divide: ["P"] }, x: { multiply: ["A"], divide: ["S"], percent: ["S"] } } };
  for (const P of ["0", "", "-1", undefined]) {
    const r = computeSpecActivityValue(spec, { T: "10", D: "50", ...(P === undefined ? {} : { P }) }, "vehicle.km");
    assert.equal(r.ok, false, String(P));
    assert.match(r.message, /greater than 0 in "P"/);
  }
  assert.equal(computeSpecActivityValue(spec, { A: "30", S: "120" }, "x").ok, false);
  // Through the engine: divide by 0 is FIELD_REQUIRED.
  const ctx = { spec, factors: null, fera: null };
  const factor = { emission_factor_id: 1, emission_category_name: "Car", factor_value: "1", denominator_unit: "vehicle.km", year: 2025 };
  const out = computeRow(ctx, { factor, activity_data: { emission_category: "Car", T: "10", D: "50", P: "0" }, activity_unit: "vehicle.km" });
  assert.equal(out.ok, false);
  assert.equal(out.issue.code, "FIELD_REQUIRED");
});

// ── @method ─────────────────────────────────────────────────────────────────
test("@method: the row's method picks the fields; activity_data['@method'] until S3-3 gives rows a method", () => {
  assert.equal(ROW_METHOD_COLUMN, "@method");
  const spec = C.commutingSpec();
  const data = { [C.COL_FUEL]: "40", [C.COL_TOTAL_DISTANCE]: "1000", [C.COL_TOTAL_EMPLOYEES]: "100", [C.COL_SURVEYED]: "25" };
  // The row's own method (S3-3) wins.
  close(computeSpecActivityValue(spec, data, "passenger.km", "distance_based").value, 4000);
  close(computeSpecActivityValue(spec, { ...data, "@method": "distance_based" }, "litre", "fuel_based").value, 40);
  // Stand-in: the method stored with the row's fields.
  close(computeSpecActivityValue(spec, { ...data, "@method": " distance_based " }, "passenger.km").value, 4000);
  assert.equal(resolveSpecMethod(spec, { ...data, "@method": "fuel_based" }, "litre").key, "fuel_based");
});

test("@method: no method or one the form doesn't offer is refused in plain words", () => {
  const spec = C.commutingSpec();
  const none = computeSpecActivityValue(spec, { [C.COL_FUEL]: "40" }, "litre");
  assert.deepEqual(none, { ok: false, message: "Please choose a calculation method." });
  const wrong = computeSpecActivityValue(spec, { [C.COL_FUEL]: "40", "@method": "spend_based" }, "litre");
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /"spend_based" is not configured .*distance_based, average_data, fuel_based/);
  // A select-column spec still reads its column and ignores a row method.
  const select = { mode: "per_method", method_column: "Method", methods: { A: { multiply: ["X"] } } };
  close(computeSpecActivityValue(select, { Method: "A", X: "3" }, undefined, "fuel_based").value, 3);
});

// ── Forms ───────────────────────────────────────────────────────────────────
test("Category 6 form: per_unit with travellers, occupancy, hotel nights and fuel; legacy rows keep their product", () => {
  const spec = C.travelSpec();
  assert.deepEqual(Object.keys(spec.methods).sort(), ["litre", "night", "passenger.km", "vehicle.km"]);
  assert.equal(spec.legacy_field, C.COL_DISTANCE);
  close(computeSpecActivityValue(spec, { [C.COL_TRAVELLERS]: "10", [C.COL_DISTANCE]: "10000" }, "passenger.km").value, 100000);
  close(computeSpecActivityValue(spec, { [C.COL_TRAVELLERS]: "100", [C.COL_DISTANCE]: "100", [C.COL_PER_VEHICLE]: "3" }, "vehicle.km").value, 10000 / 3);
  close(computeSpecActivityValue(spec, { [C.COL_ROOMS]: "2", [C.COL_NIGHTS]: "3" }, "night").value, 6);
  close(computeSpecActivityValue(spec, { [C.COL_FUEL]: "55" }, "litre").value, 55);
  // A row saved before the form: count × distance in the distance column, no traveller field.
  const legacy = computeSpecActivityValue(spec, { [C.COL_DISTANCE]: "1234.5" }, "passenger.km");
  assert.deepEqual(legacy, { ok: true, value: 1234.5, legacy: true, unitKey: "passenger.km" });
  // The standard form's columns hold every field the spec names, and every column is unique.
  const form = C.travelForm(6);
  const names = form.columns.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const m of Object.values(spec.methods)) for (const f of [...m.multiply, ...(m.divide ?? [])]) assert.ok(names.includes(f), f);
  assert.deepEqual(form.units, ["passenger.km", "vehicle.km", "night", "litre"]);
});

test("Category 6 selects: mode → class → radiative forcing (air only); every chain maps to a factor with the class's unit", () => {
  const ids = { [C.COL_TRIP_MODE]: 11, [C.COL_TRIP_CLASS]: 12, [C.COL_RF]: 13 };
  const f = C.formFields(C.travelForm(6), ids);
  assert.deepEqual(f.column_dependencies, { [C.COL_TRIP_CLASS]: C.COL_TRIP_MODE, [C.COL_RF]: C.COL_TRIP_CLASS });
  assert.deepEqual(f.column_options["11"].map((o) => o.label), ["Air", "Rail", "Bus", "Taxi", "Rental or own car", "Hotel"]);
  // With RF is listed first (the default the spec asks for).
  for (const opts of Object.values(f.dependent_options[C.COL_RF])) assert.deepEqual(opts.map((o) => o.label), ["With RF", "Without RF"]);
  assert.deepEqual(Object.keys(f.dependent_options[C.COL_RF]).sort(), [...C.CLASSES_BY_MODE.Air].sort());
  // No fallback RF list, so non-air classes show no RF select.
  assert.deepEqual(f.column_options["13"], []);
  const mapping = f.emission_category_mapping;
  for (const [mode, classes] of Object.entries(C.CLASSES_BY_MODE)) {
    for (const cls of classes) {
      const keys = mode === "Air" ? C.RF_OPTIONS.map((rf) => `${mode}|${cls}|${rf}`) : [`${mode}|${cls}`];
      for (const k of keys) {
        assert.ok(mapping[k], k);
        const unit = /\[([^\]]+)\]$/.exec(mapping[k])[1];
        assert.ok(Object.keys(C.travelSpec().methods).includes(unit), `${k} → ${unit}`);
        const labelUnit = /\[([^\]]+)\]$/.exec(cls)?.[1];
        if (labelUnit) assert.equal(labelUnit, unit, k);
      }
    }
  }
  assert.equal(mapping["Air|Long haul, business|With RF"], "Flights - Long-haul - Business class - With RF [passenger.km]");
  assert.equal(mapping["Air|Long haul, business|Without RF"], "Flights - Long-haul - Business class - Without RF [passenger.km]");
  assert.equal(mapping["Hotel|India"], "Hotel stay - India [night]");
});

test("Category 7 form: per_method by the row's method; options map to factors in their unit", () => {
  const form = C.travelForm(7);
  assert.equal(form.calculation.mode, "per_method");
  assert.equal(form.calculation.method_column, "@method");
  assert.deepEqual(Object.keys(form.calculation.methods), ["distance_based", "average_data", "fuel_based"]);
  const names = form.columns.map((c) => c.name);
  for (const m of Object.values(form.calculation.methods)) for (const fld of [...m.multiply, ...(m.divide ?? [])]) assert.ok(names.includes(fld), fld);
  const f = C.formFields(form, { [C.COL_COMMUTE_MODE]: 21 });
  assert.deepEqual(f.column_options["21"].map((o) => o.label), Object.keys(C.COMMUTE_OPTIONS));
  for (const [label, factor] of Object.entries(C.COMMUTE_OPTIONS)) assert.equal(C.unitOfOption(label), /\[([^\]]+)\]$/.exec(factor)[1], label);
  // No walking or cycling option: their factor is 0.
  assert.ok(!Object.keys(C.COMMUTE_OPTIONS).some((l) => /walk|cycl|bicycle/i.test(l)));
});

test("standard-config marker, method options and factor list", () => {
  // Standard = the marker plus a hash of what was written; any edit since makes it customised.
  const f = C.formFields(C.travelForm(6), { [C.COL_TRIP_MODE]: 11, [C.COL_TRIP_CLASS]: 12, [C.COL_RF]: 13 });
  const written = { ...f, columns: [{ pk_id: 12 }, { pk_id: 11 }], extra_fields: [] };
  const stored = { ...written, calculation: { ...f.calculation, standard_hash: C.standardHash(written) } };
  assert.equal(C.isStandardConfig(stored), true);
  assert.equal(C.isStandardConfig({ ...stored, columns: [{ pk_id: 11 }, { pk_id: 12 }] }), true, "column order doesn't matter");
  assert.equal(C.isStandardConfig({ ...stored, column_options: { ...stored.column_options, 11: [{ id: "Air", label: "Air" }] } }), false);
  assert.equal(C.isStandardConfig({ ...stored, calculation: { ...stored.calculation, identity_columns: [] } }), false);
  assert.equal(C.isStandardConfig({ ...stored, extra_fields: [{ key: "po", label: "PO", type: "text" }] }), false);
  assert.equal(C.isStandardConfig({ config_name: "Scope 3 travel - Standard - Business travel" }), false, "the name alone is not enough");
  assert.equal(C.isStandardConfig({ config_name: "Business travel", calculation: null }), false);
  for (const n of [6, 7]) {
    const offered = GHG_CATEGORIES.find((c) => c.n === n).methods.map((m) => m.key);
    for (const m of C.METHOD_OPTIONS[n]) assert.ok(offered.includes(m), `${n} ${m}`);
  }
  const mapped = new Set([...Object.values(C.travelMapping()), ...Object.values(C.COMMUTE_OPTIONS)]);
  assert.deepEqual(new Set(TRAVEL_FACTORS.map((f) => f.name)), mapped);
  for (const f of TRAVEL_FACTORS) {
    assert.equal(f.factor_type, "life_cycle");
    assert.ok(["GB", "IN", "US", "AE", "DE", "FR", "SG", "CN"].includes(f.geography), f.name);
  }
});

test("DEFRA 2025 values: every factor has one, read from a named cell; RF and hotel spot checks", () => {
  const by = Object.fromEntries(TRAVEL_FACTORS.map((f) => [f.name, f]));
  for (const f of TRAVEL_FACTORS) {
    const v = f.values["2025"];
    assert.ok(v && v.value > 0, f.name);
    assert.match(v.from, /^(Business travel- air|Business travel- land|Hotel stay|Fuels)![A-Z]+\d+$/, f.name);
    assert.equal(f.gwp_set, "AR5");
  }
  assert.equal(by["Rail - National rail [passenger.km]"].values["2025"].value, 0.03546);
  assert.equal(by["Hotel stay - India [night]"].values["2025"].value, 58.9);
  // With RF is DEFRA's +70% CO2 uplift: always higher, by about 1.7×.
  for (const f of TRAVEL_FACTORS.filter((x) => x.name.includes("With RF"))) {
    const without = by[f.name.replace("With RF", "Without RF")].values["2025"].value;
    const ratio = f.values["2025"].value / without;
    assert.ok(ratio > 1.6 && ratio < 1.75, `${f.name} ${ratio}`);
  }
});

// ── Survey ──────────────────────────────────────────────────────────────────
const EX_71 = [
  { ref: "A", mode: "Rail", one_way_km: 10, days_per_week: 5, weeks_per_year: 48 },
  { ref: "B", mode: "train", one_way_km: 10, days_per_week: 4, weeks_per_year: 48 },
  { ref: "B", mode: "Car", one_way_km: 15, days_per_week: 1, weeks_per_year: 48 },
  { ref: "C", mode: "car", one_way_km: 20, days_per_week: 5, weeks_per_year: 48 },
];

test("matchMode: form labels, plain words and aliases; walking and cycling are zero; unknown stays as written", () => {
  assert.deepEqual(matchMode("Rail [passenger.km]"), { kind: "mode", label: "Rail [passenger.km]" });
  assert.deepEqual(matchMode(" Bus "), { kind: "mode", label: "Bus [passenger.km]" });
  assert.deepEqual(matchMode("Tube"), { kind: "mode", label: "Underground or metro [passenger.km]" });
  assert.deepEqual(matchMode("Car, petrol"), { kind: "mode", label: "Car, petrol [vehicle.km]" });
  assert.deepEqual(matchMode("Cycling"), { kind: "zero" });
  assert.deepEqual(matchMode("walk"), { kind: "zero" });
  assert.deepEqual(matchMode("Hovercraft"), { kind: "unknown", label: "Hovercraft" });
  // Fuel options are not survey modes.
  assert.equal(matchMode("Petrol used").kind, "unknown");
});

test("survey 7.1: rail 8,640 km and car 11,040 km from three people; scale 1", () => {
  const s = summariseSurvey({ total_employees: 3, responses: EX_71 });
  assert.equal(s.respondents, 3);
  assert.equal(s.scale, 1);
  assert.equal(s.coverage_pct, 100);
  assert.deepEqual(
    s.modes.map((m) => [m.mode, m.respondents, m.total_km, m.unit]),
    [
      ["Rail [passenger.km]", 2, 8640, "passenger.km"],
      ["Car, unknown fuel [vehicle.km]", 2, 11040, "vehicle.km"],
    ],
  );
});

test("survey scaling, zero-emission and empty modes, row shape", () => {
  const responses = [
    { ref: "e1", mode: "Bus", one_way_km: 5, days_per_week: 5, weeks_per_year: 46 },
    { ref: "e2", mode: "Walking", one_way_km: 1, days_per_week: 5, weeks_per_year: 46 },
    { ref: "e3", mode: "Hovercraft", one_way_km: 2, days_per_week: 1, weeks_per_year: 46 },
    { ref: "e4", mode: "Rail", one_way_km: 12, days_per_week: 0, weeks_per_year: 46 },
  ];
  const s = summariseSurvey({ total_employees: 16, responses });
  assert.equal(s.respondents, 4);
  assert.equal(s.scale, 4);
  assert.equal(s.coverage_pct, 25);
  assert.deepEqual(s.modes.map((m) => [m.mode, m.matched, m.total_km]), [
    ["Bus [passenger.km]", true, 2300],
    ["Hovercraft", false, 184],
  ]);
  assert.deepEqual(s.skipped.map((x) => [x.mode, x.reason]).sort(), [
    ["Rail [passenger.km]", "no_distance"],
    ["Walking", "zero_emission"],
  ]);
  const period = { kind: "yearly", year_type: "CY", year: 2025 };
  const rows = surveyRows(s, 1, 77, period, "CY2025");
  assert.equal(rows.length, 2);
  for (const r of rows) {
    ImportRowSchema.parse(r); // survives the import contract (survey kept, nothing stripped)
    assert.equal(ImportRowSchema.parse(r).survey.coverage_pct, 25);
    assert.equal(r.fields["@method"], "distance_based");
    assert.equal(r.fields[C.COL_TOTAL_EMPLOYEES], 16);
    assert.equal(r.fields[C.COL_SURVEYED], 4);
    for (const k of ["total", "total_emission", "total_tco2e", "factor"]) assert.equal(k in r, false);
    assert.ok(!JSON.stringify(r).includes("e1"), "refs never leave the survey");
  }
  // Through the engine: 2,300 km × 16 ÷ 4 = 9,200 passenger.km.
  const spec = C.commutingSpec();
  close(computeSpecActivityValue(spec, rows[0].fields, rows[0].activity_unit).value, 9200);
});

test("survey body: ≤ 20,000 responses, numbers in range", () => {
  const base = { site_id: 1, year: 2025, year_type: "CY", total_employees: 10 };
  assert.equal(CommutingSurveyBodySchema.safeParse({ ...base, responses: EX_71 }).success, true);
  const many = Array.from({ length: COMMUTING_SURVEY_MAX_RESPONSES + 1 }, (_, i) => ({ ...EX_71[0], ref: String(i) }));
  assert.equal(CommutingSurveyBodySchema.safeParse({ ...base, responses: many }).success, false);
  for (const bad of [{ days_per_week: 8 }, { weeks_per_year: 60 }, { one_way_km: -1 }, { mode: "" }]) {
    assert.equal(CommutingSurveyBodySchema.safeParse({ ...base, responses: [{ ...EX_71[0], ...bad }] }).success, false, JSON.stringify(bad));
  }
  assert.equal(CommutingSurveyBodySchema.safeParse({ ...base, responses: [] }).success, false);
});

// ── Golden cases through the forms ──────────────────────────────────────────
const ctxFor = (spec) => ({ site_id: 0, category_id: 0, category_name: "golden", scope: "Scope 3", assigned: true, hasForm: true, spec, selectColumns: new Set(), factors: null, fera: null });
const kgOf = (spec, value, unit, data, method) => {
  const factor = { emission_factor_id: 1, emission_category_name: "f", factor_value: String(value), denominator_unit: unit, year: 2025 };
  const r = computeRow(ctxFor(spec), { factor, activity_data: { emission_category: "f", ...data }, activity_unit: unit, method });
  assert.equal(r.ok, true, JSON.stringify(r.issue));
  return r.computed.total * 1000;
};

test("golden ex-6.1 through the Category 6 form: 8,317,583.33 kg", () => {
  const spec = C.travelSpec();
  const road = (t, occ, km, f) => kgOf(spec, f, "vehicle.km", { [C.COL_TRAVELLERS]: t, [C.COL_PER_VEHICLE]: occ, [C.COL_DISTANCE]: km });
  const air = (t, km, f) => kgOf(spec, f, "passenger.km", { [C.COL_TRAVELLERS]: t, [C.COL_DISTANCE]: km });
  const total = road(10, 2, 50, 1) + road(20, 2, 200, 2) + road(100, 3, 100, 4) + air(10, 10000, 5) + air(20, 15000, 6) + air(100, 12000, 5);
  // Totals are stored at 2 dp tCO₂e: within the golden tolerance (0.1 %).
  assert.ok(Math.abs(total - 8317583.33) <= 8317583.33 * 0.001, String(total));
});

test("golden ex-7.1 through the survey path: 3,072 kg", () => {
  const s = summariseSurvey({ total_employees: 3, responses: EX_71 });
  const rows = surveyRows(s, 1, 77, { kind: "yearly", year_type: "CY", year: 2025 }, "t");
  const factor = { "passenger.km": 0.1, "vehicle.km": 0.2 };
  const spec = C.commutingSpec();
  const total = rows.reduce((sum, r) => sum + kgOf(spec, factor[r.activity_unit], r.activity_unit, { ...r.fields }), 0);
  // 0.864 t + 2.208 t stored at 2 dp tCO₂e: 3,070 kg, within the golden tolerance (max(0.5 kg, 0.1 %)).
  assert.ok(Math.abs(total - 3072) <= 3072 * 0.001, String(total));
});

test("golden ex-7.2 average-data through the Category 7 form: 6,697,500 kg", () => {
  const spec = C.commutingSpec();
  const mode = (pct, km, f, unit) =>
    kgOf(spec, f, unit, { [C.COL_TOTAL_EMPLOYEES]: 10000, [C.COL_MODE_SHARE]: pct, [C.COL_ONE_WAY]: km, [C.COL_TRIPS_PER_DAY]: 2, [C.COL_WORKING_DAYS]: 235 }, "average_data");
  close(mode(50, 10, 0.1, "passenger.km") + mode(30, 15, 0.2, "vehicle.km") + mode(5, 5, 0.1, "passenger.km"), 6697500);
});
