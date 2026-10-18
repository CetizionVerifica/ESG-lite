// KPI-5 auto adapters, the pure parts: one adapter per AutoSourceKey, the
// report filters for a KPI period (CY/FY, month, quarter), energy rows and
// their GJ (units, the row's own NCV, data/kpi/ncv.json, skipped reasons),
// the renewable split, waste disposal methods, which auto sources a changed
// row can feed, and the debounced refresh job.
//   npm run build && node --test ci/unit/kpi-auto.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { ADAPTERS, missingAdapters } = require(path.resolve("dist/kpi/auto/adapters.js"));
const { ghgFilters } = require(path.resolve("dist/kpi/auto/ghg.js"));
const { rowGj, isEnergyRow, isRenewable, fuelOf } = require(path.resolve("dist/kpi/auto/energy.js"));
const { disposalOf } = require(path.resolve("dist/kpi/auto/waste.js"));
const { createDebouncer, sourcesOf } = require(path.resolve("dist/kpi/auto/hook.js"));
const { periodsFor } = require(path.resolve("dist/kpi/values/period.js"));
const { AUTO_SOURCE_KEYS } = require(path.resolve("dist/kpi/contracts/enums.js"));

test("one adapter per AutoSourceKey", () => {
  assert.deepEqual(missingAdapters(), []);
  assert.equal(Object.keys(ADAPTERS).length, AUTO_SOURCE_KEYS.length);
});

test("report filters for a KPI period: the same year type and year, narrowed to the month or quarter", () => {
  const [fy] = periodsFor("annual", "FY", 2026);
  assert.deepEqual(ghgFilters([1], fy), { siteIds: [1], yearType: "FY", year: 2026, frequency: "yearly" });
  const apr = periodsFor("monthly", "FY", 2026)[0];
  assert.equal(apr.start, "2025-04-01");
  assert.deepEqual(ghgFilters([1, 2], apr), { siteIds: [1, 2], yearType: "FY", year: 2026, frequency: "monthly", month: 4 });
  const q3 = periodsFor("quarterly", "CY", 2026)[2];
  assert.deepEqual(ghgFilters([1], q3), { siteIds: [1], yearType: "CY", year: 2026, frequency: "quarterly", quarter: 3 });
});

const row = (over) => ({ id: 1, scope: "Scope 1", category: "Stationary Combustion", activity: "Diesel", quantity: 1000, unit: "litre", snapshot_ncv: null, snapshot_ncv_unit: null, ...over });

test("energy rows: Scope 2, Scope 1 combustion, renewable electricity; never refrigerants or travel", () => {
  assert.ok(isEnergyRow(row({})));
  assert.ok(isEnergyRow(row({ scope: "Scope 2", category: "Purchased Electricity" })));
  assert.ok(isEnergyRow(row({ scope: null, category: "Renewable Electricity" })));
  assert.ok(isEnergyRow(row({ scope: "Scope 1", category: "Mobile Combustion" })));
  assert.ok(!isEnergyRow(row({ category: "Fugitive Emissions" })));
  assert.ok(!isEnergyRow(row({ scope: "Scope 3", category: "Business Travel" })));
  assert.ok(!isEnergyRow(row({ scope: null, category: "Water" })));
});

test("GJ by hand: energy units directly, fuels through NCV × density, the row's own NCV first, skipped with a reason", () => {
  assert.deepEqual(rowGj(row({})), { gj: 35.714295 }, "1,000 L diesel × 0.830565 kg/L × 43.0 GJ/t");
  assert.deepEqual(rowGj(row({ unit: "kWh", quantity: 10000 })), { gj: 36 });
  assert.deepEqual(rowGj(row({ unit: "MWh", quantity: 2 })), { gj: 7.2 });
  assert.deepEqual(rowGj(row({ unit: "tonne", quantity: 2, activity: "Coal" })), { gj: 51.6 });
  assert.deepEqual(rowGj(row({ unit: "kg", quantity: 500, activity: "LPG" })), { gj: 23.65 });
  assert.deepEqual(rowGj(row({ unit: "m3", quantity: 1000, activity: "Natural gas" })), { gj: 38.496 }, "1,000 m³ × 0.802 kg/m³ × 48 GJ/t");
  assert.deepEqual(rowGj(row({ snapshot_ncv: 0.0386, snapshot_ncv_unit: "litre" })), { gj: 38.6 }, "the factor snapshot's NCV wins");
  assert.match(rowGj(row({ activity: "Hydrogen", unit: "kg" })).skipped, /calorific/);
  assert.match(rowGj(row({ unit: "" })).skipped, /no unit/);
  assert.match(rowGj(row({ unit: "km" })).skipped, /unit km/);
  assert.match(rowGj(row({ quantity: 0 })).skipped, /quantity/);
  assert.match(rowGj(row({ activity: "Coal", unit: "litre" })).skipped, /density/);
});

test("fuels: specific names first; renewable words", () => {
  assert.equal(fuelOf("Biodiesel B100").key, "biodiesel");
  assert.equal(fuelOf("High Speed Diesel (HSD)").key, "diesel");
  assert.equal(fuelOf("Petroleum coke").key, "petcoke");
  assert.equal(fuelOf("Coke oven coke").key, "coke");
  assert.equal(fuelOf("Lignite").key, "lignite");
  assert.equal(fuelOf("Imported coal").key, "coal_bituminous");
  assert.equal(fuelOf("Hydrogen"), null);
  // DESNZ 2025 "Fuel properties" rows told apart (2026-10-18 check).
  assert.equal(fuelOf("Light diesel oil (LDO)").key, "gas_oil");
  assert.equal(fuelOf("Gas oil").key, "gas_oil");
  assert.equal(fuelOf("Propane cylinders").key, "propane");
  assert.equal(fuelOf("ATF").key, "jet_fuel");
  assert.equal(fuelOf("Kerosene").key, "kerosene");
  assert.equal(fuelOf("LNG").key, "lng");
  assert.equal(fuelOf("Liquefied natural gas").key, "lng");
  assert.equal(fuelOf("CNG").key, "natural_gas");
  assert.ok(isRenewable({ category: "Renewable Electricity", activity: "" }));
  assert.ok(isRenewable({ category: "Purchased Electricity", activity: "Solar PPA" }));
  assert.ok(!isRenewable({ category: "Stationary Combustion", activity: "Hydrogen" }));
  assert.ok(!isRenewable({ category: "Purchased Electricity", activity: "Grid" }));
});

test("waste disposal method from the activity name", () => {
  assert.equal(disposalOf("ETP Sludge - Landfill"), "landfill");
  assert.equal(disposalOf("Mixed plastics - Open-loop recycling"), "open_loop_recycling");
  assert.equal(disposalOf("Paper"), null);
});

test("a changed row marks only the auto sources it can feed", () => {
  assert.deepEqual(sourcesOf("Scope 1", null), ["ghg_scope1", "energy_total", "energy_renewable", "energy_non_renewable"]);
  assert.deepEqual(sourcesOf("Scope 2", null).slice(0, 2), ["ghg_scope2_location", "ghg_scope2_market"]);
  assert.deepEqual(sourcesOf("Scope 3", 5), ["ghg_scope3_total", "ghg_scope3_category_5", "waste_total"]);
  assert.deepEqual(sourcesOf("scope-3", 6), ["ghg_scope3_total", "ghg_scope3_category_6"]);
  assert.deepEqual(sourcesOf(null, null), ["energy_total", "energy_renewable", "energy_non_renewable"]);
});

test("debounced job: one run per company after the last change, with every year collected", async () => {
  let now = 0;
  const timers = [];
  const fake = {
    setTimeout: (fn, ms) => {
      const t = { fn, at: now + ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => (t.cleared = true),
  };
  const runs = [];
  const d = createDebouncer(async (company, years) => runs.push([company, years]), 60000, fake);
  d.schedule(1, [2026]);
  now = 30000;
  d.schedule(1, [2025, 2026]);
  d.schedule(2, [2026]);
  assert.deepEqual([...d.pending()], [[1, [2025, 2026]], [2, [2026]]]);
  now = 90000;
  for (const t of timers.filter((t) => !t.cleared && t.at <= now)) t.fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs, [[1, [2025, 2026]], [2, [2026]]]);
  assert.equal(d.pending().size, 0);
  assert.equal(timers.filter((t) => t.cleared).length, 1, "the first timer of company 1 was replaced");
});

test("ncv.json densities: each one checked against DESNZ 2025 'Fuel properties' (figures copied by hand from the table)", () => {
  const ncv = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "../../data/kpi/ncv.json"), "utf8"));
  assert.match(ncv.density_source, /2025.*Fuel properties/);
  // kg/m3 from the table, by row (DESNZ 2025 full set v1).
  const table = { "Biodiesel (ME)": 890, "Gas Oil": 853.971, "Diesel (100% mineral diesel)": 830.565, "Petrol (100% mineral petrol)": 741.84, Propane: 514.933, Butane: 575.374, LPG: 529.749, "Aviation Turbine Fuel": 800, "Burning Oil": 802.568, "Fuel Oil": 983.284, LNG: 452.489, "Natural Gas": 0.802, Naphtha: 674.309 };
  for (const f of ncv.fuels) {
    const density = f.density_kg_per_litre !== undefined ? f.density_kg_per_litre * 1000 : f.density_kg_per_m3;
    if (density === undefined) {
      assert.equal(f.verified, false, `${f.key}: no density, so not marked verified`);
      assert.ok(f.note, `${f.key} says why`);
      continue;
    }
    assert.equal(f.verified, true, f.key);
    assert.ok(f.density_row in table, `${f.key} names a table row`);
    assert.ok(Math.abs(density - table[f.density_row]) < 1e-9, `${f.key}: ${density} = ${table[f.density_row]}`);
  }
});
