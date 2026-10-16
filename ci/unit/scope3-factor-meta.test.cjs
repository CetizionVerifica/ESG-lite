// S3-2 factor metadata: request validation, the FACTOR_TYPE_MISMATCH warning,
// the snapshot fields and the backfill rules. Runs against the compiled build
// (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const meta = require(path.resolve("dist/scope3/factors/meta.js"));
const backfill = require(path.resolve("dist/scope3/factors/backfill.js"));
const contracts = require(path.resolve("dist/scope3/contracts/factor.js"));
const { factorSnapshot } = require(path.resolve("dist/services/emissionWrite/compute.js"));

test("every allowed-types entry names known factor types", () => {
  for (const [cat, types] of Object.entries(contracts.ALLOWED_FACTOR_TYPES)) {
    assert.ok(Number(cat) >= 1 && Number(cat) <= 15, cat);
    for (const t of types) assert.ok(contracts.isFactorType(t), `${cat}: ${t}`);
  }
});

test("parseFactorMeta reads, normalises and keeps decimals as text", () => {
  const r = meta.parseFactorMeta({
    factor_type: "wtt",
    gwp_set: "ar6",
    geography: " gb ",
    dataset: " DEFRA ",
    dataset_version: "2026",
    co2_kg: "0.00012345",
    ch4_kg: 0.5,
    n2o_kg: null,
    includes_wtt: true,
    price_currency: "usd",
    unrelated: "ignored",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.meta, {
    factor_type: "wtt",
    gwp_set: "AR6",
    geography: "GB",
    dataset: "DEFRA",
    dataset_version: "2026",
    co2_kg: "0.00012345",
    ch4_kg: "0.5",
    n2o_kg: null,
    includes_wtt: true,
    price_currency: "USD",
  });
  assert.deepEqual(meta.parseFactorMeta({}).meta, {});
  assert.deepEqual(meta.parseFactorMeta({ dataset: "  " }).meta, { dataset: null });
});

test("parseFactorMeta refuses bad values with the field name", () => {
  const bad = [
    [{ factor_type: "scope3" }, "factor_type"],
    [{ gwp_set: "AR3" }, "gwp_set"],
    [{ geography: "Great Britain" }, "geography"],
    [{ co2_kg: "-1" }, "co2_kg"],
    [{ co2_kg: "0.123456789" }, "co2_kg"],
    [{ co2_kg: "1e-5" }, "co2_kg"],
    [{ includes_wtt: "yes" }, "includes_wtt"],
    [{ price_base_year: 1800 }, "price_base_year"],
    [{ price_currency: "dollars" }, "price_currency"],
    [{ dataset: "x".repeat(61) }, "dataset"],
  ];
  for (const [body, field] of bad) {
    const r = meta.parseFactorMeta(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.field, field);
  }
});

test("unitMissing", () => {
  for (const u of [undefined, null, "", "  ", 3]) assert.equal(meta.unitMissing(u), true, String(u));
  assert.equal(meta.unitMissing("litre"), false);
});

test("FACTOR_TYPE_MISMATCH only when the category has a number and the type is outside its list", () => {
  assert.equal(meta.factorTypeWarning(null, "wtt"), null);
  assert.equal(meta.factorTypeWarning(1, null), null);
  assert.equal(meta.factorTypeWarning(1, "eeio_spend"), null);
  assert.equal(meta.factorTypeWarning(8, "other"), null); // reported partner emissions (D13)
  assert.equal(meta.factorTypeWarning(8, "wtt").code, "FACTOR_TYPE_MISMATCH"); // Cat 8 has a list since S3-0 #144
  const w = meta.factorTypeWarning(3, "combustion");
  assert.equal(w.code, "FACTOR_TYPE_MISMATCH");
  assert.deepEqual(w.details, { ghg_category: 3, factor_type: "combustion", allowed: ["wtt", "td_loss"] });
  assert.equal(meta.ghgCategoryOf({ ghg_category: 4 }), 4);
  assert.equal(meta.ghgCategoryOf({ category_name: "x" }), null);
});

test("factor_value keeps the old 4-decimal text and any extra precision", () => {
  assert.equal(meta.factorValueText("2680.00000000"), "2680.0000");
  assert.equal(meta.factorValueText("0.23300000"), "0.2330");
  assert.equal(meta.factorValueText("0.00012345"), "0.00012345");
  assert.equal(meta.factorValueText("2.6800"), "2.6800");
  assert.equal(meta.factorValueText(2.68), 2.68);
});

test("the factor snapshot carries the S3-2 fields only when set", () => {
  const base = { emission_factor_id: 9, emission_category_name: "Diesel", global_category_name: null, factor_value: "2.68000000", denominator_unit: "litre", source: "DEFRA", year: 2025 };
  assert.deepEqual(factorSnapshot({ ...base, includes_wtt: false }), {
    emission_factor_id: 9, emission_category_name: "Diesel", global_category_name: undefined,
    factor_value: "2.6800", denominator_unit: "litre", source: "DEFRA", year: 2025,
  });
  const full = factorSnapshot({
    ...base, factor_type: "combustion", gwp_set: "AR6", geography: "GB", dataset: "DEFRA", dataset_version: "2025",
    co2_kg: "2.60000000", ch4_kg: "0.00012345", n2o_kg: null, includes_wtt: false,
  });
  assert.equal(full.factor_type, "combustion");
  assert.equal(full.gwp_set, "AR6");
  assert.equal(full.geography, "GB");
  assert.equal(full.dataset_version, "2025");
  assert.deepEqual(full.gases, { co2_kg: "2.6000", ch4_kg: "0.00012345" });
});

test("backfill: factor type from the category", () => {
  const t = (category_name, scope, denominator_unit = "kg") => backfill.factorTypeFor({ category_name, scope, denominator_unit, source: null });
  assert.equal(t("FERA", "Scope 3"), "wtt");
  assert.equal(t("FERA Purchased Electricity", null), "wtt");
  assert.equal(t("Stationary Combustion", "Scope 1"), "combustion");
  assert.equal(t("Purchased Electricity", "scope2"), "combustion");
  assert.equal(t("Purchased Goods and Services", "Scope 3", "INR"), "eeio_spend");
  assert.equal(t("Purchased Goods and Services", "Scope 3", "tonne"), "cradle_to_gate");
  assert.equal(t("Capital Goods", "S3", "usd"), "eeio_spend");
  assert.equal(t("Upstream Transportation and Distribution", "Scope 3"), "life_cycle");
  assert.equal(t("Business Travel", "Scope 3"), "life_cycle");
  assert.equal(t("Employee Commuting", "Scope-3"), "life_cycle");
  assert.equal(t("Downstream Transportation and Distribution", null), "life_cycle");
  assert.equal(t("Waste Generated in Operations", "Scope 3"), "other");
  assert.equal(t("Renewable Electricity", null), "other");
});

test("backfill: WTT, GWP set and dataset from the source text", () => {
  assert.equal(backfill.includesWtt("DEFRA Freighting goods + WTT- delivery vehs & freight, summed"), true);
  assert.equal(backfill.includesWtt("DESNZ 2024, WTT included"), true);
  assert.equal(backfill.includesWtt("DEFRA WTT- fuels"), false);
  assert.equal(backfill.includesWtt(null), false);
  assert.equal(backfill.gwpSetFrom("IPCC AR5 GWP100"), "AR5");
  assert.equal(backfill.gwpSetFrom("seed values (ar4)"), "AR4");
  assert.equal(backfill.gwpSetFrom("DEFRA 2025"), null);
  assert.equal(backfill.datasetFrom("UK DESNZ 2025"), "DEFRA");
  assert.equal(backfill.datasetFrom("IEA 2023 grid"), "IEA");
  assert.equal(backfill.datasetFrom("US EPA hub"), "EPA");
  assert.equal(backfill.datasetFrom("ecoinvent 3.10"), "ecoinvent");
  assert.equal(backfill.datasetFrom("supplier sheet"), null);
});

test("new factors start on AR6 unless a GWP set is given (D7)", () => {
  assert.deepEqual(meta.withNewFactorDefaults({}), { gwp_set: "AR6" });
  assert.deepEqual(meta.withNewFactorDefaults({ gwp_set: "AR5" }), { gwp_set: "AR5" });
  assert.deepEqual(meta.withNewFactorDefaults({ gwp_set: null }), { gwp_set: null });
});

test("a spend (EEIO) factor needs its price base year and currency (S3-0 rule)", () => {
  assert.equal(meta.eeioPriceProblem({ factor_type: "combustion" }), null);
  assert.equal(meta.eeioPriceProblem({ factor_type: "eeio_spend", price_base_year: 2022, price_currency: "USD" }), null);
  assert.deepEqual(meta.eeioPriceProblem({ factor_type: "eeio_spend", price_base_year: 2022 }), {
    ok: false,
    field: "price_base_year",
    message: "A spend (EEIO) factor needs its price base year and currency.",
  });
});
