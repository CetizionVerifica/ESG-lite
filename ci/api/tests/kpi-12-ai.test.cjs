// KPI-12: the ESG-lite proxy to python's KPI suggestions, against a stub of
// python_AI_service on AI_STUB_PORT (ci/api/run.cjs points the server there).
// Scope (the caller's own due KPIs; another site refused), the request python
// gets (service key, user_id, period hint, codes), candidates outside the
// request dropped, the multipart path (upload as the caller, then suggest),
// degrading when python is down / 503 / slow-failing, the Superadmin answer,
// mapping from the enabled catalogue, roles and the switch.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const PORT = Number(process.env.AI_STUB_PORT);

// ---------------------------------------------------------------- the stub
const seen = [];
let mode = "ok"; // ok | 503 | 404 | 410 | 422 | 500
let server = null;
const startStub = () =>
  new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const isJson = (req.headers["content-type"] || "").includes("application/json");
        const body = isJson ? JSON.parse(raw.toString("utf8") || "{}") : null;
        seen.push({ path: req.url, headers: req.headers, body, size: raw.length });
        const send = (status, payload) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (mode !== "ok") return send(Number(mode), { detail: mode === "503" ? "AI not available right now" : "nope" });
        if (req.url === "/v1/kpi/documents") return send(200, { document_id: 4321, document_name: "water-bill.pdf" });
        if (req.url === "/v1/kpi/suggest-values") {
          const codes = body.kpis.map((k) => k.code);
          return send(200, {
            document_id: body.document_id,
            document_name: "water-bill.pdf",
            pages: 3,
            candidates: [
              { kpi_code: "WATER_WITHDRAWAL", value: 1200, unit: "m3", breakdown_key: null, period_start: "2026-09-01", period_end: "2026-09-30", site_hint: "Plant A", source_page: 2, quote: "Water consumed: 1,200 m3", confidence: 0.92, why: "found 'Water consumed: 1,200 m3' on page 2" },
              { kpi_code: "WATER_DISCHARGE", value: 300, unit: "m3", breakdown_key: null, period_start: null, period_end: null, site_hint: null, source_page: 3, quote: "Discharge 300", confidence: 0.4, why: "a number near 'discharge'" },
              { kpi_code: "NOT_ASKED_KPI", value: 1, unit: null, source_page: 1, quote: "x", confidence: 0.9, why: "x" },
            ].filter((c) => codes.includes(c.kpi_code) || c.kpi_code === "NOT_ASKED_KPI"),
          });
        }
        if (req.url === "/v1/kpi/suggest-mapping") {
          return send(200, {
            suggestions: [
              { framework: "GRI", code: body.catalogue.find((c) => c.framework === "GRI").code, title: "t", section: null, why: "same subject", confidence: 0.81 },
              { framework: "XBRL", code: "nope", title: "not in the catalogue", why: "x", confidence: 0.9 },
            ],
          });
        }
        send(404, { detail: "unknown" });
      });
    });
    server.listen(PORT, "127.0.0.1", resolve);
  });
const stopStub = () => new Promise((resolve) => (server ? server.close(resolve) : resolve()));

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await clearSetup();
  await setupCompany(1, { frameworks: ["GRI", "BRSR"] });
  await setupCompany(2, { frameworks: ["GRI"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await stopStub();
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await clearSetup();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const values = (who, body) => call("POST", "/kpi/ai/suggest-values", who, body);

test("AI down: suggestions degrade to 'AI not available right now', never an error; nothing is stored", async () => {
  const r = await values("user", { document_id: 77, site_id: 1, period: "2026-09" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { available: false, message: "AI not available right now", suggestions: [] });
  const m = await call("POST", "/kpi/ai/suggest-mapping", "admin", { name: "Rainwater harvested", question: "How much rainwater did you harvest?", unit: "m3", topic: "water" });
  assert.deepEqual([m.status, m.json.available, m.json.message], [200, false, "AI not available right now"]);
  assert.equal((await q(`SELECT 1 FROM kpi_value WHERE company_id = 1`)).length, 0);
});

test("suggest-values: the caller's due KPIs only, the request python gets, candidates outside it dropped, check-this below 0.6", async () => {
  await startStub();
  seen.length = 0;
  const r = await values("user", { document_id: 77, site_id: 1, period: "2026-09" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.available, r.json.document_id, r.json.document_name, r.json.pages, r.json.period], [true, 77, "water-bill.pdf", 3, "2026-09"]);
  assert.deepEqual(r.json.suggestions.map((s) => s.kpi_code), ["WATER_WITHDRAWAL", "WATER_DISCHARGE"], "NOT_ASKED_KPI is dropped");
  const w = r.json.suggestions[0];
  assert.deepEqual([w.value, w.unit, w.source_page, w.site_id, w.check_this, w.label, w.confidence], [1200, "m3", 2, 1, false, "Suggested from water-bill.pdf, page 2", 0.92]);
  assert.equal(r.json.suggestions[1].check_this, true, "0.4 < 0.6");
  // What python got: the service key, the caller, the company, the caller's own due codes and the period.
  const sent = seen.find((s) => s.path === "/v1/kpi/suggest-values");
  assert.equal(sent.headers["x-service-key"], process.env.AI_SERVICE_KEY);
  assert.deepEqual([sent.body.company_id, sent.body.document_id, sent.body.user_id], [1, 77, 1]);
  const my = (await call("GET", "/kpi/my?period=2026-09&site=1", "user")).json.items.filter((i) => i.source === "manual" && i.group === "due");
  assert.deepEqual(sent.body.kpis.map((k) => k.code).sort(), [...new Set(my.map((i) => i.code))].sort());
  assert.deepEqual(sent.body.period_hint, { period_start: "2026-09-01", period_end: "2026-09-30", frequency: my.every((i) => i.frequency === "monthly") ? "monthly" : null });
  assert.ok(sent.body.kpis.every((k) => typeof k.question === "string" && Array.isArray(k.allowed_units)));
  // The same document and KPIs within 24 h: from the cache, python isn't asked again.
  const before = seen.length;
  assert.equal((await values("user", { document_id: 77, site_id: 1, period: "2026-09" })).json.suggestions.length, 2);
  assert.equal(seen.length, before);
  // Nothing was stored.
  assert.equal((await q(`SELECT 1 FROM kpi_value WHERE company_id = 1`)).length, 0);
});

test("scope: another site's KPI or site is refused; another company is 404; narrowing by code", async () => {
  assert.equal((await values("user", { document_id: 77, site_id: 2, period: "2026-09" })).status, 404, "site 2 isn't user 1's");
  assert.equal((await values("user", { document_id: 77, site_id: 3, period: "2026-09" })).status, 404, "company 2's site");
  const notMine = await values("user", { document_id: 77, site_id: 1, period: "2026-09", kpis: ["REVENUE"] });
  assert.deepEqual([notMine.status, notMine.json.code], [403, "KPI_NOT_ASSIGNED"]);
  const narrowed = await values("user", { document_id: 78, site_id: 1, period: "2026-09", kpis: ["WATER_WITHDRAWAL"] });
  assert.deepEqual(narrowed.json.suggestions.map((s) => s.kpi_code), ["WATER_WITHDRAWAL"]);
  assert.deepEqual(seen.at(-1).body.kpis.map((k) => k.code), ["WATER_WITHDRAWAL"]);
  assert.equal((await call("POST", "/kpi/ai/suggest-values?company_id=1", "otherManager", { document_id: 77 })).status, 404);
  assert.equal((await values("user", { site_id: 1 })).json.code, "KPI_VALIDATION", "a document_id or a file");
  // The Manager owes nothing there: nothing is asked.
  const before = seen.length;
  const mgr = await values("manager", { document_id: 79, site_id: 1, period: "2026-09" });
  assert.deepEqual([mgr.json.available, mgr.json.suggestions], [true, []]);
  assert.equal(seen.length, before);
});

test("multipart: the file goes to python's store as the caller, then the suggestions; the Superadmin gets 'not available yet'", async () => {
  seen.length = 0;
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.4 water bill")]), "water-bill.pdf");
  form.append("site_id", "1");
  form.append("period", "2026-09");
  const r = await call("POST", "/kpi/ai/suggest-values", "user", form);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.document_id, r.json.document_name], [4321, "water-bill.pdf"]);
  assert.equal(r.json.suggestions[0].document_id, 4321);
  const [upload, suggest] = seen;
  assert.equal(upload.path, "/v1/kpi/documents");
  assert.match(upload.headers.authorization, /^Bearer /, "the caller's own token, so python records the uploader");
  assert.equal(upload.headers["x-service-key"], undefined);
  assert.equal(suggest.body.document_id, 4321);
  const sa = await values("superadmin", { document_id: 77, company_id: 1 });
  assert.deepEqual(sa.json, { available: false, message: "Fill from a document isn't available for Superadmin yet", suggestions: [] });
  assert.equal((await values("superadmin", { document_id: 77 })).json.code, "KPI_COMPANY_REQUIRED");
});

test("python's refusals: 404 is not found, 410/422 say why, 503 and 500 degrade", async () => {
  const ask = (doc) => values("user", { document_id: doc, site_id: 1, period: "2026-09" });
  try {
    mode = "404";
    assert.equal((await ask(501)).status, 404, "a document of another company or user");
    mode = "410";
    assert.deepEqual((await ask(502)).json, { available: false, message: "That document is no longer stored. Upload it again.", suggestions: [] });
    mode = "422";
    assert.equal((await ask(503)).json.message, "The document couldn't be read.");
    mode = "503";
    assert.deepEqual((await ask(504)).json, { available: false, message: "AI not available right now", suggestions: [] });
    mode = "500";
    assert.equal((await ask(505)).json.available, false);
  } finally {
    mode = "ok";
  }
});

test("suggest-mapping: Admin and Superadmin, the enabled catalogue, only disclosures of it come back", async () => {
  seen.length = 0;
  const body = { name: "Rainwater harvested", question: "How much rainwater did you harvest?", unit: "m3", topic: "water" };
  const r = await call("POST", "/kpi/ai/suggest-mapping", "admin", body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.available, true);
  assert.equal(r.json.suggestions.length, 1, "the XBRL one isn't in the catalogue");
  const s = r.json.suggestions[0];
  assert.deepEqual([s.framework, s.check_this, s.why, s.confidence], ["GRI", false, "same subject", 0.81]);
  assert.ok(Number.isInteger(s.disclosure_id));
  const sent = seen.find((x) => x.path === "/v1/kpi/suggest-mapping").body;
  assert.deepEqual([...new Set(sent.catalogue.map((c) => c.framework))].sort(), ["BRSR", "GRI"], "the enabled versions only");
  const pairs = sent.catalogue.map((c) => `${c.framework}|${c.code}`);
  assert.equal(new Set(pairs).size, pairs.length, "(framework, code) unique");
  assert.equal((await call("POST", "/kpi/ai/suggest-mapping?company_id=1", "superadmin", body)).json.available, true);
  assert.equal((await call("POST", "/kpi/ai/suggest-mapping", "manager", body)).json.code, "KPI_FORBIDDEN");
  assert.equal((await call("POST", "/kpi/ai/suggest-mapping", "user", body)).status, 403);
  assert.equal((await call("POST", "/kpi/ai/suggest-mapping", "admin", { name: "x" })).json.code, "KPI_VALIDATION");
  // Company 2 sees only its own enabled catalogue.
  await call("POST", "/kpi/ai/suggest-mapping", "superadmin", { ...body, company_id: 2 });
  assert.deepEqual([...new Set(seen.at(-1).body.catalogue.map((c) => c.framework))], ["GRI"]);
});

test("switch off: both AI routes answer KPI_TRACKING_OFF", async () => {
  await setSwitch(1, false);
  try {
    assert.equal((await values("user", { document_id: 77 })).json.code, "KPI_TRACKING_OFF");
    assert.equal((await call("POST", "/kpi/ai/suggest-mapping", "admin", { name: "x" })).json.code, "KPI_TRACKING_OFF");
  } finally {
    await setSwitch(1, true);
  }
});
