// Outbound calls have time limits with env overrides (audit finding F-14).
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { aiServiceTimeoutMs, routeServiceTimeoutMs } = require(path.resolve("dist/utils/aiServiceHeaders.js"));

test("defaults apply when the env is unset or invalid", () => {
  const saved = { ai: process.env.AI_SERVICE_TIMEOUT_MS, route: process.env.ROUTE_SERVICE_TIMEOUT_MS };
  try {
    delete process.env.AI_SERVICE_TIMEOUT_MS;
    process.env.ROUTE_SERVICE_TIMEOUT_MS = "not-a-number";
    assert.equal(aiServiceTimeoutMs(), 30000);
    assert.equal(routeServiceTimeoutMs(), 15000);
    process.env.AI_SERVICE_TIMEOUT_MS = "45000";
    process.env.ROUTE_SERVICE_TIMEOUT_MS = "5000";
    assert.equal(aiServiceTimeoutMs(), 45000);
    assert.equal(routeServiceTimeoutMs(), 5000);
  } finally {
    for (const [k, v] of [["AI_SERVICE_TIMEOUT_MS", saved.ai], ["ROUTE_SERVICE_TIMEOUT_MS", saved.route]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
