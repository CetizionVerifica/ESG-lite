// #183 U1-BE: the units a row may use for its emission category are the
// factor's unit and the units the engine converts to it — nothing the save
// would refuse with UNIT_NOT_CONVERTIBLE, nothing it would accept left out.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { allowedUnitsFor, buildUnitOptions, isUnitAllowed } = require(path.resolve("dist/services/emissionWrite/unitOptions.js"));
const { applyFactor } = require(path.resolve("dist/services/emissionWrite/methods/activity.js"));
const { canonicalUnit, convertibleUnitsOf, getConversionFactor, unitConversions, CONVERTIBLE_CURRENCIES } = require(path.resolve("dist/services/emissionWrite/units.js"));

// Every unit key of the engine's table but currencies (spend rows have their own fields).
const ALL_UNITS = Object.keys(unitConversions).filter((u) => !CONVERTIBLE_CURRENCIES.some((c) => c.toLowerCase() === u.toLowerCase()));

test("a Diesel factor in litre keeps litre and what converts to it; kWh and kg go, Ltr folds into litre", () => {
  const units = allowedUnitsFor({ factorUnits: ["litre"], candidates: ["litre", "kg", "kWh", "kl", "Ltr", "gallon"] });
  assert.deepEqual(units, ["litre", "kl", "gallon"]);
});

test("an electricity factor in kWh keeps the energy units only", () => {
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["kWh"], candidates: ["litre", "kWh", "MWh", "GJ"] }), ["kWh", "MWh", "GJ"]);
});

test("the admin's spelling of an alias is kept: MT for a tonne factor, first in the list", () => {
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["tonne"], candidates: ["kg", "MT", "litre"] }), ["MT", "kg"]);
});

test("the factor unit is always offered, even when no admin unit row names it", () => {
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["kWh"], candidates: ["litre"] }), ["kWh"]);
});

test("a fixed unit wins; a factor with no unit leaves the list unfiltered", () => {
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["litre"], candidates: ["litre", "kl"], fixedUnit: "kl" }), ["kl"]);
  assert.deepEqual(allowedUnitsFor({ factorUnits: [null, ""], candidates: ["litre", "kWh", "Litre"] }), ["litre", "kWh"]);
});

test("per_unit specs compare the normalised unit key: Tonne KM stays for a tonne.km factor, km goes", () => {
  const units = allowedUnitsFor({ factorUnits: ["tonne.km"], candidates: ["Tonne KM", "km", "kg.km"], perUnit: true });
  assert.deepEqual(units, ["Tonne KM", "kg.km"]);
  // A unit the spec doesn't configure is refused before the factor step, so it isn't offered.
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["tonne.km"], candidates: ["Tonne KM", "kg.km"], perUnit: true, specUnitKeys: ["tonne.km", "km"] }), ["Tonne KM"]);
});

test("a unit is offered exactly when the engine accepts it (aliases fold into one spelling)", () => {
  const candidates = ["litre", "kg", "kWh", "kl", "Ltr", "gallon", "MT", "tonne", "MWh", "GJ", "SCM", "cubic meter", "ml", "lb", ...ALL_UNITS];
  for (const factorUnit of ["litre", "kWh", "tonne", "cubic meter", "kg", "g", "MJ", "km", "tonne.km"]) {
    const factor = { denominator_unit: factorUnit, factor_value: 2, emission_category_name: "X" };
    const allowed = allowedUnitsFor({ factorUnits: [factorUnit], candidates });
    for (const unit of candidates) {
      const accepted = applyFactor(10, unit, factor).ok;
      const offered = allowed.some((u) => canonicalUnit(u) === canonicalUnit(unit));
      assert.equal(offered, accepted, `${unit} for a ${factorUnit} factor: offered ${offered}, engine accepts ${accepted}`);
    }
  }
});

test("buildUnitOptions: one entry per factor name, global name and alias; an alias takes its target's list", () => {
  const options = buildUnitOptions({
    factors: [
      { emission_factor_id: 1, emission_category_name: "Diesel", global_category_name: "Diesel (avg biofuel blend)", denominator_unit: "litre", year: 2024 },
      { emission_factor_id: 2, emission_category_name: "Diesel", global_category_name: null, denominator_unit: "litre", year: 2023 },
      { emission_factor_id: 3, emission_category_name: "Grid electricity", global_category_name: null, denominator_unit: "kWh", year: 2024 },
      { emission_factor_id: 4, emission_category_name: "Natural gas", global_category_name: null, denominator_unit: "cubic meter", year: 2024 },
    ],
    mappings: [
      { name: "HSD", factor_name: "Diesel", emission_factor_id: null },
      { name: "City gas", factor_name: "Unknown", emission_factor_id: 4 },
    ],
    formUnits: ["litre", "kWh", "SCM", "kg"],
    methodUnits: [],
    fixedUnit: null,
    perUnit: false,
    specUnitKeys: null,
  });
  const byName = Object.fromEntries(options.activities.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName), ["City gas", "Diesel", "Diesel (avg biofuel blend)", "Grid electricity", "HSD", "Natural gas"]);
  // Admin units first (their spelling wins: SCM, not cubic meter), then what the engine converts (#183 follow-up).
  assert.deepEqual(byName.Diesel, { name: "Diesel", factor_unit: "litre", units: ["litre", "SCM", "kl", "gallon", "ml"] });
  assert.deepEqual(byName["Grid electricity"].units, ["kWh", "MWh", "GJ", "MJ"]);
  assert.deepEqual(byName["Natural gas"].units, ["SCM", "litre", "kl", "gallon", "ml"]);
  assert.deepEqual(byName.HSD, { name: "HSD", maps_to: "Diesel", factor_unit: "litre", units: ["litre", "SCM", "kl", "gallon", "ml"] });
  // A pinned factor id wins over the alias's factor name, as the engine resolves it.
  assert.deepEqual(byName["City gas"], { name: "City gas", maps_to: "Unknown", factor_unit: "cubic meter", units: ["SCM", "litre", "kl", "gallon", "ml"] });
  assert.equal(options.fixed_unit, null);
  assert.deepEqual(options.all_units, ["litre", "kWh", "SCM", "kg"]);
});

test("isUnitAllowed folds aliases and, for per_unit specs, unit keys (U3-BE audit)", () => {
  assert.equal(isUnitAllowed(["litre", "kl"], "Ltr"), true);
  assert.equal(isUnitAllowed(["litre", "kl"], "kWh"), false);
  assert.equal(isUnitAllowed(["tonne.km"], "Tonne KM"), false);
  assert.equal(isUnitAllowed(["tonne.km"], "Tonne KM", true), true);
});

test("decided 22 Oct: a km factor takes miles and metres; Kilo Litre is KL (no conversion value changes)", () => {
  assert.deepEqual(allowedUnitsFor({ factorUnits: ["km"], candidates: ["km", "mile", "m", "kg"] }), ["km", "mile", "m"]);
  const factor = { denominator_unit: "km", factor_value: 0.2, emission_category_name: "Van" };
  const mile = applyFactor(100, "miles", factor);
  assert.equal(mile.ok, true);
  assert.equal(mile.computed.conversion, 1.60934);
  // "Kilo Litre" folds into KL: an entry saved in it is offered on a KL form, and converts to litre as before.
  assert.equal(isUnitAllowed(["KL", "litre"], "Kilo Litre"), true);
  const litreFactor = { denominator_unit: "litre", factor_value: 2.68, emission_category_name: "Diesel" };
  assert.equal(applyFactor(2, "Kilo Litre", litreFactor).computed.conversion, 1000);
  assert.equal(applyFactor(2, "KL", litreFactor).computed.conversion, 1000);
});

const source = (factors, formUnits) => ({
  factors: factors.map(([name, unit], i) => ({ emission_factor_id: i + 1, emission_category_name: name, global_category_name: null, denominator_unit: unit, year: 2025 })),
  mappings: [], formUnits, methodUnits: [], fixedUnit: null, perUnit: false, specUnitKeys: null,
});
const unitsOf = (options, name) => options.activities.find((a) => a.name === name).units;

test("convertibleUnitsOf: every unit the engine converts to the factor's, one spelling each, no currencies", () => {
  assert.deepEqual(convertibleUnitsOf("litre"), ["kl", "gallon", "ml", "cubic meter"]);
  assert.deepEqual(convertibleUnitsOf("SCM"), ["litre", "kl", "gallon", "ml"]);
  assert.deepEqual(convertibleUnitsOf("kWh"), ["MWh", "GJ", "MJ"]);
  assert.deepEqual(convertibleUnitsOf("tonne"), ["kg", "lb", "g"]);
  assert.deepEqual(convertibleUnitsOf("MT"), ["kg", "lb", "g"]);
  assert.deepEqual(convertibleUnitsOf("kg"), ["lb", "tonne", "g"]);
  assert.deepEqual(convertibleUnitsOf("km"), ["m", "mile"]);
  assert.deepEqual(convertibleUnitsOf("tonne.km"), ["kg.km", "g.km"]);
  assert.deepEqual(convertibleUnitsOf("USD"), []);
  assert.deepEqual(convertibleUnitsOf("no such unit"), []);
});

test("an admin who added only litre still sees gallon, kl, ml and cubic meter (auto-generated forms)", () => {
  // Capture setup's auto-generate saves only each factor's unit: litre for Diesel, kWh for electricity.
  const options = buildUnitOptions(source([["Diesel", "litre"], ["Electricity", "kWh"]], ["litre", "kWh"]));
  assert.deepEqual(unitsOf(options, "Diesel"), ["litre", "kl", "gallon", "ml", "cubic meter"]);
  assert.deepEqual(unitsOf(options, "Electricity"), ["kWh", "MWh", "GJ", "MJ"]);
  assert.deepEqual(options.all_units, ["litre", "kWh"]);
});

test("a tonne factor offers no second spelling of the tonne (ton, tonnes, Tonnes)", () => {
  const units = unitsOf(buildUnitOptions(source([["Coal", "tonne"]], ["tonne"])), "Coal");
  assert.deepEqual(units, ["tonne", "kg", "lb", "g"]);
  for (const synonym of ["ton", "tonnes", "Tonnes"]) assert.equal(units.includes(synonym), false, synonym);
});

test("buildUnitOptions offers exactly the units the engine accepts, whatever the admin added", () => {
  for (const factorUnit of ["litre", "SCM", "kWh", "tonne", "MT", "kg", "km", "g", "MJ"]) {
    const units = unitsOf(buildUnitOptions(source([["X", factorUnit]], [])), "X");
    const factor = { denominator_unit: factorUnit, factor_value: 2, emission_category_name: "X" };
    for (const unit of ALL_UNITS) {
      const accepted = applyFactor(10, unit, factor).ok;
      // Offered as itself, or as another spelling of the same unit (ton is offered as tonne).
      const offered = units.some((u) => canonicalUnit(u) === canonicalUnit(unit) || (getConversionFactor(u, unit) === 1 && getConversionFactor(unit, u) === 1));
      assert.equal(offered, accepted, `${unit} for a ${factorUnit} factor: offered ${offered}, engine accepts ${accepted}`);
    }
    for (const u of units) assert.equal(applyFactor(10, u, factor).ok, true, `${u} offered for ${factorUnit} is accepted`);
  }
});
