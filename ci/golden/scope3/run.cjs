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

/** The case's factor `key` as the engine's emission factor. */
const emissionFactorOf = (k, key, id, label) => {
  const f = k.factors[key];
  if (!f) throw new Error(`${k.id}: unknown factor "${key}"`);
  return {
    emission_factor_id: id,
    emission_category_name: label,
    global_category_name: label,
    year: 2026,
    factor_value: String(f.kgco2e_per_unit),
    denominator_unit: f.unit,
    source: `guidance ${k.guidance_ref.example}`,
  };
};

/**
 * S3-6: a row with `supplier` is calculated from the supplier's own figures,
 * the way `src/scope3/suppliers` hands them to the engine:
 *   - `supplier.factor`: a case factor key used as the supplier's cradle-to-gate figure (supplier-specific);
 *   - `supplier.lines`: hybrid input lines `{kind, name, quantity, unit, factor}` (factor = a case factor key);
 *   - `supplier.facility` / `supplier.purchased_value`: facility data to allocate (hybrid).
 */
const supplierOf = (k, row, i) => {
  const s = row.supplier;
  if (!s) return undefined;
  let factor = null;
  if (s.factor) {
    const f = k.factors[s.factor];
    if (!f) throw new Error(`${k.id}: row ${i} names unknown factor "${s.factor}"`);
    factor = {
      supplier_factor_id: -(i + 1),
      item: row.label,
      unit: f.unit,
      kgco2e_per_unit: f.kgco2e_per_unit,
      boundary: "cradle_to_gate",
      reference_year: 2026,
      gwp_set: "AR6",
      has_evidence: true,
      source: "manual",
    };
  }
  return {
    supplier_id: s.id ?? 1,
    country: s.country ?? null,
    factor,
    facility: s.facility ?? null,
    purchased_value: s.purchased_value ?? null,
    lines: (s.lines ?? []).map((l, j) => ({ kind: l.kind, name: l.name, quantity: l.quantity, unit: l.unit, factor: emissionFactorOf(k, l.factor, -(100 * (i + 1) + j), l.name) })),
  };
};

/**
 * kgCO₂e of one row: the engine's kg figure once it has one (`total_kgco2e`
 * per 01-contracts.md §6; S3-4 #137 names it `total_kg`), else the 2 dp tCO₂e × 1000.
 */
const rowKg = (k, row, i) => {
  const supplier = supplierOf(k, row, i);
  if (!row.factor && !supplier) throw new Error(`${k.id}: row ${i} names no factor`);
  const factor = row.factor ? emissionFactorOf(k, row.factor, -(i + 1), row.label) : null;
  const value = row.quantity * (row.share ?? 1);
  const result = computeRow(ctx, {
    factor,
    activity_data: { emission_category: row.label, activity_value: String(value) },
    activity_unit: row.unit,
    method: k.method,
    proxy: k.proxy,
    ...(supplier ? { supplier } : {}),
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
