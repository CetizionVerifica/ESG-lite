// S3-0: the Scope 3 router is mounted at /scope3 behind authenticate and is
// empty until the modules add their routes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

test("/scope3 needs a token; unknown paths give 404", async () => {
  // A path no module will add, so this keeps holding once S3-1 adds routes.
  assert.equal((await call("GET", "/scope3/__no_such_route__", null)).status, 401);
  assert.equal((await call("GET", "/scope3/__no_such_route__", "admin")).status, 404);
});
