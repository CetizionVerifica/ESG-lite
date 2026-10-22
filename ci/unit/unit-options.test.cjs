// #183 U1-BE: the units a row may use for its emission category are the
// factor's unit and the units the engine converts to it — nothing the save
// would refuse with UNIT_NOT_CONVERTIBLE, nothing it would accept left out.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { allowedUnitsFor, buildUnitOptions } = require(path.resolve("dist/services/emissionWrite/unitOptions.js"));
const { applyFactor } = require(path.resolve("dist/services/emissionWrite/methods/activity.js"));
const { canonicalUnit } = require(path.resolve("dist/services/emissionWrite/units.js"));

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
  const candidates = ["litre", "kg", "kWh", "kl", "Ltr", "gallon", "MT", "tonne", "MWh", "GJ", "SCM", "cubic meter", "ml", "lb"];
  for (const factorUnit of ["litre", "kWh", "tonne", "cubic meter", "kg"]) {
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
  assert.deepEqual(byName.Diesel, { name: "Diesel", factor_unit: "litre", units: ["litre", "SCM"] });
  assert.deepEqual(byName["Grid electricity"].units, ["kWh"]);
  assert.deepEqual(byName["Natural gas"].units, ["SCM", "litre"]);
  assert.deepEqual(byName.HSD, { name: "HSD", maps_to: "Diesel", factor_unit: "litre", units: ["litre", "SCM"] });
  // A pinned factor id wins over the alias's factor name, as the engine resolves it.
  assert.deepEqual(byName["City gas"], { name: "City gas", maps_to: "Unknown", factor_unit: "cubic meter", units: ["SCM", "litre"] });
  assert.equal(options.fixed_unit, null);
  assert.deepEqual(options.all_units, ["litre", "kWh", "SCM", "kg"]);
});
