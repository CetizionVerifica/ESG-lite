// Sign-in and password-reset endpoints are rate limited per client IP and
// route (audit finding F-20). Uses reset-password, whose only other caller
// (access-scope) runs earlier, so the exhausted bucket does not affect it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const disabled = process.env.AUTH_RATE_LIMIT_DISABLED === "true";
const MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

test("failed reset attempts beyond the limit get 429 with Retry-After", { skip: disabled && "AUTH_RATE_LIMIT_DISABLED" }, async () => {
  // Earlier tests may already have used part of this route's allowance, so
  // send one more than the limit: failures (400) until it is used up, then 429.
  const statuses = [];
  let blocked;
  for (let i = 0; i <= MAX; i++) {
    const r = await call("POST", "/auth/reset-password", null, { token: `ci-bogus-${i}`, password: "long-enough-pw" });
    statuses.push(r.status);
    if (r.status === 429) blocked = blocked || r;
  }
  const first429 = statuses.indexOf(429);
  assert.ok(first429 > 0, `statuses: ${statuses}`);
  assert.ok(statuses.slice(0, first429).every((s) => s === 400), `statuses: ${statuses}`);
  assert.ok(statuses.slice(first429).every((s) => s === 429), `statuses: ${statuses}`);
  assert.match(blocked.json.message, /Too many attempts/);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  // The bucket is per route: sign-in is still answered normally.
  const login = await call("POST", "/auth/login", null, { email: "nobody@example.invalid", password: "wrong" });
  assert.equal(login.status, 401);
});

test("sign-in is limited per account, so one person's failures don't lock out the office", { skip: disabled && "AUTH_RATE_LIMIT_DISABLED" }, async () => {
  const statuses = [];
  for (let i = 0; i <= MAX; i++) {
    statuses.push((await call("POST", "/auth/login", null, { email: " CI-Locked@Example.invalid ", password: `wrong-${i}` })).status);
  }
  assert.ok(statuses.slice(0, MAX).every((s) => s === 401), `statuses: ${statuses}`);
  assert.equal(statuses[MAX], 429, `statuses: ${statuses}`);
  // The same address in another case is the same account.
  assert.equal((await call("POST", "/auth/login", null, { email: "ci-locked@example.invalid", password: "x" })).status, 429);
  // Someone else on the same IP is still answered normally.
  assert.equal((await call("POST", "/auth/login", null, { email: "ci-colleague@example.invalid", password: "x" })).status, 401);
});
