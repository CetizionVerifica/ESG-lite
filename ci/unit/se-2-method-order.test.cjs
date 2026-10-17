// SE-2 · the method order through the engine (01-contracts §6 after SE-0), one
// step at a time, plus the form defaults and the currency fallback as
// prepareEntry applies them. No database: the context is built by hand and
// the checks are stubs (no mode lock, no saved rows). Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { prepareEntry } = require(path.resolve("dist/services/emissionWrite/index.js"));
const { FactorIndex, MappingIndex } = require(path.resolve("dist/services/emissionWrite/resolve.js"));
const { methodUnits } = require(path.resolve("dist/scope3/dq/methodOptions.js"));
const form = require(path.resolve("dist/forms/formConfig.js"));

const factor = (id, name, value, unit, over = {}) => ({
  emission_factor_id: id,
  emission_category_name: name,
  global_category_name: name,
  year: 2025,
  factor_value: String(value),
  denominator_unit: unit,
  source: "CI",
  factor_type: "life_cycle",
  ...over,
});
const factors = new FactorIndex([
  factor(1, "Diesel used", 3, "litre"),
  factor(2, "HGV", 1, "km"),
  factor(3, "Pallets", 2, "kg"),
  factor(4, "Steel spend", 0.5, "USD", { factor_type: "eeio_spend", price_currency: "USD", price_base_year: null }),
]);

// "What does your record show?": a fuel bill or a trip, in the client's words.
const shape = {
  columns: [
    { pk_id: 11, column_name: "record_type", column_type: "select" },
    { pk_id: 12, column_name: "Vehicle", column_type: "select" },
  ],
  extra_fields: [{ key: "paid_by", label: "Who paid?", type: "select", options: ["We paid", "Customer or other"] }],
  column_options: { 11: [{ id: "fuel_bill", label: "Fuel bill" }, { id: "trip", label: "Trip distance" }], 12: [{ id: "hgv", label: "HGV" }] },
  dependent_options: {},
};
const methodOptions = [
  { method: "fuel_based", units: ["litre"] },
  { method: "distance_based", units: ["km"] },
];
const choice = { column: "record_type", map: { fuel_bill: "fuel_based", trip: "distance_based" } };

// The rate source S3-5 hands the engine; a fixed USD → USD quote is enough here.
const rates = {
  quote: async (input) => ({
    ok: true,
    quote: {
      amount: input.amount,
      spend_date: input.spend_date,
      fx: { currency: input.currency, to: "USD", rate: input.currency === "USD" ? 1 : 1 / 80, as_of: input.spend_date, source: "CI", spend_date: input.spend_date },
      fallback: false,
      deflator: null,
      noDeflator: false,
    },
  }),
};

const ctx = (over = {}) => {
  const options = over.method_options_full === undefined ? methodOptions : over.method_options_full;
  const settings = over.settings ?? {};
  delete over.method_options_full;
  delete over.settings;
  return {
    site_id: 1,
    category_id: 1,
    category_name: "SE-2 freight",
    scope: "Scope 3",
    assigned: true,
    hasForm: true,
    spec: null,
    selectColumns: new Set(),
    factors,
    fera: null,
    mappings: new MappingIndex(),
    company_id: 1,
    method_options: options ? options.map((o) => o.method) : null,
    method_units: options ? methodUnits(options) : null,
    rates,
    form: form.readFormSettings({ ...shape, method_options: options }, settings),
    default_currency: "INR",
    ...over,
  };
};
const checks = { modeLock: async () => null, existingRows: async () => [] };
const row = (activity_data, unit, over = {}) => ({
  site_id: 1,
  category_id: 1,
  activity_data,
  activity_data_unit: unit,
  period: { date_of_reporting: "2026-07-31", reporting_period: "monthly", year_type: "CY" },
  extra_data: {},
  ...over,
});
const prepare = (c, r) => prepareEntry(c, checks, r);
const ok = async (c, r) => {
  const out = await prepare(c, r);
  assert.equal(out.ok, true, JSON.stringify(out.issue ?? out));
  // What the engine stored on the row: the input after the form's settings, and the result.
  return { ...out.entry, activity_data: out.entry.input.activity_data, extra_data: out.entry.input.extra_data };
};

test("step 1: an importer's method wins over the choice (it must be one the form offers)", async () => {
  const c = ctx({ settings: { method_by_choice: choice } });
  const e = await ok(c, row({ record_type: "trip", emission_category: "HGV", activity_value: "100" }, "km", { method: "fuel_based" }));
  assert.equal(e.computed.method, "fuel_based");
  assert.equal(e.computed.total, 0.1, "the label moves, the total doesn't");
  const refused = await prepare(c, row({ record_type: "trip", emission_category: "HGV", activity_value: "100" }, "km", { method: "spend_based" }));
  assert.equal(refused.ok, false);
  assert.equal(refused.issue.code, "METHOD_NOT_ALLOWED");
});

test("step 2: the choice decides; a contributor's own method or @method is ignored where the form fixes one", async () => {
  const c = ctx({ settings: { method_by_choice: choice } });
  const caller = await ok(c, row({ record_type: "Fuel bill", emission_category: "Diesel used", activity_value: "10" }, "litre"));
  assert.equal(caller.computed.method, "fuel_based", "an importer naming no method gets the choice's (by label too)");
  const user = await ok(c, row({ record_type: "trip", "@method": "fuel_based", emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor", method: "spend_based" }));
  assert.equal(user.computed.method, "distance_based");
  assert.equal(user.activity_data["@method"], "distance_based", "the contributor's @method is replaced, never left to contradict the form");
  // A choice map fixes the method even when the answer maps to nothing: the row's own is still ignored.
  const unmapped = await ok(c, row({ "@method": "fuel_based", emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor" }));
  assert.equal(unmapped.activity_data["@method"], "distance_based", "replaced with the form's method for km (S3-8)");
  assert.equal(unmapped.computed.method, "distance_based");
  assert.equal(unmapped.computed.total, 0.1);
  // One method on the form fixes it too.
  const single = ctx({ method_options_full: [{ method: "distance_based", units: ["km"] }] });
  const one = await ok(single, row({ "@method": "fuel_based", emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor" }));
  assert.equal(one.computed.method, "distance_based");
  // Several methods and no choice map: the form fixes none, so S3-3's rule stands.
  const several = await prepare(ctx(), row({ "@method": "spend_based", emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor" }));
  assert.equal(several.ok, false);
  assert.equal(several.issue.code, "METHOD_NOT_ALLOWED");
});

test("step 3: no method and no choice, the form's method for the row's unit (S3-8), then method_options[0]", async () => {
  const c = ctx();
  assert.equal((await ok(c, row({ emission_category: "HGV", activity_value: "100" }, "km"))).computed.method, "distance_based", "km is distance_based's unit");
  assert.equal((await ok(c, row({ emission_category: "Pallets", activity_value: "5" }, "kg"))).computed.method, "fuel_based", "a unit no method lists: method_options[0]");
});

test("step 4: an eeio_spend factor makes a spend row (S3-5); step 5: no form methods, average data", async () => {
  const spendForm = ctx({ method_options_full: [{ method: "average_data", units: [] }] });
  const spend = await ok(spendForm, row({ emission_category: "Steel spend", spent_value: "1000", currency: "USD" }, "USD", { extra_data: { invoice_date: "2026-07-15" } }));
  assert.equal(spend.computed.method, "spend_based");
  assert.equal(spend.computed.total, 0.5, "1000 USD × 0.5 kg");
  const bare = ctx({ method_options_full: null });
  assert.equal((await ok(bare, row({ emission_category: "Pallets", activity_value: "5" }, "kg"))).computed.method, "average_data");
});

test("defaults: a hidden field's default fills an empty field, never overwrites; units.fixed fills a missing unit, refuses another", async () => {
  const c = ctx({ settings: { method_by_choice: choice, field_settings: { Vehicle: { hidden: true, default: "hgv" }, paid_by: { hidden: true, default: "We paid" } } } });
  const filled = await ok(c, row({ record_type: "trip", emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor" }));
  assert.equal(filled.activity_data.Vehicle, "hgv");
  assert.equal(filled.extra_data.paid_by, "We paid");
  const kept = await ok(c, row({ record_type: "trip", Vehicle: "van", emission_category: "HGV", activity_value: "100" }, "km", { extra_data: { paid_by: "Customer or other" } }));
  assert.equal(kept.activity_data.Vehicle, "van");
  assert.equal(kept.extra_data.paid_by, "Customer or other");

  const fixed = ctx({ settings: { units: { fixed: "km" } } });
  const none = await ok(fixed, row({ emission_category: "HGV", activity_value: "20" }, ""));
  assert.equal(none.computed.activity_unit, "km");
  assert.equal(none.computed.total, 0.02);
  const other = await prepare(fixed, row({ emission_category: "HGV", activity_value: "20" }, "litre"));
  assert.equal(other.ok, false);
  assert.equal(other.issue.code, "UNIT_NOT_ALLOWED");
  assert.equal(other.issue.field, "activity_data_unit");
});

test("currency: the row's currency unit, then currency.fixed, then the company's default_currency", async () => {
  const spendOptions = [{ method: "spend_based", units: ["INR", "USD"] }];
  const r = (activity_data, unit) => row({ emission_category: "Steel spend", spent_value: "8000", ...activity_data }, unit, { extra_data: { invoice_date: "2026-07-15" }, method_source: "contributor" });
  const company = await ok(ctx({ method_options_full: spendOptions }), r({}, ""));
  assert.equal(company.activity_data.currency, "INR", "the company's default");
  assert.equal(company.computed.fx.currency, "INR");
  const fixedForm = ctx({ method_options_full: spendOptions, settings: { currency: { fixed: "USD" } } });
  const fixed = await ok(fixedForm, r({}, ""));
  assert.equal(fixed.activity_data.currency, "USD", "the form's fixed currency wins over the company's");
  const unit = await ok(fixedForm, r({}, "INR"));
  assert.equal(unit.activity_data.currency, undefined, "a row whose unit is a currency keeps it");
  assert.equal(unit.computed.activity_unit, "INR");
  const own = await ok(fixedForm, r({ currency: "INR" }, ""));
  assert.equal(own.activity_data.currency, "INR", "a currency the row gives is never overwritten");
});

test("a form with none of the SE-2 settings: a User's row gives the same result as an importer's", async () => {
  const c = ctx({ form: form.NO_FORM_SETTINGS });
  const a = await ok(c, row({ emission_category: "HGV", activity_value: "100" }, "km", { method_source: "contributor" }));
  const b = await ok(c, row({ emission_category: "HGV", activity_value: "100" }, "km"));
  assert.deepEqual([a.computed.total, a.computed.method], [b.computed.total, b.computed.method]);
});
