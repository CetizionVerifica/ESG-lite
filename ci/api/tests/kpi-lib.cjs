// Shared bits for the KPI API tests (ci/api/tests/kpi-*.test.cjs).
const path = require("path");
const { spawnSync } = require("child_process");
const { withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");

/** Sets company.kpi_tracking_enabled directly (the switch itself is tested in kpi-1). */
const setSwitch = (companyId, on) =>
  withDb((db) => db.query(`UPDATE company SET kpi_tracking_enabled = $1 WHERE company_id = $2`, [on, companyId]));

/** Runs a compiled migrate script (dist/scripts/<name>.js) against the test database. */
const runScript = (name) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`)], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

/** Every route of the compiled /kpi router: [{method, path}], walked from its Express stack. */
const kpiRoutes = () => {
  const router = require(path.join(ROOT, "dist/kpi/router.js")).default;
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) if (method !== "_all") out.push({ method: method.toUpperCase(), path: layer.route.path });
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return out;
};

/** A concrete URL for a route pattern (":id" → 1). */
const concrete = (p) => "/kpi" + p.replace(/:[a-z_]+/gi, "1");

/**
 * A finished KPI-3 setup written straight to the database (the setup API itself
 * is tested in kpi-3): settings, the framework versions of `frameworks`, and
 * every active library KPI selected (or only `kpis`), with `frequencies`
 * overrides by code.
 */
const setupCompany = (companyId, { yearType = "CY", frameworks = ["GRI", "BRSR", "ESRS"], kpis = null, frequencies = {}, completed = true } = {}) =>
  withDb(async (db) => {
    await db.query(
      `INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at) VALUES ($1, $2, 2026, 15, CASE WHEN $3 THEN now() END)
       ON CONFLICT (company_id) DO UPDATE SET year_type = EXCLUDED.year_type, setup_completed_at = EXCLUDED.setup_completed_at`,
      [companyId, yearType, completed],
    );
    await db.query(
      `INSERT INTO company_framework (company_id, framework_id, framework_code) SELECT $1, id, code FROM kpi_framework WHERE active AND code = ANY($2::text[])
       ON CONFLICT (company_id, framework_code) DO NOTHING`,
      [companyId, frameworks],
    );
    await db.query(
      `INSERT INTO company_kpi (company_id, kpi_definition_id, selected) SELECT $1, id, true FROM kpi_definition WHERE company_id IS NULL AND active AND ($2::text[] IS NULL OR code = ANY($2::text[]))
       ON CONFLICT (company_id, kpi_definition_id) DO UPDATE SET selected = true, reason_excluded = NULL`,
      [companyId, kpis],
    );
    for (const [code, frequency] of Object.entries(frequencies)) {
      await db.query(`UPDATE company_kpi SET frequency = $3 WHERE company_id = $1 AND kpi_definition_id = (SELECT id FROM kpi_definition WHERE code = $2 AND company_id IS NULL)`, [companyId, code, frequency]);
    }
  });

/** Removes every KPI-3 setup row of the fixture companies (1, 2) and their users' topic grants. */
const clearSetup = () =>
  withDb(async (db) => {
    for (const t of ["kpi_assignment", "company_kpi", "company_material_topic", "company_framework", "company_kpi_settings"]) {
      await db.query(`DELETE FROM ${t} WHERE company_id IN (1, 2)`);
    }
    await db.query(`DELETE FROM kpi_topic_grant WHERE user_id IN (1, 2, 3, 4, 6, 7)`);
  });

module.exports = { setSwitch, runScript, kpiRoutes, concrete, setupCompany, clearSetup, ROOT };
