// S3-16 · Scope 3 audit probes (audit/harness/scope3-probes.cjs).
//
//   node audit/harness/scope3-probes.cjs <ESG-lite dir> <out.json>
//
// Answers, row by row, which Scope 3 promises hold on the real stack. A row
// whose module has not merged yet is `na` and names the module that owes it,
// so the audit reads the same before and after each lane lands. What is
// "built" is read from the stack itself (columns, tables, routes asked with a
// token, migrate scripts the build carries), never from a list of merged PRs.
//
// Shape follows xi-probes.cjs: the same two arguments, the throwaway-database
// guard, signed tokens for the fixture users, and records of
// { ids, title, expected, observed, status } with pass / fail / error / na /
// manual. Run twice in a row: same result, fixture cleaned.
//
// Step `scope3-golden` (spec step 3) is the live golden runner: every `run`
// case of ci/golden/scope3/cases.json is posted through POST /user/emissions,
// approved, and its Σ total_kgco2e compared with expected_kgco2e (S3-0
// tolerance). Its results go to <out>-golden.json beside <out> (with run-audit's
// `<ts>-scope3-probes.json` name: `<ts>-scope3-golden.json` in the same folder).
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ESG_DIR = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || "scope3-probes.json");
const GOLDEN_OUT = /scope3-probes(\.json)?$/.test(path.basename(OUT))
  ? path.join(path.dirname(OUT), path.basename(OUT).replace(/scope3-probes(\.json)?$/, "scope3-golden.json"))
  : OUT.replace(/(\.json)?$/, "-golden.json");
const PORT = Number(process.env.SCOPE3_PROBE_PORT || 3996);
const AI_PORT = Number(process.env.SCOPE3_PROBE_AI_PORT || 8997);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "audit-only-not-a-real-secret";

// Dependencies come from the ESG-lite checkout under audit, so the harness
// needs no node_modules of its own in the audit folder.
const need = (name) => require(require.resolve(name, { paths: [ESG_DIR, __dirname] }));
const { assertThrowawayDb, createScratchDb, dropScratchDb } = require(path.join(ESG_DIR, "ci/lib/throwaway-db.cjs"));
assertThrowawayDb();
// Every server this harness starts (its own, and the golden snapshot's) runs
// without the background jobs: the daily FX job fetches rates from the network
// and fills fx_rate mid-run (which reads as probe residue), and the nightly
// base-year check could raise a proposal under the S3-16 row. Rates a probe
// needs are stored by the probe itself.
process.env.FX_JOB_DISABLED = "true";
process.env.SCOPE3_BASE_YEAR_JOB = "off";
const { Client } = need("pg");
const jwt = need("jsonwebtoken");

// ci/api/fixture.sql: company 1 has users 1 (User, site 1), 2 (Manager, sites
// 1-2), 3 (Admin) and Superadmin 5; company 2 has 4 (User) and 6 (Manager), site 3.
const USERS = {
  user: { userId: 1, role: "User" },
  manager: { userId: 2, role: "Manager" },
  admin: { userId: 3, role: "Admin" },
  superadmin: { userId: 5, role: "Superadmin" },
  otherUser: { userId: 4, role: "User" },
  otherManager: { userId: 6, role: "Manager" },
};
const ROLES = ["user", "manager", "admin", "superadmin"];
const token = (who) => jwt.sign(USERS[who], SECRET);

// Everything the probe creates is named with this prefix and removed by id
// (and, after a crash, by name) at the start and end of every run.
const TAG = "S3-16 probe";
const SITE = 1; // company 1
const GOLDEN_YEAR = 2012; // entries; factors are for the year before, as the engine looks them up
const REPORT_YEAR = 2013;
const CHECK_YEAR = 2014;

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
  let payload;
  if (typeof FormData !== "undefined" && body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${route}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") || "";
  let json = null;
  let buffer = null;
  if (type.includes("application/json")) json = await res.json().catch(() => null);
  else buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buffer, type };
}

const tail = (run) => `${run.stdout || ""}${run.stderr || ""}`.trim().split("\n").slice(-3).join(" / ").slice(-300);
const dbConfig = (database) => ({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
});

// ---------------------------------------------------------------- what exists

// Each capability names the module that owes it, so an `na` row explains
// itself. Columns and tables are read from information_schema; routes are
// asked with a Superadmin token (an anonymous 401 says nothing about whether a
// route exists, and /reports/ghg/scope3 sits under a prefix that answers
// either way); scripts are the migrate:* entries the build carries.
const COLUMNS = {
  "category.ghg_category": "S3-1",
  "emission_factors.factor_type": "S3-2",
  "emission.method": "S3-3",
  "emission.dq": "S3-3",
  "emission.data_type": "S3-3",
  "emission.total_kgco2e": "S3-4",
  "emission.fx": "S3-5",
  "emission.supplier_id": "S3-6",
  "emission.scope3_sub": "S3-7",
  "emission.proxy": "S3-12",
  "emission.checks": "S3-15·1",
  "company.review_workflow_v2": "S3-15·2",
};
const TABLES = {
  company_scope3_category: "S3-1",
  fx_rate: "S3-5",
  supplier: "S3-6",
  product_sale: "S3-10",
  investment: "S3-11",
  company_base_year: "S3-14",
  period_lock: "S3-15·2",
};
const ROUTES = {
  "GET /scope3/categories": ["S3-1", "/scope3/categories?company_id=1"],
  "GET /scope3/commuting/sites": ["S3-9", "/scope3/commuting/sites?company_id=1"],
  "GET /scope3/product-sales": ["S3-10", "/scope3/product-sales?company_id=1"],
  "GET /scope3/investments": ["S3-11", "/scope3/investments?company_id=1"],
  "GET /scope3/screening": ["S3-12", "/scope3/screening?company_id=1&year=2025"],
  "GET /reports/ghg/scope3": ["S3-13", `/reports/ghg/scope3?siteIds=${SITE}&year=2025`],
  "GET /scope3/base-year": ["S3-14", "/scope3/base-year?company_id=1"],
  "GET /periods/lock": ["S3-15·2", "/periods/lock?company_id=1&year=2025&month=1"],
};
const SCRIPTS = {
  "migrate:scope3-transport": "S3-8",
};

/** The module owning each feature, for "is this module built?" questions (golden case owners). */
const MODULE_FEATURES = {
  "S3-1": ["category.ghg_category", "company_scope3_category", "GET /scope3/categories"],
  "S3-2": ["emission_factors.factor_type"],
  "S3-3": ["emission.method", "emission.dq", "emission.data_type"],
  "S3-4": ["emission.total_kgco2e"],
  "S3-5": ["emission.fx", "fx_rate"],
  "S3-6": ["supplier", "emission.supplier_id"],
  "S3-7": ["emission.scope3_sub"],
  "S3-8": ["migrate:scope3-transport"],
  "S3-9": ["GET /scope3/commuting/sites"],
  "S3-10": ["product_sale", "GET /scope3/product-sales"],
  "S3-11": ["investment", "GET /scope3/investments"],
  "S3-12": ["emission.proxy", "GET /scope3/screening"],
  "S3-13": ["GET /reports/ghg/scope3"],
  "S3-14": ["company_base_year", "GET /scope3/base-year"],
  "S3-15·1": ["emission.checks"],
  "S3-15·2": ["period_lock", "company.review_workflow_v2", "GET /periods/lock"],
};

async function readHead(db) {
  const has = new Map();
  for (const name of Object.keys(COLUMNS)) {
    const [table, column] = name.split(".");
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    has.set(name, rows.length > 0);
  }
  for (const name of Object.keys(TABLES)) {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [name],
    );
    has.set(name, rows.length > 0);
  }
  for (const [name, [, route]] of Object.entries(ROUTES)) {
    try {
      const res = await call("GET", route, "superadmin");
      // The report route is built when it answers its own JSON (rows per
      // category); before S3-13 the /reports/ghg/:companyId route caught it.
      has.set(name, name === "GET /reports/ghg/scope3" ? res.status === 200 && Array.isArray(res.json?.rows) : res.status !== 404);
    } catch {
      has.set(name, false);
    }
  }
  const scripts = packageScripts();
  for (const name of Object.keys(SCRIPTS)) has.set(name, name in scripts);
  return has;
}

const ownerOf = (name) => COLUMNS[name] || TABLES[name] || (ROUTES[name] || [])[0] || SCRIPTS[name] || "an unknown module";

/** The modules a row needs, or null when the head has everything. */
function missing(head, needs) {
  const owed = new Set();
  for (const name of needs) if (!head.get(name)) owed.add(ownerOf(name));
  return owed.size ? [...owed].sort(byModule).join(", ") : null;
}
const moduleBuilt = (head, module) => (MODULE_FEATURES[module] || []).every((name) => head.get(name));
const byModule = (a, b) => {
  const n = (s) => s.replace(/^S3-/, "").split("·").map(Number);
  const [x, y] = [n(a), n(b)];
  return x[0] - y[0] || (x[1] || 0) - (y[1] || 0);
};

const packageScripts = () => JSON.parse(fs.readFileSync(path.join(ESG_DIR, "package.json"), "utf8")).scripts || {};
const scope3Migrations = () => Object.keys(packageScripts()).filter((name) => name.startsWith("migrate:scope3-"));

// ------------------------------------------------------------- the fixture

/** Ids of what this run created, removed at the end (and by TAG after a crash). */
const made = { categories: [], factors: [], emissions: [], documents: [], users: [] };

// The fixture has no Admin in company 2, so an Admin-only endpoint answers
// company 2's Manager and User 403 on role alone and says nothing about tenant
// isolation. S3-19 creates one through the API (and removes it at the end).
const OTHER_ADMIN_EMAIL = "s3-16-probe-other-admin@example.invalid";
async function otherAdmin(db) {
  if (USERS.otherAdmin) return true;
  const found = await db.query(`SELECT user_id FROM "user" WHERE email = $1`, [OTHER_ADMIN_EMAIL]);
  let id = found.rows[0]?.user_id;
  if (!id) {
    const res = await call("POST", "/admin/users", "superadmin", { name: `${TAG} other admin`, email: OTHER_ADMIN_EMAIL, role: "Admin", site_id: 3 });
    if (res.status !== 201) throw new Error(`POST /admin/users (company 2 Admin) answered ${res.status}: ${res.json?.message || ""}`);
    id = res.json.user.user_id;
  }
  made.users.push(id);
  USERS.otherAdmin = { userId: id, role: "Admin" };
  return true;
}

const GHG_FACTOR_TYPE = { 1: "cradle_to_gate", 2: "cradle_to_gate", 3: "wtt", 4: "life_cycle", 5: "process", 6: "life_cycle", 7: "life_cycle", 8: "life_cycle", 9: "life_cycle", 10: "process", 11: "combustion", 12: "process", 13: "life_cycle", 14: "life_cycle", 15: "other" };

/** A Scope 3 category with its GHG number on the fixture site: the API creates it, SQL assigns the site. */
async function probeCategory(db, head, n) {
  const name = `${TAG} Cat ${n}`;
  const found = await db.query(`SELECT category_id FROM category WHERE category_name = $1`, [name]);
  if (found.rows.length) return found.rows[0].category_id;
  const body = { category_name: name, scope: "Scope 3", ...(head.get("category.ghg_category") ? { ghg_category: n } : {}) };
  const res = await call("POST", "/admin/categories", "superadmin", body);
  if (res.status !== 201) throw new Error(`POST /admin/categories (Cat ${n}) answered ${res.status}: ${JSON.stringify(res.json)}`);
  const id = res.json?.category?.category_id;
  made.categories.push(id);
  await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [SITE, id]);
  return id;
}

/** A factor through the admin API (S3-2 metadata when the head has it). */
async function probeFactor(head, { categoryId, n, name, value, unit, year, type, extra = {} }) {
  const body = {
    site_id: SITE,
    category_id: categoryId,
    year,
    factor_value: String(value),
    denominator_unit: unit,
    emission_category_name: name,
    global_category_name: name,
    source: `${TAG} (guidance example)`,
    ...(head.get("emission_factors.factor_type")
      ? { factor_type: type || GHG_FACTOR_TYPE[n] || "other", gwp_set: "AR6", geography: "GLO", dataset: "S3-16 probe", dataset_version: "2026" }
      : {}),
    ...extra,
  };
  const res = await call("POST", "/admin/emission-factors", "superadmin", body);
  if (res.status !== 201) throw new Error(`POST /admin/emission-factors (${name}) answered ${res.status}: ${JSON.stringify(res.json)}`);
  made.factors.push(res.json.emissionFactor.emission_factor_id);
  return res;
}

/** A typed entry through POST /user/emissions as the site's contributor. */
async function postEntry({ categoryId, date, name, value, unit, who = "user", site = SITE }) {
  const res = await call("POST", "/user/emissions", who, {
    site_id: site,
    category_id: categoryId,
    date_of_reporting: date,
    activity_data_unit: unit,
    activity_data: { emission_category: name, activity_value: String(value) },
  });
  if (res.status === 201) {
    made.emissions.push(res.json.emission.pk_id);
    if (res.json.fera_emission) made.emissions.push(res.json.fera_emission.pk_id);
  }
  return res;
}

/** Every table with a category_id column, so cleanup also catches what the API made beside a category. */
async function categoryTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'category_id' AND table_name <> 'category'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

async function cleanup(db, startNotification) {
  const byTag = await db.query(`SELECT category_id FROM category WHERE category_name LIKE $1`, [`${TAG}%`]);
  const categories = [...new Set([...made.categories, ...byTag.rows.map((r) => r.category_id)])];
  const factorTag = await db.query(`SELECT emission_factor_id FROM emission_factors WHERE emission_category_name LIKE $1`, [`${TAG}%`]);
  const factors = [...new Set([...made.factors, ...factorTag.rows.map((r) => r.emission_factor_id)])];
  const emissionTag = await db.query(
    `SELECT pk_id FROM emission WHERE activity_data->>'emission_category' LIKE $1 OR category_id = ANY($2::int[])`,
    [`${TAG}%`, categories],
  );
  let emissions = [...new Set([...made.emissions, ...emissionTag.rows.map((r) => r.pk_id)])];
  if (emissions.length) {
    const twins = await db.query(`SELECT pk_id FROM emission WHERE fera_linked_id = ANY($1::int[])`, [emissions]);
    emissions = [...new Set([...emissions, ...twins.rows.map((r) => r.pk_id)])];
  }

  const docs = emissions.length
    ? (await db.query(`SELECT document_id FROM emission_document WHERE emission_id = ANY($1::int[])`, [emissions])).rows.map((r) => r.document_id)
    : [];
  for (const id of new Set([...made.documents, ...docs])) await call("DELETE", `/user/documents/${id}`, "user").catch(() => {});

  if (emissions.length) {
    await db.query(`DELETE FROM emission_document WHERE emission_id = ANY($1::int[])`, [emissions]);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [emissions]);
    await db.query(`UPDATE emission SET fera_linked_id = NULL WHERE pk_id = ANY($1::int[])`, [emissions]);
    await db.query(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [emissions]);
  }
  if (factors.length) {
    await db.query(`DELETE FROM audit_log WHERE entity_type IN ('emission_factor', 'emission_factors') AND entity_id = ANY($1::int[])`, [factors]).catch(() => {});
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1::int[])`, [factors]);
  }
  if (categories.length) {
    for (const table of await categoryTables(db)) {
      await db.query(`DELETE FROM "${table}" WHERE category_id = ANY($1::int[])`, [categories]);
    }
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'category' AND entity_id = ANY($1::int[])`, [categories]).catch(() => {});
    await db.query(`DELETE FROM category WHERE category_id = ANY($1::int[])`, [categories]);
  }
  // Rates the S3-07 probe stored (its own source tag, never a real day's rate).
  if (await tableExists(db, "fx_rate")) await db.query(`DELETE FROM fx_rate WHERE source = $1`, [TAG]);
  // The base year the S3-16 probe froze (only ever for a company that had
  // none; its rationale is the tag) and the recalculations raised since.
  if (await tableExists(db, "company_base_year")) {
    const ours = await db.query(`SELECT id, company_id, created_at FROM company_base_year WHERE rationale = $1`, [TAG]);
    for (const by of ours.rows) {
      const events = await db.query(`SELECT id FROM recalculation_event WHERE company_id = $1 AND created_at >= $2`, [by.company_id, by.created_at]);
      const ids = events.rows.map((x) => x.id);
      await db.query(`DELETE FROM audit_log WHERE entity_type = 'scope3_recalculation' AND entity_id = ANY($1::int[])`, [ids]);
      await db.query(`DELETE FROM audit_log WHERE entity_type = 'scope3_base_year' AND entity_id = $1`, [by.id]);
      await db.query(`DELETE FROM recalculation_event WHERE id = ANY($1::int[])`, [ids]);
      await db.query(`DELETE FROM company_base_year WHERE id = $1`, [by.id]);
    }
  }
  const userTag = await db.query(`SELECT user_id FROM "user" WHERE email = $1`, [OTHER_ADMIN_EMAIL]);
  const users = [...new Set([...made.users, ...userTag.rows.map((x) => x.user_id)])];
  if (users.length) {
    for (const table of ["user_categories", "user_sites"]) await db.query(`DELETE FROM "${table}" WHERE user_id = ANY($1::int[])`, [users]);
    await db.query(`DELETE FROM "user" WHERE user_id = ANY($1::int[])`, [users]);
  }
  delete USERS.otherAdmin;
  if (startNotification !== undefined) {
    await db.query(`DELETE FROM notification WHERE id > $1`, [startNotification]).catch(() => {});
  }
  made.categories = [];
  made.factors = [];
  made.emissions = [];
  made.documents = [];
  made.users = [];
}

const tableExists = async (db, name) =>
  (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0;

/** Row counts of every table: equal before and after a run, or the fixture was not cleaned. */
async function fingerprint(db) {
  const { rows } = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const counts = {};
  for (const { tablename } of rows) {
    counts[tablename] = Number((await db.query(`SELECT count(*) AS n FROM "${tablename}"`)).rows[0].n);
  }
  return counts;
}
const diffCounts = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((t) => a[t] !== b[t])
    .map((t) => `${t} ${a[t] ?? "-"}→${b[t] ?? "-"}`);

// --------------------------------------------------------- the live golden

const goldenFile = () => path.join(ESG_DIR, "ci/golden/scope3/cases.json");
const reportFile = () => path.join(ESG_DIR, "ci/golden/scope3/report.json");
const withinTolerance = (tol, actual, expected) => Math.abs(actual - expected) <= Math.max(tol.kg, Math.abs(expected) * tol.relative);

/** A skip case is owed by its owner, or by a module its note says it waits for ("Runs once S3-5 …"). */
function skipOwedBy(head, k) {
  if (!moduleBuilt(head, k.owner)) return k.owner;
  const waits = String(k.note || "").match(/runs once ([^.]*)/i);
  const named = waits ? [...waits[1].matchAll(/S3-\d+(?:·\d)?/g)].map((m) => m[0]) : [];
  const unbuilt = named.filter((m) => !moduleBuilt(head, m));
  return unbuilt.length ? unbuilt.join(", ") : null;
}

/** Engine figure per case from ci/golden/scope3/run.cjs (in memory, on the same dist). */
function engineGolden() {
  const run = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/golden/scope3/run.cjs")], {
    cwd: ESG_DIR,
    env: { ...process.env, SCOPE3_GOLDEN_ALL: "1" },
    encoding: "utf8",
  });
  const byCase = {};
  for (const line of String(run.stdout || "").split("\n")) {
    const m = /^(pass|FAIL|skip)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) byCase[m[2]] = { engine: m[1].toLowerCase(), detail: m[4] };
  }
  const summary = String(run.stdout || "").split("\n").find((l) => l.startsWith("Scope 3 golden:")) || tail(run);
  return { status: run.status, summary, byCase };
}

/**
 * The golden suites seed their own companies, so they get a database of their
 * own: run in the probe's database they collide with the shared fixture. The
 * scratch database is `<DB_NAME>_golden`, made and removed by the guarded
 * helpers in ci/lib/throwaway-db.cjs (they refuse any other name).
 */
async function inGoldenDb(script) {
  const name = await createScratchDb(Client, dbConfig(), "golden");
  const env = { ...process.env, DB_NAME: name };
  try {
    // The golden suite expects the schema already built, the way the CI job
    // does it (schema-sync, then the runner).
    const sync = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/schema-sync.cjs"), path.join(ESG_DIR, "dist")], { cwd: ESG_DIR, env, encoding: "utf8" });
    if (sync.status !== 0) return sync;
    return spawnSync(process.execPath, [script], { cwd: ESG_DIR, env, encoding: "utf8" });
  } finally {
    await dropScratchDb(Client, dbConfig(), "golden");
  }
}

/** Posts every row of a case as a typed entry on its category's factors; returns the new ids or why not. */
async function postCase(db, head, k, categoryId, monthOffset) {
  const ids = [];
  const factorYear = GOLDEN_YEAR - 1;
  const names = {};
  for (const [key, f] of Object.entries(k.factors)) {
    names[key] = `${TAG} ${k.id} ${key}`;
    await probeFactor(head, { categoryId, n: k.category, name: names[key], value: f.kgco2e_per_unit, unit: f.unit, year: factorYear });
  }
  for (const [i, row] of k.rows.entries()) {
    // One month per row keeps two rows on one factor apart (no duplicate entry).
    const month = String(((monthOffset + i) % 12) + 1).padStart(2, "0");
    const res = await postEntry({
      categoryId,
      date: `${GOLDEN_YEAR}-${month}-${String(1 + Math.floor((monthOffset + i) / 12)).padStart(2, "0")}`,
      name: names[row.factor],
      value: row.quantity * (row.share ?? 1),
      unit: row.unit,
    });
    if (res.status !== 201) return { error: `row ${i} (${row.label}): POST /user/emissions answered ${res.status} ${res.json?.code || res.json?.message || ""}`.trim() };
    ids.push(res.json.emission.pk_id);
  }
  return { ids };
}

async function storedKg(db, head, ids) {
  const kg = head.get("emission.total_kgco2e") ? "total_kgco2e" : "total_emission * 1000";
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'approved') AS approved, count(*) AS n, COALESCE(sum(${kg}), 0) AS kg
       FROM emission WHERE pk_id = ANY($1::int[])`,
    [ids],
  );
  return { approved: Number(rows[0].approved), n: Number(rows[0].n), kg: Number(rows[0].kg) };
}

async function approve(ids) {
  const res = await call("PUT", "/user/emissions/bulk-approve", "manager", { ids });
  if (res.status !== 200) throw new Error(`bulk-approve answered ${res.status}: ${res.json?.message || ""}`);
  return res;
}

/**
 * Spec step 3. Returns the golden summary every S3-01, S3-10..S3-13 row reads;
 * posts nothing when the engine contract (S3-0 cases.json) is missing.
 */
async function liveGolden(db, head) {
  const out = { probe: "scope3-golden", cases: [], report_cases: [], engine: null, snapshot: null };
  if (!fs.existsSync(goldenFile())) return { ...out, missing: true };
  const file = JSON.parse(fs.readFileSync(goldenFile(), "utf8"));
  out.tolerance = file.tolerance;
  const engine = engineGolden();
  out.engine = { exit: engine.status, summary: engine.summary };

  const categories = {};
  let monthOffset = 0;
  for (const k of file.cases) {
    const entry = { id: k.id, owner: k.owner, category: k.category, method: k.method, status: k.status, expected_kgco2e: k.expected_kgco2e, engine: engine.byCase[k.id]?.engine || null };
    if (k.status !== "run") {
      const owed = skipOwedBy(head, k);
      entry.result = owed ? "skip" : "fail";
      entry.why = owed ? `waits for ${owed}` : `still skip though ${k.owner} and what its note waits for are built`;
      out.cases.push(entry);
      continue;
    }
    if (!k.category || !k.rows?.length || k.expected_kgco2e === null) {
      entry.result = "fail";
      entry.why = "run case without a category, rows or figures";
      out.cases.push(entry);
      continue;
    }
    let posted;
    try {
      categories[k.category] = categories[k.category] || (await probeCategory(db, head, k.category));
      posted = await postCase(db, head, k, categories[k.category], monthOffset);
    } catch (err) {
      // The probe could not set the case up: a harness error, not the module's fail.
      entry.result = "error";
      entry.why = `setup failed: ${err.message}`;
      out.cases.push(entry);
      continue;
    }
    monthOffset += k.rows.length;
    if (posted.error) {
      entry.result = "fail";
      entry.why = posted.error;
      out.cases.push(entry);
      continue;
    }
    entry.ids = posted.ids;
    out.cases.push(entry);
  }

  // Review checks see the rows pending before anything is approved (S3-17).
  out.pending = out.cases.filter((c) => c.ids).flatMap((c) => c.ids);

  const ready = await readyCheckOn(db, head, out);
  await approveAll(db, head, out);
  out.only_ready = ready;

  // Report-level cases (S3-13): each case's stored kg posted on an identity
  // factor (D13) in its category, approved, read back from the report.
  if (fs.existsSync(reportFile())) {
    const report = JSON.parse(fs.readFileSync(reportFile(), "utf8"));
    for (const rc of report.cases) {
      const entry = { id: rc.id, owner: rc.owner, status: rc.status, expected_tco2e: rc.expected_tco2e };
      if (rc.status !== "run") {
        entry.result = "skip";
        out.report_cases.push(entry);
        continue;
      }
      if (!head.get("GET /reports/ghg/scope3")) {
        entry.result = "skip";
        entry.why = "waits for S3-13";
        out.report_cases.push(entry);
        continue;
      }
      const ids = [];
      let error = null;
      let i = 0;
      for (const [n, caseIds] of Object.entries(rc.categories)) {
        const categoryId = categories[n] || (categories[n] = await probeCategory(db, head, Number(n)));
        const name = `${TAG} ${rc.id} reported Cat ${n}`;
        await probeFactor(head, { categoryId, n: Number(n), name, value: 1, unit: "kgco2e", year: REPORT_YEAR - 1, type: "other" });
        for (const caseId of caseIds) {
          const kg = file.cases.find((c) => c.id === caseId)?.expected_kgco2e;
          const res = await postEntry({ categoryId, date: `${REPORT_YEAR}-${String((i % 12) + 1).padStart(2, "0")}-15`, name, value: kg, unit: "kgco2e" });
          i++;
          if (res.status !== 201) error = `${caseId}: POST /user/emissions answered ${res.status} ${res.json?.code || res.json?.message || ""}`.trim();
          else ids.push(res.json.emission.pk_id);
        }
      }
      if (!error && ids.length) await approve(ids);
      const read = await call("GET", `/reports/ghg/scope3?siteIds=${SITE}&year=${REPORT_YEAR}`, "admin");
      const actual = {};
      for (const key of Object.keys(rc.expected_tco2e)) {
        actual[key] = key === "scope3" ? read.json?.total_tco2e : read.json?.rows?.find((x) => x.n === Number(key))?.tco2e;
      }
      const wrong = Object.keys(rc.expected_tco2e).filter((key) => actual[key] !== rc.expected_tco2e[key]);
      entry.actual_tco2e = actual;
      entry.result = error || read.status !== 200 || wrong.length ? "fail" : "pass";
      if (error) entry.why = error;
      else if (read.status !== 200) entry.why = `report answered ${read.status}`;
      else if (wrong.length) entry.why = `differs on ${wrong.join(", ")}`;
      out.report_cases.push(entry);
    }
  }

  // Byte-identical calculation snapshot (ci/golden/run.cjs) in its own database.
  const snapshot = await inGoldenDb(path.join(ESG_DIR, "ci/golden/run.cjs"));
  out.snapshot = { exit: snapshot.status, summary: tail(snapshot) };
  return out;
}

/** Approves every posted case row, then reads back Σ kg per case. */
async function approveAll(db, head, out) {
  const all = out.cases.filter((c) => c.ids).flatMap((c) => c.ids);
  if (all.length) await approve(all);
  for (const c of out.cases) {
    if (!c.ids) continue;
    const got = await storedKg(db, head, c.ids);
    c.live_kgco2e = Math.round(got.kg * 10000) / 10000;
    const ok = got.approved === c.ids.length && withinTolerance(out.tolerance, got.kg, c.expected_kgco2e);
    c.result = ok ? "pass" : "fail";
    if (!ok) c.why = got.approved !== c.ids.length ? `${got.approved} of ${c.ids.length} row(s) approved` : `live ${c.live_kgco2e} kg, expected ${c.expected_kgco2e} kg`;
    delete c.ids;
  }
}

/**
 * S3-17's "approve all ready approves only ready rows", on two of the golden
 * rows while they are pending: one made ready with an evidence document, one
 * left held (no evidence). Recorded for the S3-17 row.
 */
async function readyCheckOn(db, head, out) {
  if (!head.get("emission.checks") || out.pending.length < 2) return null;
  const [readyId, heldId] = out.pending;
  const form = new FormData();
  form.append("file", new Blob([`${TAG} evidence`], { type: "application/pdf" }), "s3-16-probe-evidence.pdf");
  form.append("emission_id", String(readyId));
  const doc = await call("POST", "/user/documents", "user", form);
  if (doc.status !== 201) return { error: `evidence upload answered ${doc.status}` };
  made.documents.push(doc.json.document.document_id);
  const { rows } = await db.query(`SELECT pk_id, checks FROM emission WHERE pk_id = ANY($1::int[])`, [[readyId, heldId]]);
  const checks = Object.fromEntries(rows.map((r) => [r.pk_id, r.checks]));
  const res = await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [readyId, heldId], only_ready: true });
  const approvedIds = (res.json?.approved || []).map((x) => (typeof x === "object" ? x.pk_id ?? x.id : x));
  const skippedIds = (res.json?.skipped || []).map((x) => (typeof x === "object" ? x.pk_id ?? x.id : x));
  const after = await db.query(`SELECT pk_id, status FROM emission WHERE pk_id = ANY($1::int[])`, [[readyId, heldId]]);
  const status = Object.fromEntries(after.rows.map((r) => [r.pk_id, r.status]));
  return {
    http: res.status,
    readyBefore: checks[readyId]?.ready === true,
    heldBefore: checks[heldId]?.ready === false,
    heldIds: checks[heldId]?.held || [],
    readyApproved: status[readyId] === "approved" && approvedIds.map(Number).includes(Number(readyId)),
    heldSkipped: status[heldId] === "pending" && skippedIds.map(Number).includes(Number(heldId)),
  };
}

// ------------------------------------------------------------------ the rows

const CHECK_IDS = ["FACTOR_FOUND", "UNIT_OK", "EVIDENCE_ATTACHED", "WITHIN_THRESHOLD", "NO_DUPLICATE", "IMPORT_MATCH_SURE", "METHOD_GIVEN", "DQ_ACCEPTABLE"];

/** The rows S3-10 to S3-13 read: one module's live golden cases. */
function ownerCases(golden, owner) {
  const mine = golden.cases.filter((c) => c.owner === owner);
  const run = mine.filter((c) => c.status === "run");
  const failed = mine.filter((c) => c.result === "fail");
  return { mine, run, failed };
}

async function runRows(db, head, golden, logs) {
  const needs = (ids, title, expected, features, fn) =>
    probe(ids, title, expected, async (r) => {
      const owed = missing(head, features);
      if (owed) return r.na(owed);
      return fn(r);
    });

  // S3-01 · the golden suite.
  await probe("S3-01", "Golden cases reproduce the guidance", "ci/golden byte-identical; every case of a merged module is run and passes through the live API", async (r) => {
    if (golden.missing) return r.na("S3-0 (no ci/golden/scope3/cases.json transcribed yet)");
    const broken = golden.cases.filter((c) => c.result === "error");
    if (broken.length) throw new Error(broken.map((c) => `${c.id}: ${c.why}`).join("; "));
    const problems = [];
    if (golden.snapshot.exit !== 0) problems.push(`ci/golden/run.cjs exited ${golden.snapshot.exit}: ${golden.snapshot.summary}`);
    if (golden.engine.exit !== 0) problems.push(`test:scope3-golden exited ${golden.engine.exit}: ${golden.engine.summary}`);
    const failed = golden.cases.filter((c) => c.result === "fail");
    for (const c of failed) problems.push(`${c.id} (${c.owner}): ${c.why}`);
    for (const c of golden.report_cases.filter((x) => x.result === "fail")) problems.push(`${c.id} (${c.owner}): ${c.why}`);
    const run = golden.cases.filter((c) => c.status === "run");
    const skipped = golden.cases.filter((c) => c.result === "skip");
    const owed = [...new Set(skipped.map((c) => c.why.replace(/^waits for /, "")).flatMap((w) => w.split(", ")))].sort(byModule);
    if (problems.length) return r.fail(problems.join("; "));
    const reports = golden.report_cases.filter((c) => c.result === "pass").length;
    return r.pass(
      `snapshot identical; ${golden.engine.summary.replace(/\.$/, "")}; live API: ${run.length} run case(s) pass` +
        `${reports ? `, ${reports} report case(s) pass` : ""}; ${skipped.length} skip, owed by ${owed.join(", ") || "nobody"}`,
    );
  });

  await needs("S3-02", "Every Scope 3 category carries its GHG number", "a number 1-15 or Unmapped, only on Scope 3; scope is one of the four values; SCOPE_INVALID on a bad scope", ["category.ghg_category"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE scope = 'Scope 3' AND ghg_category IS NULL) AS unmapped,
              count(*) FILTER (WHERE ghg_category IS NOT NULL AND (ghg_category < 1 OR ghg_category > 15)) AS bad,
              count(*) FILTER (WHERE ghg_category IS NOT NULL AND scope IS DISTINCT FROM 'Scope 3') AS stray
         FROM category`,
    );
    const scopes = await db.query(
      `SELECT DISTINCT scope FROM category WHERE scope IS NOT NULL AND scope NOT IN ('Scope 1','Scope 2','Scope 3') ORDER BY scope`,
    );
    if (Number(rows[0].bad) > 0) return r.fail(`${rows[0].bad} category(ies) numbered outside 1-15`);
    if (Number(rows[0].stray) > 0) return r.fail(`${rows[0].stray} non-Scope 3 category(ies) carry a GHG number`);
    if (scopes.rows.length) return r.fail(`scope values outside the four: ${scopes.rows.map((s) => s.scope).join(", ")}`);
    const bad = await call("POST", "/admin/categories", "superadmin", { category_name: `${TAG} bad scope`, scope: "Scope 9" });
    await db.query(`DELETE FROM category WHERE category_name = $1`, [`${TAG} bad scope`]);
    if (bad.status !== 400 || bad.json?.code !== "SCOPE_INVALID") return r.fail(`a "Scope 9" category answered ${bad.status} ${bad.json?.code || ""}, expected 400 SCOPE_INVALID`);
    const wrong = await call("POST", "/admin/categories", "superadmin", { category_name: `${TAG} numbered Scope 1`, scope: "Scope 1", ghg_category: 4 });
    await db.query(`DELETE FROM category WHERE category_name = $1`, [`${TAG} numbered Scope 1`]);
    if (wrong.status !== 400 || wrong.json?.code !== "GHG_CATEGORY_INVALID") return r.fail(`a numbered Scope 1 category answered ${wrong.status} ${wrong.json?.code || ""}, expected 400 GHG_CATEGORY_INVALID`);
    return r.pass(`${rows[0].unmapped} Scope 3 category(ies) Unmapped, every number within 1-15 and on Scope 3 only; SCOPE_INVALID and GHG_CATEGORY_INVALID refuse bad saves`);
  });

  await needs("S3-03", "The company boundary covers all 15 categories", "15 rows a company; no exclusion without a reason (EXCLUSION_REASON_REQUIRED); Manager PUT 403", ["company_scope3_category", "GET /scope3/categories"], async (r) => {
    const list = await call("GET", "/scope3/categories", "admin");
    if (list.status !== 200 || list.json?.categories?.length !== 15) return r.fail(`Admin GET /scope3/categories answered ${list.status} with ${list.json?.categories?.length ?? "no"} row(s), expected 15`);
    const { rows } = await db.query(
      `SELECT company_id, count(*) AS rows,
              count(*) FILTER (WHERE status IN ('excluded', 'not_relevant') AND btrim(coalesce(reason, '')) = '') AS reasonless
         FROM company_scope3_category GROUP BY company_id ORDER BY company_id`,
    );
    const short = rows.filter((row) => Number(row.rows) !== 15);
    const reasonless = rows.filter((row) => Number(row.reasonless) > 0);
    if (short.length) return r.fail(`company ${short[0].company_id} has ${short[0].rows} boundary row(s), not 15`);
    if (reasonless.length) return r.fail(`company ${reasonless[0].company_id} excludes a category with no reason`);
    const noReason = await call("PUT", "/scope3/categories/8", "admin", { status: "excluded", reason: "  " });
    if (noReason.status !== 400 || noReason.json?.code !== "EXCLUSION_REASON_REQUIRED") return r.fail(`an exclusion with no reason answered ${noReason.status} ${noReason.json?.code || ""}, expected 400 EXCLUSION_REASON_REQUIRED`);
    const guarded = await call("PUT", "/scope3/categories/8", "manager", { status: "excluded", reason: TAG });
    if (guarded.status !== 403) return r.fail(`Manager PUT answered ${guarded.status}, expected 403 (D12)`);
    return r.pass(`${rows.length} company boundary(ies) of 15 rows, every exclusion with a reason; EXCLUSION_REASON_REQUIRED; Manager PUT 403`);
  });

  await needs("S3-04", "Factors carry their metadata and the snapshot copies it", "factor_type, gwp_set, geography, dataset on new factors; the row snapshot copies them; FACTOR_TYPE_MISMATCH warns only", ["emission_factors.factor_type", "category.ghg_category"], async (r) => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'emission_factors' AND column_name IN ('factor_type','gwp_set','geography','dataset')`,
    );
    if (rows.length !== 4) return r.fail(`${4 - rows.length} factor metadata column(s) missing`);
    const snaps = await db.query(
      `SELECT count(*) AS n,
              count(*) FILTER (WHERE emission_factor_snapshot->>'factor_type' IS NULL OR emission_factor_snapshot->>'gwp_set' IS NULL
                                  OR emission_factor_snapshot->>'geography' IS NULL OR emission_factor_snapshot->>'dataset' IS NULL) AS bare
         FROM emission WHERE activity_data->>'emission_category' LIKE $1`,
      [`${TAG} ex-%`],
    );
    if (Number(snaps.rows[0].n) === 0) return r.fail("no golden row was posted to read a snapshot from");
    if (Number(snaps.rows[0].bare) > 0) return r.fail(`${snaps.rows[0].bare} of ${snaps.rows[0].n} probe row snapshot(s) lack factor_type, gwp_set, geography or dataset`);
    const cat6 = await probeCategory(db, head, 6);
    const mismatch = await probeFactor(head, { categoryId: cat6, n: 6, name: `${TAG} mismatch`, value: 1, unit: "km", year: CHECK_YEAR, type: "wtt" });
    const codes = (mismatch.json.warnings || []).map((w) => w.code);
    return codes.includes("FACTOR_TYPE_MISMATCH")
      ? r.pass(`metadata on factors and copied to ${snaps.rows[0].n} row snapshot(s); a wtt factor on Cat 6 saves (201) with FACTOR_TYPE_MISMATCH`)
      : r.fail(`a wtt factor on Cat 6 saved with warnings [${codes.join(", ")}], expected FACTOR_TYPE_MISMATCH`);
  });

  await needs("S3-05", "Every new Scope 3 row carries a method and a DQ", "method, dq and data_type on rows from every channel; the backfill is done", ["emission.method", "emission.dq", "emission.data_type"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE e.method IS NULL) AS methodless
         FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE c.scope = 'Scope 3'`,
    );
    const fresh = await db.query(
      `SELECT count(*) AS n, count(*) FILTER (WHERE method IS NULL OR dq IS NULL OR data_type IS NULL) AS bare
         FROM emission WHERE activity_data->>'emission_category' LIKE $1`,
      [`${TAG} ex-%`],
    );
    if (Number(rows[0].total) === 0) return r.fail("no Scope 3 row in this database to judge");
    if (Number(rows[0].methodless) > 0) return r.fail(`${rows[0].methodless} of ${rows[0].total} Scope 3 row(s) have no method after the backfill`);
    if (Number(fresh.rows[0].bare) > 0) return r.fail(`${fresh.rows[0].bare} of ${fresh.rows[0].n} typed probe row(s) lack method, dq or data_type`);
    return r.pass(`${rows[0].total} Scope 3 row(s), each with a method; ${fresh.rows[0].n} typed probe row(s) with method, dq and data_type (other channels: S3-22)`);
  });

  await needs("S3-06", "Engine integrity", "UNIT_REQUIRED on a factor with no unit; total_kgco2e on every row", ["emission.total_kgco2e"], async (r) => {
    const cat6 = await probeCategory(db, head, 6);
    const create = await call("POST", "/admin/emission-factors", "superadmin", { site_id: SITE, category_id: cat6, year: CHECK_YEAR, factor_value: "1", denominator_unit: "", emission_category_name: `${TAG} unitless` });
    if (create.status === 201) made.factors.push(create.json.emissionFactor.emission_factor_id);
    if (create.status !== 400 || create.json?.code !== "UNIT_REQUIRED") return r.fail(`a factor with no unit saved as ${create.status} ${create.json?.code || ""}, expected 400 UNIT_REQUIRED`);
    // A unitless factor that predates the check still never applies unchecked.
    const legacy = await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
       VALUES ($1, $2, $3, 1000, '', $4, $5, $5) RETURNING emission_factor_id`,
      [SITE, cat6, CHECK_YEAR - 1, TAG, `${TAG} legacy unitless`],
    );
    made.factors.push(legacy.rows[0].emission_factor_id);
    const entry = await postEntry({ categoryId: cat6, date: `${CHECK_YEAR}-03-15`, name: `${TAG} legacy unitless`, value: 10, unit: "km" });
    if (entry.status !== 400 || entry.json?.code !== "UNIT_REQUIRED") return r.fail(`an entry on a unitless factor answered ${entry.status} ${entry.json?.code || ""}, expected 400 UNIT_REQUIRED`);
    const { rows } = await db.query(`SELECT count(*) AS n, count(*) FILTER (WHERE total_kgco2e IS NULL) AS missing FROM emission`);
    return Number(rows[0].missing) === 0
      ? r.pass(`UNIT_REQUIRED on factor save and on an entry; all ${rows[0].n} row(s) carry total_kgco2e (historical import parity: S3-4's API test)`)
      : r.fail(`${rows[0].missing} of ${rows[0].n} row(s) carry no total_kgco2e`);
  });

  await needs("S3-07", "Spend-based rows are reproducible", "fx stored with rate and date; FX_RATE_FALLBACK, NO_DEFLATOR and DEFLATOR_FALLBACK_YEAR warn", ["emission.fx", "fx_rate", "emission.method"], async (r) => {
    // Typed spend rows on a probe EEIO factor (USD, price year = the first US
    // index stored), each read back and recomputed from what the row stored.
    const idx = await db.query(`SELECT year, "index"::float8 AS i FROM price_deflator WHERE country = 'US' ORDER BY year`);
    if (idx.rows.length < 2) return r.fail(`price_deflator holds ${idx.rows.length} US index year(s); migrate:scope3-spend seeds the CPI-U series`);
    const index = Object.fromEntries(idx.rows.map((x) => [x.year, x.i]));
    const base = idx.rows[0].year;
    const exactYear = base + 1;
    const lateYear = idx.rows[idx.rows.length - 1].year + 1; // after the latest published index
    const INR_PER_USD = 80;
    const rateDay = `${exactYear}-03-10`;
    const near = await db.query(
      `SELECT 1 FROM fx_rate WHERE currency = 'INR' AND date BETWEEN $1::date - 7 AND $1::date AND source <> $2`,
      [`${exactYear}-06-10`, TAG],
    );
    await db.query(`INSERT INTO fx_rate (currency, date, rate_to_usd, source) VALUES ('INR', $1, $2, $3) ON CONFLICT (currency, date) DO NOTHING`, [rateDay, INR_PER_USD, TAG]);
    const stored = await db.query(`SELECT rate_to_usd::float8 AS r FROM fx_rate WHERE currency = 'INR' AND date = $1`, [rateDay]);
    const inrPerUsd = stored.rows[0].r;

    const cat1 = await probeCategory(db, head, 1);
    const name = `${TAG} spend sector`;
    const FACTOR = 0.5; // kgCO₂e per USD at the price year
    const years = [...new Set([exactYear, base - 1, lateYear <= new Date().getUTCFullYear() ? lateYear : null].filter(Boolean))];
    for (const y of years) {
      await probeFactor(head, { categoryId: cat1, n: 1, name, value: FACTOR, unit: "USD", year: y - 1, type: "eeio_spend", extra: { price_currency: "USD", price_base_year: base } });
    }
    const spend = async (date, amount, currency, invoice) => {
      const res = await call("POST", "/user/emissions", "user", {
        site_id: SITE,
        category_id: cat1,
        date_of_reporting: date,
        activity_data: { emission_category: name, "@method": "spend_based", spent_value: String(amount), currency },
        extra_data: { invoice_date: invoice },
      });
      if (res.status === 201) made.emissions.push(res.json.emission.pk_id);
      return res;
    };
    const problems = [];
    const seen = [];
    const check = async (label, res, { warn, expectKg }) => {
      if (res.status !== 201) return problems.push(`${label}: POST /user/emissions answered ${res.status} ${res.json?.code || res.json?.message || ""}`.trim());
      const codes = (res.json.warnings || []).map((w) => w.code);
      const row = (await db.query(`SELECT method, fx, total_kgco2e::float8 AS kg FROM emission WHERE pk_id = $1`, [res.json.emission.pk_id])).rows[0];
      const fx = row.fx || {};
      if (row.method !== "spend_based") problems.push(`${label}: stored method ${row.method}, expected spend_based`);
      if (!(Number(fx.rate) > 0) || !fx.as_of) return problems.push(`${label}: fx stored without a rate and a date (${JSON.stringify(row.fx)})`);
      if (Math.abs(row.kg - expectKg(Number(fx.rate))) > 0.001) problems.push(`${label}: stored ${row.kg} kg, the stored fx and indexes give ${expectKg(Number(fx.rate)).toFixed(4)}`);
      for (const code of ["FX_RATE_FALLBACK", "NO_DEFLATOR", "DEFLATOR_FALLBACK_YEAR"]) {
        if (code === warn && !codes.includes(code)) problems.push(`${label}: warnings [${codes.join(", ")}], expected ${code}`);
        if (code !== warn && codes.includes(code)) problems.push(`${label}: unexpected ${code}`);
      }
      seen.push(`${label} ${warn || "no warning"}`);
      return row;
    };

    // INR on a day with a stored rate: converted at it, deflated to the price year.
    const exact = await spend(`${exactYear}-03-15`, 80000, "INR", rateDay);
    const exactRow = await check("INR on a stored day", exact, { expectKg: (rate) => 80000 * rate * (index[base] / index[exactYear]) * FACTOR });
    if (exactRow && Math.abs(Number(exactRow.fx.rate) - 1 / inrPerUsd) > 1e-9) problems.push(`INR on a stored day: fx.rate ${exactRow.fx.rate}, the stored rate gives ${1 / inrPerUsd}`);
    if (exactRow && String(exactRow.fx.as_of).slice(0, 10) !== rateDay) problems.push(`INR on a stored day: fx.as_of ${exactRow.fx.as_of}, expected ${rateDay}`);
    // INR three months after the last stored rate: the latest rate, flagged.
    if (near.rows.length) seen.push("FX_RATE_FALLBACK not tried (this database stores an INR rate that week)");
    else await check("INR with no rate that week", await spend(`${exactYear}-06-15`, 80000, "INR", `${exactYear}-06-10`), { warn: "FX_RATE_FALLBACK", expectKg: (rate) => 80000 * rate * (index[base] / index[exactYear]) * FACTOR });
    // USD before the first index year: not deflated, flagged.
    await check("USD before the first index", await spend(`${base - 1}-05-15`, 1000, "USD", `${base - 1}-05-15`), { warn: "NO_DEFLATOR", expectKg: () => 1000 * FACTOR });
    // USD after the latest index: the latest index stands in, flagged.
    if (years.includes(lateYear)) {
      const latest = idx.rows[idx.rows.length - 1].year;
      await check(`USD in ${lateYear}`, await spend(`${lateYear}-01-15`, 1000, "USD", `${lateYear}-01-15`), { warn: "DEFLATOR_FALLBACK_YEAR", expectKg: () => 1000 * (index[base] / index[latest]) * FACTOR });
    } else seen.push(`DEFLATOR_FALLBACK_YEAR not tried (${lateYear} has not started)`);
    return problems.length ? r.fail(`${problems.join("; ")} (held: ${seen.join("; ") || "nothing"})`) : r.pass(`spend rows store fx with rate and date and recompute from it: ${seen.join("; ")}`);
  });

  await needs("S3-08", "Supplier figures and hybrid allocation", "SUPPLIER_FACTOR_BOUNDARY on a wrong boundary; hybrid allocates by the chosen key", ["supplier", "emission.supplier_id"], async (r) =>
    r.manual("S3-6 is built; walk SUPPLIER_FACTOR_BOUNDARY and hybrid allocation until this row learns the supplier API"),
  );

  await needs("S3-09", "Cat 3 twins are split, not double counted", "scope3_sub on every twin; WTT_ALREADY_IN_FACTOR warns on a Cat 4/9 WTT-inclusive factor; no total moved without the PR list", ["emission.scope3_sub", "category.ghg_category"], async (r) => {
    const problems = [];
    const seen = [];
    // A Scope 1 entry with a FERA factor gets its 3a twin.
    const fuel = `${TAG} diesel`;
    await probeFactor(head, { categoryId: 1, n: null, name: fuel, value: 2.68, unit: "litre", year: CHECK_YEAR - 1, type: "combustion" });
    await probeFactor(head, { categoryId: 5, n: 3, name: fuel, value: 0.61, unit: "litre", year: CHECK_YEAR - 1, type: "wtt" });
    const entry = await postEntry({ categoryId: 1, date: `${CHECK_YEAR}-04-15`, name: fuel, value: 1000, unit: "litre" });
    const twin = entry.json?.fera_emission;
    if (entry.status !== 201) problems.push(`a Scope 1 entry answered ${entry.status} ${entry.json?.code || entry.json?.message || ""}`.trim());
    else if (!twin) problems.push("a Scope 1 entry with a FERA factor got no Category 3 twin");
    else if (twin.scope3_sub !== "3a_upstream_fuels") problems.push(`the fuel twin carries scope3_sub ${twin.scope3_sub}, expected 3a_upstream_fuels`);
    else seen.push("fuel twin 3a_upstream_fuels");
    // A twin is the FERA-category row of a linked pair; the link may point either way.
    const { rows } = await db.query(
      `SELECT count(*) AS twins, count(*) FILTER (WHERE t.scope3_sub IS NULL) AS unsplit
         FROM emission t JOIN category c ON c.category_id = t.category_id
        WHERE lower(c.category_name) = 'fera'
          AND (t.fera_linked_id IS NOT NULL OR EXISTS (SELECT 1 FROM emission p WHERE p.fera_linked_id = t.pk_id))`,
    );
    if (Number(rows[0].unsplit) > 0) problems.push(`${rows[0].unsplit} of ${rows[0].twins} twin(s) carry no scope3_sub`);
    else seen.push(`all ${rows[0].twins} twin(s) split`);
    // D6: a WTT-inclusive life-cycle freight factor on a category numbered 4
    // (ghg_category, named the client's way) warns and keeps its total.
    const cat4 = await probeCategory(db, head, 4);
    const freight = `${TAG} freight with WTT`;
    await probeFactor(head, { categoryId: cat4, n: 4, name: freight, value: 0.11, unit: "tonne.km", year: CHECK_YEAR - 1, type: "life_cycle", extra: { includes_wtt: true } });
    const haul = await postEntry({ categoryId: cat4, date: `${CHECK_YEAR}-04-15`, name: freight, value: 1000, unit: "tonne.km" });
    if (haul.status !== 201) problems.push(`a Cat 4 entry answered ${haul.status} ${haul.json?.code || ""}`.trim());
    else {
      const codes = (haul.json.warnings || []).map((w) => w.code);
      const kg = (await db.query(`SELECT total_kgco2e FROM emission WHERE pk_id = $1`, [haul.json.emission.pk_id])).rows[0].total_kgco2e;
      if (!codes.includes("WTT_ALREADY_IN_FACTOR")) {
        problems.push(`a life_cycle factor with includes_wtt on a category with ghg_category 4 (not named "Upstream transportation and distribution") gave warnings [${codes.join(", ")}], expected WTT_ALREADY_IN_FACTOR`);
      } else seen.push("WTT_ALREADY_IN_FACTOR warns");
      if (Number(kg) !== 110) problems.push(`the Cat 4 row stored ${kg} kg, expected 110 (D6: nothing recalculated)`);
      else seen.push("Cat 4 total kept (110 kg)");
    }
    const cat3 = golden.cases.filter((c) => c.category === 3);
    const bad = cat3.filter((c) => c.result === "fail");
    if (bad.length) problems.push(`Cat 3 golden case(s) fail: ${bad.map((c) => c.id).join(", ")}`);
    else seen.push(`${cat3.filter((c) => c.result === "pass").length} Cat 3 golden case(s) pass live; snapshot: S3-01`);
    return problems.length ? r.fail(`${problems.join("; ")} (held: ${seen.join("; ")})`) : r.pass(seen.join("; "));
  });

  for (const [ids, title, owner, features] of [
    ["S3-10", "Transport forms compute their golden cases", "S3-8", ["migrate:scope3-transport"]],
    ["S3-11", "Travel and commuting forms compute their golden cases", "S3-9", ["GET /scope3/commuting/sites"]],
    ["S3-12", "Sold products compute their golden cases", "S3-10", ["product_sale", "GET /scope3/product-sales"]],
    ["S3-13", "Leased assets, franchises and investments compute their golden cases", "S3-11", ["investment", "GET /scope3/investments"]],
  ]) {
    await needs(ids, title, `every ${owner} case reproduces the guidance figure through the API`, features, async (r) => {
      if (golden.missing) return r.na("S3-0 (no ci/golden/scope3/cases.json)");
      const { mine, run, failed } = ownerCases(golden, owner);
      const broken = mine.filter((c) => c.result === "error");
      if (broken.length) throw new Error(broken.map((c) => `${c.id}: ${c.why}`).join("; "));
      if (failed.length) return r.fail(failed.map((c) => `${c.id}: ${c.why}`).join("; "));
      if (!run.length) return r.fail(`${owner} is built but none of its ${mine.length} golden case(s) is run`);
      const waiting = mine.filter((c) => c.result === "skip");
      return r.pass(
        `${run.length} case(s) pass live (${run.map((c) => c.id).join(", ")})` +
          (waiting.length ? `; ${waiting.map((c) => `${c.id} ${c.why}`).join("; ")}` : ""),
      );
    });
  }

  await needs("S3-14", "Screening estimates never become rows", "proxy rows are Pending, secondary, and carry their basis", ["emission.proxy", "GET /scope3/screening"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) AS proxies,
              count(*) FILTER (WHERE status::text NOT IN ('pending', 'approved', 'rejected') OR data_type <> 'secondary' OR proxy->>'basis' IS NULL) AS wrong
         FROM emission WHERE proxy IS NOT NULL`,
    );
    if (Number(rows[0].proxies) === 0) return r.manual("S3-12 is built but this database holds no proxy row; walk POST /scope3/extrapolate");
    return Number(rows[0].wrong) === 0
      ? r.pass(`${rows[0].proxies} proxy row(s), each secondary and with a basis`)
      : r.fail(`${rows[0].wrong} proxy row(s) are not secondary or carry no basis`);
  });

  await needs("S3-15", "The report answers the ch. 11 checklist", "R1-R10 present in /reports/ghg/scope3 and the PDF, or \"Not tracked\"", ["GET /reports/ghg/scope3"], async (r) => {
    const year = REPORT_YEAR;
    const report = await call("GET", `/reports/ghg/scope3?siteIds=${SITE}&year=${year}`, "admin");
    if (report.status !== 200) return r.fail(`/reports/ghg/scope3 answered ${report.status}`);
    const body = report.json;
    const rows = body.rows || [];
    const t = body.tracked || {};
    const cat = rows.filter((x) => x.n !== null);
    const every = (fn) => cat.length === 15 && cat.every(fn);
    const items = {
      // R1 lives in the PDF's KPI row (Scope 1 and 2 totals), read below.
      R2: every((x) => typeof x.tco2e === "number") && typeof body.total_tco2e === "number",
      R3: every((x) => "biogenic_tco2e" in x),
      R4: every((x) => typeof x.status === "string" && Array.isArray(x.mapped_categories)),
      R5: rows.filter((x) => ["excluded", "not_relevant"].includes(x.status)).every((x) => String(x.reason || "").trim()),
      R6: true, // the base-year block, in the PDF (S3-14 fills it)
      R7: every((x) => x.biogenic_tco2e === null || typeof x.biogenic_tco2e === "number") && (t.biogenic || cat.every((x) => x.biogenic_tco2e === null)),
      R8: every((x) => Array.isArray(x.datasets) && Array.isArray(x.gwp_sets) && x.dq && typeof x.dq === "object"),
      R9: every((x) => x.methods && typeof x.methods === "object" && "method_note" in x),
      R10: every((x) => "value_chain_pct" in x && "primary_pct" in x),
    };
    const missingJson = Object.entries(items).filter(([, ok]) => !ok).map(([k]) => k);
    if (missingJson.length) return r.fail(`report JSON lacks ${missingJson.join(", ")}`);
    const notTracked = Object.entries(t).filter(([, v]) => v === false).map(([k]) => k);

    // The PDF: rendered when the stack has a browser, else the same Scope 3
    // blocks the PDF prints, from the build under audit.
    const pdf = await call("GET", `/reports/ghg?siteIds=${SITE}&year=${year}`, "admin");
    let text = "";
    let source;
    if (pdf.status === 200 && pdf.buffer && pdf.buffer.slice(0, 4).toString() === "%PDF") {
      const file = path.join(path.dirname(OUT), `.scope3-probe-${process.pid}.pdf`);
      fs.writeFileSync(file, pdf.buffer);
      const txt = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
      fs.rmSync(file, { force: true });
      if (txt.status === 0) {
        text = txt.stdout;
        source = "PDF text";
      }
    }
    if (!text) {
      const { scope3Blocks } = require(path.join(ESG_DIR, "dist/reporting/ghg-scope3.js"));
      text = JSON.stringify(scope3Blocks(body, null, "S3-16 probe"));
      source = `the PDF's Scope 3 blocks from dist (PDF answered ${pdf.status}; no browser on this host)`;
    }
    const pdfItems = {
      R1: source === "PDF text" ? /Scope 1/.test(text) && /Scope 2/.test(text) : null,
      R2: /Scope 3 by category/i.test(text),
      R5: /(Excluded|not relevant)/i.test(text),
      R6: /base year/i.test(text),
      R7: /Biogenic/i.test(text) && (t.biogenic || /Not tracked/.test(text)),
      R8: /Data quality/i.test(text) && /(dataset|GWP|AR\d)/i.test(text),
      R9: /Methodology/i.test(text),
      R10: /(value.chain|supplier)/i.test(text),
    };
    const missingPdf = Object.entries(pdfItems).filter(([, ok]) => ok === false).map(([k]) => k);
    if (missingPdf.length) return r.fail(`${source} lacks ${missingPdf.join(", ")}`);
    return r.pass(
      `JSON: 15 categories + Unmapped carry R2-R5 and R7-R10${notTracked.length ? `; Not tracked: ${notTracked.join(", ")}` : ""}; ` +
        `${source}: ${Object.entries(pdfItems).filter(([, ok]) => ok).map(([k]) => k).join(", ")}${pdfItems.R1 === null ? " (R1 is the KPI row of the rendered PDF, not in these blocks)" : ""}`,
    );
  });

  await needs("S3-16", "Base year freezes and re-freezes", "a freeze, a proposal at or above the threshold, approval re-freezes, rows untouched", ["company_base_year", "GET /scope3/base-year"], async (r) => {
    // Company 1 freezes the golden year (its rows are approved by now), a late
    // approved row moves it by about 20 %, and the Admin approves the proposal.
    // A company that already has a base year is never touched.
    if ((await db.query(`SELECT 1 FROM company_base_year WHERE company_id = 1`)).rows.length) {
      return r.manual("company 1 already has a Scope 3 base year, which the probe never overwrites; walk freeze, proposal and re-freeze by hand");
    }
    const preview = await call("GET", `/scope3/base-year/preview?base_year=${GOLDEN_YEAR}`, "admin");
    if (preview.status !== 200) return r.fail(`preview of ${GOLDEN_YEAR} answered ${preview.status} ${preview.json?.code || ""}`.trim());
    const manager = await call("PUT", "/scope3/base-year", "manager", { base_year: GOLDEN_YEAR, rationale: TAG });
    if (manager.status !== 403) return r.fail(`Manager PUT /scope3/base-year answered ${manager.status}, expected 403 (D12)`);
    const freeze = await call("PUT", "/scope3/base-year", "admin", { base_year: GOLDEN_YEAR, rationale: TAG, significance_pct: 5 });
    if (freeze.status !== 200) return r.fail(`Admin freeze answered ${freeze.status} ${freeze.json?.code || ""}`.trim());
    const snap = freeze.json.snapshot || {};
    if (snap.version !== 1 || snap.total_tco2e !== preview.json.total_tco2e) {
      return r.fail(`freeze stored version ${snap.version}, ${snap.total_tco2e} t; the preview showed ${preview.json.total_tco2e} t (expected version 1)`);
    }
    if (!(snap.total_tco2e > 0)) return r.fail(`the frozen ${GOLDEN_YEAR} total is ${snap.total_tco2e} t; the golden rows should be in it`);

    const lateKg = Math.round(snap.total_tco2e * 1000 * 0.2);
    const cat = await probeCategory(db, head, 2);
    const name = `${TAG} late base-year row`;
    await probeFactor(head, { categoryId: cat, n: 2, name, value: 1, unit: "kgco2e", year: GOLDEN_YEAR - 1, type: "other" });
    const late = await postEntry({ categoryId: cat, date: `${GOLDEN_YEAR}-12-28`, name, value: lateKg, unit: "kgco2e" });
    if (late.status !== 201) return r.fail(`the late ${GOLDEN_YEAR} row answered ${late.status} ${late.json?.code || ""}`.trim());
    await approve([late.json.emission.pk_id]);

    const open = await call("GET", "/scope3/recalculations?status=proposed", "admin");
    const events = open.json?.events || [];
    if (open.status !== 200 || events.length !== 1) return r.fail(`after a ~20 % late row, GET /scope3/recalculations?status=proposed answered ${open.status} with ${events.length} proposal(s), expected 1`);
    const p = events[0];
    if (!(Math.abs(p.delta_pct) >= 5)) return r.fail(`the proposal moves the base year ${p.delta_pct} %, below the 5 % threshold it was raised for`);
    const noReason = await call("POST", "/scope3/recalculations", "admin", { note: TAG });
    if (noReason.status !== 400 || noReason.json?.code !== "RECALCULATION_REASON_REQUIRED") return r.fail(`approve with no reason answered ${noReason.status} ${noReason.json?.code || ""}, expected 400 RECALCULATION_REASON_REQUIRED`);
    const byManager = await call("POST", "/scope3/recalculations", "manager", { reason: p.reason });
    if (byManager.status !== 403) return r.fail(`Manager approve answered ${byManager.status}, expected 403`);

    const rowsBefore = (await db.query(`SELECT count(*)::int AS n, coalesce(sum(total_kgco2e), 0)::text AS kg, max(updated_at)::text AS at FROM emission`)).rows[0];
    const ok = await call("POST", "/scope3/recalculations", "admin", { reason: p.reason, note: TAG });
    const rowsAfter = (await db.query(`SELECT count(*)::int AS n, coalesce(sum(total_kgco2e), 0)::text AS kg, max(updated_at)::text AS at FROM emission`)).rows[0];
    if (ok.status !== 200) return r.fail(`Admin approve answered ${ok.status} ${ok.json?.code || ""}`.trim());
    const refrozen = ok.json.base_year?.snapshot || {};
    const want = Math.round((snap.total_tco2e * 1000 + lateKg) / 10) / 100;
    if (refrozen.version !== 2 || Math.abs(refrozen.total_tco2e - want) > 0.011) return r.fail(`approval re-froze version ${refrozen.version} at ${refrozen.total_tco2e} t, expected version 2 at about ${want} t`);
    if (JSON.stringify(rowsBefore) !== JSON.stringify(rowsAfter)) return r.fail(`approval touched emission rows: ${JSON.stringify(rowsBefore)} → ${JSON.stringify(rowsAfter)}`);
    return r.pass(`froze ${GOLDEN_YEAR} at ${snap.total_tco2e} t (as previewed; Manager 403); a ${p.delta_pct} % late row raised one ${p.reason} proposal; no reason → RECALCULATION_REASON_REQUIRED, Manager 403; approval re-froze version 2 at ${refrozen.total_tco2e} t with emission rows untouched`);
  });

  await needs("S3-17", "Review checks hold and release rows", "every pending row carries checks of the §8 ids; ready filter and counts; \"approve all ready\" approves only ready rows", ["emission.checks"], async (r) => {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) FILTER (WHERE status = 'pending' AND checks IS NULL) AS unchecked
         FROM emission`,
    );
    if (Number(rows[0].unchecked) > 0) return r.fail(`${rows[0].unchecked} of ${rows[0].pending} pending row(s) carry no checks`);
    const held = await db.query(`SELECT DISTINCT jsonb_array_elements_text(checks->'held') AS id FROM emission WHERE checks IS NOT NULL`);
    const unknown = held.rows.map((x) => x.id).filter((id) => !CHECK_IDS.includes(id));
    if (unknown.length) return r.fail(`held check id(s) outside §8: ${unknown.join(", ")}`);
    const list = await call("GET", `/user/emissions?siteIds=${SITE}&page=1&limit=10&ready=0`, "manager");
    if (list.status !== 200 || typeof list.json?.summary?.ready !== "number" || typeof list.json?.summary?.held !== "number") return r.fail(`GET /user/emissions?ready=0 answered ${list.status} without summary.ready and summary.held`);
    if (!(list.json.data || []).every((e) => e.status === "pending")) return r.fail("ready=0 lists rows that are not pending");
    const o = golden.only_ready;
    if (!o) return r.fail("no two pending probe rows to try only_ready on");
    if (o.error) return r.fail(o.error);
    const problems = [];
    if (!o.readyBefore) problems.push("a row with evidence was not ready");
    if (!o.heldBefore) problems.push("a row with no evidence was not held");
    if (!o.readyApproved) problems.push("only_ready did not approve the ready row");
    if (!o.heldSkipped) problems.push("only_ready did not skip the held row");
    return problems.length
      ? r.fail(problems.join("; "))
      : r.pass(`${rows[0].pending} pending row(s) all checked, held ids within §8; ready filter and counts answer; only_ready approved the ready row and skipped the held one (held: ${o.heldIds.join(", ")})`);
  });

  await needs("S3-18", "Drafts stay out of queues, and a locked month refuses writes", "PERIOD_LOCKED on create, edit, delete, approve, reject, batch, import commit and MCP commit; unlock needs a reason", ["period_lock", "company.review_workflow_v2", "GET /periods/lock"], async (r) =>
    r.manual("S3-15 part 2 is built; walk every write path on a locked month until this row learns the lock API"),
  );

  await probe("S3-19", "Tenant isolation on every Scope 3 endpoint", "company 2's token on company 1's ids answers 403 or 404", async (r) => {
    const built = ISOLATION.filter((e) => !missing(head, e.needs));
    const owed = [...new Set(ISOLATION.filter((e) => missing(head, e.needs)).map((e) => missing(head, e.needs)))].join(", ");
    if (!built.length) return r.na(`S3-1, S3-9 to S3-15 (no Scope 3 endpoint is mounted yet)`);
    await otherAdmin(db);
    const leaks = [];
    for (const e of built) {
      // company_id=1 on the query too, so a write route that reads it there is asked for company 1.
      const route = /company_id=|^\/company\/|^\/reports\//.test(e.route) ? e.route : `${e.route}${e.route.includes("?") ? "&" : "?"}company_id=1`;
      for (const who of ["otherManager", "otherUser", "otherAdmin"]) {
        const res = await call(e.method, route, who, e.body);
        if (![403, 404].includes(res.status)) leaks.push(`${e.method} ${route} as ${who} answered ${res.status}`);
      }
    }
    return leaks.length
      ? r.fail(leaks.join("; "))
      : r.pass(`${built.length} endpoint(s) × company 2's Manager, User and Admin answer 403/404${owed ? `; not built yet: ${owed}` : ""}`);
  });

  await probe("S3-20", "The role matrix holds", "User, Manager, Admin and Superadmin per D12, layer rule 3 and each module's roles", async (r) => {
    const built = MATRIX.filter((e) => !missing(head, e.needs));
    if (!built.length) return r.na("S3-1 (no Scope 3 endpoint is mounted yet)");
    const owed = [...new Set(MATRIX.filter((e) => missing(head, e.needs)).map((e) => missing(head, e.needs)))].join(", ");
    const wrong = [];
    for (const e of built) {
      for (const who of ROLES) {
        const route = who === "superadmin" && e.superadminRoute ? e.superadminRoute : e.route;
        const body = who === "superadmin" && e.body ? { ...e.body, company_id: 1 } : e.body;
        const res = await call(e.method, route, who, body);
        const want = e.expect[who];
        if (want === "allowed" ? [401, 403, 404].includes(res.status) || res.status >= 500 : res.status !== want) {
          wrong.push(`${e.method} ${e.route} as ${who}: ${res.status}, expected ${want}`);
        }
      }
    }
    return wrong.length
      ? r.fail(wrong.join("; "))
      : r.pass(`${built.length} endpoint(s) × 4 roles as specified${owed ? `; not built yet: ${owed}` : ""}`);
  });

  // S3-21 runs after cleanup (see main): its migrations seed forms for sites
  // with Scope 3 categories, so they must not see the probe's categories.

  await needs("S3-22", "Every channel agrees", "one row typed, bulk, smart import and MCP gives the same total_kgco2e, method and dq", ["emission.method", "emission.total_kgco2e"], async (r) =>
    r.manual("walk one Scope 3 row through typed, bulk, smart import and MCP and compare total_kgco2e, method and dq"),
  );

  await probe("S3-23", "Logs carry no sheet text", "no cell text, supplier names, prices or survey refs in the API or AI logs", async (r) => {
    const text = logs.join("");
    const hits = text.split("\n").filter((line) => line.includes(TAG)).length;
    if (hits) return r.fail(`${hits} API log line(s) carry the probe's activity names (layer rule 7)`);
    return r.manual("API log of this run is clean (no probe activity name in it); read the AI service log from ai-probes by hand");
  });

  await probe("S3-24", "The Scope 3 pages hold up", "every Scope 3 route in the sweep, four themes, 390 px, no console errors", async (r) =>
    r.manual("route-sweep.mjs with the Scope 3 routes (see the handover), then look at each page"),
  );

  await probe("E2E-12", "A Scope 3 month, end to end", "contributor drafts and submits; manager approves ready rows, fixes a held one, locks the month; Admin screens, sets status, reads the report and the base year", async (r) =>
    r.manual("walked on staging by hand; the result is dated in the audit doc"),
  );
}

async function migrationsTwice(db) {
  await probe("S3-21", "Migrations are idempotent", "migrate:all runs twice clean with every migrate:scope3-* script; the second run changes nothing", async (r) => {
    const names = scope3Migrations();
    if (!names.length) return r.na("S3-1 to S3-15 (no migrate:scope3-* script exists yet)");
    const prints = [];
    for (const pass of [1, 2]) {
      const run = spawnSync(process.execPath, [path.join(ESG_DIR, "scripts/migrate-all.cjs")], { cwd: ESG_DIR, env: process.env, encoding: "utf8" });
      if (run.status !== 0) return r.fail(`migrate:all failed on pass ${pass}: ${tail(run)}`);
      const ran = names.filter((n) => run.stdout.includes(`> ${n}\n`));
      if (ran.length !== names.length) return r.fail(`migrate:all skipped ${names.filter((n) => !ran.includes(n)).join(", ")}`);
      prints.push({ counts: await fingerprint(db), columns: (await db.query(`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'public'`)).rows[0].n });
    }
    const moved = diffCounts(prints[0].counts, prints[1].counts);
    if (moved.length || prints[0].columns !== prints[1].columns) return r.fail(`the second migrate:all changed ${moved.join(", ") || "the schema"}`);
    return r.pass(`migrate:all ran twice clean with ${names.length} migrate:scope3-* script(s) (${names.map((n) => n.replace("migrate:scope3-", "")).join(", ")}); the second changed nothing`);
  });
}

// Tenant isolation: company 2's tokens on company 1's ids. Write bodies are
// deliberately invalid, so a leak shows as a 400/200 without writing anything.
const ISOLATION = [
  { method: "GET", route: "/scope3/categories?company_id=1", needs: ["GET /scope3/categories"] },
  { method: "PUT", route: "/scope3/categories/8", body: { company_id: 1, status: "maybe" }, needs: ["GET /scope3/categories"] },
  { method: "GET", route: "/scope3/category-map?company_id=1", needs: ["GET /scope3/categories"] },
  { method: "POST", route: "/scope3/category-map", body: { company_id: 1, confirm: [{ category_id: 5, ghg_category: 0 }] }, needs: ["GET /scope3/categories"] },
  { method: "PUT", route: "/company/1/consolidation-approach", body: { consolidation_approach: "whatever" }, needs: ["GET /scope3/categories"] },
  { method: "GET", route: "/scope3/commuting/sites?company_id=1", needs: ["GET /scope3/commuting/sites"] },
  { method: "POST", route: "/scope3/commuting/surveys", body: { company_id: 1, site_id: 1 }, needs: ["GET /scope3/commuting/sites"] },
  { method: "GET", route: "/scope3/product-sales?company_id=1", needs: ["GET /scope3/product-sales"] },
  { method: "POST", route: "/scope3/product-sales", body: { company_id: 1 }, needs: ["GET /scope3/product-sales"] },
  { method: "POST", route: "/scope3/sold-products/plan", body: { company_id: 1, site_id: 1 }, needs: ["GET /scope3/product-sales"] },
  { method: "GET", route: "/scope3/investments?company_id=1", needs: ["GET /scope3/investments"] },
  { method: "POST", route: "/scope3/investments", body: { company_id: 1 }, needs: ["GET /scope3/investments"] },
  { method: "POST", route: "/scope3/investments/plan", body: { company_id: 1, site_id: 1 }, needs: ["GET /scope3/investments"] },
  { method: "GET", route: "/scope3/assets/sites?company_id=1", needs: ["GET /scope3/investments"] },
  { method: "PUT", route: "/scope3/assets/sites/1", body: { company_id: 1, lease_role: "bogus" }, needs: ["GET /scope3/investments"] },
  { method: "GET", route: "/scope3/screening?company_id=1&year=2025", needs: ["GET /scope3/screening"] },
  { method: "GET", route: `/reports/ghg/scope3?siteIds=${SITE}&year=2025`, needs: ["GET /reports/ghg/scope3"] },
  { method: "GET", route: `/reports/ghg/scope3/1?siteIds=${SITE}&year=2025`, needs: ["GET /reports/ghg/scope3"] },
  { method: "GET", route: "/scope3/base-year?company_id=1", needs: ["GET /scope3/base-year"] },
  { method: "GET", route: `/scope3/base-year/preview?company_id=1&base_year=${GOLDEN_YEAR}`, needs: ["GET /scope3/base-year"] },
  { method: "PUT", route: "/scope3/base-year?company_id=1", body: { company_id: 1, base_year: "x" }, needs: ["GET /scope3/base-year"] },
  { method: "GET", route: "/scope3/recalculations?company_id=1", needs: ["GET /scope3/base-year"] },
  { method: "POST", route: "/scope3/recalculations?company_id=1", body: { company_id: 1 }, needs: ["GET /scope3/base-year"] },
  { method: "GET", route: "/periods/lock?company_id=1&year=2025&month=1", needs: ["GET /periods/lock"] },
  { method: "POST", route: "/periods/lock", body: { company_id: 1, site_id: SITE, year: 2025, month: 13 }, needs: ["GET /periods/lock"] },
  { method: "POST", route: "/periods/unlock", body: { company_id: 1, site_id: SITE, year: 2025, month: 1, reason: "" }, needs: ["GET /periods/lock"] },
];

// Role matrix. "allowed" = past the role check (2xx, or a 400 on the
// deliberately invalid write body); a number = that exact status.
const READ_ALL = { user: "allowed", manager: "allowed", admin: "allowed", superadmin: "allowed" };
const MANAGER_UP = { user: 403, manager: "allowed", admin: "allowed", superadmin: "allowed" };
const ADMIN_UP = { user: 403, manager: 403, admin: "allowed", superadmin: "allowed" };
const MATRIX = [
  // S3-1 / D12: everyone reads the boundary; Admin and Superadmin change it.
  { method: "GET", route: "/scope3/categories", superadminRoute: "/scope3/categories?company_id=1", expect: READ_ALL, needs: ["GET /scope3/categories"] },
  { method: "PUT", route: "/scope3/categories/8", body: { status: "maybe" }, expect: ADMIN_UP, needs: ["GET /scope3/categories"] },
  { method: "PUT", route: "/company/1/consolidation-approach", body: { consolidation_approach: "whatever" }, expect: ADMIN_UP, needs: ["GET /scope3/categories"] },
  { method: "POST", route: "/scope3/category-map", body: { confirm: [{ category_id: 5, ghg_category: 0 }] }, expect: { user: 403, manager: 403, admin: 403, superadmin: "allowed" }, needs: ["GET /scope3/categories"] },
  // S3-9: commuting surveys are Manager and above.
  { method: "GET", route: "/scope3/commuting/sites", superadminRoute: "/scope3/commuting/sites?company_id=1", expect: MANAGER_UP, needs: ["GET /scope3/commuting/sites"] },
  // S3-10: product sales are Manager and above.
  { method: "GET", route: "/scope3/product-sales", superadminRoute: "/scope3/product-sales?company_id=1", expect: MANAGER_UP, needs: ["GET /scope3/product-sales"] },
  // S3-11: investments read by Manager+, changed by Admin and Superadmin.
  { method: "GET", route: "/scope3/investments", superadminRoute: "/scope3/investments?company_id=1", expect: MANAGER_UP, needs: ["GET /scope3/investments"] },
  { method: "POST", route: "/scope3/investments", body: {}, expect: ADMIN_UP, needs: ["GET /scope3/investments"] },
  { method: "PUT", route: "/scope3/assets/sites/1", body: { lease_role: "bogus" }, expect: ADMIN_UP, needs: ["GET /scope3/investments"] },
  // S3-13: the report reads like /reports/ghg (any role with the site).
  { method: "GET", route: `/reports/ghg/scope3?siteIds=${SITE}&year=2025`, expect: READ_ALL, needs: ["GET /reports/ghg/scope3"] },
  // S3-15: approving stays with today's reviewers, Manager and Superadmin (who may approve is out of S3-15's scope).
  { method: "PUT", route: "/user/emissions/bulk-approve", body: { ids: [], only_ready: true }, expect: { user: 403, manager: "allowed", admin: 403, superadmin: "allowed" }, needs: ["emission.checks"] },
  // S3-14: base year is Admin and Superadmin (D12).
  { method: "PUT", route: "/scope3/base-year", body: {}, expect: ADMIN_UP, needs: ["GET /scope3/base-year"] },
  // S3-15 part 2: locks are Manager and above.
  { method: "POST", route: "/periods/lock", body: { site_id: SITE, year: 2025, month: 13 }, expect: MANAGER_UP, needs: ["GET /periods/lock"] },
];

// ------------------------------------------------------------------ the stack

async function waitForServer(server, logs) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`server exited during startup:\n${logs.join("").slice(-2000)}`);
    try {
      const res = await fetch(`${BASE}/user/emissions`);
      if (res.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs.join("").slice(-2000)}`);
}

/**
 * The schema and the shared fixture, loaded only when this database is empty,
 * then migrate:all: production runs it on every container start (ESG-lite
 * #126), so the stack under audit is a migrated stack. Without it a probe
 * would report a backfill as missing only because nothing had run it yet.
 */
async function prepare(db) {
  const { rows } = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'emission'`);
  if (!rows.length) {
    const sync = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/schema-sync.cjs"), path.join(ESG_DIR, "dist")], { cwd: ESG_DIR, env: process.env, encoding: "utf8" });
    if (sync.status !== 0) throw new Error(`ci/schema-sync.cjs exited ${sync.status}: ${tail(sync)}`);
  }
  const seeded = await db.query(`SELECT 1 FROM company LIMIT 1`);
  if (!seeded.rows.length) await db.query(fs.readFileSync(path.join(ESG_DIR, "ci/api/fixture.sql"), "utf8"));
  const run = spawnSync(process.execPath, [path.join(ESG_DIR, "scripts/migrate-all.cjs")], { cwd: ESG_DIR, env: process.env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`migrate:all failed: ${tail(run)}`);
}

const ORDER = ["S3-01", "S3-02", "S3-03", "S3-04", "S3-05", "S3-06", "S3-07", "S3-08", "S3-09", "S3-10", "S3-11", "S3-12", "S3-13", "S3-14", "S3-15", "S3-16", "S3-17", "S3-18", "S3-19", "S3-20", "S3-21", "S3-22", "S3-23", "S3-24", "E2E-12"];

(async () => {
  const logs = [];
  let db;
  let server;
  let golden = null;
  let start = null;
  try {
    db = new Client(dbConfig(process.env.DB_NAME));
    await db.connect();
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
    // Reads that seed rows by design (the boundary is created on first read)
    // happen before the "before" picture, so they never count as residue.
    await cleanup(db);
    start = await fingerprint(db);
    const startNotification = Number((await db.query(`SELECT coalesce(max(id), 0) AS n FROM notification`)).rows[0].n);

    try {
      golden = await liveGolden(db, head);
      await runRows(db, head, golden, logs);
    } finally {
      await cleanup(db, startNotification);
    }
    const end = await fingerprint(db);
    const residue = diffCounts(start, end);
    if (residue.length) record("S3-00", "The probe cleans up after itself", "row counts equal before and after the run", `left behind: ${residue.join(", ")}`, "error");
    await migrationsTwice(db);
  } catch (err) {
    record("S3-00", "The probe harness itself", "the probes run against a live stack", `harness failed: ${err && err.message ? err.message : String(err)}`, "error");
  } finally {
    if (server) server.kill("SIGTERM");
    if (db) await db.end().catch(() => {});
  }

  results.sort((a, b) => (ORDER.indexOf(a.ids[0]) + 1 || 99) - (ORDER.indexOf(b.ids[0]) + 1 || 99));
  const counts = { pass: 0, fail: 0, error: 0, na: 0, manual: 0 };
  for (const row of results) counts[row.status] = (counts[row.status] || 0) + 1;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ probe: "scope3-probes", counts, results }, null, 2)}\n`);
  if (golden) {
    const { pending: _p, only_ready: _o, ...file } = golden;
    fs.writeFileSync(GOLDEN_OUT, `${JSON.stringify(file, null, 2)}\n`);
  }
  console.log(
    `s scope3-probes "${counts.pass} pass / ${counts.fail} fail / ${counts.error} error / ${counts.na} n/a / ${counts.manual} manual"`,
  );
  // A fail belongs to the owning lane, not to the harness: only a harness
  // error stops the audit.
  process.exit(counts.error > 0 ? 1 : 0);
})();
