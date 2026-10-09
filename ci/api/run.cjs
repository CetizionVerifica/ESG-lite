// API tests for the redesign backend endpoints (B1–B8).
//
// Builds the schema from the compiled entities (dist/) on the throwaway CI
// database, loads ci/api/fixture.sql, boots the compiled server against it and
// runs every ci/api/tests/*.test.cjs file with node:test. Tests talk to the
// server over HTTP (API_BASE) and may read the database directly (DB_* env).
//
//   npm run build && node ci/api/run.cjs
//
// Like the calculation snapshot, it refuses any database that is not the
// disposable CI one (ci/lib/throwaway-db.cjs).
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { assertThrowawayDb } = require("../lib/throwaway-db.cjs");

assertThrowawayDb();
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.API_TEST_PORT || 3998);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "ci-only-not-a-real-secret";

async function waitForServer(server, logs) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("server exited during startup:\n" + logs.join(""));
    try {
      const res = await fetch(`${BASE}/user/emissions`);
      if (res.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + logs.join(""));
}

(async () => {
  const sync = spawnSync(process.execPath, [path.join(ROOT, "ci/schema-sync.cjs"), path.join(ROOT, "dist")], {
    stdio: "inherit",
    env: process.env,
  });
  if (sync.status !== 0) process.exit(sync.status || 1);

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, "fixture.sql"), "utf8"));
  await client.end();

  const logs = [];
  const server = spawn(process.execPath, [path.join(ROOT, "dist/index.js")], {
    cwd: ROOT,
    env: { ...process.env, TZ: "UTC", PORT: String(PORT), JWT_SECRET: SECRET, TYPEORM_SYNC: "false", RABBITMQ_URL: "amqp://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => logs.push(d.toString()));
  server.stderr.on("data", (d) => logs.push(d.toString()));

  let exitCode = 0;
  try {
    await waitForServer(server, logs);
    const testDir = path.join(__dirname, "tests");
    const files = fs
      .readdirSync(testDir)
      .filter((f) => f.endsWith(".test.cjs"))
      .sort()
      .map((f) => path.join(testDir, f));
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
      stdio: "inherit",
      env: { ...process.env, API_BASE: BASE, JWT_SECRET: SECRET },
    });
    exitCode = result.status ?? 1;
    if (exitCode !== 0) console.error("--- server log (tail) ---\n" + logs.join("").slice(-8000));
  } catch (err) {
    console.error(err);
    console.error("--- server log ---\n" + logs.join(""));
    exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
  process.exit(exitCode);
})();
