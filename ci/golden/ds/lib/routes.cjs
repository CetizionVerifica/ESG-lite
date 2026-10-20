// DS-14 · the /studio route list shared by the DS golden runner, the DS audit probes
// (audit/harness/ds-probes.cjs) and the workflow's DS steps.
//
//   builtRoutes(root)     every route of the compiled /studio router (dist/studio/router.js),
//                         walked from its Express stack: [{method, path}] with ":id" patterns
//   CONTRACT_ROUTES       every endpoint of docs/design-studio/01-contracts.md §4 under /studio,
//                         with the module that builds it, so the switch-off gate and the tenant
//                         probes cover routes no module has built yet
//   gatedRoutes(root)     built ∪ contract, concrete (ids → 1), without GET /status
//
// The contract list mirrors ci/api/tests/ds-lib.cjs (DS-0); a module that adds an endpoint
// not in §4 adds it to both.
const path = require("path");

const builtRoutes = (root) => {
  const router = require(path.join(root, "dist/studio/router.js")).default;
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

// [method, path pattern, module]. Paths are the router's own patterns (as builtRoutes prints them).
const CONTRACT_ROUTES = [
  ["GET", "/status", "DS-0"],
  ["GET", "/readiness", "DS-5"],
  ["GET", "/brand-kit", "DS-3"], ["PUT", "/brand-kit", "DS-3"], ["GET", "/styles", "DS-3"],
  ["GET", "/templates", "DS-4"], ["GET", "/templates/:id", "DS-4"], ["GET", "/layouts", "DS-4"], ["GET", "/elements", "DS-4"],
  ["POST", "/assets", "DS-4"], ["GET", "/assets", "DS-4"], ["DELETE", "/assets/:id", "DS-4"],
  ["POST", "/resolve", "DS-2"], ["GET", "/docs/:id/inputs", "DS-2"], ["PATCH", "/docs/:id/inputs", "DS-2"],
  ["GET", "/docs", "DS-5"], ["POST", "/docs", "DS-5"], ["GET", "/docs/:id", "DS-5"], ["PATCH", "/docs/:id", "DS-5"], ["DELETE", "/docs/:id", "DS-5"],
  ["POST", "/docs/:id/rebuild", "DS-5"], ["POST", "/docs/:id/presence", "DS-5"], ["POST", "/docs/:id/duplicate", "DS-5"],
  ["POST", "/docs/:id/resize", "DS-10"],
  ["GET", "/docs/:id/preview.html", "DS-11"], ["POST", "/docs/:id/jobs", "DS-11"], ["GET", "/jobs/:id", "DS-11"],
  ["GET", "/docs/:id/versions", "DS-11"], ["POST", "/docs/:id/versions", "DS-11"], ["POST", "/docs/:id/versions/:n/restore", "DS-13"], ["GET", "/docs/:id/versions/:n/pdf", "DS-11"],
  ["POST", "/docs/:id/shares", "DS-11"], ["GET", "/docs/:id/shares", "DS-11"], ["DELETE", "/shares/:id", "DS-11"],
  ["POST", "/docs/:id/ai", "DS-9"], ["POST", "/docs/:id/ai/chat", "DS-9"], ["GET", "/docs/:id/ai/usage", "DS-9"],
  ["POST", "/docs/:id/checks", "DS-12"], ["GET", "/docs/:id/drift", "DS-13"],
  ["POST", "/comments/:id/task", "DS-13"], ["PATCH", "/comments/:id/task", "DS-13"],
  ["POST", "/docs/:id/approvals", "DS-13"], ["POST", "/approvals/:id/decide", "DS-13"], ["DELETE", "/approvals/:id", "DS-13"],
  ["POST", "/templates/from-doc", "DS-13"], ["POST", "/layouts/from-page", "DS-13"],
  ["GET", "/fonts/:file", "DS-1"], // the renderer's self-hosted fonts (ds-lib.cjs probes /fonts/source-sans-3.woff2)
  // DS-2 additions outside 01-contracts §4 (awaiting a DS-0 contracts follow-up)
  ["GET", "/inputs/prefill", "DS-2"], ["GET", "/data", "DS-2"], ["GET", "/materiality", "DS-2"], ["PUT", "/materiality", "DS-2"],
  // DS-4 additions outside 01-contracts §4 (awaiting a DS-0 contracts follow-up)
  ["PATCH", "/assets/:id", "DS-4"], ["GET", "/assets/:id/file", "DS-4"], ["POST", "/assets/generate", "DS-4"],
  // DS-11 additions outside 01-contracts §4 (awaiting a DS-0 contracts follow-up): recent jobs (the Share dialog picks a proof) and the stored file
  ["GET", "/docs/:id/jobs", "DS-11"], ["GET", "/jobs/:id/file", "DS-11"],
  // DS-9 addition outside 01-contracts §4 (awaiting a DS-0 contracts follow-up): design from a brief (no doc yet)
  ["POST", "/ai/brief", "DS-9"],
].map(([method, p, module]) => ({ method, path: p, module }));

// A query string a route needs to get past validation to the guard and the tenant check.
const QUERY = { "/fonts/1": "", "/inputs/prefill": "?kind=ghg&year=2025", "/readiness": "?kind=ghg&year=2025", "/styles": "?kind=ghg", "/templates": "?kind=ghg", "/layouts": "?kind=ghg", "/docs/1/preview.html": "?mode=sheet" };

/** "/docs/:id/versions/:n" → "/studio/docs/1/versions/1" (+ the query it needs). */
const concrete = (p, ids = {}) => {
  const filled = p.replace(/:([a-z_]+)/gi, (_, name) => String(ids[name] ?? 1));
  return `/studio${filled}${QUERY[filled] ?? ""}`;
};

const key = (r) => `${r.method} ${r.path}`;
/** The same route whatever its parameters are called ("/docs/:docId" = "/docs/:id"). */
const shape = (r) => `${r.method} ${r.path.replace(/:[a-z_]+/gi, ":p")}`;

/** Every route behind the switch: built ∪ contract, each once, without GET /status. */
const gatedRoutes = (root) => {
  const seen = new Set();
  const all = [...builtRoutes(root).map((r) => ({ ...r, module: (CONTRACT_ROUTES.find((c) => shape(c) === shape(r)) || {}).module || "built" })), ...CONTRACT_ROUTES];
  return all.filter((r) => key(r) !== "GET /status").filter((r) => (seen.has(shape(r)) ? false : seen.add(shape(r))));
};

/** True once the compiled router serves `method path` (a module has landed). */
const isBuilt = (root, method, p) => builtRoutes(root).some((r) => shape(r) === shape({ method, path: p }));

module.exports = { builtRoutes, CONTRACT_ROUTES, gatedRoutes, concrete, isBuilt, key, shape };
