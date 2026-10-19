// Sign in with a one-time code sent by email (forgot password). CI has no
// Brevo, so requesting a code answers 503; the verify tests store a code the
// way requestLoginOtp does (HMAC of "<user_id>:<code>") straight in the db.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { call, withDb } = require("../helpers.cjs");

const hashCode = (userId, code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${userId}:${code}`).digest("hex");

const storeCode = (userId, code, minutes = 10) =>
  withDb((db) =>
    db.query(
      `UPDATE "user" SET login_otp_hash = $1, login_otp_expires = now() + make_interval(mins => $2), login_otp_attempts = 0 WHERE user_id = $3`,
      [hashCode(userId, code), minutes, userId],
    ),
  );

const readCode = (userId) =>
  withDb(async (db) => (await db.query(`SELECT login_otp_hash, login_otp_attempts FROM "user" WHERE user_id = $1`, [userId])).rows[0]);

test("POST /auth/login-otp/request without Brevo: 503 for known and unknown addresses alike", async () => {
  for (const email of ["nobody@example.invalid", "ci-user@example.invalid"]) {
    const res = await call("POST", "/auth/login-otp/request", null, { email });
    assert.equal(res.status, 503, email);
    assert.match(res.json.message, /aren't set up on this server/);
  }
  assert.equal((await call("POST", "/auth/login-otp/request", null, {})).status, 400);
});

test("the right code signs in once, like a password login; the same code again is refused", async () => {
  await storeCode(1, "123456");
  const ok = await call("POST", "/auth/login-otp/verify", null, { email: " CI-User@Example.invalid ", code: "123 456" });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  assert.equal(ok.json.role, "User");
  assert.equal(ok.json.user.user_id, 1);
  assert.equal(ok.json.user.password, undefined);
  assert.equal(ok.json.user.login_otp_hash, undefined);
  assert.equal((await readCode(1)).login_otp_hash, null);

  // The token works on an authenticated route.
  const me = await fetch(`${process.env.API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${ok.json.token}` } });
  assert.equal(me.status, 200);

  const again = await call("POST", "/auth/login-otp/verify", null, { email: "ci-user@example.invalid", code: "123456" });
  assert.equal(again.status, 401);
});

test("wrong codes are counted and the last allowed try clears the code", async () => {
  await storeCode(4, "654321");
  for (let i = 1; i <= 5; i++) {
    const r = await call("POST", "/auth/login-otp/verify", null, { email: "ci-other-user@example.invalid", code: "000000" });
    assert.equal(r.status, 401);
    assert.match(r.json.message, /wrong or has expired/);
  }
  const row = await readCode(4);
  assert.equal(row.login_otp_hash, null);
  // Even the right code no longer works; a new one has to be requested.
  const late = await call("POST", "/auth/login-otp/verify", null, { email: "ci-other-user@example.invalid", code: "654321" });
  assert.equal(late.status, 401);
});

test("an expired code, an unknown address or a malformed code get the same 401", async () => {
  await storeCode(7, "111222", -1);
  const expired = await call("POST", "/auth/login-otp/verify", null, { email: "ci-multi@example.invalid", code: "111222" });
  assert.equal(expired.status, 401);
  const unknown = await call("POST", "/auth/login-otp/verify", null, { email: "nobody@example.invalid", code: "111222" });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.message, expired.json.message);
  const malformed = await call("POST", "/auth/login-otp/verify", null, { email: "ci-multi@example.invalid", code: "abc" });
  assert.equal(malformed.status, 401);
  assert.equal((await call("POST", "/auth/login-otp/verify", null, { email: "ci-multi@example.invalid" })).status, 400);
});
