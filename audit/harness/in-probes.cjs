// IN-10 · Insights audit probes (audit/harness/in-probes.cjs).
//
//   node audit/harness/in-probes.cjs <ESG-lite dir> <out.json>
//
// Answers, route by route, which Insights promises hold on the real stack:
//   IN-P01  switch off: every gated /insights route answers 403 IN_OFF for every role;
//           GET /insights/status still answers {enabled: false}
//   IN-P02  tenant isolation: company 2's people naming company 1 get 404 on every gated route,
//           and 404 on company 1's ids (an event); nothing changes
//   IN-P03  role matrix: Users get 403 IN_FORBIDDEN; Managers, Admins and the Superadmin (with
//           company_id) pass; the Superadmin without company_id gets 400 IN_COMPANY_REQUIRED
//   IN-P04  site scope: a site outside the caller's (or another company's) → 404 IN_SITE_NOT_FOUND
//   IN-P05  PUT /kpi/setup/materiality-scores: Admin and Superadmin only, tenant 404, KPI_TRACKING_OFF
//   IN-P06  every migrate:in-* script runs twice cleanly and the second run changes no row count
//   IN-P07  every route of the compiled router is in the probe list (nothing unprobed)
//   IN-P08  timings (layer rule 8): p95 of each panel with the cache missed (the stamp moved before
//           every call) on the IN-10 fixture company (ci/fixtures/in-company): summary ≤ 400 ms,
//           every other panel ≤ 800 ms. A miss is reported as `warn`, not `fail`: the harness runs
//           on shared CI and developer machines whose speed it doesn't control. The JSON keeps
//           every p95 so a slow panel is visible.
//
// Shape follows kpi-probes.cjs: the same two arguments, the throwaway-database guard, signed
// tokens for the API fixture users (ci/api/fixture.sql) and the fixture company's people,
// records { ids, title, expected, observed, status } with pass / fail / error / warn / na.
// It needs a scratch database of its own (the workflow's step IN-W7 makes `<DB_NAME>_inprobes`):
// it builds the schema from dist/, loads the API fixture and the Insights fixture company,
// runs the KPI and Insights migrations and boots the compiled server on IN_PROBE_PORT (default
// 3994). Writes send empty or invalid bodies, so an allowed role gets a validation answer.
// Exit 1 when any row is fail or error.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ESG_DIR = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || "in-probes.json");
const PORT = Number(process.env.IN_PROBE_PORT || 3994);
const AI_PORT = Number(process.env.IN_PROBE_AI_PORT || 8994); // nothing listens: AI wording falls back to rule text
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "audit-only-not-a-real-secret";
const TIMING_RUNS = Number(process.env.IN_PROBE_TIMING_RUNS || 10);
const BUDGET_MS = { summary: 400, other: 800 };

const need = (name) => require(require.resolve(name, { paths: [ESG_DIR, __dirname] }));
const { assertThrowawayDb } = require(path.join(ESG_DIR, "ci/lib/throwaway-db.cjs"));
assertThrowawayDb();
const { Client } = need("pg");
const jwt = need("jsonwebtoken");

// ci/api/fixture.sql: company 1 has users 1 (User, site 1), 2 (Manager, sites 1-2), 3 (Admin);
// Superadmin 5; company 2 has 4 (User) and 6 (Manager), site 3. The IN-10 fixture company 901
// has 901 (Admin) and 902 (Manager of sites 901, 902).
const USERS = {
  user: { userId: 1, role: "User" },
  manager: { userId: 2, role: "Manager" },
  admin: { userId: 3, role: "Admin" },
  superadmin: { userId: 5, role: "Superadmin" },
  otherUser: { userId: 4, role: "User" },
  otherManager: { userId: 6, role: "Manager" },
  fixtureAdmin: { userId: 901, role: "Admin" },
};
const ROLES = ["user", "manager", "admin", "superadmin"];
const ALLOWED = ["manager", "admin", "superadmin"];
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
  return { status: res.status, code: json?.code ?? null, json };
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

// ---------------------------------------------------------------- the routes
// Every /insights route (01-contracts §4) with the query each probe sends. `gated: false` = before
// the switch (GET /status). `pdf`: the printer may be missing on this machine (Chromium), so an
// allowed role's 500 is not read as a refusal; only 403/404 are.
const ROUTES = {
  "GET /status": { url: "/insights/status", gated: false },
  "GET /sites": { url: "/insights/sites" },
  "GET /summary": { url: "/insights/summary?year=2025", panel: "summary" },
  "GET /esg-ring": { url: "/insights/esg-ring?year=2025", panel: "esg_ring" },
  "GET /decoupling": { url: "/insights/decoupling?year=2025&years=5", panel: "decoupling" },
  "GET /target-wall": { url: "/insights/target-wall?year=2025", panel: "target_wall" },
  "GET /pathway": { url: "/insights/pathway?year=2025", panel: "pathway" },
  "GET /completeness": { url: "/insights/completeness?year=2025", panel: "completeness" },
  "GET /events": { url: "/insights/events?from=2025-01-01&to=2025-12-31" },
  "POST /events": { url: "/insights/events", body: {} },
  "PATCH /events/:id": { url: "/insights/events/999999", body: {} },
  "DELETE /events/:id": { url: "/insights/events/999999" },
  "GET /flow": { url: "/insights/flow?year=2025", panel: "flow" },
  "GET /cards": { url: "/insights/cards?year=2025", panel: "cards" },
  "GET /bridge": { url: "/insights/bridge?year=2025&compare=prior", panel: "bridge" },
  "GET /materiality": { url: "/insights/materiality?year=2025", panel: "materiality" },
  "GET /stripes": { url: "/insights/stripes?year=2025", panel: "stripes" },
  "GET /snapshot.pdf": { url: "/insights/snapshot.pdf?year=2025", pdf: true },
  "GET /site-compare": { url: "/insights/site-compare?year=2025", panel: "site_compare" },
};

/** Every route of the compiled /insights router, walked from its Express stack. */
function insightsRoutes() {
  const router = require(path.join(ESG_DIR, "dist/insights/router.js")).default;
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) if (m !== "_all") out.push(`${m.toUpperCase()} ${layer.route.path}`);
      if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) walk(layer.handle.stack);
    }
  };
  walk(router.stack);
  return out;
}

const withCompany = (u, id = 1) => `${u}${u.includes("?") ? "&" : "?"}company_id=${id}`;
const withSites = (u, sites) => `${u}${u.includes("?") ? "&" : "?"}sites=${sites}`;

// ---------------------------------------------------------------- the stack
function migrate(names) {
  for (const name of names) {
    const r = spawnSync(process.execPath, [path.join(ESG_DIR, `dist/scripts/${name}.js`)], { cwd: ESG_DIR, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${name} failed: ${(r.stdout + r.stderr).slice(-500)}`);
  }
}
const scriptsFor = (prefix) =>
  Object.entries(require(path.join(ESG_DIR, "package.json")).scripts)
    .filter(([k]) => k.startsWith(prefix))
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
    const dir = path.join(ESG_DIR, "ci/fixtures/in-company");
    for (const f of ["seed.sql", ...fs.readdirSync(dir).filter((x) => x.startsWith("seed-") && x.endsWith(".sql")).sort()]) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await c.end();
  }
  migrate([...scriptsFor("migrate:kpi-"), ...scriptsFor("migrate:ds-2-"), ...scriptsFor("migrate:in-")]);
  // Both API fixture companies: Insights and KPI tracking on, KPI set up, one ESRS material topic.
  for (const id of [1, 2]) {
    await q(`UPDATE company SET insights_enabled = true, kpi_tracking_enabled = true WHERE company_id = $1`, [id]);
    await q(`INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at) VALUES ($1, 'CY', 2026, 15, now()) ON CONFLICT (company_id) DO UPDATE SET setup_completed_at = now()`, [id]);
    await q(`INSERT INTO company_framework (company_id, framework_id, framework_code) SELECT $1, id, code FROM kpi_framework WHERE active AND default_for_new ON CONFLICT DO NOTHING`, [id]);
    await q(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected) SELECT $1, id, true FROM kpi_definition WHERE company_id IS NULL AND active ON CONFLICT DO NOTHING`, [id]);
    if (!(await q(`SELECT 1 FROM company_material_topic WHERE company_id = $1 AND esrs_topic = 'E1'`, [id])).length) {
      await q(`INSERT INTO company_material_topic (company_id, esrs_topic, material) VALUES ($1, 'E1', true)`, [id]);
    }
  }
  // Company 1's ids for the tenant probes: an event.
  let [ev] = await q(`SELECT id FROM insight_event WHERE company_id = 1 AND label = 'IN probe event'`);
  if (!ev) [ev] = await q(`INSERT INTO insight_event (company_id, site_id, date, label, kind, created_by) VALUES (1, NULL, '2025-06-01', 'IN probe event', 'initiative', 3) RETURNING id`);
  return { eventId: Number(ev.id) };
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

const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
};

// ---------------------------------------------------------------- the probes
(async () => {
  let server = null;
  const logs = [];
  const timings = {};
  try {
    const ids = await setUp();
    server = spawn(process.execPath, [path.join(ESG_DIR, "dist/index.js")], {
      cwd: ESG_DIR,
      env: { ...process.env, TZ: "UTC", NODE_ENV: "test", PORT: String(PORT), JWT_SECRET: SECRET, TYPEORM_SYNC: "false", RABBITMQ_URL: "amqp://127.0.0.1:1", LOCAL_FILE_STORAGE: "true", FX_JOB_DISABLED: "true", SCOPE3_BASE_YEAR_JOB: "off", KPI_DUE_JOB: "off", OCR_SERVICE_URL: `http://127.0.0.1:${AI_PORT}`, INSIGHTS_AI_BASE_URL: `http://127.0.0.1:${AI_PORT}`, INSIGHTS_AI_API_KEY: "audit-only" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => logs.push(d.toString()));
    server.stderr.on("data", (d) => logs.push(d.toString()));
    await waitForServer(server, logs);

    const routed = insightsRoutes();
    await probe("IN-P07", "every /insights route is in the probe list", "none unprobed", async () => {
      const missing = routed.filter((k) => !ROUTES[k]);
      const stale = Object.keys(ROUTES).filter((k) => !routed.includes(k));
      return missing.length || stale.length ? `not probed: ${missing.join(", ") || "-"}; probed, not routed: ${stale.join(", ") || "-"}` : true;
    });
    const gated = Object.entries(ROUTES).filter(([, r]) => r.gated !== false);

    // IN-P03: the role matrix, switch on.
    for (const [k, r] of gated) {
      await probe("IN-P03", `${k}: Manager, Admin, Superadmin pass; Users get IN_FORBIDDEN`, "allowed roles never 403/404/400 IN_COMPANY_REQUIRED (nor 5xx outside the PDF); User 403 IN_FORBIDDEN", async () => {
        const wrong = [];
        for (const who of ROLES) {
          const res = await call(k.split(" ")[0], who === "superadmin" ? withCompany(r.url) : r.url, who, r.body);
          if (ALLOWED.includes(who)) {
            // An event id that doesn't exist is the route's own 404 (IN_EVENT_NOT_FOUND), not a refusal.
            const refused = res.status === 403 || (res.status === 404 && res.code !== "IN_EVENT_NOT_FOUND") || res.code === "IN_COMPANY_REQUIRED" || (res.status >= 500 && !r.pdf);
            if (refused) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
          } else if (!(res.status === 403 && res.code === "IN_FORBIDDEN")) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        const none = await call(k.split(" ")[0], r.url, "superadmin", r.body);
        if (!(none.status === 400 && none.code === "IN_COMPANY_REQUIRED")) wrong.push(`superadmin without company_id ${none.status} ${none.code ?? ""}`);
        return wrong.length ? wrong.join("; ") : true;
      });
    }
    await probe("IN-P03", "GET /insights/status answers every role of the company", "200 {enabled, kpi_tracking}", async () => {
      const wrong = [];
      for (const who of ["user", "manager", "admin"]) {
        const res = await call("GET", "/insights/status", who);
        if (res.status !== 200 || res.json?.enabled !== true) wrong.push(`${who} ${res.status} ${JSON.stringify(res.json)}`);
      }
      return wrong.length ? wrong.join("; ") : true;
    });

    // IN-P04: site scope (GET routes that take `sites`).
    for (const [k, r] of gated.filter(([key]) => key.startsWith("GET ") && key !== "GET /sites")) {
      await probe("IN-P04", `${k}: a site outside the caller's scope`, "404 IN_SITE_NOT_FOUND", async () => {
        const wrong = [];
        for (const [who, sites] of [["manager", "3"], ["admin", "1,3"], ["manager", "999999"]]) {
          const res = await call("GET", withSites(r.url, sites), who);
          if (!(res.status === 404 && res.code === "IN_SITE_NOT_FOUND")) wrong.push(`${who} sites=${sites}: ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }

    // IN-P02: tenant isolation.
    for (const [k, r] of gated) {
      await probe("IN-P02", `${k}: company 2's people naming company 1`, "404 (never 200 or 403)", async () => {
        const wrong = [];
        for (const who of ["otherUser", "otherManager"]) {
          const res = await call(k.split(" ")[0], withCompany(r.url), who, r.body);
          if (res.status !== 404) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }
    await probe("IN-P02", "company 1's event with company 2's tokens", "404 IN_EVENT_NOT_FOUND; the event is unchanged", async () => {
      const wrong = [];
      for (const [method, body] of [["PATCH", { label: "taken over" }], ["DELETE", undefined]]) {
        const res = await call(method, `/insights/events/${ids.eventId}`, "otherManager", body);
        if (res.status !== 404) wrong.push(`${method} ${res.status} ${res.code ?? ""}`);
      }
      const list = await call("GET", "/insights/events", "otherManager");
      if ((list.json?.events ?? list.json?.data ?? []).some?.((e) => e.id === ids.eventId)) wrong.push("company 2 lists company 1's event");
      const [still] = await q(`SELECT label FROM insight_event WHERE id = $1`, [ids.eventId]);
      if (still?.label !== "IN probe event") wrong.push("company 1's event changed");
      return wrong.length ? wrong.join("; ") : true;
    });
    await probe("IN-P02", "company 2 reads only its own figures", "company 2's summary net is the net of its own site", async () => {
      const mine = await call("GET", "/insights/summary?year=2025", "otherManager");
      const ov = await call("GET", "/manager/overview?period=2025", "otherManager");
      return mine.status === 200 && mine.json.data.net.value === ov.json.kpis.net ? true : `${mine.status} ${JSON.stringify(mine.json?.data?.net)} vs overview ${ov.json?.kpis?.net}`;
    });

    // IN-P05: PUT /kpi/setup/materiality-scores.
    await probe("IN-P05", "PUT /kpi/setup/materiality-scores: Admin and Superadmin only", "Admin/Superadmin 200 or 400 IN_SCORES_INVALID; Manager/User 403", async () => {
      const wrong = [];
      const body = { topics: [{ esrs_topic: "E1", impact_score: 7, financial_score: 6.5 }] };
      for (const who of ROLES) {
        const res = await call("PUT", who === "superadmin" ? withCompany("/kpi/setup/materiality-scores") : "/kpi/setup/materiality-scores", who, who === "superadmin" ? { ...body, company_id: 1 } : body);
        if (["admin", "superadmin"].includes(who) ? res.status !== 200 : res.status !== 403) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
      }
      const bad = await call("PUT", "/kpi/setup/materiality-scores", "admin", { topics: [{ esrs_topic: "E1", impact_score: 11, financial_score: 1 }] });
      if (!(bad.status === 400 && bad.code === "IN_SCORES_INVALID")) wrong.push(`out of range ${bad.status} ${bad.code}`);
      return wrong.length ? wrong.join("; ") : true;
    });
    await probe("IN-P05", "PUT /kpi/setup/materiality-scores: company 2 naming company 1", "404, company 1's scores unchanged", async () => {
      const before = await q(`SELECT impact_score::text, financial_score::text FROM company_material_topic WHERE company_id = 1 AND esrs_topic = 'E1'`);
      const res = await call("PUT", withCompany("/kpi/setup/materiality-scores"), "otherManager", { topics: [{ esrs_topic: "E1", impact_score: 1, financial_score: 1 }], company_id: 1 });
      const after = await q(`SELECT impact_score::text, financial_score::text FROM company_material_topic WHERE company_id = 1 AND esrs_topic = 'E1'`);
      return res.status === 404 && JSON.stringify(before) === JSON.stringify(after) ? true : `${res.status} ${res.code}; ${JSON.stringify(before)} → ${JSON.stringify(after)}`;
    });
    await q(`UPDATE company SET kpi_tracking_enabled = false WHERE company_id = 1`);
    try {
      await probe("IN-P05", "PUT /kpi/setup/materiality-scores with KPI tracking off", "403 KPI_TRACKING_OFF", async () => {
        const res = await call("PUT", "/kpi/setup/materiality-scores", "admin", { topics: [{ esrs_topic: "E1", impact_score: 2, financial_score: 2 }] });
        return res.status === 403 && res.code === "KPI_TRACKING_OFF" ? true : `${res.status} ${res.code}`;
      });
      await probe("IN-P05", "KPI panels with KPI tracking off", "200 availability kpi_off, data null", async () => {
        const wrong = [];
        for (const u of ["/insights/esg-ring?year=2025", "/insights/materiality?year=2025"]) {
          const res = await call("GET", u, "admin");
          if (!(res.status === 200 && res.json?.availability === "kpi_off" && res.json?.data === null)) wrong.push(`${u} ${res.status} ${res.json?.availability}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    } finally {
      await q(`UPDATE company SET kpi_tracking_enabled = true WHERE company_id = 1`);
    }

    // IN-P01: switch off.
    await q(`UPDATE company SET insights_enabled = false WHERE company_id = 1`);
    try {
      for (const [k, r] of gated) {
        await probe("IN-P01", `${k} with the switch off`, "403 IN_OFF for every role", async () => {
          const wrong = [];
          for (const who of ROLES) {
            const res = await call(k.split(" ")[0], who === "superadmin" ? withCompany(r.url) : r.url, who, r.body);
            if (!(res.status === 403 && res.code === "IN_OFF")) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
          }
          return wrong.length ? wrong.join("; ") : true;
        });
      }
      await probe("IN-P01", "GET /insights/status answers with the switch off", "200 {enabled: false}", async () => {
        const res = await call("GET", "/insights/status", "user");
        return res.status === 200 && res.json?.enabled === false ? true : `${res.status} ${JSON.stringify(res.json)}`;
      });
    } finally {
      await q(`UPDATE company SET insights_enabled = true WHERE company_id = 1`);
    }

    // IN-P08: timings on the fixture company (901), the cache missed before every call.
    for (const [k, r] of Object.entries(ROUTES).filter(([, x]) => x.panel)) {
      const ms = [];
      let failed = null;
      for (let i = 0; i < TIMING_RUNS; i++) {
        await q(`UPDATE company_base_year SET updated_at = now() + ($1 || ' seconds')::interval WHERE company_id = 901`, [String(i + 1)]);
        const t0 = process.hrtime.bigint();
        const res = await call("GET", r.url, "fixtureAdmin");
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
        if (res.status !== 200) failed = `${res.status} ${res.code ?? ""}`;
      }
      const budget = r.panel === "summary" ? BUDGET_MS.summary : BUDGET_MS.other;
      const value = Math.round(p95(ms));
      timings[r.panel] = value;
      if (failed) record("IN-P08", `${k}: p95 on the fixture`, `200 within ${budget} ms`, `answered ${failed}`, "fail");
      else record("IN-P08", `${k}: p95 on the fixture (cache missed)`, `≤ ${budget} ms`, `${value} ms over ${TIMING_RUNS} calls`, value <= budget ? "pass" : "warn");
    }

    // IN-P06: migrations twice.
    await probe("IN-P06", "every migrate:in-* runs twice; the second run changes no row count", "exit 0 both times, same counts", async () => {
      const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'insight_%' OR tablename = 'company')`)).map((r) => r.tablename).sort();
      migrate(scriptsFor("migrate:in-"));
      const first = await rowCounts(tables);
      migrate(scriptsFor("migrate:in-"));
      const second = await rowCounts(tables);
      return JSON.stringify(first) === JSON.stringify(second) ? true : `first ${JSON.stringify(first)} second ${JSON.stringify(second)}`;
    });
  } catch (err) {
    record("IN-P00", "harness setup", "the stack starts", `harness failed: ${err && err.message ? err.message : String(err)}`, "error");
  } finally {
    if (server) server.kill("SIGTERM");
  }
  const counts = { pass: 0, fail: 0, error: 0, warn: 0, na: 0 };
  for (const r of results) counts[r.status]++;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ harness: "in-probes", at: new Date().toISOString(), counts, timings_p95_ms: timings, results }, null, 2) + "\n");
  for (const r of results.filter((x) => x.status === "fail" || x.status === "error" || x.status === "warn")) console.log(`${r.status.toUpperCase()} ${r.ids.join(",")} ${r.title}: ${String(r.observed).slice(0, 300)}`);
  console.log(`in-probes: ${counts.pass} pass / ${counts.fail} fail / ${counts.error} error / ${counts.warn} warn / ${counts.na} n/a · p95 ms ${JSON.stringify(timings)}`);
  process.exit(counts.fail || counts.error ? 1 : 0);
})();
