// Every-category scenario (ci/workflow/README.md, "Every category"). One client
// reports every Scope 1 and Scope 2 source and all 15 Scope 3 categories. For
// each category the Superadmin sets up the client's own activities (site
// factors) or the deploy seeds the standard form; a User picks one activity,
// enters a month and the stored tCO₂e must equal the kg worked out by hand here
// (never read back from the engine).
//
// Rows are dated in 2026, so they use factor year 2025 (targetYearFor), the
// year the standard Scope 3 seeds carry. The report is calendar year 2026.
// Rounding rule (D5, #209, D14): a row stores tCO₂e at 3 dp and kgCO₂e at 4 dp;
// every report (the Scope 3 table and the scope totals alike) sums kg and rounds once.

const FACTOR_YEAR = 2025;
const REPORT_YEAR = 2026;
const YEAR_TYPE = "CY";

const CLIENT = {
  companyName: "CI Every Category Industries",
  industry: "Manufacturing",
  region: "India",
  contactPerson: "Cora Admin",
  email: "admin@categories.ci.example",
  password: "Categories-admin-1",
};
const PEOPLE = {
  manager: { name: "Cal Manager", email: "manager@categories.ci.example", password: "Categories-manager-1", role: "Manager" },
  user: { name: "Cyd User", email: "user@categories.ci.example", password: "Categories-user-1", role: "User" },
};

/**
 * The client's categories. FERA is found by its name (emissionWrite/context.ts),
 * so it reuses the platform's "FERA" category when one exists.
 */
const CATEGORIES = {
  s1Stationary: { category_name: "CI Cat Stationary combustion", scope: "Scope 1" },
  s1Mobile: { category_name: "CI Cat Mobile combustion", scope: "Scope 1" },
  s1Fugitive: { category_name: "CI Cat Refrigerants", scope: "Scope 1" },
  s1Process: { category_name: "CI Cat Process emissions", scope: "Scope 1" },
  s2Electricity: { category_name: "CI Cat Purchased electricity", scope: "Scope 2" },
  s2Steam: { category_name: "CI Cat Purchased steam", scope: "Scope 2" },
  c1: { category_name: "CI Cat Purchased goods and services", scope: "Scope 3", ghg_category: 1 },
  c2: { category_name: "CI Cat Capital goods", scope: "Scope 3", ghg_category: 2 },
  fera: { category_name: "FERA", scope: "Scope 3", ghg_category: 3 },
  c4: { category_name: "CI Cat Upstream transportation", scope: "Scope 3", ghg_category: 4 },
  c5: { category_name: "CI Cat Waste generated in operations", scope: "Scope 3", ghg_category: 5 },
  c6: { category_name: "CI Cat Business travel", scope: "Scope 3", ghg_category: 6 },
  c7: { category_name: "CI Cat Employee commuting", scope: "Scope 3", ghg_category: 7 },
  c8: { category_name: "CI Cat Upstream leased assets", scope: "Scope 3", ghg_category: 8 },
  c9: { category_name: "CI Cat Downstream transportation", scope: "Scope 3", ghg_category: 9 },
  c10: { category_name: "CI Cat Processing of sold products", scope: "Scope 3", ghg_category: 10 },
  c11: { category_name: "CI Cat Use of sold products", scope: "Scope 3", ghg_category: 11 },
  c12: { category_name: "CI Cat End-of-life treatment", scope: "Scope 3", ghg_category: 12 },
  c13: { category_name: "CI Cat Downstream leased assets", scope: "Scope 3", ghg_category: 13 },
  c14: { category_name: "CI Cat Franchises", scope: "Scope 3", ghg_category: 14 },
  c15: { category_name: "CI Cat Investments", scope: "Scope 3", ghg_category: 15 },
};

/**
 * The client's own activities, kgCO₂e per unit, factor year 2025 (CI test
 * figures, DEFRA-like). Categories 6, 7, 11, 12 and the "Reported emissions"
 * identity factors of 8 and 13–15 are seeded by the deploy and not listed here.
 * A Category 3 factor (cat "fera") has the same name as the activity it follows.
 */
const FACTORS = [
  { cat: "s1Stationary", emission_category_name: "CI Diesel - boiler house", factor_value: 2.66155, denominator_unit: "litre", factor_type: "combustion" },
  { cat: "fera", emission_category_name: "CI Diesel - boiler house", factor_value: 0.62409, denominator_unit: "litre", factor_type: "wtt" },
  { cat: "s1Mobile", emission_category_name: "CI Diesel - delivery fleet", factor_value: 2.51279, denominator_unit: "litre", factor_type: "combustion" },
  { cat: "fera", emission_category_name: "CI Diesel - delivery fleet", factor_value: 0.61001, denominator_unit: "litre", factor_type: "wtt" },
  { cat: "s1Fugitive", emission_category_name: "CI R410A - chiller top-up", factor_value: 2256, denominator_unit: "kg", factor_type: "other" },
  { cat: "s1Process", emission_category_name: "CI Limestone calcination", factor_value: 440, denominator_unit: "tonne", factor_type: "process" },
  { cat: "s2Electricity", emission_category_name: "CI Grid electricity - Maharashtra", factor_value: 0.727, denominator_unit: "kWh", factor_type: "combustion" },
  { cat: "fera", emission_category_name: "CI Grid electricity - Maharashtra", factor_value: 0.11, denominator_unit: "kWh", factor_type: "wtt" },
  // 3c: its own name, matched by its global name; only the factor import sets that (POST /admin/emission-factors/bulk).
  { cat: "fera", emission_category_name: "CI Grid electricity - Maharashtra T&D losses", global_category_name: "CI Grid electricity - Maharashtra", factor_value: 0.052, denominator_unit: "kWh", factor_type: "td_loss", import: true },
  { cat: "s2Steam", emission_category_name: "CI Purchased steam - industrial park", factor_value: 0.2, denominator_unit: "kWh", factor_type: "combustion" },
  { cat: "fera", emission_category_name: "CI Purchased steam - industrial park", factor_value: 0.03, denominator_unit: "kWh", factor_type: "wtt" },
  { cat: "c1", emission_category_name: "CI Steel coil, hot rolled (cradle-to-gate)", factor_value: 1.85, denominator_unit: "kg", factor_type: "cradle_to_gate" },
  { cat: "c2", emission_category_name: "CI CNC machining centre (cradle-to-gate)", factor_value: 3.2, denominator_unit: "kg", factor_type: "cradle_to_gate" },
  { cat: "c4", emission_category_name: "CI Road freight - HGV inbound [tonne.km]", factor_value: 0.107, denominator_unit: "tonne.km", factor_type: "life_cycle" },
  { cat: "c5", emission_category_name: "CI Mixed waste - landfill [tonne]", factor_value: 520.5327, denominator_unit: "tonne", factor_type: "process" },
  { cat: "c8", emission_category_name: "Electricity [kWh]", factor_value: 0.727, denominator_unit: "kWh", factor_type: "combustion" },
  { cat: "c9", emission_category_name: "CI Road freight - van outbound [tonne.km]", factor_value: 0.5, denominator_unit: "tonne.km", factor_type: "life_cycle" },
  { cat: "c10", emission_category_name: "Electricity [kWh]", factor_value: 0.727, denominator_unit: "kWh", factor_type: "combustion" },
];

/** Seeded values the hand-worked figures use, with where the deploy takes them from. */
const SEEDED = {
  hotelIndia: { cat: "c6", name: "Hotel stay - India [night]", value: 58.9 }, // DEFRA 2025, scope3/commuting/factors.ts
  rail: { cat: "c7", name: "Rail - National rail [passenger.km]", value: 0.03546 }, // DEFRA 2025
  r134a: { cat: "c11", name: "R134a - GWP", value: 1530 }, // IPCC AR6 (D7), scope3/soldProducts/configs.ts
  eolPaperLandfill: { cat: "c12", name: "End of life - Paper and board - Landfill [kg]", value: 1.1644894 }, // DEFRA 2025 1,164.4894 per tonne ÷ 1,000
  reportedKg13: { cat: "c13", name: "Reported emissions [kgCO2e]", value: 1 }, // D13 identity factor
  reportedKg14: { cat: "c14", name: "Reported emissions [kgCO2e]", value: 1 },
  reportedT15: { cat: "c15", name: "Reported emissions [tCO2e]", value: 1000 },
};

/**
 * One row per category: what the User selects and types, and the kg worked out
 * by hand. `twins` are the Category 3 rows it creates (kg by sub-category).
 */
const ROWS = [
  // ── Scope 1 ──
  { ref: "s1-stationary", cat: "s1Stationary", date: "2026-01-31", unit: "litre", activity_data: { emission_category: "CI Diesel - boiler house", activity_value: "1500" },
    kg: 1500 * 2.66155, twins: { "3a_upstream_fuels": 1500 * 0.62409 }, why: "1,500 litres × 2.66155" },
  { ref: "s1-mobile", cat: "s1Mobile", date: "2026-01-31", unit: "kl", activity_data: { emission_category: "CI Diesel - delivery fleet", activity_value: "3.2" },
    kg: 3200 * 2.51279, twins: { "3a_upstream_fuels": 3200 * 0.61001 }, why: "3.2 kl = 3,200 litres × 2.51279" },
  { ref: "s1-fugitive", cat: "s1Fugitive", date: "2026-02-28", unit: "kg", activity_data: { emission_category: "CI R410A - chiller top-up", activity_value: "12" },
    kg: 12 * 2256, twins: {}, why: "12 kg leaked × GWP 2,256" },
  { ref: "s1-process", cat: "s1Process", date: "2026-02-28", unit: "kg", activity_data: { emission_category: "CI Limestone calcination", activity_value: "50000" },
    kg: 50 * 440, twins: {}, why: "50,000 kg = 50 t limestone × 440" },
  // ── Scope 2 ──
  { ref: "s2-electricity", cat: "s2Electricity", date: "2026-01-31", unit: "kWh", activity_data: { emission_category: "CI Grid electricity - Maharashtra", activity_value: "60000" },
    kg: 60000 * 0.727, twins: { "3b_upstream_electricity": 60000 * 0.11, "3c_td_losses": 60000 * 0.052 }, why: "60,000 kWh × 0.727" },
  { ref: "s2-steam", cat: "s2Steam", date: "2026-03-31", unit: "MWh", activity_data: { emission_category: "CI Purchased steam - industrial park", activity_value: "100" },
    kg: 100000 * 0.2, twins: { "3b_upstream_electricity": 100000 * 0.03 }, why: "100 MWh = 100,000 kWh × 0.2" },
  // ── Scope 3 ──
  { ref: "c1", cat: "c1", n: 1, date: "2026-01-31", unit: "tonne", activity_data: { emission_category: "CI Steel coil, hot rolled (cradle-to-gate)", activity_value: "20" },
    kg: 20000 * 1.85, why: "20 t = 20,000 kg × 1.85 (average-data)" },
  { ref: "c2", cat: "c2", n: 2, date: "2026-02-28", unit: "tonne", activity_data: { emission_category: "CI CNC machining centre (cradle-to-gate)", activity_value: "2.5" },
    kg: 2500 * 3.2, why: "2.5 t = 2,500 kg × 3.2" },
  // Categories 4 and 9 carry S3-8's standard transport form (migrate:scope3-transport): weight × distance.
  { ref: "c4", cat: "c4", n: 4, date: "2026-01-31", unit: "tonne.km", activity_data: { emission_category: "CI Road freight - HGV inbound [tonne.km]", "Weight (tonne)": "20", "Distance travelled": "600" },
    kg: 20 * 600 * 0.107, why: "20 t × 600 km = 12,000 tonne.km × 0.107 (distance-based)" },
  { ref: "c5", cat: "c5", n: 5, date: "2026-02-28", unit: "kg", activity_data: { emission_category: "CI Mixed waste - landfill [tonne]", activity_value: "4000" },
    kg: 4 * 520.5327, why: "4,000 kg = 4 t × 520.5327 (waste-type-specific)" },
  { ref: "c6", cat: "c6", n: 6, date: "2026-02-28", unit: "night",
    activity_data: { emission_category: "Hotel stay - India [night]", "Trip mode": "Hotel", "Trip class": "India", Rooms: "2", Nights: "3", "Trip ref": "CAT-H1" },
    kg: 2 * 3 * 58.9, why: "2 rooms × 3 nights × 58.9" },
  { ref: "c7", cat: "c7", n: 7, date: "2026-01-31", unit: "passenger.km",
    activity_data: { emission_category: "Rail - National rail [passenger.km]", "@method": "average_data", "Commuting mode": "Rail [passenger.km]", "Total employees": "200", "Share using this mode (%)": "30", "One-way distance (km)": "15", "Trips per day": "2", "Working days per year": "220" },
    kg: 200 * 0.3 * 15 * 2 * 220 * 0.03546, why: "200 staff × 30 % × 15 km × 2 trips × 220 days × 0.03546" },
  { ref: "c8", cat: "c8", n: 8, date: "2026-01-31", unit: "kWh",
    activity_data: { emission_category: "Electricity [kWh]", "Leased asset activity": "Electricity [kWh]", "Building or asset quantity": "12000", "Leased floor area (m²)": "200", "Building floor area (m²)": "2000", "Occupancy rate (%)": "80" },
    kg: ((12000 * 200) / (2000 * 0.8)) * 0.727, why: "12,000 kWh × 200 m² ÷ (2,000 m² × 80 %) × 0.727" },
  { ref: "c9", cat: "c9", n: 9, date: "2026-03-31", unit: "tonne.km", activity_data: { emission_category: "CI Road freight - van outbound [tonne.km]", "Weight (tonne)": "0.8", "Distance travelled": "1000" },
    kg: 0.8 * 1000 * 0.5, why: "0.8 t × 1,000 km = 800 tonne.km × 0.5" },
  { ref: "c10", cat: "c10", n: 10, date: "2026-03-31", unit: "kWh",
    activity_data: { emission_category: "Electricity [kWh]", "@method": "site_specific", "Processing activity": "Electricity [kWh]", "Product name": "Resin pellets", Quantity: "50000", "Share for our product (%)": "40" },
    kg: 50000 * 0.4 * 0.727, why: "50,000 kWh × 40 % × 0.727 (site-specific)" },
  { ref: "c11", cat: "c11", n: 11, date: "2026-03-31", unit: "kg",
    activity_data: { emission_category: "R134a - GWP", Method: "Product containing gas", "Product Name": "Chiller X", "Country / Fuel / Gas": "R134a", "Units Sold": "1000", "Gas per Product (kg)": "0.5", "% of Gas Released": "10" },
    kg: 1000 * 0.5 * 0.1 * 1530, why: "1,000 units × 0.5 kg × 10 % released × GWP 1,530" },
  { ref: "c12", cat: "c12", n: 12, date: "2026-03-31", unit: "kg",
    activity_data: { emission_category: "End of life - Paper and board - Landfill [kg]", "@method": "waste_type_specific", Material: "Paper and board", Treatment: "Landfill", "Product name": "Shipping box", "Mass at end of life (kg)": "10000", "Share treated this way (%)": "50" },
    kg: 10000 * 0.5 * 1.1644894, why: "10,000 kg × 50 % landfilled × 1.1644894" },
  { ref: "c13", cat: "c13", n: 13, date: "2026-02-28", unit: "kgCO2e",
    activity_data: { emission_category: "Reported emissions [kgCO2e]", "Leased asset activity": "Reported Scope 1+2 [kgCO2e]", "Reported Scope 1+2 (kgCO₂e)": "48000", "Leased floor area (m²)": "500", "Building floor area (m²)": "4000" },
    kg: (48000 * 500) / 4000, why: "tenant reports 48,000 kg × 500 m² ÷ 4,000 m²" },
  { ref: "c14", cat: "c14", n: 14, date: "2026-02-28", unit: "kgCO2e",
    activity_data: { emission_category: "Reported emissions [kgCO2e]", "Reported Scope 1+2 (kgCO₂e)": "12000", "Franchises in group": "10", "Franchises sampled": "4" },
    kg: (12000 * 10) / 4, why: "4 sampled franchises report 12,000 kg, × 10 ÷ 4" },
  { ref: "c15", cat: "c15", n: 15, date: "2026-03-31", unit: "tCO2e",
    activity_data: { emission_category: "Reported emissions [tCO2e]", "Investment ref": "INV-1", "Investee Scope 1+2 (tCO₂e)": "5000", "Share of equity (%)": "20" },
    kg: 5000 * 0.2 * 1000, why: "investee 5,000 t × 20 % equity" },
];

/** Scope of each category key, from CATEGORIES. */
const scopeOf = (cat) => CATEGORIES[cat].scope;

module.exports = { FACTOR_YEAR, REPORT_YEAR, YEAR_TYPE, CLIENT, PEOPLE, CATEGORIES, FACTORS, SEEDED, ROWS, scopeOf };
