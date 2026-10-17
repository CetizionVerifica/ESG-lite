// The client the workflow test onboards, and every figure it expects, worked
// out by hand from the inputs below (never read back from the engine).
// Change an input here and its expected figures follow; a lane that adds a
// calculation adds its inputs and expected kg here too (README.md).
//
// Rounding rule (D5): each row stores tCO₂e at 2 dp and kgCO₂e at 4 dp; the
// Scope 3 report sums kg first and rounds once.

// The client reports by Indian financial year (April to March, the app's default year type).
// Rows run from 1 Apr 2025 to 31 Mar 2026. Reports name a financial year by the
// year it ENDS in (reporting/ghg-data.ts getDateRange), so this is "FY 2026":
// completed, so it can be frozen as the base year.
const YEAR = 2025; // calendar year the financial year starts in (entry dates)
const YEAR_TYPE = "FY";
const REPORT_YEAR = YEAR + 1;

const SUPERADMIN = { name: "CI Workflow Superadmin", email: "superadmin@workflow.ci.example", password: "Workflow-super-1" };

const CLIENT = {
  companyName: "CI Workflow Chemicals",
  industry: "Chemicals",
  region: "India",
  contactPerson: "Asha Admin",
  email: "admin@workflow.ci.example",
  password: "Workflow-admin-1",
};
const OTHER_CLIENT = { companyName: "CI Workflow Other Co", contactPerson: "Omar Other", email: "admin@other.workflow.ci.example", password: "Workflow-other-1" };

const PEOPLE = {
  manager: { name: "Mina Manager", email: "manager@workflow.ci.example", password: "Workflow-manager-1", role: "Manager" },
  userMain: { name: "Uma User", email: "user.main@workflow.ci.example", password: "Workflow-user-1", role: "User" },
  userPlantB: { name: "Bala User", email: "user.plantb@workflow.ci.example", password: "Workflow-user-2", role: "User" },
};

const COUNTRY = { name: "India", code: "IN" };
const PLANT_B = { name: "CI Workflow Plant B", address: "Plot 7, MIDC, Pune", contact_person: "Bala User" };

/** Global categories the Superadmin creates (Phase 0). The FERA category is found by its name "FERA". */
const CATEGORIES = {
  fuel: { category_name: "Stationary combustion", scope: "Scope 1" },
  electricity: { category_name: "Purchased electricity", scope: "Scope 2" },
  fera: { category_name: "FERA", scope: "Scope 3", ghg_category: 3 },
  travel: { category_name: "Business travel", scope: "Scope 3", ghg_category: 6 },
  goods: { category_name: "Purchased goods and services", scope: "Scope 3", ghg_category: 1 },
};

/**
 * Site factors, kgCO₂e per unit (Phase 4). Each site gets the same set.
 * The engine looks up the factor of the year BEFORE a row's calendar year
 * (emissionWrite/resolve.ts targetYearFor): Apr–Dec 2025 rows use 2024
 * factors, Jan–Mar 2026 rows use 2025 factors. So FY 2025 needs both years,
 * and the values differ so the test proves the right year was used. A
 * Category 3 (FERA) factor has no fallback year: a missing year means no
 * Category 3 row, only a FERA_FACTOR_MISSING warning.
 */
const FACTOR_YEARS = [2024, 2025];
const FACTORS = {
  diesel: { cat: "fuel", emission_category_name: "Diesel", values: { 2024: 2.68, 2025: 2.66155 }, denominator_unit: "litre", source: "DEFRA", factor_type: "combustion", gwp_set: "AR6" },
  dieselWtt: { cat: "fera", emission_category_name: "Diesel", values: { 2024: 0.61, 2025: 0.62409 }, denominator_unit: "litre", source: "DEFRA", factor_type: "wtt", gwp_set: "AR6" },
  grid: { cat: "electricity", emission_category_name: "Grid electricity - India", values: { 2024: 0.716, 2025: 0.727 }, denominator_unit: "kWh", source: "CEA", factor_type: "combustion", gwp_set: "AR6" },
  gridWtt: { cat: "fera", emission_category_name: "Grid electricity - India", values: { 2024: 0.1, 2025: 0.11 }, denominator_unit: "kWh", source: "CI test figure", factor_type: "wtt", gwp_set: "AR6" },
  // T&D losses (3c): its own name, matched to the activity by its global name. The single-factor
  // create has no global name, so this one goes through the factor import (POST /admin/emission-factors/bulk).
  gridTd: { cat: "fera", emission_category_name: "Grid electricity - India T&D losses", global_category_name: "Grid electricity - India", values: { 2024: 0.05, 2025: 0.052 }, denominator_unit: "kWh", source: "CI test figure", factor_type: "td_loss", gwp_set: "AR6", import: true },
};

/** The factor year the engine uses for a row dated `date` (YYYY-MM-DD). */
const factorYearOf = (date) => Number(date.slice(0, 4)) - 1;

/** Category 6: the standard form's factor for a domestic flight (DEFRA 2025, seeded by migrate:scope3-travel), used by Jan–Mar 2026 rows. */
const FLIGHT = { name: "Flights - Domestic - Average passenger - With RF [passenger.km]", kg_per_pkm: 0.22928, unit: "passenger.km" };

/** Category 1 spend (S3-5): one USEEIO sector copied from the library, an INR amount, a stored rate and a deflator. */
const SPEND = {
  sector: "Plastics Material and Resin Manufacturing",
  amount_inr: 500000,
  invoice_date: `${YEAR}-06-10`,
  row_date: `${YEAR}-06-30`, // looks up the sector copied for factor year 2024
  inr_per_usd: 85.6, // stands in for the daily FX job (network) on the invoice date
  deflator_2025: 321.943, // US CPI-U 2025 annual average (BLS), seeded by migrate:scope3-spend
};

/**
 * The rows people enter. `site` is "main" or "plantB"; `cat` a CATEGORIES key;
 * `kg` the hand-worked kgCO₂e of the row and `twins` of its Category 3 rows.
 * `review` is what the Manager does: approve, reject or leave pending.
 */
const ENTRIES = [
  { ref: "diesel-apr", who: "userMain", site: "main", cat: "fuel", date: `${YEAR}-04-30`, activity: "Diesel", value: 1200, unit: "litre", review: "approve" },
  { ref: "grid-apr", who: "userMain", site: "main", cat: "electricity", date: `${YEAR}-04-30`, activity: "Grid electricity - India", value: 45000, unit: "kWh", review: "approve" },
  { ref: "diesel-may", who: "userMain", site: "main", cat: "fuel", date: `${YEAR}-05-31`, activity: "Diesel", value: 800, unit: "litre", review: "approve" },
  { ref: "diesel-jun-wrong", who: "userMain", site: "main", cat: "fuel", date: `${YEAR}-06-30`, activity: "Diesel", value: 99999, unit: "litre", review: "reject" },
  { ref: "diesel-mar-pending", who: "userMain", site: "main", cat: "fuel", date: `${YEAR + 1}-03-31`, activity: "Diesel", value: 500, unit: "litre", review: "leave" },
  { ref: "grid-jan-b", who: "userPlantB", site: "plantB", cat: "electricity", date: `${YEAR + 1}-01-31`, activity: "Grid electricity - India", value: 20000, unit: "kWh", review: "approve" },
];

/** kg of each row and its Category 3 twins, from FACTORS. */
function expectedFor(e) {
  const f = (k) => FACTORS[k].values[factorYearOf(e.date)];
  if (e.cat === "fuel") return { kg: e.value * f("diesel"), twins: { "3a_upstream_fuels": e.value * f("dieselWtt") } };
  if (e.cat === "electricity") return { kg: e.value * f("grid"), twins: { "3b_upstream_electricity": e.value * f("gridWtt"), "3c_td_losses": e.value * f("gridTd") } };
  throw new Error(`no expectation for ${e.cat}`);
}

const TRAVEL = { ref: "flight-feb", who: "userMain", site: "main", date: `${YEAR + 1}-02-28`, travellers: 2, distance_km: 1400 };
const travelKg = () => TRAVEL.travellers * TRAVEL.distance_km * FLIGHT.kg_per_pkm;

/** kg of the spend row once the copied factor value, base year and deflators are known. */
const spendKg = ({ factor_value, base_index, spend_index }) => (SPEND.amount_inr / SPEND.inr_per_usd) * (base_index / spend_index) * factor_value;

/**
 * Scope 3 screening (S3-12, Phase 3): the Admin gives the headcount for
 * Category 7. The screening estimate assumes every employee drives an average
 * car (DEFRA 2025 "Car - Average car - Unknown fuel", 0.16725 kgCO₂e per
 * vehicle.km) 15 km each way, 2 trips a day, 230 working days. It is shown,
 * never saved as a row.
 */
const SCREENING = {
  headcount: 120,
  one_way_km: 15,
  trips_per_day: 2,
  working_days: 230,
  car_kg_per_vkm: 0.16725,
  tick: { n: 6, key: "stakeholders" }, // Table II "Stakeholders" on business travel
};
/** 120 × 15 × 2 × 230 = 828,000 vehicle.km × 0.16725 = 138,483 kg. */
const screeningKg = () => SCREENING.headcount * SCREENING.one_way_km * SCREENING.trips_per_day * SCREENING.working_days * SCREENING.car_kg_per_vkm;

/**
 * Review workflow v2 (S3-15 parts 3–4), switched on after the reports are checked: the main
 * site's User files August as Drafts, submits, marks the two Scope 3 categories "Nothing this
 * month", and the Manager approves and closes the month. Factor year 2024 (Aug 2025 rows):
 * diesel 300 l × 2.68 = 804 kg (3a: 300 × 0.61 = 183 kg); grid 10,000 kWh × 0.716 = 7,160 kg
 * (3b: 1,000 kg, 3c: 500 kg).
 */
const REVIEW_V2 = {
  year: YEAR,
  month: 8,
  period: `${YEAR}-08`,
  late_date: `${YEAR}-08-20`,
  entries: [
    { ref: "v2-diesel-aug", cat: "fuel", date: `${YEAR}-08-31`, activity: "Diesel", value: 300, unit: "litre" },
    { ref: "v2-grid-aug", cat: "electricity", date: `${YEAR}-08-31`, activity: "Grid electricity - India", value: 10000, unit: "kWh" },
  ],
};

/** Boundary choices the client's Admin makes (Phase 3). */
const BOUNDARY = {
  consolidation_approach: "operational_control",
  set: [
    { n: 9, status: "excluded", reason: "Customers collect at the gate; no downstream transport." },
    { n: 11, status: "not_relevant", reason: "Our resins use no energy in use." },
  ],
};

/**
 * S3-6: one supplier, its own cradle-to-gate product figure, and one Category 1
 * purchase from it calculated with that figure ("Supplier's own figure").
 * 2.5 t of ingot × 8.6 kgCO₂e/kg = 2,500 kg × 8.6 = 21,500 kgCO₂e = 21.5 tCO₂e.
 */
const SUPPLIER = {
  name: "Gulf Smelter Co.",
  country: "BH",
  factor: { item: "P1020 aluminium ingot", unit: "kg", kgco2e_per_unit: 8.6, reference_year: YEAR, boundary: "cradle_to_gate" },
  purchase: { date: `${YEAR}-07-31`, quantity: 2.5, unit: "tonne", kg: 2500 * 8.6 },
};

module.exports = { REVIEW_V2, SUPPLIER, YEAR, YEAR_TYPE, REPORT_YEAR, SUPERADMIN, CLIENT, OTHER_CLIENT, PEOPLE, COUNTRY, PLANT_B, CATEGORIES, FACTORS, FLIGHT, SPEND, ENTRIES, expectedFor, FACTOR_YEARS, factorYearOf, TRAVEL, travelKg, spendKg, SCREENING, screeningKg, BOUNDARY };
