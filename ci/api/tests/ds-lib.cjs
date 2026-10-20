// Shared bits for the Design Studio API tests (ci/api/tests/ds-*.test.cjs), DS-0.
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");

/** Sets company.design_studio_enabled directly (the switch itself is tested in ds-0). */
const setStudio = (companyId, on) =>
  withDb((db) => db.query(`UPDATE company SET design_studio_enabled = $1 WHERE company_id = $2`, [on, companyId]));

/** Sets company.kpi_tracking_enabled directly (the sustainability kind needs it). */
const setKpi = (companyId, on) =>
  withDb((db) => db.query(`UPDATE company SET kpi_tracking_enabled = $1 WHERE company_id = $2`, [on, companyId]));

/** Runs a compiled migrate script (dist/scripts/<name>.js) against the test database. */
const runScript = (name) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`)], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

/** Every route of the compiled /studio router: [{method, path}], walked from its Express stack. */
const studioRoutes = () => {
  const router = require(path.join(ROOT, "dist/studio/router.js")).default;
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
 * Every endpoint of 01-contracts §4 under /studio (ids as 1), so the switch-off
 * gate is checked for routes no module has built yet as well as for built ones.
 */
const STUDIO_CONTRACT_ROUTES = [
  ["GET", "/readiness?kind=ghg&year=2025"],
  ["GET", "/brand-kit"], ["PUT", "/brand-kit"], ["GET", "/styles?kind=ghg"],
  ["GET", "/templates?kind=ghg"], ["GET", "/templates/1"], ["GET", "/layouts?kind=ghg"], ["GET", "/elements"],
  ["POST", "/assets"], ["GET", "/assets"], ["DELETE", "/assets/1"],
  ["POST", "/resolve"], ["GET", "/docs/1/inputs"], ["PATCH", "/docs/1/inputs"],
  ["GET", "/docs"], ["POST", "/docs"], ["GET", "/docs/1"], ["PATCH", "/docs/1"], ["DELETE", "/docs/1"],
  ["POST", "/docs/1/rebuild"], ["POST", "/docs/1/presence"], ["POST", "/docs/1/duplicate"], ["POST", "/docs/1/resize"],
  ["GET", "/docs/1/preview.html?mode=sheet"], ["POST", "/docs/1/jobs"], ["GET", "/jobs/1"],
  ["GET", "/docs/1/versions"], ["POST", "/docs/1/versions"], ["POST", "/docs/1/versions/1/restore"], ["GET", "/docs/1/versions/1/pdf"],
  ["POST", "/docs/1/shares"], ["GET", "/docs/1/shares"], ["DELETE", "/shares/1"],
  ["POST", "/docs/1/ai"], ["POST", "/docs/1/ai/chat"], ["GET", "/docs/1/ai/usage"],
  ["POST", "/docs/1/checks"], ["GET", "/docs/1/drift"],
  ["POST", "/comments/1/task"], ["PATCH", "/comments/1/task"],
  ["POST", "/docs/1/approvals"], ["POST", "/approvals/1/decide"], ["DELETE", "/approvals/1"],
  ["POST", "/templates/from-doc"], ["POST", "/layouts/from-page"], ["GET", "/fonts/source-sans-3.woff2"],
].map(([method, p]) => ({ method, path: p }));

/** A concrete URL for a route pattern (":id" → 1). */
const concrete = (p) => "/studio" + p.replace(/:[a-z_]+/gi, "1");

/** Every gated route: the built ones (walked) and the contract list, without GET /status. */
const gatedStudioRoutes = () => {
  const seen = new Set();
  return [...studioRoutes().map((r) => ({ method: r.method, path: concrete(r.path) })), ...STUDIO_CONTRACT_ROUTES.map((r) => ({ method: r.method, path: "/studio" + r.path }))]
    .filter((r) => !(r.method === "GET" && r.path === "/studio/status"))
    .filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : seen.add(`${r.method} ${r.path}`)));
};

/** Calls a route as `who`; a Superadmin names the company (query and body). */
const callAs = (route, who, companyId) => {
  const hasBody = route.method !== "GET" && route.method !== "DELETE";
  if (who !== "superadmin") return call(route.method, route.path, who, hasBody ? {} : undefined);
  const sep = route.path.includes("?") ? "&" : "?";
  return call(route.method, `${route.path}${sep}company_id=${companyId}`, who, hasBody ? { company_id: companyId } : undefined);
};

module.exports = { setStudio, setKpi, runScript, studioRoutes, STUDIO_CONTRACT_ROUTES, gatedStudioRoutes, concrete, callAs };
