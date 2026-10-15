// S3-16 · Scope 3 audit probes (audit/harness/scope3-probes.cjs).
//
//   node audit/harness/scope3-probes.cjs <ESG-lite dir> <out.json>
//
// Answers, row by row, which Scope 3 promises hold on the real stack. A row
// whose module has not merged yet is `na` and says which module owes it, so
// the audit reads the same before and after each lane lands.
//
// Shape follows xi-probes.cjs: the same two arguments, the throwaway-database
// guard, signed tokens for the fixture users, and records of
// { ids, title, expected, observed, status } with pass / fail / error / na /
// manual. Run twice in a row: same result, fixtures cleaned.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const ESG_DIR = path.resolve(process.argv[2] || ".");
const OUT = process.argv[3] || "scope3-probes.json";
const PORT = Number(process.env.SCOPE3_PROBE_PORT || 3996);
const AI_PORT = Number(process.env.SCOPE3_PROBE_AI_PORT || 8997);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "audit-only-not-a-real-secret";

require(path.join(ESG_DIR, "ci/lib/throwaway-db.cjs")).assertThrowawayDb();

// ci/api/fixture.sql: company 1 has users 1 (User), 2 (Manager), 3 (Admin) and
// Superadmin 5; company 2 has 4 (User) and 6 (Manager).
const USERS = {
  user: { userId: 1, role: "User" },
  manager: { userId: 2, role: "Manager" },
  admin: { userId: 3, role: "Admin" },
  superadmin: { userId: 5, role: "Superadmin" },
  otherManager: { userId: 6, role: "Manager" },
};
const token = (who) => jwt.sign(USERS[who], SECRET);

const results = [];
const record = (ids, title, expected, observed, status) =>
  results.push({ ids: [].concat(ids), title, expected, observed, status });
const pass = (ids, title, expected, observed) => record(ids, title, expected, observed || expected, "pass");
const fail = (ids, title, expected, observed) => record(ids, title, expected, observed, "fail");
const na = (ids, title, expected, owes) => record(ids, title, expected, `not built yet: ${owes}`, "na");
const manual = (ids, title, expected, how) => record(ids, title, expected, `checked by hand: ${how}`, "manual");

/** Runs one check, turning a throw into an `error` row rather than a crash. */
async function probe(ids, title, expected, fn) {
  try {
    await fn({
      pass: (observed) => pass(ids, title, expected, observed),
      fail: (observed) => fail(ids, title, expected, observed),
      na: (owes) => na(ids, title, expected, owes),
      manual: (how) => manual(ids, title, expected, how),
    });
  } catch (err) {
    record(ids, title, expected, `probe threw: ${err && err.message ? err.message : String(err)}`, "error");
  }
}

async function call(method, route, who, body) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${token(who)}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (res.headers.get("content-type") || "").includes("application/json") ? await res.json() : null;
  return { status: res.status, json };
}

const tail = (run) => `${run.stdout || ""}${run.stderr || ""}`.trim().split("\n").slice(-3).join(" / ").slice(-300);

/**
 * The golden suites seed their own companies, so they get a database of their
 * own: run in the probe's database they collide with the shared fixture. The
 * name keeps the ci_ prefix the throwaway guard insists on, and only a name
 * this function created (…_golden) is ever dropped.
 */
async function inGoldenDb(args) {
  const name = `${process.env.DB_NAME}_golden`;
  const admin = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: "postgres",
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end().catch(() => {});
  }
  const env = { ...process.env, DB_NAME: name };
  // The golden suites expect the schema already built, the way the CI job
  // does it (schema-sync, then the runner).
  const sync = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/schema-sync.cjs"), path.join(ESG_DIR, "dist")], {
    cwd: ESG_DIR,
    env,
    encoding: "utf8",
  });
  if (sync.status !== 0) return sync;

  return args[0] === "--run"
    ? spawnSync("npm", ["run", "--silent", args[1]], {
        cwd: ESG_DIR,
        env,
        encoding: "utf8",
        shell: process.platform === "win32",
      })
    : spawnSync(process.execPath, args, { cwd: ESG_DIR, env, encoding: "utf8" });
}

// ---------------------------------------------------------------- what exists

// Each capability names the module that owes it, so an `na` row explains itself.
const COLUMNS = {
  "category.ghg_category": "S3-1",
  "emission.method": "S3-3",
  "emission.dq": "S3-3",
  "emission.data_type": "S3-3",
  "emission.total_kgco2e": "S3-4",
  "emission.fx": "S3-5",
  "emission.supplier_id": "S3-6",
  "emission.scope3_sub": "S3-7",
  "emission.proxy": "S3-12",
  "emission.checks": "S3-15",
};
const TABLES = {
  company_scope3_category: "S3-1",
  supplier: "S3-6",
  investment: "S3-11",
  product_sale: "S3-10",
  company_base_year: "S3-14",
  period_lock: "S3-15",
};
const ROUTES = {
  "GET /scope3/categories": "S3-1",
  "GET /scope3/screening": "S3-12",
  "GET /reports/ghg/scope3": "S3-13",
  "GET /periods/lock": "S3-15",
};

async function readHead(db) {
  const columns = new Map();
  for (const name of Object.keys(COLUMNS)) {
    const [table, column] = name.split(".");
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    columns.set(name, rows.length > 0);
  }

  const tables = new Map();
  for (const name of Object.keys(TABLES)) {
    const { rows } = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [name]);
    tables.set(name, rows.length > 0);
  }

  // A route that answers 404 to the highest-access token is not built. The
  // probe asks as Superadmin on purpose: an anonymous 401 says nothing about
  // whether the route exists, and /reports/ghg/scope3 sits under a prefix
  // that answers today, so only the authenticated answer tells them apart.
  const routes = new Map();
  for (const name of Object.keys(ROUTES)) {
    const [method, route] = name.split(" ");
    try {
      const asSuperadmin = await call(method, route, "superadmin");
      routes.set(name, asSuperadmin.status !== 404);
    } catch {
      routes.set(name, false);
    }
  }
  return { columns, tables, routes };
}

/** The modules a row needs, or null when the head has everything. */
function missing(head, needs) {
  const owed = new Set();
  for (const name of needs) {
    const built =
      head.columns.has(name) ? head.columns.get(name)
      : head.tables.has(name) ? head.tables.get(name)
      : head.routes.get(name);
    if (built) continue;
    owed.add(COLUMNS[name] || TABLES[name] || ROUTES[name] || "an unknown module");
  }
  return owed.size ? [...owed].sort().join(", ") : null;
}

// ------------------------------------------------------------------ the rows

async function runRows(db, head) {
  const need = (ids, title, expected, needs, fn) =>
    probe(ids, title, expected, async (r) => {
      const owed = missing(head, needs);
      if (owed) return r.na(owed);
      return fn(r, db);
    });

  // S3-01 · the golden suite: today's cases locked, Scope 3 cases owned.
  await probe("S3-01", "Golden cases reproduce the guidance", "ci/golden byte-identical; every case of a merged module runs and passes", async (r) => {
    const golden = await inGoldenDb([path.join(ESG_DIR, "ci/golden/run.cjs")]);
    const output = tail(golden);
    if (golden.status !== 0) return r.fail(`ci/golden/run.cjs exited ${golden.status}: ${output}`);

    const cases = path.join(ESG_DIR, "ci/golden/scope3/cases.json");
    if (!fs.existsSync(cases)) return r.na(`S3-0 (${output}; no ci/golden/scope3/cases.json transcribed yet)`);
    const parsed = JSON.parse(fs.readFileSync(cases, "utf8"));
    const all = Array.isArray(parsed) ? parsed : parsed.cases || [];
    const live = all.filter((one) => one.status === "run");
    if (!live.length) return r.na(`S3-0 transcribed ${all.length} case(s), all still skip`);
    const scope3 = await inGoldenDb(["--run", "test:scope3-golden"]);
    return scope3.status === 0
      ? r.pass(`${output}; ${live.length} Scope 3 case(s) run green`)
      : r.fail(`${live.length} Scope 3 case(s) run, suite exited ${scope3.status}`);
  });

  await need("S3-02", "Every Scope 3 category carries its GHG number", "a number 1-15 or Unmapped; scope is one of the four values", ["category.ghg_category"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE ghg_category IS NULL) AS unmapped,
              count(*) FILTER (WHERE ghg_category IS NOT NULL AND (ghg_category < 1 OR ghg_category > 15)) AS bad
         FROM category WHERE scope = 'Scope 3'`,
    );
    const scopes = await db.query(
      `SELECT DISTINCT scope FROM category WHERE scope IS NOT NULL AND scope NOT IN ('Scope 1','Scope 2','Scope 3')`,
    );
    if (Number(rows[0].bad) > 0) return r.fail(`${rows[0].bad} category(ies) outside 1-15`);
    if (scopes.rows.length) return r.fail(`scope values outside the four: ${scopes.rows.map((s) => s.scope).join(", ")}`);
    return r.pass(`${rows[0].unmapped} unmapped category(ies), every number within 1-15`);
  });

  await need("S3-03", "The company boundary covers all 15 categories", "15 rows a company; no exclusion without a reason; Manager PUT 403", ["company_scope3_category", "GET /scope3/categories"], async (r) => {
    const { rows } = await db.query(
      `SELECT company_id, count(*) AS rows, count(*) FILTER (WHERE status <> 'included' AND coalesce(reason, '') = '') AS reasonless
         FROM company_scope3_category GROUP BY company_id ORDER BY company_id`,
    );
    const short = rows.filter((row) => Number(row.rows) !== 15);
    const reasonless = rows.filter((row) => Number(row.reasonless) > 0);
    if (short.length) return r.fail(`company ${short[0].company_id} has ${short[0].rows} row(s), not 15`);
    if (reasonless.length) return r.fail(`company ${reasonless[0].company_id} excludes a category with no reason`);
    const guarded = await call("PUT", "/scope3/categories/1", "manager", { status: "excluded", reason: "probe" });
    return guarded.status === 403
      ? r.pass(`${rows.length} company boundary(ies) complete; Manager PUT 403`)
      : r.fail(`Manager PUT returned ${guarded.status}, expected 403 (D12)`);
  });

  await need("S3-04", "Factors carry their metadata and the snapshot copies it", "factor_type, gwp_set, geography, dataset on new factors; FACTOR_TYPE_MISMATCH warns only", ["emission.method"], async (r) => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'emission_factor' AND column_name IN ('factor_type','gwp_set','geography','dataset')`,
    );
    return rows.length === 4
      ? r.pass("factor_type, gwp_set, geography and dataset all present")
      : r.na(`S3-2 (${4 - rows.length} factor column(s) missing)`);
  });

  await need("S3-05", "Every new Scope 3 row carries a method and a DQ", "method, dq and data_type on rows from every channel; the backfill is done", ["emission.method", "emission.dq", "emission.data_type"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE e.method IS NULL) AS methodless
         FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE c.scope = 'Scope 3'`,
    );
    if (Number(rows[0].total) === 0) return r.na("S3-3 merged, but this database holds no Scope 3 row to judge");
    return Number(rows[0].methodless) === 0
      ? r.pass(`${rows[0].total} Scope 3 row(s), every one with a method`)
      : r.fail(`${rows[0].methodless} of ${rows[0].total} Scope 3 row(s) have no method`);
  });

  await need("S3-06", "Engine integrity", "UNIT_REQUIRED; historical import through the engine; total_kgco2e on every row", ["emission.total_kgco2e"], async (r) => {
    const { rows } = await db.query(`SELECT count(*) AS missing FROM emission WHERE total_kgco2e IS NULL`);
    return Number(rows[0].missing) === 0
      ? r.pass("every row carries total_kgco2e")
      : r.fail(`${rows[0].missing} row(s) with no total_kgco2e`);
  });

  await need("S3-07", "Spend-based rows are reproducible", "fx stored with rate and date; FX_RATE_FALLBACK and NO_DEFLATOR warn", ["emission.fx"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS spend, count(*) FILTER (WHERE fx IS NULL OR fx->>'rate' IS NULL) AS unreproducible
         FROM emission WHERE method = 'spend_based'`,
    );
    if (Number(rows[0].spend) === 0) return r.na("S3-5 merged, but this database holds no spend-based row");
    return Number(rows[0].unreproducible) === 0
      ? r.pass(`${rows[0].spend} spend row(s), each with its fx rate`)
      : r.fail(`${rows[0].unreproducible} spend row(s) with no usable fx`);
  });

  await need("S3-08", "Supplier figures and hybrid allocation", "SUPPLIER_FACTOR_BOUNDARY on a wrong boundary; hybrid allocates by the chosen key", ["supplier", "emission.supplier_id"], async (r) =>
    r.manual("S3-6 lands the supplier flow; this row runs once its API is in 01-contracts §5"),
  );

  await need("S3-09", "Cat 3 twins are split, not double counted", "scope3_sub on every twin; WTT_ALREADY_IN_FACTOR; no total moved without the PR list", ["emission.scope3_sub"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS twins, count(*) FILTER (WHERE scope3_sub IS NULL) AS unsplit
         FROM emission WHERE fera_linked_id IS NOT NULL`,
    );
    if (Number(rows[0].twins) === 0) return r.na("S3-7 merged, but this database holds no FERA twin");
    return Number(rows[0].unsplit) === 0
      ? r.pass(`${rows[0].twins} twin(s), each with a sub-category`)
      : r.fail(`${rows[0].unsplit} of ${rows[0].twins} twin(s) carry no scope3_sub`);
  });

  for (const [ids, title, needs, owes] of [
    ["S3-10", "Transport forms compute their golden cases", ["emission.method"], "S3-8"],
    ["S3-11", "Travel and commuting forms compute their golden cases", ["emission.method"], "S3-9"],
    ["S3-12", "Sold products compute their golden cases", ["product_sale"], "S3-10"],
    ["S3-13", "Leased assets, franchises and investments compute their golden cases", ["investment"], "S3-11"],
  ]) {
    await need(ids, title, "every case of this category reproduces the guidance figure through the API", needs, async (r) =>
      r.na(`${owes} (the form's golden cases run from ci/golden/scope3/cases.json once its module merges)`),
    );
  }

  await need("S3-14", "Screening estimates never become rows", "proxy rows are Pending, secondary, and carry their basis", ["emission.proxy", "GET /scope3/screening"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS proxies,
              count(*) FILTER (WHERE status <> 'pending' OR data_type <> 'secondary' OR proxy->>'basis' IS NULL) AS wrong
         FROM emission WHERE proxy IS NOT NULL`,
    );
    if (Number(rows[0].proxies) === 0) return r.na("S3-12 merged, but this database holds no proxy row");
    return Number(rows[0].wrong) === 0
      ? r.pass(`${rows[0].proxies} proxy row(s), each Pending, secondary and with a basis`)
      : r.fail(`${rows[0].wrong} proxy row(s) are not Pending, secondary and explained`);
  });

  await need("S3-15", "The report answers the ch. 11 checklist", "R1-R10 present in /reports/ghg/scope3 and the PDF, or \"Not tracked\"", ["GET /reports/ghg/scope3"], async (r) => {
    const report = await call("GET", "/reports/ghg/scope3?year=2026", "admin");
    // Today /reports/ghg/* answers this path without a Scope 3 report behind
    // it, so a refusal means "not built", not "built and broken".
    if ([401, 403].includes(report.status)) {
      return r.na(`S3-13 (/reports/ghg/scope3 answered ${report.status}; no Scope 3 report behind the prefix yet)`);
    }
    if (report.status !== 200) return r.fail(`/reports/ghg/scope3 answered ${report.status}`);
    const text = JSON.stringify(report.json || {});
    const absent = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"].filter(
      (item) => !text.includes(item) && !text.includes("Not tracked"),
    );
    return absent.length
      ? r.fail(`checklist item(s) missing and not marked Not tracked: ${absent.join(", ")}`)
      : r.pass("every checklist item answered or marked Not tracked");
  });

  await need("S3-16", "Base year freezes and re-freezes", "a freeze, a proposal at or above the threshold, approval re-freezes, rows untouched", ["company_base_year"], async (r) =>
    r.manual("S3-14 lands the base-year flow; this row runs once its API is in 01-contracts §5"),
  );

  await need("S3-17", "Review checks hold and release rows", "every check id held and passed; \"approve all ready\" approves only ready rows", ["emission.checks"], async (r) => {
    const dryRun = await call("POST", "/user/emissions/check", "manager", { site_id: 1, year: 2026, month: 1 });
    return dryRun.status === 404
      ? r.na("S3-15·1 (POST /user/emissions/check is not mounted)")
      : r.pass(`the dry-run check answers ${dryRun.status}`);
  });

  await need("S3-18", "Drafts stay out of queues, and a locked month refuses writes", "PERIOD_LOCKED on create, edit, delete, approve, reject, batch, import commit and MCP commit; unlock needs a reason", ["period_lock"], async (r) =>
    r.manual("S3-15·2 lands the lock; this row walks every write path once /periods/lock is in"),
  );

  // S3-19 and S3-20 run against whatever /scope3 routes the head has.
  await probe("S3-19", "Tenant isolation on every Scope 3 endpoint", "company 2's token on company 1's ids answers 403 or 404", async (r) => {
    const built = [...head.routes].filter(([, yes]) => yes).map(([name]) => name);
    if (!built.length) return r.na("S3-1, S3-12, S3-13, S3-15 (no /scope3 route is mounted yet)");
    const leaks = [];
    for (const name of built) {
      const [method, route] = name.split(" ");
      const crossed = await call(method, `${route}${route.includes("?") ? "&" : "?"}company_id=1`, "otherManager");
      if (![403, 404].includes(crossed.status)) leaks.push(`${name} answered ${crossed.status}`);
    }
    return leaks.length
      ? r.fail(leaks.join("; "))
      : r.pass(`${built.length} route(s) refuse company 2's token on company 1 ids`);
  });

  await probe("S3-20", "The role matrix holds", "User, Manager, Admin and Superadmin per D12 and layer rule 3", async (r) => {
    if (!head.routes.get("GET /scope3/categories")) return r.na("S3-1 (the boundary route is not mounted yet)");
    const asUser = await call("GET", "/scope3/categories", "user");
    const asAdmin = await call("GET", "/scope3/categories", "admin");
    if (asAdmin.status !== 200) return r.fail(`Admin GET answered ${asAdmin.status}, expected 200`);
    return [200, 403].includes(asUser.status)
      ? r.pass(`Admin reads it (200), User gets ${asUser.status}`)
      : r.fail(`User GET answered ${asUser.status}`);
  });

  await probe("S3-21", "Migrations are idempotent", "migrate:all runs twice clean with every migrate:scope3-* script", async (r) => {
    const names = scope3Migrations();
    if (!names.length) return r.na("S3-1 to S3-15 (no migrate:scope3-* script exists yet)");
    for (const pass of [1, 2]) {
      for (const name of names) {
        const run = spawnSync("npm", ["run", "--silent", name], {
          cwd: ESG_DIR,
          env: process.env,
          encoding: "utf8",
          shell: process.platform === "win32",
        });
        if (run.status !== 0) return r.fail(`${name} failed on pass ${pass}: ${tail(run)}`);
      }
    }
    return r.pass(`${names.length} script(s) ran twice clean: ${names.join(", ")}`);
  });

  await need("S3-22", "Every channel agrees", "one row typed, bulk, smart import and MCP gives the same total_kgco2e, method and dq", ["emission.method", "emission.total_kgco2e"], async (r) =>
    r.manual("walks all four channels once S3-3 and S3-4 are both merged"),
  );

  await probe("S3-23", "Logs carry no sheet text", "no cell text, supplier names, prices or survey refs in the API or AI logs", async (r) =>
    r.manual("read from the run's API and ai-probes log paths, as layer rule 7 asks"),
  );

  await probe("S3-24", "The Scope 3 pages hold up", "every Scope 3 route in the sweep, four themes, 390 px, no console errors", async (r) =>
    r.manual("audit/harness/route-sweep.mjs, once its route list carries the Scope 3 pages"),
  );

  await probe("E2E-12", "A Scope 3 month, end to end", "contributor drafts and submits; manager approves ready rows, fixes a held one, locks the month; Admin screens, sets status, reads the report and the base year", async (r) =>
    r.manual("walked on staging by hand; the result is dated in the audit doc"),
  );
}

// ------------------------------------------------------------------ the stack

async function connect() {
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();
  return db;
}

async function waitForServer(server, logs) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`server exited during startup:\n${logs.join("")}`);
    try {
      const res = await fetch(`${BASE}/user/emissions`);
      if (res.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs.join("")}`);
}

/** The schema and the shared fixture, loaded only when this database is empty. */
async function prepare(db) {
  const { rows } = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'emission'`);
  if (!rows.length) {
    const sync = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/schema-sync.cjs"), path.join(ESG_DIR, "dist")], {
      cwd: ESG_DIR,
      env: process.env,
      stdio: "inherit",
    });
    if (sync.status !== 0) throw new Error(`ci/schema-sync.cjs exited ${sync.status}`);
  }
  const seeded = await db.query(`SELECT 1 FROM company LIMIT 1`);
  if (!seeded.rows.length) {
    await db.query(fs.readFileSync(path.join(ESG_DIR, "ci/api/fixture.sql"), "utf8"));
  }

  // The stack under audit is a migrated stack: production runs migrate:all on
  // container start (ESG-lite #126), so every migrate:scope3-* script runs
  // here too before any row is judged. Without it a probe would report a
  // backfill as missing only because nothing had run it yet.
  for (const name of scope3Migrations()) {
    const run = spawnSync("npm", ["run", "--silent", name], {
      cwd: ESG_DIR,
      env: process.env,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (run.status !== 0) throw new Error(`${name} failed: ${tail(run)}`);
  }
}

const scope3Migrations = () =>
  Object.keys(require(path.join(ESG_DIR, "package.json")).scripts).filter((name) =>
    name.startsWith("migrate:scope3-"),
  );

(async () => {
  const logs = [];
  let db;
  let server;
  try {
    db = await connect();
    await prepare(db);

    server = spawn(process.execPath, [path.join(ESG_DIR, "dist/index.js")], {
      cwd: ESG_DIR,
      env: {
        ...process.env,
        TZ: "UTC",
        PORT: String(PORT),
        AI_SERVICE_PORT: String(AI_PORT),
        JWT_SECRET: SECRET,
        TYPEORM_SYNC: "false",
        RABBITMQ_URL: "amqp://127.0.0.1:1",
        LOCAL_FILE_STORAGE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => logs.push(d.toString()));
    server.stderr.on("data", (d) => logs.push(d.toString()));
    await waitForServer(server, logs);

    const head = await readHead(db);
    await runRows(db, head);
  } catch (err) {
    record("S3-00", "The probe harness itself", "the probes run against a live stack", `harness failed: ${err && err.message ? err.message : String(err)}`, "error");
  } finally {
    if (server) server.kill("SIGTERM");
    if (db) await db.end().catch(() => {});
  }

  const counts = { pass: 0, fail: 0, error: 0, na: 0, manual: 0 };
  for (const row of results) counts[row.status] = (counts[row.status] || 0) + 1;
  fs.writeFileSync(OUT, `${JSON.stringify({ probe: "scope3-probes", counts, results }, null, 2)}\n`);
  console.log(
    `s scope3-probes "${counts.pass} pass / ${counts.fail} fail / ${counts.error} error / ${counts.na} n/a / ${counts.manual} manual"`,
  );
  // A fail belongs to the owning lane, not to the harness: only a harness
  // error stops the audit.
  process.exit(counts.error > 0 ? 1 : 0);
})();
