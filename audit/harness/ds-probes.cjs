// DS-14 · Design Studio audit probes (audit/harness/ds-probes.cjs).
//
//   node audit/harness/ds-probes.cjs <ESG-lite dir> <out.json>
//
// Answers, route by route, which Design Studio promises hold on the real stack:
//   DS-P01  switch off: every gated /studio route answers 403 DS_STUDIO_OFF for every role;
//           GET /studio/status still answers {enabled: false}
//   DS-P02  tenant isolation: company 2's people naming company 1 get 404 on every gated route
//   DS-P03  cross-tenant ids: company 1's ids with company 2's tokens answer 404 on every route
//           that takes an id, and the row is unchanged (needs a company-1 row: see ID_SOURCES)
//   DS-P04  roles: Users get 403 DS_ROLE everywhere; Admins and Managers pass the guard; on the
//           Manager-only routes (M in 01-contracts §4) an Admin gets 403 DS_ROLE
//   DS-P05  Superadmin: without company_id 400 DS_COMPANY_REQUIRED; with it, the guard passes
//   DS-P06  kind guard: a sustainability request with KPI tracking off answers 403 DS_KIND_OFF
//   DS-P07  every route of the compiled router is in the contract list (nothing unprobed)
//   DS-P08  every migrate:ds-* script runs twice cleanly; the second run changes no row count
//   DS-P09  share tokens: guessing tokens at GET /s/:token is rate limited (429)          (DS-11)
//   DS-P10  the 2 MB doc cap: PATCH /studio/docs/:id with a > 2 MB doc → 413 DS_DOC_TOO_LARGE (DS-5)
//   DS-P11  a <script> tag or event handler in text, alt text or a brand voice is inert  (DS-1, DS-3)
//
// A probe whose module hasn't landed records "na" with the module it waits on; DS-14 final
// turns every na into pass. Same shape as audit/harness/kpi-probes.cjs: the throwaway-database
// guard, signed tokens for the API fixture users (ci/api/fixture.sql), records
// { ids, title, expected, observed, status } with pass / fail / error / na. It needs a scratch
// database of its own (the workflow's step DS-W10 makes `<DB_NAME>_dsprobes`): schema from
// dist/, the API fixture, every migrate:ds-* script, the compiled server on DS_PROBE_PORT
// (default 3994). Writes send empty bodies, so an allowed role gets a validation answer and
// nothing that matters is written. Exit 1 when any row is fail or error.
const fs = require("fs");
const path = require("path");

const ESG_DIR = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || "ds-probes.json");
const PORT = Number(process.env.DS_PROBE_PORT || 3994);
const SECRET = "audit-only-not-a-real-secret";

require(path.join(ESG_DIR, "ci/lib/throwaway-db.cjs")).assertThrowawayDb();
const { prepare, boot, migrate, dsMigrations, q: query, caller } = require(path.join(ESG_DIR, "ci/golden/ds/lib/stack.cjs"));
const { builtRoutes, CONTRACT_ROUTES, gatedRoutes, concrete, shape } = require(path.join(ESG_DIR, "ci/golden/ds/lib/routes.cjs"));
const q = (sql, params) => query(sql, params, ESG_DIR);

const results = [];
const record = (ids, title, expected, observed, status) => results.push({ ids: [].concat(ids), title, expected, observed, status });
async function probe(ids, title, expected, fn) {
  try {
    const observed = await fn();
    if (observed === true || observed === undefined) record(ids, title, expected, expected, "pass");
    else if (observed && observed.na) record(ids, title, expected, observed.na, "na");
    else record(ids, title, expected, observed, "fail");
  } catch (err) {
    record(ids, title, expected, `probe threw: ${err && err.message ? err.message : String(err)}`, "error");
  }
}
const na = (why) => ({ na: why });

// ---------------------------------------------------------------- the matrix
// Manager-only routes (01-contracts §4 "M"): an Admin gets DS_ROLE. POST /docs/:id/jobs is M
// only for kind 'final' (body-dependent) and is probed by DS-11's own tests.
const MANAGER_ONLY_ROUTES = ["PUT /brand-kit", "POST /docs/:id/shares", "GET /docs/:id/shares", "DELETE /shares/:id", "POST /approvals/:id/decide"];
// Routes that take a kind (query or body): a sustainability request with KPI off → DS_KIND_OFF.
const KIND_ROUTES = { "GET /readiness": "query", "GET /styles": "query", "GET /templates": "query", "GET /layouts": "query", "POST /docs": "body" };
// Where a company-1 id for a route parameter comes from, by the first path segment. Each module
// that adds a table adds its line (the table must exist and hold a company-1 row; a module that
// needs one seeded adds it to SEED below).
const ID_SOURCES = {
  docs: { table: "report_doc", sql: `SELECT id FROM report_doc WHERE company_id = 1 ORDER BY id LIMIT 1`, module: "DS-5" },
  templates: { table: "report_template", sql: `SELECT id FROM report_template WHERE company_id = 1 ORDER BY id LIMIT 1`, module: "DS-4" },
  assets: { table: "report_asset", sql: `SELECT id FROM report_asset WHERE company_id = 1 ORDER BY id LIMIT 1`, module: "DS-4" },
  jobs: { table: "report_job", sql: `SELECT j.id FROM report_job j JOIN report_doc d ON d.id = j.doc_id WHERE d.company_id = 1 ORDER BY j.id LIMIT 1`, module: "DS-11" },
  shares: { table: "report_share", sql: `SELECT s.id FROM report_share s JOIN report_doc d ON d.id = s.doc_id WHERE d.company_id = 1 ORDER BY s.id LIMIT 1`, module: "DS-11" },
  comments: { table: "report_comment", sql: `SELECT c.id FROM report_comment c JOIN report_doc d ON d.id = c.doc_id WHERE d.company_id = 1 ORDER BY c.id LIMIT 1`, module: "DS-13" },
  approvals: { table: "report_approval", sql: `SELECT a.id FROM report_approval a JOIN report_doc d ON d.id = a.doc_id WHERE d.company_id = 1 ORDER BY a.id LIMIT 1`, module: "DS-13" },
};
// Route parameters that are not tenant ids: nothing company-owned to cross, so DS-P03 records n/a
// (DS-P02 and DS-P04 still probe these routes). [Wave 1 integrate]
const NON_TENANT_PARAMS = { fonts: "the :file is a bundled font name, the same files for every company (DS-1)" };
// Company-1 rows the probes need, made through the API as company 1's Manager once the route
// exists (each module appends its own step). A step returns nothing; ID_SOURCES then finds the row.
const SEED = [];
// DS-4: a company-1 template and asset for the cross-tenant probe (a row is enough; uploads are tested in ds-4-library).
SEED.push(async ({ q }) => {
  if (!(await q(`SELECT 1 FROM report_template WHERE company_id = 1 LIMIT 1`)).length) {
    await q(`INSERT INTO report_template (company_id, slug, family, kind, purpose, format, name, doc, version) SELECT 1, 'c1-probe', 'c1-probe', kind, purpose, format, 'Company 1 template', doc, 1 FROM report_template WHERE company_id IS NULL AND kind = 'ghg' ORDER BY id LIMIT 1`);
  }
  if (!(await q(`SELECT 1 FROM report_asset WHERE company_id = 1 LIMIT 1`)).length) {
    await q(`INSERT INTO report_asset (company_id, kind, r2_key, mime, bytes, w, h, sha256) VALUES (1, 'image', 'studio-assets/company_1/probe.png', 'image/png', 1, 1, 1, repeat('0', 64))`);
  }
});
// DS-5: a blank company-1 design (no template needed), so DS-P03 and DS-P10 have a report_doc row.
SEED.push(async ({ call }) => {
  await call("POST", "/studio/docs", "manager", { kind: "ghg", templateId: "blank", year: 2025, yearType: "CY", title: "DS probes design" });
});

// DS-11: a company-1 render job and view link on that design (rows only; rendering and links are tested in ds-11-outputs).
SEED.push(async ({ q }) => {
  if (!(await tableExists("report_job"))) return;
  const [doc] = await q(`SELECT id, rev FROM report_doc WHERE company_id = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1`);
  if (!doc) return;
  if (!(await q(`SELECT 1 FROM report_job WHERE company_id = 1 LIMIT 1`)).length) {
    await q(`INSERT INTO report_job (company_id, doc_id, kind, status, rev, options) VALUES (1, $1, 'proof', 'failed', $2, '{}')`, [doc.id, doc.rev]);
  }
  if (!(await q(`SELECT 1 FROM report_share WHERE company_id = 1 LIMIT 1`)).length) {
    await q(`INSERT INTO report_share (company_id, doc_id, token_hash, expires_at) VALUES (1, $1, repeat('1', 64), now() + interval '1 day')`, [doc.id]);
  }
});

const ROLES = ["user", "manager", "admin", "superadmin"];

const tableExists = async (t) => (await q(`SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`, [t])).length > 0;

(async () => {
  let stack = null;
  try {
    await prepare(ESG_DIR);
    stack = await boot(ESG_DIR, PORT, SECRET);
    const call = caller(ESG_DIR, stack.base, SECRET);
    const built = builtRoutes(ESG_DIR);
    const builtKeys = new Set(built.map(shape));
    const isBuilt = (k) => builtKeys.has(shape({ method: k.split(" ")[0], path: k.split(" ")[1] }));
    const key = (r) => `${r.method} ${r.path}`;
    const managerOnly = new Set(MANAGER_ONLY_ROUTES.map((k) => shape({ method: k.split(" ")[0], path: k.split(" ")[1] })));
    const isManagerOnly = (r) => managerOnly.has(shape(r));
    const gated = gatedRoutes(ESG_DIR);
    const bodyOf = (r) => (r.method === "GET" || r.method === "DELETE" ? undefined : {});
    const withCompany = (u, id = 1) => `${u}${u.includes("?") ? "&" : "?"}company_id=${id}`;
    const as = (r, who, url = concrete(r.path)) =>
      who === "superadmin" ? call(r.method, withCompany(url), who, r.method === "GET" || r.method === "DELETE" ? undefined : { company_id: 1 }) : call(r.method, url, who, bodyOf(r));
    const setStudio = (id, on) => q(`UPDATE company SET design_studio_enabled = $1 WHERE company_id = $2`, [on, id]);
    const setKpi = (id, on) => q(`UPDATE company SET kpi_tracking_enabled = $1 WHERE company_id = $2`, [on, id]);
    const guardCodes = new Set(["DS_STUDIO_OFF", "DS_ROLE", "DS_COMPANY_REQUIRED"]);

    await probe("DS-P07", "every /studio route of the compiled router is in the contract list", "none unprobed", async () => {
      const contract = new Set(CONTRACT_ROUTES.map(shape));
      const missing = built.filter((r) => !contract.has(shape(r))).map((r) => `${r.method} ${r.path}`);
      return missing.length ? `routed but not in ci/golden/ds/lib/routes.cjs CONTRACT_ROUTES: ${missing.join(", ")}` : true;
    });

    // DS-P01: switch off for both companies.
    await setStudio(1, false);
    await setStudio(2, false);
    for (const r of gated) {
      await probe("DS-P01", `${r.method} ${r.path} with the switch off`, "403 DS_STUDIO_OFF for every role", async () => {
        const wrong = [];
        for (const who of ROLES) {
          const res = await as(r, who);
          if (!(res.status === 403 && res.code === "DS_STUDIO_OFF")) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }
    await probe("DS-P01", "GET /studio/status answers with the switch off", "200 {enabled: false, kinds all false}", async () => {
      const res = await call("GET", "/studio/status", "user");
      const ok = res.status === 200 && res.json?.enabled === false && res.json?.kinds?.ghg === false && res.json?.kinds?.sustainability === false;
      return ok ? true : `${res.status} ${JSON.stringify(res.json)}`;
    });

    // The rest with the switch on for both companies, KPI tracking off.
    await setStudio(1, true);
    await setStudio(2, true);
    await setKpi(1, false);
    await setKpi(2, false);
    for (const step of SEED) await step({ call, q });

    for (const r of gated) {
      await probe("DS-P02", `${r.method} ${r.path}: company 2's people naming company 1`, "404 (never 200 or 403)", async () => {
        const wrong = [];
        for (const who of ["otherUser", "otherManager"]) {
          const res = await call(r.method, withCompany(concrete(r.path)), who, r.method === "GET" || r.method === "DELETE" ? undefined : { company_id: 1 });
          if (res.status !== 404) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        return wrong.length ? wrong.join("; ") : true;
      });
    }

    // DS-P03: company 1's ids with company 2's Manager (whose own studio is on).
    for (const r of gated.filter((x) => /:[a-z_]+/i.test(x.path))) {
      await probe("DS-P03", `${r.method} ${r.path}: company 1's id with company 2's Manager`, "404 and the row unchanged", async () => {
        if (!isBuilt(key(r))) return na(`waits on ${r.module}: not routed yet`);
        const resource = r.path.split("/")[1];
        if (NON_TENANT_PARAMS[resource]) return na(NON_TENANT_PARAMS[resource]);
        const src = ID_SOURCES[resource];
        if (!src) return `no ID_SOURCES entry for /${resource}: add one so this route is probed`;
        if (!(await tableExists(src.table))) return na(`waits on ${src.module}: no ${src.table} table`);
        const [row] = await q(src.sql);
        if (!row) return na(`no company-1 ${src.table} row: add a SEED step (${src.module})`);
        const before = JSON.stringify(await q(`SELECT * FROM "${src.table}" WHERE id = $1`, [row.id]));
        const res = await call(r.method, concrete(r.path.replace(/:[a-z_]+/i, String(row.id))), "otherManager", bodyOf(r));
        const after = JSON.stringify(await q(`SELECT * FROM "${src.table}" WHERE id = $1`, [row.id]));
        if (res.status !== 404) return `${res.status} ${res.code ?? ""}`;
        return before === after ? true : "company 1's row changed";
      });
    }

    // DS-P04: roles.
    for (const r of gated) {
      await probe("DS-P04", `${r.method} ${r.path}: Users refused, Admins and Managers pass the guard${isManagerOnly(r) ? " (Manager only)" : ""}`, "User 403 DS_ROLE; Manager past the guard; Admin past it unless the route is M", async () => {
        const wrong = [];
        for (const who of ["user", "multiSiteUser"]) {
          const res = await as(r, who);
          if (!(res.status === 403 && res.code === "DS_ROLE")) wrong.push(`${who} ${res.status} ${res.code ?? ""}`);
        }
        const mgr = await as(r, "manager");
        if (guardCodes.has(mgr.code) || mgr.status >= 500) wrong.push(`manager ${mgr.status} ${mgr.code ?? ""}`);
        const adm = await as(r, "admin");
        if (isManagerOnly(r) && isBuilt(key(r))) {
          if (!(adm.status === 403 && adm.code === "DS_ROLE")) wrong.push(`admin ${adm.status} ${adm.code ?? ""} (M route)`);
        } else if (guardCodes.has(adm.code) || adm.status >= 500) wrong.push(`admin ${adm.status} ${adm.code ?? ""}`);
        return wrong.length ? wrong.join("; ") : true;
      });
    }

    // DS-P05: Superadmin.
    for (const r of gated) {
      await probe("DS-P05", `${r.method} ${r.path}: the Superadmin names the company`, "no company_id → 400 DS_COMPANY_REQUIRED; with it past the guard", async () => {
        const none = await call(r.method, concrete(r.path), "superadmin", bodyOf(r));
        if (!(none.status === 400 && none.code === "DS_COMPANY_REQUIRED")) return `without company_id: ${none.status} ${none.code}`;
        const sa = await as(r, "superadmin");
        if (guardCodes.has(sa.code) || sa.status >= 500) return `with company_id: ${sa.status} ${sa.code}`;
        return true;
      });
    }

    // DS-P06: the kind guard.
    for (const [k, where] of Object.entries(KIND_ROUTES)) {
      const [method, p] = k.split(" ");
      await probe("DS-P06", `${k}: kind=sustainability with KPI tracking off`, "403 DS_KIND_OFF", async () => {
        const r = CONTRACT_ROUTES.find((c) => key(c) === k);
        if (!isBuilt(k)) return na(`waits on ${r.module}: not routed yet`);
        const url = where === "query" ? `/studio${p}?kind=sustainability&year=2025` : `/studio${p}`;
        const res = await call(method, url, "manager", where === "body" ? { kind: "sustainability" } : undefined);
        return res.status === 403 && res.code === "DS_KIND_OFF" ? true : `${res.status} ${res.code}`;
      });
    }

    // DS-P09: share-token guessing (DS-11 mounts GET /s/:token outside /studio).
    await probe("DS-P09", "guessing share tokens at GET /s/:token is rate limited", "a 429 within 60 wrong tokens; never 200", async () => {
      const first = await call("GET", "/s/not-a-real-token-0", null);
      if (first.status === 404 && !first.json && !first.headers.get("x-robots-tag")) return na("waits on DS-11: GET /s/:token is not mounted"); // DS-11: its 404 page is HTML with X-Robots-Tag
      for (let i = 1; i <= 60; i++) {
        const res = await call("GET", `/s/not-a-real-token-${i}`, null);
        if (res.status === 200) return `token ${i} answered 200`;
        if (res.status === 429) return true;
      }
      return "60 wrong tokens, no 429";
    });

    // DS-P10: the 2 MB cap on PATCH /docs/:id.
    await probe("DS-P10", "PATCH /studio/docs/:id with a doc over 2 MB", "413 DS_DOC_TOO_LARGE and the doc unchanged", async () => {
      if (!isBuilt("PATCH /docs/:id")) return na("waits on DS-5: PATCH /docs/:id is not routed");
      if (!(await tableExists("report_doc"))) return na("waits on DS-5: no report_doc table");
      const [row] = await q(`SELECT id, rev, draft AS doc FROM report_doc WHERE company_id = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1`); // DS-5: the ReportDoc is report_doc.draft
      if (!row) return na("no company-1 report_doc row: add a SEED step (DS-5)");
      const big = JSON.parse(JSON.stringify(row.doc));
      big.meta = { ...(big.meta || {}), subtitle: "x".repeat(2 * 1024 * 1024 + 1) };
      const res = await call("PATCH", `/studio/docs/${row.id}`, "manager", { rev: row.rev, doc: big });
      const [after] = await q(`SELECT rev FROM report_doc WHERE id = $1`, [row.id]);
      if (!(res.status === 413 && res.code === "DS_DOC_TOO_LARGE")) return `${res.status} ${res.code}`;
      return after.rev === row.rev ? true : "the doc's rev moved";
    });

    // DS-P11: script tags inert. Text and alt text through the renderer (pure, from dist), the brand voice through DS-3/DS-9.
    await probe("DS-P11", "a <script> tag and an onerror handler in text and alt text render inert", "no <script, no on*= attribute, no javascript: URL in the HTML", async () => {
      const renderPath = path.join(ESG_DIR, "dist/reporting/studio/render/index.js");
      if (!fs.existsSync(renderPath)) return na("waits on DS-1: dist/reporting/studio/render is not built");
      return na("DS-1 landed: write the render call for this probe (DS-14 final)");
    });
    await probe("DS-P11", "a <script> tag in the brand voice is fenced data in prompts and inert on the brand kit page", "stored as text; never HTML", async () => {
      if (!isBuilt("PUT /brand-kit")) return na("waits on DS-3: PUT /brand-kit is not routed");
      return na("DS-3 landed: write this probe (DS-14 final)");
    });

    // DS-P08: migrations twice.
    await probe("DS-P08", "every migrate:ds-* runs twice; the second run changes no row count", "exit 0 both times, same counts", async () => {
      const scripts = dsMigrations(ESG_DIR);
      if (!scripts.length) return "no migrate:ds-* script in package.json";
      const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'report\\_%' OR tablename = 'company')`)).map((r) => r.tablename).sort();
      const counts = async () => {
        const out = {};
        for (const t of tables) out[t] = Number((await q(`SELECT COUNT(*)::int AS n FROM "${t}"`))[0].n);
        return out;
      };
      migrate(ESG_DIR, scripts);
      const first = await counts();
      migrate(ESG_DIR, scripts);
      const second = await counts();
      return JSON.stringify(first) === JSON.stringify(second) ? true : `first ${JSON.stringify(first)} second ${JSON.stringify(second)}`;
    });

    await setStudio(1, false);
    await setStudio(2, false);
  } catch (err) {
    record("DS-P00", "harness setup", "the stack starts", `harness failed: ${err && err.message ? err.message : String(err)}`, "error");
    if (stack) console.error(stack.logs.join("").slice(-3000));
  } finally {
    if (stack) stack.server.kill("SIGTERM");
  }
  const counts = { pass: 0, fail: 0, error: 0, na: 0, manual: 0 };
  for (const r of results) counts[r.status]++;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ harness: "ds-probes", at: new Date().toISOString(), counts, results }, null, 2) + "\n");
  for (const r of results.filter((x) => x.status === "fail" || x.status === "error")) console.log(`${r.status.toUpperCase()} ${r.ids.join(",")} ${r.title}: ${String(r.observed).slice(0, 300)}`);
  console.log(`ds-probes: ${counts.pass} pass / ${counts.fail} fail / ${counts.error} error / ${counts.na} n/a / ${counts.manual} manual`);
  process.exit(counts.fail || counts.error ? 1 : 0);
})();
