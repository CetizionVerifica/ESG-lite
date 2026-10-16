// S3-5 spend-based method: which rows are spend rows, the engine formula
// (amount × rate × deflator ratio × factor), its warnings, the rate lookup
// order (nearest earlier day within 7 days, latest, peg), a stored rate reused
// on recalculation, the daily FX job with mocked providers, and the USEEIO
// file reader. No database: fake managers answer the rate queries.
// Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { isSpendRow, spendInputOf, isoDay } = require(path.resolve("dist/scope3/spend/inputs.js"));
const { SpendRateSource, factorCurrency } = require(path.resolve("dist/scope3/spend/rates.js"));
const { supportedCurrency, looksLikeCurrency, SUPPORTED_CURRENCIES, USD_PEGS } = require(path.resolve("dist/scope3/spend/currencies.js"));
const fxJob = require(path.resolve("dist/scope3/spend/fxJob.js"));
const { readUseeio, parseCsv } = require(path.resolve("dist/scope3/spend/useeio.js"));
const { ROW_ISSUE_CODES } = require(path.resolve("dist/imports/errors.js"));

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const ctx = { site_id: 0, category_id: 0, category_name: "", scope: "Scope 3", assigned: true, hasForm: false, spec: null, selectColumns: new Set(), factors: null, fera: null };
const eeio = (over = {}) => ({
  emission_factor_id: 1,
  emission_category_name: "Steel mills (NAICS 331110)",
  factor_value: "0.42",
  denominator_unit: "USD",
  factor_type: "eeio_spend",
  price_currency: "USD",
  price_base_year: 2022,
  year: 2026,
  ...over,
});

// ── inputs ──────────────────────────────────────────────────────────────────
test("a row is a spend row by its method or its factor type", () => {
  assert.equal(isSpendRow({ "@method": "spend_based" }, eeio({ factor_type: "cradle_to_gate" })), true);
  assert.equal(isSpendRow({}, eeio()), true);
  assert.equal(isSpendRow({}, eeio({ factor_type: "cradle_to_gate" }), "spend_based"), true);
  assert.equal(isSpendRow({ "@method": "average_data" }, eeio({ factor_type: "cradle_to_gate" })), false);
});

test("amount and currency: spent_value + currency (fields or extras) on a row asking for spend, else a quantity in a currency unit", () => {
  const spend = { "@method": "spend_based" };
  assert.deepEqual(spendInputOf({ ...spend, spent_value: "1240000", currency: "inr" }, {}, null, "2026-09-30"), { amount: 1240000, currency: "INR", spend_date: "2026-09-30", amount_from: "spent_value" });
  assert.deepEqual(spendInputOf(spend, { spent_value: 50, currency: "EUR", invoice_date: "2026-09-03" }, "kg", "2026-09-30"), { amount: 50, currency: "EUR", spend_date: "2026-09-03", amount_from: "spent_value" });
  assert.deepEqual(spendInputOf({}, { spent_value: 50, currency: "EUR" }, "kg", "2026-09-30", undefined, "spend_based").currency, "EUR", "the row's method column counts too");
  // Without the spend method the old Category 1/2 extras are informational: the quantity in its currency unit decides.
  assert.deepEqual(spendInputOf({ quantity: "1000" }, { spent_value: "1000", currency: "INR" }, "USD", "2026-09-30"), { amount: 1000, currency: "USD", spend_date: "2026-09-30", amount_from: "quantity" });
  assert.equal(spendInputOf({ quantity: "1000" }, { spent_value: "1000", currency: "INR" }, "kg", "2026-09-30"), null);
  assert.deepEqual(spendInputOf({ activity_value: "900" }, null, "USD", "2026-09-30T00:00:00.000Z"), { amount: 900, currency: "USD", spend_date: "2026-09-30", amount_from: "quantity" });
  assert.equal(spendInputOf({ activity_value: "900" }, null, "kwh", "2026-09-30"), null, "kWh is a unit, not a currency");
  assert.equal(spendInputOf({ activity_value: "900" }, null, "ton", "2026-09-30"), null);
  // A bad invoice date falls back to the reporting date.
  assert.equal(spendInputOf({ ...spend, spent_value: "1", currency: "USD", invoice_date: "2026-02-30" }, null, null, "2026-09-30").spend_date, "2026-09-30");
  // The purchase date is never read as the quantity ("2026-09-03" parses as 2026).
  assert.equal(spendInputOf({ invoice_date: "2026-09-03", amount: "25" }, null, "USD", "2026-09-30").amount, 25);
  assert.equal(isoDay("2026-09-03T10:00:00Z"), "2026-09-03");
});

test("currencies: seven supported, three pegged, the factor's currency from price_currency or unit", () => {
  assert.deepEqual([...SUPPORTED_CURRENCIES].sort(), ["AED", "BHD", "EUR", "GBP", "INR", "SAR", "USD"]);
  assert.deepEqual(Object.keys(USD_PEGS).sort(), ["AED", "BHD", "SAR"]);
  assert.equal(supportedCurrency(" inr "), "INR");
  assert.equal(supportedCurrency("JPY"), null);
  assert.equal(looksLikeCurrency("JPY"), true);
  assert.equal(looksLikeCurrency("kwh"), false);
  assert.equal(factorCurrency(eeio({ price_currency: null, denominator_unit: "usd" })), "USD");
  assert.equal(factorCurrency(eeio({ price_currency: null, denominator_unit: "kg" })), null);
});

test("the three spend codes are row issues: one error, two warnings", () => {
  assert.equal(ROW_ISSUE_CODES.CURRENCY_NOT_SUPPORTED, "error");
  assert.equal(ROW_ISSUE_CODES.FX_RATE_FALLBACK, "warning");
  assert.equal(ROW_ISSUE_CODES.NO_DEFLATOR, "warning");
});

// ── engine ──────────────────────────────────────────────────────────────────
const quote = (over = {}) => ({
  amount: 1000000,
  spend_date: "2026-09-03",
  fx: { currency: "INR", to: "USD", rate: 1 / 88.9, as_of: "2026-09-03", source: "ecb", spend_date: "2026-09-03" },
  fallback: false,
  deflator: { country: "US", base_year: 2022, spend_year: 2026, base_index: 292.655, spend_index: 330.2, source: "CI" },
  noDeflator: false,
  ...over,
});

test("spend: amount × rate × index[base] ÷ index[spend year] × factor, rounded only at the end", () => {
  const row = { factor: eeio(), activity_data: { emission_category: "Steel", spent_value: "1000000", currency: "INR" }, activity_unit: "INR", spend: quote() };
  const r = computeRow(ctx, row);
  assert.equal(r.ok, true);
  const kg = (1000000 / 88.9) * (292.655 / 330.2) * 0.42;
  assert.equal(r.computed.total_kgco2e, kg.toFixed(4));
  assert.equal(r.computed.total, Math.round((kg / 1000) * 100) / 100);
  assert.equal(r.computed.method, "spend_based");
  assert.equal(r.computed.activity_unit, "INR");
  assert.equal(r.computed.activityValue, 1000000);
  assert.deepEqual(r.computed.fx, quote().fx);
  assert.equal(r.computed.deflator.base_year, 2022);
  close(r.computed.conversion, (1 / 88.9) * (292.655 / 330.2));
  assert.equal(r.computed.warnings, undefined);
});

test("spend beats a calculation spec: a Category 6 trip paid in INR is the amount spent", () => {
  const specCtx = { ...ctx, spec: { mode: "per_unit", methods: { "passenger.km": { multiply: ["T", "D"] } } } };
  const r = computeRow(specCtx, { factor: eeio(), activity_data: { emission_category: "Air" }, activity_unit: "INR", spend: quote({ deflator: null }) });
  assert.equal(r.ok, true);
  assert.equal(r.computed.total_kgco2e, ((1000000 / 88.9) * 0.42).toFixed(4));
});

test("a form whose fields multiply into the amount (Category 15) spends the product, not the first number", () => {
  const specCtx = { ...ctx, spec: { mode: "per_method", method_column: "@method", methods: { average_data: { multiply: ["Revenue", "Share", "Equity"], percent: ["Share", "Equity"] } } } };
  const row = { factor: eeio({ price_base_year: null, factor_value: "0.6" }), activity_data: { "@method": "average_data", Revenue: "3000000", Share: "100", Equity: "5" }, activity_unit: "USD", method: "average_data", spend: quote({ amount: 3000000, amount_from: "quantity", fx: { currency: "USD", to: "USD", rate: 1, as_of: "2025-12-31", source: "same currency" }, deflator: null }) };
  const r = computeRow(specCtx, row);
  assert.equal(r.ok, true);
  assert.equal(r.computed.total, 90); // 3,000,000 × 5 % × 0.6 kg = 90,000 kg
  assert.equal(row.activity_data.activity_value, "150000");
  // An explicit amount spent is taken as entered.
  const explicit = computeRow(specCtx, { ...row, activity_data: { ...row.activity_data }, spend: { ...row.spend, amount: 1000, amount_from: "spent_value" } });
  assert.equal(explicit.computed.total_kgco2e, "600.0000");
});

test("warnings: FX_RATE_FALLBACK and NO_DEFLATOR never block", () => {
  const r = computeRow(ctx, { factor: eeio(), activity_data: {}, activity_unit: "INR", spend: quote({ fallback: true, deflator: null, noDeflator: true }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.computed.warnings.map((w) => w.code), ["FX_RATE_FALLBACK", "NO_DEFLATOR"]);
  assert.equal(r.computed.total_kgco2e, ((1000000 / 88.9) * 0.42).toFixed(4), "no deflation applied");
});

test("without loaded rates: same currency computes (golden cases), another currency is CURRENCY_NOT_SUPPORTED", () => {
  const same = computeRow(ctx, { factor: eeio({ price_base_year: null }), activity_data: { activity_value: "20000" }, activity_unit: "USD", method: "spend_based" });
  assert.equal(same.ok, true);
  assert.equal(same.computed.total_kgco2e, "8400.0000");
  const other = computeRow(ctx, { factor: eeio(), activity_data: { activity_value: "20000" }, activity_unit: "INR", method: "spend_based" });
  assert.equal(other.ok, false);
  assert.equal(other.issue.code, "CURRENCY_NOT_SUPPORTED");
  // A spend method on a factor per kg with a kg quantity: the activity step, as before.
  const kg = computeRow(ctx, { factor: eeio({ factor_type: "cradle_to_gate", denominator_unit: "kg", price_currency: null }), activity_data: { activity_value: "10" }, activity_unit: "kg", method: "spend_based" });
  assert.equal(kg.ok, true);
  assert.equal(kg.computed.method, undefined);
});

test("zero spend gives zero, never NaN", () => {
  const r = computeRow(ctx, { factor: eeio(), activity_data: {}, activity_unit: "INR", spend: quote({ amount: 0 }) });
  assert.equal(r.ok, true);
  assert.equal(r.computed.total, 0);
  assert.equal(r.computed.total_kgco2e, "0.0000");
});

// ── rate lookup ─────────────────────────────────────────────────────────────
/** A fake manager answering the three rate queries and the deflator query from arrays. */
const fakeManager = (rates, deflators = []) => ({
  queries: [],
  async query(sql, params) {
    this.queries.push(sql);
    if (/FROM price_deflator/.test(sql)) return deflators.filter((d) => d.country === params[0] && d.year === params[1]).map((d) => ({ index: String(d.index), source: d.source ?? "CI" }));
    const [currency, date, days] = params;
    const mine = rates.filter((r) => r.currency === currency).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (/date <= \$2::date/.test(sql)) {
      const limit = new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10);
      return mine.filter((r) => r.date <= date && r.date >= limit).slice(0, 1).map((r) => ({ rate: String(r.rate), date: r.date, source: r.source ?? "ecb" }));
    }
    return mine.slice(0, 1).map((r) => ({ rate: String(r.rate), date: r.date, source: r.source ?? "ecb" }));
  },
});

test("rate: the purchase day, else the nearest earlier day within 7 days", async () => {
  const m = fakeManager([
    { currency: "INR", date: "2026-08-28", rate: 88.1 },
    { currency: "INR", date: "2026-09-01", rate: 88.5 },
    { currency: "INR", date: "2026-09-03", rate: 88.9 },
  ]);
  const src = new SpendRateSource(m);
  const on = await src.quote({ amount: 100, currency: "INR", spend_date: "2026-09-03" }, eeio({ price_base_year: null }));
  close(on.quote.fx.rate, 1 / 88.9);
  assert.equal(on.quote.fx.as_of, "2026-09-03");
  assert.equal(on.quote.fallback, false);
  const weekend = await src.quote({ amount: 100, currency: "INR", spend_date: "2026-09-06" }, eeio({ price_base_year: null }));
  assert.equal(weekend.quote.fx.as_of, "2026-09-03");
  assert.equal(weekend.quote.fallback, false);
});

test("rate: nothing within 7 days → the latest stored rate, flagged", async () => {
  const src = new SpendRateSource(fakeManager([{ currency: "INR", date: "2026-09-03", rate: 88.9 }]));
  const r = await src.quote({ amount: 100, currency: "INR", spend_date: "2026-06-01" }, eeio({ price_base_year: null }));
  assert.equal(r.quote.fallback, true);
  assert.equal(r.quote.fx.as_of, "2026-09-03");
});

test("rate: a pegged currency with nothing stored uses its peg; cross rates go through USD", async () => {
  const src = new SpendRateSource(fakeManager([{ currency: "INR", date: "2026-09-03", rate: 88.9 }]));
  const aed = await src.quote({ amount: 100, currency: "AED", spend_date: "2026-09-03" }, eeio({ price_base_year: null }));
  close(aed.quote.fx.rate, 1 / 3.6725);
  assert.equal(aed.quote.fx.source, "peg");
  const inrToAed = await src.quote({ amount: 100, currency: "INR", spend_date: "2026-09-03" }, eeio({ price_currency: "AED", denominator_unit: "AED", price_base_year: null }));
  close(inrToAed.quote.fx.rate, 3.6725 / 88.9);
  assert.equal(inrToAed.quote.fx.to, "AED");
});

test("rate: unsupported currency, and a per-kg factor chosen for an amount spent, are refused", async () => {
  const src = new SpendRateSource(fakeManager([]));
  const jpy = await src.quote({ amount: 100, currency: "JPY", spend_date: "2026-09-03" }, eeio());
  assert.equal(jpy.ok, false);
  assert.equal(jpy.code, "CURRENCY_NOT_SUPPORTED");
  const perKg = await src.quote({ amount: 100, currency: "USD", spend_date: "2026-09-03" }, eeio({ factor_type: "cradle_to_gate", price_currency: null, denominator_unit: "kg" }));
  assert.equal(perKg.ok, false);
  assert.equal(perKg.code, "FIELD_INVALID");
  assert.equal(perKg.field, "emission_category");
});

test("deflator: index[base] and index[spend year] of the factor currency's country; missing → NO_DEFLATOR", async () => {
  const defl = [
    { country: "US", year: 2022, index: 292.655 },
    { country: "US", year: 2024, index: 313.689 },
  ];
  const src = new SpendRateSource(fakeManager([], defl));
  const ok = await src.quote({ amount: 100, currency: "USD", spend_date: "2024-05-01" }, eeio());
  assert.deepEqual(ok.quote.deflator, { country: "US", base_year: 2022, spend_year: 2024, base_index: 292.655, spend_index: 313.689, source: "CI" });
  const missing = await src.quote({ amount: 100, currency: "USD", spend_date: "2026-05-01" }, eeio());
  assert.equal(missing.quote.deflator, null);
  assert.equal(missing.quote.noDeflator, true);
  const sameYear = await src.quote({ amount: 100, currency: "USD", spend_date: "2022-05-01" }, eeio());
  assert.equal(sameYear.quote.deflator, null);
  assert.equal(sameYear.quote.noDeflator, false);
});

test("recalculation: a stored fx with the same currency and day is reused, not today's rate", async () => {
  const m = fakeManager([{ currency: "INR", date: "2026-09-03", rate: 90 }]);
  const stored = { currency: "INR", to: "USD", rate: 1 / 80, as_of: "2026-09-03", source: "ecb", spend_date: "2026-09-03" };
  const again = await new SpendRateSource(m).quote({ amount: 100, currency: "INR", spend_date: "2026-09-03" }, eeio({ price_base_year: null }), stored);
  close(again.quote.fx.rate, 1 / 80);
  assert.equal(m.queries.length, 0, "no rate looked up");
  const moved = await new SpendRateSource(m).quote({ amount: 100, currency: "INR", spend_date: "2026-09-04" }, eeio({ price_base_year: null }), stored);
  close(moved.quote.fx.rate, 1 / 90, 1e-9);
});

// ── daily job ───────────────────────────────────────────────────────────────
test("job: the first provider that answers with EUR, INR and GBP wins", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("open.er-api.com")) throw new Error("down");
    return { date: "2026-10-15", rates: { EUR: 0.86, INR: 88.9, GBP: 0.75, JPY: 150 } };
  };
  const rows = await fxJob.fetchLatest(fetchJson);
  assert.equal(calls.length, 2);
  assert.deepEqual(rows, [
    { currency: "EUR", date: "2026-10-15", rate_to_usd: 0.86, source: "ecb" },
    { currency: "INR", date: "2026-10-15", rate_to_usd: 88.9, source: "ecb" },
    { currency: "GBP", date: "2026-10-15", rate_to_usd: 0.75, source: "ecb" },
  ]);
});

test("job: stores today's rates plus the pegs, never overwriting a stored day", async () => {
  const stored = new Map();
  const manager = {
    async query(sql, values) {
      assert.match(sql, /ON CONFLICT \(currency, date\) DO NOTHING/);
      const out = [];
      for (let i = 0; i < values.length; i += 4) {
        const key = `${values[i]}:${values[i + 1]}`;
        if (!stored.has(key)) {
          stored.set(key, values[i + 2]);
          out.push({ id: stored.size });
        }
      }
      return out;
    },
  };
  const fetchJson = async () => ({ result: "success", time_last_update_utc: "Thu, 15 Oct 2026 00:02:31 +0000", rates: { EUR: 0.86, INR: 88.9, GBP: 0.75 } });
  assert.deepEqual(await fxJob.runDailyFx(manager, fetchJson), { stored: 6, date: "2026-10-15" });
  const later = async () => ({ result: "success", time_last_update_utc: "Thu, 15 Oct 2026 12:02:31 +0000", rates: { EUR: 0.9, INR: 99, GBP: 0.8 } });
  assert.deepEqual(await fxJob.runDailyFx(manager, later), { stored: 0, date: "2026-10-15" });
  assert.equal(stored.get("INR:2026-10-15"), 88.9, "the first rate of the day stays");
  assert.equal(stored.get("SAR:2026-10-15"), 3.75);
});

test("job: every provider down stores nothing and says so", async () => {
  const manager = { query: async () => assert.fail("nothing to store") };
  assert.deepEqual(await fxJob.runDailyFx(manager, async () => { throw new Error("down"); }), { stored: 0, date: null });
});

test("backfill: ECB history a year per request, skipping years already stored", async () => {
  const urls = [];
  const manager = {
    async query(sql, values) {
      if (/GROUP BY 1/.test(sql)) return [{ y: "2019", n: "255" }];
      return Array.from({ length: values.length / 4 }, (_, i) => ({ id: i }));
    },
  };
  const fetchJson = async (url) => {
    urls.push(url);
    return { rates: { "2020-01-02": { EUR: 0.89, INR: 71.4, GBP: 0.76 } } };
  };
  const n = await fxJob.backfillFx(manager, fetchJson, new Date("2021-03-01T00:00:00Z"));
  assert.deepEqual(urls.map((u) => u.split("/").pop().split("?")[0]), ["2020-01-01..2020-12-31", "2021-01-01..2021-03-01"]);
  assert.equal(n, 12, "3 market + 3 peg rows per request");
});

// ── USEEIO file ─────────────────────────────────────────────────────────────
test("USEEIO: reads the EPA file's code, title and with-margins value at its price year", () => {
  // Shape of the EPA file; the figures here are made up for the test.
  const csv = [
    '"2017 NAICS Code","2017 NAICS Title","GHG","Unit","Supply Chain Emission Factors without Margins","Margins of Supply Chain Emission Factors","Supply Chain Emission Factors with Margins","Reference USEEIO Code"',
    '111110,"Soybean Farming","All GHGs","kg CO2e/2022 USD, purchaser price",1.1,0.1,1.2,"1111A0"',
    '331110,"Iron and Steel Mills, ""and"" Ferroalloy","All GHGs","kg CO2e/2022 USD, purchaser price",0.9,0.05,0.95,"331110"',
    '331111,"Broken","All GHGs","kg CO2e/2022 USD, purchaser price",0.9,0.05,,"x"',
  ].join("\r\n");
  const rows = readUseeio(csv, "SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { code: "331110", name: 'Iron and Steel Mills, "and" Ferroalloy (NAICS 331110)', value: "0.95000000", base_year: 2022, version: "SEF v1.3.0" });
  assert.throws(() => readUseeio("a,b\n1,2", "x.csv"), /not an EPA/);
  assert.deepEqual(parseCsv('a,"b,c"\n1,2'), [["a", "b,c"], ["1", "2"]]);
});

test("the purchase date is never the quantity; the amount spent only on a row asking for spend", () => {
  const { pickActivityValue } = require(path.resolve("dist/services/activityValue.js"));
  assert.equal(pickActivityValue({ invoice_date: "2026-09-03", amount: "40" }, new Set()), 40);
  // An older form whose "Spent value" column is its quantity keeps it.
  assert.equal(pickActivityValue({ spent_value: "500" }, new Set()), 500);
  assert.equal(pickActivityValue({ "@method": "spend_based", spent_value: "500", weight: "3" }, new Set()), 3);
});
