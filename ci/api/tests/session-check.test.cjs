// A session ends at once when its person is deleted, their role changes or
// their password changes (services/sessionCheck), on the API, the report
// routes (?token=) and the notification stream, instead of a day later when
// the token expires.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { withDb } = require("../helpers.cjs");

const ID = 9501;
const EMAIL = "ci-session@example.invalid";
const PASSWORD = "Session-check-1";
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

const get = async (route, token, viaQuery = false) => {
  const url = `${process.env.API_BASE}${route}${viaQuery ? `${route.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : ""}`;
  const res = await fetch(url, { headers: viaQuery ? {} : { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const signed = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

async function makeUser(role = "User") {
  await q(`DELETE FROM "user" WHERE user_id = $1`, [ID]);
  await q(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES ($1, 'CI Session', $2, $3, $4, 1)`, [ID, EMAIL, await bcrypt.hash(PASSWORD, 4), role]);
}

async function login() {
  const res = await fetch(`${process.env.API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text).token;
}

test.after(() => q(`DELETE FROM "user" WHERE user_id = $1`, [ID]));

test("a deleted person's token stops working at once, on the API, report links and the stream", async () => {
  await makeUser();
  const token = signed({ userId: ID, role: "User" });
  assert.equal((await get("/auth/me", token)).status, 200);
  await q(`DELETE FROM "user" WHERE user_id = $1`, [ID]);
  const me = await get("/auth/me", token);
  assert.equal(me.status, 401);
  assert.equal(me.json.code, "SESSION_ENDED");
  assert.equal((await get("/reports/ghg?siteIds=1", token, true)).status, 401);
  assert.equal((await get("/notifications/stream", token, true)).status, 401);
});

test("a role change ends the session: the old role can't be used", async () => {
  await makeUser("Manager");
  const token = signed({ userId: ID, role: "Manager" });
  assert.equal((await get("/auth/me", token)).status, 200);
  await q(`UPDATE "user" SET role = 'User' WHERE user_id = $1`, [ID]);
  assert.equal((await get("/auth/me", token)).status, 401);
  // A token for the role they have now works.
  assert.equal((await get("/auth/me", signed({ userId: ID, role: "User" }))).status, 200);
});

test("a password change ends sessions signed before it", async () => {
  await makeUser();
  const token = await login();
  assert.equal((await get("/auth/me", token)).status, 200);
  await q(`UPDATE "user" SET password = $2 WHERE user_id = $1`, [ID, await bcrypt.hash("Another-password-2", 4)]);
  assert.equal((await get("/auth/me", token)).status, 401);
});

test("a token with a forged password fingerprint is refused", async () => {
  await makeUser();
  assert.equal((await get("/auth/me", signed({ userId: ID, role: "User", pw: "not-the-fingerprint-xx" }))).status, 401);
});
