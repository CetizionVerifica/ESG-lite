// Scope 3 golden cases (S3-0): the GHG Protocol guidance's worked examples,
// run through the engine (emissionWrite computeRow) with an in-memory context.
// No database. Runs against the compiled build:
//   npm run build && npm run test:scope3-golden
//
// Only cases with "status": "run" count. Each starts as "skip"; the owner
// module turns its own cases on when its method lands, and fills in the
// figures first where the docs give none (docs/scope3/01-contracts.md §9).
// A run case fails when |actual - expected| > max(0.5 kg, 0.1 % of expected).
//
//   SCOPE3_GOLDEN_ALL=1 npm run test:scope3-golden   # also show skipped cases (never fails on them)
const path = require("path");
const fs = require("fs");

const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const file = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
const showAll = process.env.SCOPE3_GOLDEN_ALL === "1";

const ctx = {
  site_id: 0,
  category_id: 0,
  category_name: "Scope 3 golden",
  scope: "Scope 3",
  assigned: true,
  hasForm: false,
  spec: null,
  selectColumns: new Set(),
  factors: null,
  fera: null,
};

const tolerance = (expected) => Math.max(file.tolerance.kg, Math.abs(expected) * file.tolerance.relative);

/**
 * kgCO₂e of one row: the engine's kg figure once it has one (`total_kgco2e`
 * per 01-contracts.md §6; S3-4 #137 names it `total_kg`), else the 2 dp tCO₂e × 1000.
 */
const rowKg = (k, row, i) => {
  const f = k.factors[row.factor];
  if (!f) throw new Error(`${k.id}: row ${i} names unknown factor "${row.factor}"`);
  const factor = {
    emission_factor_id: -(i + 1),
    emission_category_name: row.label,
    global_category_name: row.label,
    year: 2026,
    factor_value: String(f.kgco2e_per_unit),
    denominator_unit: f.unit,
    source: `guidance ${k.guidance_ref.example}`,
  };
  const value = row.quantity * (row.share ?? 1);
  const result = computeRow(ctx, {
    factor,
    activity_data: { emission_category: row.label, activity_value: String(value) },
    activity_unit: row.unit,
    method: k.method,
    proxy: k.proxy,
  });
  if (!result.ok) throw new Error(`${k.id}: row ${i} (${row.label}) gives ${result.issue.code}: ${result.issue.message}`);
  const c = result.computed;
  const kg = c.total_kgco2e ?? c.total_kg;
  return kg !== undefined ? Number(kg) : c.total * 1000;
};

let failed = 0;
let ran = 0;
for (const k of file.cases) {
  const run = k.status === "run";
  if (!run && !showAll) continue;
  if (k.expected_kgco2e === null) {
    if (run) {
      console.log(`FAIL ${k.id.padEnd(22)} ${k.owner.padEnd(6)} runs without figures`);
      ran++;
      failed++;
    }
    continue;
  }
  if (!k.rows.length) {
    // Report-level cases are checked through the API by their owner (S3-13);
    // here a run case needs rows, or nothing would check it.
    if (run) {
      console.log(`FAIL ${k.id.padEnd(22)} ${k.owner.padEnd(6)} runs without rows`);
      ran++;
      failed++;
    }
    continue;
  }
  let actual;
  let error = null;
  try {
    actual = k.rows.reduce((sum, row, i) => sum + rowKg(k, row, i), 0);
  } catch (err) {
    error = err.message;
  }
  const ok = !error && Math.abs(actual - k.expected_kgco2e) <= tolerance(k.expected_kgco2e);
  const label = run ? (ok ? "pass" : "FAIL") : "skip";
  const detail = error ?? `actual ${actual.toFixed(2)} kg, expected ${k.expected_kgco2e} kg`;
  console.log(`${label.padEnd(4)} ${k.id.padEnd(22)} ${k.owner.padEnd(6)} ${detail}`);
  if (run) {
    ran++;
    if (!ok) failed++;
  }
}

const skipped = file.cases.filter((k) => k.status !== "run").length;
console.log(`Scope 3 golden: ${ran} run, ${failed} failed, ${skipped} skipped (of ${file.cases.length}).`);
if (failed) {
  console.error("::error::A Scope 3 golden case no longer matches its worked example. Fix the method, or explain the change in the PR.");
  process.exit(1);
}
