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

module.exports = { setSwitch, runScript, kpiRoutes, concrete, ROOT };
