// End-to-end data workflow test: onboards a brand-new client through the API
// the way a Superadmin, the client's Admin, a Manager and a User would, then
// checks every stored and reported tCO₂e against figures worked out by hand
// in ci/workflow/scenario.cjs. Spec and rules: ci/workflow/README.md.
//
//   npm run build && npm run test:workflow          (needs a ci_* throwaway Postgres)
//   bash ci/workflow/local.sh                       (creates ci_workflow, builds, runs)
//
// Unlike ci/api it starts from an empty database: schema from dist/, every
// table emptied, then `migrate-all` exactly as a deploy runs it. The only
// rows written straight to the database are the platform's first Superadmin
// and one stored exchange rate per spend date (the daily FX job needs the
// network); everything else goes through HTTP.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { assertThrowawayDb } = require("../lib/throwaway-db.cjs");

assertThrowawayDb();
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const { SUPERADMIN } = require("./scenario.cjs");
const { migrateAll } = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.WORKFLOW_PORT || 3997);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "ci-only-not-a-real-secret";
const SERVICE_KEY = "ci-only-service-key";

const dbConfig = () => ({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const SERVER_ENV = {
  ...process.env,
  TZ: "UTC",
  PORT: String(PORT),
  JWT_SECRET: SECRET,
  AI_SERVICE_KEY: SERVICE_KEY,
  TYPEORM_SYNC: "false",
  RABBITMQ_URL: "amqp://127.0.0.1:1",
  LOCAL_FILE_STORAGE: "true",
  FX_JOB_DISABLED: "true",
  AUTH_RATE_LIMIT_DISABLED: "true",
  SKIP_MIGRATIONS: "true",
};

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
  if (!fs.existsSync(path.join(ROOT, "dist/index.js"))) {
    console.error("dist/ is missing: run `npm run build` first.");
    process.exit(1);
  }
  const sync = spawnSync(process.execPath, [path.join(ROOT, "ci/schema-sync.cjs"), path.join(ROOT, "dist")], { stdio: "inherit", env: process.env });
  if (sync.status !== 0) process.exit(sync.status || 1);

  const client = new Client(dbConfig());
  await client.connect();
  await client.query(`DO $$
    DECLARE t text;
    BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
      END LOOP;
    END $$;`);
  await client.end();

  migrateAll();

  // The platform's first Superadmin (on a real deploy this account already exists).
  const seed = new Client(dbConfig());
  await seed.connect();
  await seed.query(`INSERT INTO "user" (name, email, password, role) VALUES ($1, $2, $3, 'Superadmin')`, [SUPERADMIN.name, SUPERADMIN.email, await bcrypt.hash(SUPERADMIN.password, 10)]);
  await seed.end();

  const logs = [];
  const server = spawn(process.execPath, [path.join(ROOT, "dist/index.js")], { cwd: ROOT, env: SERVER_ENV, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => logs.push(d.toString()));
  server.stderr.on("data", (d) => logs.push(d.toString()));

  let exitCode = 0;
  try {
    await waitForServer(server, logs);
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", path.join(__dirname, "workflow.test.cjs")], {
      stdio: "inherit",
      env: { ...process.env, API_BASE: BASE, JWT_SECRET: SECRET, WORKFLOW_ROOT: ROOT, TZ: "UTC" },
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

