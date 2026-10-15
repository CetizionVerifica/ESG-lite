// Without Mailgun (as in CI) password reset must say the email can't be sent,
// the same way for every address, instead of reporting a link as sent.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

test("POST /auth/forgot-password without Mailgun: 503 for known and unknown addresses alike", async () => {
  for (const email of ["nobody@example.invalid", "ci-superadmin@example.invalid"]) {
    const res = await call("POST", "/auth/forgot-password", null, { email });
    assert.equal(res.status, 503, email);
    assert.match(res.json.message, /isn't set up on this server/);
  }
});
