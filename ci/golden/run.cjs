// Calculation snapshot: locks the numbers the backend produces today.
//
// Loads a fixed fixture into the throwaway CI database, boots the compiled
// server (dist/) against it, posts real emission entries through the API,
// approves them, and reads back the stored totals and the GHG report
// figures. The result must equal ci/golden/snapshot.json exactly.
//
//   node ci/golden/run.cjs            # compare (CI)
//   UPDATE_SNAPSHOT=1 node ci/golden/run.cjs   # rewrite after an INTENDED change
//
// A changed number is either a bug or a deliberate methodology change. For a
// deliberate one, regenerate the snapshot and explain the change in the PR so
// reviewers can see every figure that moves.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { assertThrowawayDb } = require("../lib/throwaway-db.cjs");

assertThrowawayDb();
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const ROOT = path.resolve(__dirname, "../..");
const SNAPSHOT = path.join(__dirname, "snapshot.json");
const PORT = Number(process.env.GOLDEN_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "ci-only-not-a-real-secret";
const VOLATILE = new Set(["created_at", "updated_at", "reviewed_at", "generatedAt", "generated_at"]);

const db = () =>
  new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE.has(key)) continue;
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

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

async function call(method, route, token, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

(async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));

  const client = db();
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
    const userToken = jwt.sign({ userId: 1, role: "User" }, SECRET);
    const managerToken = jwt.sign({ userId: 2, role: "Manager" }, SECRET);

    const entries = [];
    for (const entry of cases.entries) {
      const res = await call("POST", "/user/emissions", userToken, entry.body);
      const created = res.json?.emission ?? res.json;
      const id = res.status < 300 ? created?.pk_id : undefined;
      if (id) {
        const approved = await call("PUT", `/user/emissions/${id}/approve`, managerToken, {});
        if (approved.status !== 200) throw new Error(`approve ${id} failed: ${JSON.stringify(approved.json)}`);
      }
      entries.push({
        name: entry.name,
        status: res.status,
        message: res.status >= 300 ? res.json?.message ?? null : undefined,
      });
    }

    const reader = db();
    await reader.connect();
    const stored = await reader.query(`
      SELECT pk_id, site_id, category_id, to_char(date_of_reporting, 'YYYY-MM-DD') AS date,
             reporting_period, year_type, status::text AS status,
             total_emission::text AS total_emission, unit, activity_data_unit,
             activity_data->>'activity_value' AS stored_activity_value,
             emission_factor_snapshot->>'factor_value' AS factor_value,
             emission_factor_snapshot->>'year' AS factor_year
        FROM emission ORDER BY pk_id`);
    await reader.end();

    const reports = [];
    for (const report of cases.reports) {
      const res = await call("POST", report.path, managerToken, report.body);
      reports.push({ name: report.name, status: res.status, body: res.json });
    }

    const actual = normalize({ entries, stored_emissions: stored.rows, reports });
    const text = JSON.stringify(actual, null, 2) + "\n";

    if (process.env.UPDATE_SNAPSHOT === "1") {
      fs.writeFileSync(SNAPSHOT, text);
      console.log(`Snapshot written: ${path.relative(ROOT, SNAPSHOT)}`);
    } else {
      if (!fs.existsSync(SNAPSHOT)) throw new Error("ci/golden/snapshot.json is missing; run with UPDATE_SNAPSHOT=1");
      const expected = fs.readFileSync(SNAPSHOT, "utf8");
      if (expected !== text) {
        fs.writeFileSync(path.join(ROOT, "golden-actual.json"), text);
        const exp = expected.split("\n");
        const act = text.split("\n");
        let shown = 0;
        for (let i = 0; i < Math.max(exp.length, act.length) && shown < 40; i++) {
          if (exp[i] !== act[i]) {
            console.log(`line ${i + 1}\n  expected: ${exp[i]}\n  actual:   ${act[i]}`);
            shown++;
          }
        }
        console.log(
          "::error::Calculation results changed. If this is a deliberate methodology change, " +
            "run `UPDATE_SNAPSHOT=1 node ci/golden/run.cjs` locally against a throwaway database, " +
            "commit ci/golden/snapshot.json and explain every moved figure in the PR.",
        );
        exitCode = 1;
      } else {
        console.log(`Calculation snapshot matches (${entries.length} entries, ${reports.length} reports).`);
      }
    }
  } catch (err) {
    console.error(err);
    console.error("--- server log ---\n" + logs.join(""));
    exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
  process.exit(exitCode);
})();
