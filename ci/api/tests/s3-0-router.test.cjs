// S3-0: the Scope 3 router is mounted at /scope3 behind authenticate and is
// empty until the modules add their routes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

test("/scope3 needs a token and has no routes yet", async () => {
  assert.equal((await call("GET", "/scope3/categories", null)).status, 401);
  assert.equal((await call("GET", "/scope3/categories", "admin")).status, 404);
});
