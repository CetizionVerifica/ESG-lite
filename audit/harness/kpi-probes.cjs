// KPI-13 · KPI audit probes (audit/harness/kpi-probes.cjs).
//
//   node audit/harness/kpi-probes.cjs <ESG-lite dir> <out.json>
//
// Answers, route by route, which KPI promises hold on the real stack:
//   KPI-P01  switch off: every gated /kpi route answers 403 KPI_TRACKING_OFF for every role
//   KPI-P02  tenant isolation: company 2's people naming company 1 get 404 on every gated route,
//            and 404 on company 1's ids (a value, its evidence, a target, a person)
//   KPI-P03  role matrix: each route allows exactly the roles of the module specs (D18 included)
//   KPI-P04  Superadmin parity (D18): with company_id never refused where an Admin isn't;
//            without it 400 KPI_COMPANY_REQUIRED
//   KPI-P05  the library is Superadmin only, whatever the switch says
//   KPI-P06  every migrate:kpi-* script runs twice cleanly and the second run changes no row count
//   KPI-P07  every route of the compiled router has a row in the matrix below (nothing unprobed)
//
// Shape follows the S3-16 harness (scope3-probes.cjs): the same two arguments, the
// throwaway-database guard, signed tokens for the API fixture users (ci/api/fixture.sql),
// records { ids, title, expected, observed, status } with pass / fail / error / na / manual.
// It needs a scratch database of its own (the workflow's step K9 makes `<DB_NAME>_kpiprobes`):
// it builds the schema from dist/, loads the API fixture, runs the KPI migrations and boots
// the compiled server on KPI_PROBE_PORT (default 3995). Writes send empty or invalid bodies,
// so an allowed role gets a validation answer and nothing that matters is written. Exit 1
// when any row is fail or error.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ESG_DIR = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || "kpi-probes.json");
const PORT = Number(process.env.KPI_PROBE_PORT || 3995);
const AI_PORT = Number(process.env.KPI_PROBE_AI_PORT || 8996); // nothing listens: the AI routes degrade
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "audit-only-not-a-real-secret";

const need = (name) => require(require.resolve(name, { paths: [ESG_DIR, __dirname] }));
const { assertThrowawayDb } = require(path.join(ESG_DIR, "ci/lib/throwaway-db.cjs"));
assertThrowawayDb();
const { Client } = need("pg");
const jwt = need("jsonwebtoken");

// ci/api/fixture.sql: company 1 has users 1 (User, site 1), 2 (Manager, sites 1-2), 3 (Admin),
// 7 (User, sites 1-2); Superadmin 5; company 2 has 4 (User) and 6 (Manager), site 3.
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

const results = [];
const record = (ids, title, expected, observed, status) => results.push({ ids: [].concat(ids), title, expected, observed, status });
async function probe(ids, title, expected, fn) {
  try {
    const observed = await fn();
    if (observed === true || observed === undefined) record(ids, title, expected, expected, "pass");
    else record(ids, title, expected, observed, "fail");
  } catch (err) {
    record(ids, title, expected, `probe threw: ${err && err.message ? err.message : String(err)}`, "error");
  }
}

async function call(method, route, who, body) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${token(who)}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${route}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") || "";
  const json = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!json) await res.arrayBuffer().catch(() => null);
  return { status: res.status, code: json?.code ?? null };
}

const dbConfig = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
async function q(sql, params) {
  const c = new Client(dbConfig());
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------- the matrix
// Who may call each route (module specs; D17 and D18 of wave D). `all` = every role of the company.
const A = ["user", "manager", "admin", "superadmin"];
const MAA = ["manager", "admin", "superadmin"];
const AS = ["admin", "superadmin"];
const MS = ["manager", "superadmin"];
const MATRIX = {
  "GET /status": { roles: A, gated: false },
  "GET /library/frameworks": { roles: ["superadmin"], library: true },
  "POST /library/frameworks": { roles: ["superadmin"], library: true },
  "PUT /library/frameworks/:id": { roles: ["superadmin"], library: true },
  "GET /library/definitions": { roles: ["superadmin"], library: true },
  "GET /library/definitions/:id": { roles: ["superadmin"], library: true },
  "POST /library/definitions": { roles: ["superadmin"], library: true },
  "PUT /library/definitions/:id": { roles: ["superadmin"], library: true },
  "GET /library/disclosures": { roles: ["superadmin"], library: true },
  "POST /library/disclosures": { roles: ["superadmin"], library: true },
  "PUT /library/disclosures/:id": { roles: ["superadmin"], library: true },
  "GET /library/mappings": { roles: ["superadmin"], library: true },
  "POST /library/mappings": { roles: ["superadmin"], library: true },
  "PUT /library/mappings/:id": { roles: ["superadmin"], library: true },
  "GET /library/coverage": { roles: ["superadmin"], library: true },
  "GET /catalogue": { roles: A },
  "GET /values": { roles: A },
  "PUT /values": { roles: A },
  "POST /values/submit": { roles: A },
  "POST /values/:id/evidence": { roles: A },
  "DELETE /values/:id/evidence/:eid": { roles: A },
  "GET /setup": { roles: A },
  "PUT /setup": { roles: AS },
  "GET /setup/materiality-scores": { roles: A }, // IN-7 follow-up: read the scores without Design Studio
  "PUT /setup/materiality-scores": { roles: AS }, // IN-7: Insights / RS-2 / DS-2 materiality scores (Admin, Superadmin)
  "POST /setup/invite": { roles: AS },
  "POST /setup/custom-kpis": { roles: AS },
  "GET /people/:user_id/topics": { roles: MAA },
  "PUT /people/:user_id/topics": { roles: MAA },
  "POST /auto/refresh": { roles: MAA },
  "GET /my": { roles: A },
  "GET /my/template": { roles: A },
  "POST /my/template": { roles: A },
  "PUT /values/approve": { roles: MS },
  "PUT /values/reject": { roles: MS },
  "GET /periods/lock": { roles: MAA },
  "POST /periods/lock": { roles: MAA },
  "POST /periods/unlock": { roles: MAA },
  "GET /targets": { roles: A },
  "PUT /targets": { roles: AS },
  "DELETE /targets/:id": { roles: AS },
  "GET /dashboard": { roles: MAA },
  "POST /dashboard/remind": { roles: MAA },
  "GET /overview": { roles: A },
  "GET /reports/:framework": { roles: MAA },
  "POST /ai/suggest-values": { roles: A },
  "POST /ai/suggest-mapping": { roles: AS },
  "GET /esg": { roles: MAA },
};
const QUERY = { "/dashboard": "?year=2026", "/periods/lock": "?year=2026", "/my/template": "?period=2026-09", "/reports/GRI": "?year=2026", "/esg": "?year=2026" };

/** Every route of the compiled /kpi router, walked from its Express stack. */
function kpiRoutes() {
  const router = require(path.join(ESG_DIR, "dist/kpi/router.js")).default;
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) if (m !== "_all") out.push({ method: m.toUpperCase(), path: layer.route.path });
      if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) walk(layer.handle.stack);
    }
  };
  walk(router.stack);
  return out;
}

// ---------------------------------------------------------------- the stack
function migrate(names) {
  for (const name of names) {
    const r = spawnSync(process.execPath, [path.join(ESG_DIR, `dist/scripts/${name}.js`)], { cwd: ESG_DIR, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${name} failed: ${(r.stdout + r.stderr).slice(-500)}`);
  }
}
const KPI_SCRIPTS = () =>
  Object.entries(require(path.join(ESG_DIR, "package.json")).scripts)
    .filter(([k]) => k.startsWith("migrate:kpi-"))
    .map(([, v]) => /src\/scripts\/(\S+)\.ts/.exec(v)[1]);

async function rowCounts(tables) {
  const out = {};
  for (const t of tables) out[t] = Number((await q(`SELECT COUNT(*)::int AS n FROM "${t}"`))[0].n);
  return out;
}

async function setUp() {
  const sync = spawnSync(process.execPath, [path.join(ESG_DIR, "ci/schema-sync.cjs"), path.join(ESG_DIR, "dist")], { env: process.env, encoding: "utf8" });
  if (sync.status !== 0) throw new Error(`schema-sync failed: ${(sync.stdout + sync.stderr).slice(-500)}`);
  const empty = await q(`SELECT COUNT(*)::int AS n FROM company`);
  if (empty[0].n === 0) {
    const c = new Client(dbConfig());
    await c.connect();
    await c.query(fs.readFileSync(path.join(ESG_DIR, "ci/api/fixture.sql"), "utf8"));
    await c.end();
  }
  migrate(KPI_SCRIPTS());
  // Both fixture companies on, set up (every library KPI selected), with topic owners (D17).
  for (const id of [1, 2]) {
    await q(`UPDATE company SET kpi_tracking_enabled = true WHERE company_id = $1`, [id]);
    await q(`INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at) VALUES ($1, 'CY', 2026, 15, now()) ON CONFLICT (company_id) DO UPDATE SET setup_completed_at = now()`, [id]);
    await q(`INSERT INTO company_framework (company_id, framework_id, framework_code) SELECT $1, id, code FROM kpi_framework WHERE active AND default_for_new ON CONFLICT DO NOTHING`, [id]);
    await q(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected) SELECT $1, id, true FROM kpi_definition WHERE company_id IS NULL AND active ON CONFLICT DO NOTHING`, [id]);
  }
  await q(`INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id) VALUES (1, 1, 'water', 1), (2, 3, 'water', 4) ON CONFLICT DO NOTHING`);
  // Company 1's ids for the tenant probes: a value with evidence, a target.
  const kpi = (await q(`SELECT id FROM kpi_definition WHERE code = 'WATER_WITHDRAWAL' AND company_id IS NULL`))[0].id;
  const [v] = await q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status, entered_by)
     VALUES (1, 1, $1, '2026-09-01', '2026-09-30', 'monthly', 'CY', 10, 'kL', 10, 'manual', 'draft', 1)
     ON CONFLICT DO NOTHING RETURNING id`,
    [kpi],
  );
  const valueId = v ? v.id : (await q(`SELECT id FROM kpi_value WHERE company_id = 1 AND kpi_definition_id = $1 AND period_start = '2026-09-01'`, [kpi]))[0].id;
  let [e] = await q(`SELECT id FROM kpi_value_evidence WHERE kpi_value_id = $1`, [valueId]);
  if (!e) [e] = await q(`INSERT INTO kpi_value_evidence (kpi_value_id, document_url, document_name, uploaded_by) VALUES ($1, 'https://files.example.invalid/p.pdf', 'p.pdf', 1) RETURNING id`, [valueId]);
  let [t] = await q(`SELECT id FROM kpi_target WHERE company_id = 1`);
  if (!t) [t] = await q(`INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction, note) VALUES (1, $1, 1, 2024, 100, 2030, 50, 'reduce', 'KPI probe') RETURNING id`, [kpi]);
  return { valueId: Number(valueId), evidenceId: Number(e.id), targetId: Number(t.id) };
}

async function waitForServer(server, logs) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("server exited during startup:\n" + logs.join("").slice(-2000));
    try {
      if ((await fetch(`${BASE}/user/emissions`)).status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

// ---------------------------------------------------------------- the probes
(async () => {
  let server = null;
  const logs = [];
  try {
    const ids = await setUp();
    server = spawn(process.execPath, [path.join(ESG_DIR, "dist/index.js")], {
      cwd: ESG_DIR,
      env: { ...process.env, TZ: "UTC", NODE_ENV: "test", PORT: String(PORT), JWT_SECRET: SECRET, TYPEORM_SYNC: "false", RABBITMQ_URL: "amqp://127.0.0.1:1", LOCAL_FILE_STORAGE: "true", FX_JOB_DISABLED: "true", SCOPE3_BASE_YEAR_JOB: "off", KPI_DUE_JOB: "off", OCR_SERVICE_URL: `http://127.0.0.1:${AI_PORT}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => logs.push(d.toString()));
    server.stderr.on("data", (d) => logs.push(d.toString()));
    await waitForServer(server, logs);

    const routes = kpiRoutes();
    const key = (r) => `${r.method} ${r.path}`;
    const url = (r, idMap = {}) => {
      let p = r.path.replace(/:framework/, "GRI").replace(/:user_id/, String(idMap.user_id ?? 7)).replace(/:eid/, String(idMap.eid ?? 999999)).replace(/:id/, String(idMap.id ?? 999999));
      return `/kpi${p}${QUERY[p] ?? ""}`;
    };
    const bodyOf = (r) => (r.method === "GET" || r.method === "DELETE" ? undefined : {});
    const withCompany = (u, id = 1) => `${u}${u.includes("?") ? "&" : "?"}company_id=${id}`;

    await probe("KPI-P07", "every /kpi route has a row in the probe matrix", "none unprobed", async () => {
      const missing = routes.filter((r) => !MATRIX[key(r)]).map(key);
      const stale = Object.keys(MATRIX).filter((k) => !routes.some((r) => key(r) === k));
      return missing.length || stale.length ? `not in the matrix: ${missing.join(", ") || "-"}; in the matrix, not routed: ${stale.join(", ") || "-"}` : true;
    });

    // KPI-P03 / P05: the role matrix, switch on.
    for (const r of routes) {
      const m = MATRIX[key(r)];
      if (!m) continue;
      await probe(m.library ? "KPI-P05" : "KPI-P03", `${key(r)}: ${m.roles.join(", ")}`, "allowed roles pass; the others get 403 KPI_FORBIDDEN", async () => {
        const wrong = [];
        for (const who of ROLES) {
          const res = await call(r.method, who === "superadmin" && !m.library ? withCompany(url(r)) : url(r), who, bodyOf(r));
          const refused = res.status === 403 && res.code === "KPI_FORBIDDEN";
          if (m.roles.includes(who) ? res.status === 403 || res.status >= 500 : !refused) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }

    // KPI-P04: Superadmin parity (D18).
    for (const r of routes.filter((x) => MATRIX[key(x)] && !MATRIX[key(x)].library)) {
      await probe("KPI-P04", `${key(r)}: the Superadmin needs company_id, and then has the Admin's rights`, "no company_id → 400 KPI_COMPANY_REQUIRED; with it never 403 where an Admin passes", async () => {
        const none = await call(r.method, url(r), "superadmin", bodyOf(r));
        if (!(none.status === 400 && none.code === "KPI_COMPANY_REQUIRED")) return `without company_id: ${none.status} ${none.code}`;
        const admin = await call(r.method, url(r), "admin", bodyOf(r));
        const sa = await call(r.method, withCompany(url(r)), "superadmin", bodyOf(r));
        if (admin.status !== 403 && (sa.status === 403 || sa.code === "KPI_COMPANY_REQUIRED")) return `admin ${admin.status}, superadmin ${sa.status} ${sa.code}`;
        return true;
      });
    }

    // KPI-P02: tenant isolation.
    for (const r of routes.filter((x) => MATRIX[key(x)] && MATRIX[key(x)].gated !== false && !MATRIX[key(x)].library)) {
      await probe("KPI-P02", `${key(r)}: company 2's people naming company 1`, "404 (never 200 or 403)", async () => {
        const wrong = [];
        for (const who of ["otherUser", "otherManager"]) {
          const res = await call(r.method, withCompany(url(r)), who, bodyOf(r));
          if (res.status !== 404) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }
    const idRoutes = [
      ["POST", `/kpi/values/${ids.valueId}/evidence`, { document_url: "https://files.example.invalid/x.pdf", document_name: "x.pdf" }],
      ["DELETE", `/kpi/values/${ids.valueId}/evidence/${ids.evidenceId}`],
      ["DELETE", `/kpi/targets/${ids.targetId}`],
      ["PUT", "/kpi/values/approve", { ids: [ids.valueId] }],
      ["GET", "/kpi/people/1/topics"],
      ["PUT", "/kpi/people/1/topics", { topics: ["water"] }],
      ["GET", `/user/audit-logs?entity_type=kpi_value&entity_id=${ids.valueId}`],
    ];
    await probe("KPI-P02", "company 1's ids with company 2's tokens", "404, or a per-id KPI_NOT_FOUND; nothing changes", async () => {
      const wrong = [];
      for (const [method, u, body] of idRoutes) {
        for (const who of ["otherUser", "otherManager"]) {
          const res = await call(method, u, who, body);
          // 404, a per-id refusal inside 200 (approve), or a refusal on role alone (403 KPI_FORBIDDEN tells
          // nothing about the id); never 200 with an effect, KPI_NOT_DRAFT or any other answer about the row.
          const fine = res.status === 404 || (u.endsWith("/approve") && res.status === 200) || (res.status === 403 && res.code === "KPI_FORBIDDEN");
          if (!fine) wrong.push(`${who} ${method} ${u}: ${res.status} ${res.code ?? ""}`);
        }
      }
      const [still] = await q(`SELECT status FROM kpi_value WHERE id = $1`, [ids.valueId]);
      const ev = await q(`SELECT 1 FROM kpi_value_evidence WHERE id = $1`, [ids.evidenceId]);
      const tg = await q(`SELECT 1 FROM kpi_target WHERE id = $1`, [ids.targetId]);
      if (still?.status !== "draft" || !ev.length || !tg.length) wrong.push("company 1's rows changed");
      return wrong.length ? wrong.join("; ") : true;
    });

    // KPI-P01: switch off.
    await q(`UPDATE company SET kpi_tracking_enabled = false WHERE company_id = 1`);
    try {
      for (const r of routes.filter((x) => MATRIX[key(x)] && MATRIX[key(x)].gated !== false && !MATRIX[key(x)].library)) {
        await probe("KPI-P01", `${key(r)} with the switch off`, "403 KPI_TRACKING_OFF for every role", async () => {
          const wrong = [];
          for (const who of ROLES) {
            const res = await call(r.method, who === "superadmin" ? withCompany(url(r)) : url(r), who, bodyOf(r));
            if (!(res.status === 403 && res.code === "KPI_TRACKING_OFF")) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
          }
          return wrong.length ? wrong.join("; ") : true;
        });
      }
      await probe("KPI-P01", "GET /kpi/status answers with the switch off", "200 {enabled: false}", async () => {
        const res = await fetch(`${BASE}/kpi/status`, { headers: { Authorization: `Bearer ${token("user")}` } });
        const j = await res.json();
        return res.status === 200 && j.enabled === false ? true : `${res.status} ${JSON.stringify(j)}`;
      });
      await probe("KPI-P05", "the library answers the Superadmin with every client's switch off", "200", async () => {
        const res = await call("GET", "/kpi/library/definitions", "superadmin");
        return res.status === 200 ? true : `${res.status} ${res.code}`;
      });
    } finally {
      await q(`UPDATE company SET kpi_tracking_enabled = true WHERE company_id = 1`);
    }

    // KPI-P06: migrations twice.
    await probe("KPI-P06", "every migrate:kpi-* runs twice; the second run changes no row count", "exit 0 both times, same counts", async () => {
      const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'kpi_%' OR tablename LIKE 'company_kpi%' OR tablename IN ('company_framework', 'company_material_topic'))`)).map((r) => r.tablename).sort();
      migrate(KPI_SCRIPTS());
      const first = await rowCounts(tables);
      migrate(KPI_SCRIPTS());
      const second = await rowCounts(tables);
      return JSON.stringify(first) === JSON.stringify(second) ? true : `first ${JSON.stringify(first)} second ${JSON.stringify(second)}`;
    });
  } catch (err) {
    record("KPI-P00", "harness setup", "the stack starts", `harness failed: ${err && err.message ? err.message : String(err)}`, "error");
  } finally {
    if (server) server.kill("SIGTERM");
  }
  const counts = { pass: 0, fail: 0, error: 0, na: 0, manual: 0 };
  for (const r of results) counts[r.status]++;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ harness: "kpi-probes", at: new Date().toISOString(), counts, results }, null, 2) + "\n");
  for (const r of results.filter((x) => x.status === "fail" || x.status === "error")) console.log(`${r.status.toUpperCase()} ${r.ids.join(",")} ${r.title}: ${String(r.observed).slice(0, 300)}`);
  console.log(`kpi-probes: ${counts.pass} pass / ${counts.fail} fail / ${counts.error} error / ${counts.na} n/a / ${counts.manual} manual`);
  process.exit(counts.fail || counts.error ? 1 : 0);
})();
