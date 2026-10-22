#!/usr/bin/env node
// #183 U3-BE: which saved entries use a unit their emission category no longer
// offers (GET …/units/…/by-activity). Read-only: every connection is opened with
// default_transaction_read_only, nothing is recalculated or rewritten. Totals,
// reports, approvals and exports stay as stored; Shyam decides per client
// whether a Manager fixes the rows by hand.
//
//   npm run build && npm run audit:unit-fit                 # writes unit-fit-audit.csv
//   npm run build && npm run audit:unit-fit -- other.csv
//
// The CSV lists company_id, site_id, category_id, emission_id, status,
// emission_category, activity_data_unit, factor_unit and refused_on_save: true
// when saving the row again would be refused (UNIT_NOT_CONVERTIBLE), false when
// the unit converts but is spelled differently from every unit offered ("Kilo
// Litre" where the form lists "KL"). The console shows ids and counts only. Rows with no emission category, no unit or no factor now are
// skipped: the save refuses those for another reason, not the unit.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
const { AppDataSource } = require(path.join(ROOT, "dist/config/data-source.js"));
const { ContextCache } = require(path.join(ROOT, "dist/services/emissionWrite/context.js"));
const { allowedUnitsFor, buildUnitOptions, isUnitAllowed, unitOptionsSourceOf } = require(path.join(ROOT, "dist/services/emissionWrite/unitOptions.js"));
const { normalizeName } = require(path.join(ROOT, "dist/services/emissionWrite/resolve.js"));

const PAGE = 5000;
const csv = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

(async () => {
  const out = path.resolve(process.argv[2] || "unit-fit-audit.csv");
  AppDataSource.setOptions({ extra: { ...(AppDataSource.options.extra || {}), options: "-c default_transaction_read_only=on" } });
  await AppDataSource.initialize();
  const pairs = await AppDataSource.query(
    `SELECT DISTINCT e.site_id, e.category_id, s.company_id FROM emission e JOIN site s ON s.site_id = e.site_id ORDER BY e.site_id, e.category_id`,
  );
  const cache = new ContextCache(AppDataSource.manager);
  const lines = ["company_id,site_id,category_id,emission_id,status,emission_category,activity_data_unit,factor_unit,refused_on_save"];
  const byCompany = new Map();
  let checked = 0;
  let refused = 0;
  for (const pair of pairs) {
    const ctx = await cache.context(pair.site_id, pair.category_id);
    const options = buildUnitOptions(unitOptionsSourceOf(ctx));
    const perUnit = ctx.spec?.mode === "per_unit";
    const byName = new Map(options.activities.map((a) => [normalizeName(a.name), a]));
    for (let after = 0; ; ) {
      const rows = await AppDataSource.query(
        `SELECT pk_id, status, activity_data->>'emission_category' AS emission_category, activity_data_unit
           FROM emission WHERE site_id = $1 AND category_id = $2 AND pk_id > $3 ORDER BY pk_id LIMIT ${PAGE}`,
        [pair.site_id, pair.category_id, after],
      );
      if (!rows.length) break;
      after = rows[rows.length - 1].pk_id;
      for (const r of rows) {
        const activity = r.emission_category && r.activity_data_unit ? byName.get(normalizeName(r.emission_category)) : undefined;
        if (!activity || !activity.factor_unit) continue;
        checked++;
        if (isUnitAllowed(activity.units, r.activity_data_unit, perUnit)) continue;
        const unit = r.activity_data_unit;
        const accepted = isUnitAllowed(allowedUnitsFor({ factorUnits: [activity.factor_unit], candidates: [unit], perUnit }), unit, perUnit);
        if (!accepted) refused++;
        lines.push([pair.company_id, pair.site_id, pair.category_id, r.pk_id, r.status, r.emission_category, unit, activity.factor_unit, !accepted].map(csv).join(","));
        byCompany.set(pair.company_id, (byCompany.get(pair.company_id) || 0) + 1);
      }
    }
  }
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`audit:unit-fit: ${checked} entries checked in ${pairs.length} site × category pairs; ${lines.length - 1} use a unit no longer offered, ${refused} of them would be refused on save → ${out}`);
  for (const [company, n] of [...byCompany].sort((a, b) => a[0] - b[0])) console.log(`  company ${company}: ${n}`);
  await AppDataSource.destroy();
})().catch((err) => {
  console.error("audit:unit-fit failed:", err.message);
  process.exit(1);
});
