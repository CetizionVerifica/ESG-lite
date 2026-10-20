// DS-14 · a throwaway stack for the DS golden runner and the DS audit probes.
//
//   prepare(root)            schema from dist/ (ci/schema-sync.cjs), the API fixture
//                            (ci/api/fixture.sql: company 1 with user 1, manager 2, admin 3,
//                            multi-site user 7; company 2 with user 4 and manager 6;
//                            Superadmin 5) when the database is empty, then every
//                            migrate:ds-* script, as a deploy runs them
//   dsMigrations(root)       the compiled paths of every migrate:ds-* script in package.json
//   migrate(root, paths)     runs them (TYPEORM_SYNC=false); throws on a failure
//   boot(root, port, secret) the compiled server on `port`; resolves once it answers
//   q(sql, params)           one query on DB_NAME
//
// It refuses any database that isn't a local ci_* one (ci/lib/throwaway-db.cjs).
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const need = (root, name) => require(require.resolve(name, { paths: [root, __dirname] }));

const dbConfig = (database = process.env.DB_NAME) => ({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
});

const ROOT_GUESS = path.resolve(__dirname, "../../..");

async function q(sql, params, root = ROOT_GUESS) {
  const { Client } = need(root, "pg");
  const c = new Client(dbConfig());
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const dsMigrations = (root) =>
  Object.entries(require(path.join(root, "package.json")).scripts)
    .filter(([k]) => k.startsWith("migrate:ds-"))
    .map(([, v]) => {
      const m = /src\/scripts\/(\S+)\.ts/.exec(v);
      if (!m) throw new Error(`migrate:ds-* script is not "ts-node src/scripts/X.ts": ${v}`);
      return path.join(root, `dist/scripts/${m[1]}.js`);
    });

function migrate(root, paths) {
  for (const p of paths) {
    const r = spawnSync(process.execPath, [p], { cwd: root, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${path.basename(p)} failed: ${(r.stdout + r.stderr).slice(-800)}`);
  }
}

async function prepare(root) {
  require(path.join(root, "ci/lib/throwaway-db.cjs")).assertThrowawayDb();
  if (!fs.existsSync(path.join(root, "dist/index.js"))) throw new Error("dist/ is missing: run `npm run build` first");
  const sync = spawnSync(process.execPath, [path.join(root, "ci/schema-sync.cjs"), path.join(root, "dist")], { env: process.env, encoding: "utf8" });
  if (sync.status !== 0) throw new Error(`schema-sync failed: ${(sync.stdout + sync.stderr).slice(-800)}`);
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM company`, [], root);
  if (n === 0) {
    const { Client } = need(root, "pg");
    const c = new Client(dbConfig());
    await c.connect();
    try {
      await c.query(fs.readFileSync(path.join(root, "ci/api/fixture.sql"), "utf8"));
    } finally {
      await c.end();
    }
  }
  migrate(root, dsMigrations(root));
}

/** Boots dist/index.js; resolves {server, logs, base} once GET /user/emissions answers 401. */
async function boot(root, port, secret, extraEnv = {}) {
  const logs = [];
  const server = spawn(process.execPath, [path.join(root, "dist/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      TZ: "UTC",
      NODE_ENV: "test",
      PORT: String(port),
      JWT_SECRET: secret,
      TYPEORM_SYNC: "false",
      SKIP_MIGRATIONS: "true",
      RABBITMQ_URL: "amqp://127.0.0.1:1",
      LOCAL_FILE_STORAGE: "true",
      FX_JOB_DISABLED: "true",
      SCOPE3_BASE_YEAR_JOB: "off",
      KPI_DUE_JOB: "off",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => logs.push(d.toString()));
  server.stderr.on("data", (d) => logs.push(d.toString()));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("server exited during startup:\n" + logs.join("").slice(-2000));
    try {
      if ((await fetch(`${base}/user/emissions`)).status === 401) return { server, logs, base };
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill("SIGTERM");
  throw new Error("server did not start:\n" + logs.join("").slice(-2000));
}

// ci/api/fixture.sql people, as signed into a token.
const USERS = {
  user: { userId: 1, role: "User" },
  manager: { userId: 2, role: "Manager" },
  admin: { userId: 3, role: "Admin" },
  multiSiteUser: { userId: 7, role: "User" },
  superadmin: { userId: 5, role: "Superadmin" },
  otherUser: { userId: 4, role: "User" },
  otherManager: { userId: 6, role: "Manager" },
};

/** An HTTP caller for `base`, signing fixture users with `secret`: call(method, route, who, body) → {status, code, json}. */
const caller = (root, base, secret) => {
  const jwt = need(root, "jsonwebtoken");
  return async (method, route, who, body) => {
    const headers = {};
    if (who) headers.Authorization = `Bearer ${jwt.sign(USERS[who], secret)}`;
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${base}${route}`, { method, headers, body: payload });
    const type = res.headers.get("content-type") || "";
    const json = type.includes("application/json") ? await res.json().catch(() => null) : null;
    if (!json) await res.arrayBuffer().catch(() => null);
    return { status: res.status, code: json?.code ?? null, json, headers: res.headers };
  };
};

module.exports = { prepare, boot, migrate, dsMigrations, q, dbConfig, caller, USERS };
