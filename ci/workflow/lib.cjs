// Helpers for the workflow test: an HTTP caller that signs in like the app
// does (POST /auth/login), a direct database client for the few checks that
// need it, and `migrateAll` to stand in for a redeploy.
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const { assertThrowawayDb } = require("../lib/throwaway-db.cjs");

// Also guards a direct `node --test workflow.test.cjs` run, which skips run.cjs.
assertThrowawayDb();

const ROOT = path.resolve(__dirname, "../..");
// #191: the server's own int8 parsers, so a bigint id or count(*) read here is
// the number the API sends, not a string.
require(path.join(ROOT, "dist/config/pgTypes.js")).installPgTypeParsers();

/** A signed-in person: { token, user }. */
async function login(email, password) {
  const r = await call("POST", "/auth/login", null, { email, password });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.token, user: r.json.user };
}

/** `who` is a session from login(), or null for no token. */
async function call(method, route, who, body) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${who.token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${process.env.API_BASE}${route}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") || "";
  const json = type.includes("application/json") ? await res.json() : null;
  return { status: res.status, json };
}

async function withDb(fn) {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** True when a table has the column (used to tell a module that hasn't merged yet). */
const hasColumn = (table, column) =>
  withDb(async (db) => (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, column])).rowCount > 0);

/** `migrate-all` exactly as a deploy runs it on start. */
function migrateAll() {
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/migrate-all.cjs")], { cwd: ROOT, env: { ...process.env, TZ: "UTC" }, encoding: "utf8" });
  if (run.status !== 0) throw new Error("migrate-all failed:\n" + run.stdout + run.stderr);
}

/** Round like the engine stores tCO₂e: kg → t at 3 dp (#209). */
const tonnes = (kg) => Math.round((kg / 1000) * 1000) / 1000;

module.exports = { login, call, withDb, hasColumn, migrateAll, tonnes };
