// Shared bits for the Insights API tests (ci/api/tests/in-*.test.cjs), IN-0.
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");

/** Sets company.insights_enabled directly (the switch itself is tested in in-0). */
const setInsights = (companyId, on) =>
  withDb((db) => db.query(`UPDATE company SET insights_enabled = $1 WHERE company_id = $2`, [on, companyId]));

/** Sets company.kpi_tracking_enabled directly (KPI panels answer kpi_off without it). */
const setKpi = (companyId, on) =>
  withDb((db) => db.query(`UPDATE company SET kpi_tracking_enabled = $1 WHERE company_id = $2`, [on, companyId]));

/** Runs a compiled migrate script (dist/scripts/<name>.js) against the test database. */
const runScript = (name) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`)], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

/** Every route of the compiled /insights router: [{method, path}], walked from its Express stack. */
const insightsRoutes = () => {
  const router = require(path.join(ROOT, "dist/insights/router.js")).default;
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

/**
 * Every endpoint of docs/insights/01-contracts §4 under /insights (ids as 1), so
 * the switch-off gate is checked for routes no module has built yet as well as
 * for built ones. A module that adds a route outside §4 appends it here.
 */
const INSIGHTS_CONTRACT_ROUTES = [
  ["GET", "/sites"], ["GET", "/summary?year=2025"], ["GET", "/esg-ring"], ["GET", "/decoupling?years=5"], ["GET", "/target-wall"],
  ["GET", "/cards"], ["GET", "/cards?ai=1"], ["GET", "/pathway"], ["GET", "/completeness"],
  ["GET", "/events?from=2025-01-01&to=2025-12-31"], ["POST", "/events"], ["PATCH", "/events/1"], ["DELETE", "/events/1"],
  ["GET", "/bridge?compare=base"], ["GET", "/flow"], ["GET", "/materiality"], ["GET", "/stripes"], ["GET", "/snapshot.pdf"],
].map(([method, p]) => ({ method, path: p }));

/** A concrete URL for a route pattern (":id" → 1). */
const concrete = (p) => "/insights" + p.replace(/:[a-z_]+/gi, "1");

/** Every gated route: the built ones (walked) and the contract list, without GET /status. */
const gatedInsightsRoutes = () => {
  const seen = new Set();
  return [...insightsRoutes().map((r) => ({ method: r.method, path: concrete(r.path) })), ...INSIGHTS_CONTRACT_ROUTES.map((r) => ({ method: r.method, path: "/insights" + r.path }))]
    .filter((r) => !(r.method === "GET" && r.path === "/insights/status"))
    .filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : seen.add(`${r.method} ${r.path}`)));
};

/** Calls a route as `who`; a Superadmin names the company (query and body). */
const callAs = (route, who, companyId) => {
  const hasBody = route.method !== "GET" && route.method !== "DELETE";
  if (who !== "superadmin") return call(route.method, route.path, who, hasBody ? {} : undefined);
  const sep = route.path.includes("?") ? "&" : "?";
  return call(route.method, `${route.path}${sep}company_id=${companyId}`, who, hasBody ? { company_id: companyId } : undefined);
};

module.exports = { setInsights, setKpi, runScript, insightsRoutes, INSIGHTS_CONTRACT_ROUTES, gatedInsightsRoutes, concrete, callAs };
