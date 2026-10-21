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


// ── IN-1: shared fixture helpers for panel tests ─────────────────────────────

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

/** The KPI library (migrations + seed) the KPI-backed panels read; idempotent. */
const ensureKpiLibrary = () => {
  for (const name of ["migrateKpiLibrary", "migrateKpiPillars", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment", "migrateKpiTargets"]) {
    const r = runScript(name);
    if (r.status !== 0) throw new Error(`${name}: ${r.stderr}${r.stdout}`);
  }
};

/** Library KPI ids by code. */
const kpiIds = async (codes) => Object.fromEntries((await q(`SELECT code, id FROM kpi_definition WHERE company_id IS NULL AND code = ANY($1::text[])`, [codes])).map((r) => [r.code, r.id]));

/** An annual CY KPI value for company `company` (site null = company level). */
const kpiValue = (company, kpiId, site, year, v, status = "approved", source = "manual") =>
  q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES ($1, $2, $3, $4, $5, 'annual', 'CY', $6, NULL, $6, $7, $8) RETURNING id`,
    [company, site, kpiId, `${year}-01-01`, `${year}-12-31`, v, source, status],
  );

/** Removes the KPI rows the Insights tests write for companies 1 and 2 (values, targets, setup). */
const wipeKpi = async () => {
  await q(`DELETE FROM kpi_target WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  for (const t of ["kpi_topic_assignment", "kpi_assignment", "company_kpi", "company_material_topic", "company_framework", "company_kpi_settings"]) {
    await q(`DELETE FROM ${t} WHERE company_id IN (1, 2)`);
  }
};

/** GET /insights<path> as `who` (a Superadmin names company `companyId`); asserts the status. */
const panel = async (who, pathAndQuery, { companyId = 1, status = 200, headers = {} } = {}) => {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `/insights${pathAndQuery}${who === "superadmin" ? `${sep}company_id=${companyId}` : ""}`;
  const r = await call("GET", url, who, undefined, headers);
  if (r.status !== status) throw new Error(`${who} GET ${url}: ${r.status} ${JSON.stringify(r.json)}`);
  return r;
};

/** Every envelope field of a panel response (01-contracts §2). */
const assertEnvelope = (assert, body, panelId) => {
  assert.equal(body.panel, panelId);
  for (const k of ["availability", "period", "sites", "label", "pending_not_in", "stamp", "links"]) assert.ok(k in body, `envelope has ${k}`);
  assert.ok("data" in body);
  assert.equal(typeof body.pending_not_in.emissions, "number");
  assert.equal(typeof body.pending_not_in.kpi_values, "number");
  assert.match(body.stamp, /^[0-9a-f]{16}$/);
};

module.exports = { setInsights, setKpi, runScript, insightsRoutes, INSIGHTS_CONTRACT_ROUTES, gatedInsightsRoutes, concrete, callAs, q, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope };
