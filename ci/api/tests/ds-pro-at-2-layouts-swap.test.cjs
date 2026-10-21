// AT-2 · Suggest layouts (DS-9 action `suggest_layouts` on POST /studio/docs/:id/ai) and
// try another template (POST /studio/docs/:id/template-swap/preview|apply).
//
//   - switch off (DS_STUDIO_OFF) on every route for every role; Users get DS_ROLE; no session 401;
//   - tenant isolation: another company's doc is not found; a Superadmin names the company;
//     another company's template is not found;
//   - kind off: a sustainability design with KPI tracking off answers DS_KIND_OFF;
//   - suggest_layouts: three page options that keep every element id with its props (only
//     frame and z move), nothing saved, one report_ai_call row per model call, the page text
//     fenced as untrusted data; a bad answer → one retry with the issues → DS_AI_OUTPUT_INVALID;
//     wrong targets answer DS_VALIDATION with no model call;
//   - template swap: preview saves nothing; apply saves one new rev with every element kept and
//     the doc pointing at the new template; stale rev or preview hash → 409 DS_VERSION_CONFLICT;
//     another format → DS_FORMAT_INVALID; a final can't be changed (DS_FINAL_IMMUTABLE).
//
// The model is a recorded stub on STUDIO_AI_STUB_PORT (ci/api/run.cjs): no real model is called.
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3), company 2 (other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const compose = require(path.resolve("dist/studio/swap/compose.js"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

const stub = { queue: [], requests: [], server: null };
const answer = (a) => stub.queue.push(a);

test.before(async () => {
  for (const name of ["migrateDs4Library", "migrateDs5Docs", "migrateDs9Ai"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  stub.server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      stub.requests.push({ url: req.url, body });
      const next = stub.queue.shift();
      if (!next || next.status) {
        res.writeHead(next ? next.status : 500, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: typeof next === "string" ? next : JSON.stringify(next) } }], usage: { prompt_tokens: 900, completion_tokens: 200 } }));
    });
  });
  await new Promise((r) => stub.server.listen(Number(process.env.STUDIO_AI_STUB_PORT), "127.0.0.1", r));
  await reset();
});
test.after(async () => {
  await reset();
  await setStudio(1, false);
  await setStudio(2, false);
  await new Promise((r) => stub.server.close(r));
});
test.beforeEach(() => {
  stub.queue.length = 0;
  stub.requests.length = 0;
});

async function reset() {
  await q(`DELETE FROM report_ai_call WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'AT-2%')`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'AT-2%')`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'AT-2%'`);
  await q(`DELETE FROM report_template WHERE name LIKE 'AT-2%'`);
  await setKpi(1, false);
}

const templateId = async (slug) => Number((await q(`SELECT id FROM report_template WHERE slug = $1 AND company_id IS NULL ORDER BY version DESC LIMIT 1`, [slug]))[0].id);

/** A design built from a library template (DS-5, synchronous build, no AI). */
async function makeDoc(title, slug = "ghg-inventory-classic", who = "manager") {
  const c = await call("POST", "/studio/docs", who, { kind: "ghg", templateId: await templateId(slug), year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  return { id: c.json.id, rev: c.json.rev, doc: c.json.doc };
}
const pageByRole = (doc, role) => doc.pages.find((p) => p.kind === "freeform" && p.layoutId && p.layoutId.endsWith(`/${role}`));
const contentIds = (page) => page.elements.filter((e) => !compose.isDecor(e)).map((e) => e.id).sort();
/** JSON with sorted keys (jsonb reorders them). */
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v));
const withoutPos = (e) => canon({ ...e, frame: 0, z: 0 });
const aiCalls = (docId) => q(`SELECT action, ok, error_code FROM report_ai_call WHERE doc_id = $1 ORDER BY id`, [docId]);

/** A model answer naming the best candidates the server will offer for `page`. */
async function goodAnswer(page, who = "manager") {
  const l = await call("GET", "/studio/layouts?kind=ghg&format=a4", who);
  assert.equal(l.status, 200);
  const ranked = compose.rankLayouts(page, l.json).map((r) => r.layout);
  const chart = page.elements.find((e) => e.type === "chart");
  return {
    options: ranked.slice(0, 3).map((layout, i) => {
      const slot = compose.layoutSlots(layout).find((s) => s.cls === "chart");
      return { layoutSlug: layout.slug, name: ["Chart + story", "Big number + table", "Full-width chart"][i], reason: "The chart answers where Scope 1 comes from first; the table stays for the verifier.", slots: slot && chart ? [{ slot: slot.slot, elementId: chart.id }] : [] };
    }),
  };
}

// ---------------------------------------------------------------------------

test("switch off: suggest_layouts and the swap routes answer DS_STUDIO_OFF; Users get DS_ROLE; no session is 401", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Switch");
  const page = pageByRole(doc.doc, "scope1");
  const tid = await templateId("ghg-inventory-night");
  await setStudio(1, false);
  const routes = [
    ["POST", `/studio/docs/${doc.id}/ai`, { action: "suggest_layouts", target: { pageId: page.id } }],
    ["POST", `/studio/docs/${doc.id}/template-swap/preview`, { templateId: tid, rev: doc.rev }],
    ["POST", `/studio/docs/${doc.id}/template-swap/apply`, { templateId: tid, rev: doc.rev, previewHash: "x" }],
  ];
  for (const [m, p, b] of routes) {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call(m, p, who, b);
      assert.equal(r.status, 403, `${who} ${p}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF", `${who} ${p}`);
    }
  }
  await setStudio(1, true);
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "user", b);
    assert.equal(r.status, 403, p);
    assert.equal(r.json.code, "DS_ROLE", p);
    assert.equal((await call(m, p, undefined, b)).status, 401, `no session ${p}`);
  }
  assert.equal(stub.requests.length, 0, "no model call while off or refused");
});

test("tenant isolation: another company's doc and template are not found; a Superadmin names the company", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc("AT-2 Tenant");
  const page = pageByRole(doc.doc, "scope1");
  const tid = await templateId("ghg-inventory-night");
  for (const [p, b] of [
    [`/studio/docs/${doc.id}/ai`, { action: "suggest_layouts", target: { pageId: page.id } }],
    [`/studio/docs/${doc.id}/template-swap/preview`, { templateId: tid, rev: doc.rev }],
    [`/studio/docs/${doc.id}/template-swap/apply`, { templateId: tid, rev: doc.rev, previewHash: "x" }],
  ]) {
    const r = await call("POST", p, "otherManager", b);
    assert.equal(r.status, 404, p);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND", p);
    const s = await call("POST", `${p}?company_id=2`, "superadmin", { ...b, company_id: 2 });
    assert.equal(s.status, 404, `superadmin naming company 2: ${p}`);
  }
  assert.equal(stub.requests.length, 0);
  // Company 2's own template is invisible to company 1.
  const [own] = await q(
    `INSERT INTO report_template (company_id, slug, family, kind, purpose, format, name, doc, version) SELECT 2, 'at-2-foreign', family, kind, purpose, format, 'AT-2 Company 2 only', doc, 1 FROM report_template WHERE id = $1 RETURNING id`,
    [tid],
  );
  const f = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "manager", { templateId: Number(own.id), rev: doc.rev });
  assert.equal(f.status, 404);
  assert.equal(f.json.code, "DS_LAYOUT_NOT_FOUND");
  const sa = await call("POST", `/studio/docs/${doc.id}/template-swap/preview?company_id=1`, "superadmin", { company_id: 1, templateId: tid, rev: doc.rev });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
});

test("kind off: a sustainability design with KPI tracking off answers DS_KIND_OFF", async () => {
  await setStudio(1, true);
  await setKpi(1, true);
  const c = await call("POST", "/studio/docs", "manager", { kind: "sustainability", templateId: "blank", year: 2025, yearType: "CY", sites: "all", frameworks: ["GRI"], inputs: {}, ai: false, format: "a4", title: "AT-2 Sustainability" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  await setKpi(1, false);
  const tid = await templateId("sustainability-editorial").catch(() => 1);
  for (const [p, b] of [
    [`/studio/docs/${c.json.id}/ai`, { action: "suggest_layouts", target: { pageId: "p1" } }],
    [`/studio/docs/${c.json.id}/template-swap/preview`, { templateId: tid, rev: c.json.rev }],
    [`/studio/docs/${c.json.id}/template-swap/apply`, { templateId: tid, rev: c.json.rev, previewHash: "x" }],
  ]) {
    const r = await call("POST", p, "manager", b);
    assert.equal(r.status, 403, p);
    assert.equal(r.json.code, "DS_KIND_OFF", p);
  }
  assert.equal(stub.requests.length, 0);
});

test("suggest_layouts: three options that keep every element and its props; nothing saved; one logged call; page text fenced", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Layouts");
  const page = pageByRole(doc.doc, "scope1");
  answer(await goodAnswer(page, "admin"));
  const r = await call("POST", `/studio/docs/${doc.id}/ai`, "admin", { action: "suggest_layouts", target: { pageId: page.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.kind, "pages");
  assert.equal(r.json.action, "suggest_layouts");
  assert.equal(r.json.payload.pages.length, 3);
  assert.deepEqual(r.json.payload.layoutOptions.map((o) => o.id), ["A", "B", "C"]);
  assert.equal(new Set(r.json.payload.layoutOptions.map((o) => o.layoutSlug)).size, 3);
  const before = new Map(page.elements.map((e) => [e.id, e]));
  for (const [i, option] of r.json.payload.pages.entries()) {
    assert.equal(option.id, page.id);
    assert.equal(option.layoutId, r.json.payload.layoutOptions[i].layoutSlug);
    for (const id of contentIds(page)) {
      const e = option.elements.find((x) => x.id === id);
      assert.ok(e, `option ${i}: ${id} kept`);
      assert.equal(withoutPos(e), withoutPos(before.get(id)), `option ${i}: ${id} props unchanged`);
    }
    for (const e of option.elements) if (!before.has(e.id)) assert.ok(compose.isDecor(e), `option ${i}: ${e.id} is a layout block`);
    assert.ok(r.json.payload.layoutOptions[i].placedElementIds.length >= contentIds(page).length);
  }
  const now = await call("GET", `/studio/docs/${doc.id}`, "admin");
  assert.equal(now.json.rev, doc.rev, "nothing saved");
  assert.deepEqual(await aiCalls(doc.id), [{ action: "suggest_layouts", ok: true, error_code: null }]);
  const prompt = stub.requests[0].body.messages.map((m) => m.content).join("\n");
  assert.match(prompt, /<untrusted name="page_elements">/);
  assert.ok(!/@/.test(prompt), "no emails in the prompt");
  // More ideas: the shown slugs are left out of the candidates.
  const shown = r.json.payload.layoutOptions.map((o) => o.layoutSlug);
  answer({ options: [{ layoutSlug: shown[0], name: "Again", reason: "Same as before.", slots: [] }] });
  answer({ options: [] });
  const more = await call("POST", `/studio/docs/${doc.id}/ai`, "manager", { action: "suggest_layouts", target: { pageId: page.id }, params: { differentFrom: shown.join(",") } });
  assert.equal(more.status, 502, "a slug that wasn't offered, twice");
  assert.match(stub.requests[1].body.messages.map((m) => m.content).join("\n"), /Already shown to the person/);
});

test("suggest_layouts: an invalid answer is retried once with the issues, then DS_AI_OUTPUT_INVALID; both calls logged", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Invalid");
  const page = pageByRole(doc.doc, "scope1");
  const good = await goodAnswer(page);
  answer({ options: [{ ...good.options[0], reason: "Scope 1 was 4,120 tCO2e so lead with it." }] });
  answer("not json at all");
  const r = await call("POST", `/studio/docs/${doc.id}/ai`, "manager", { action: "suggest_layouts", target: { pageId: page.id } });
  assert.equal(r.status, 502, JSON.stringify(r.json));
  assert.equal(r.json.code, "DS_AI_OUTPUT_INVALID");
  assert.equal(stub.requests.length, 2);
  assert.match(stub.requests[1].body.messages.map((m) => m.content).join("\n"), /YOUR LAST ANSWER COULDN'T BE USED/);
  assert.deepEqual((await aiCalls(doc.id)).map((c) => [c.ok, c.error_code]), [[false, "DS_AI_OUTPUT_INVALID"], [false, "DS_AI_OUTPUT_INVALID"]]);
  // The retry can succeed.
  answer({ options: [{ ...good.options[0], slots: [{ slot: "no_such_slot", elementId: "x" }] }] });
  answer(good);
  const ok = await call("POST", `/studio/docs/${doc.id}/ai`, "manager", { action: "suggest_layouts", target: { pageId: page.id } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await call("GET", `/studio/docs/${doc.id}`, "manager")).json.rev, doc.rev);
});

test("suggest_layouts: no page, a flow page or an unknown page answer DS_VALIDATION without a model call", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Validation");
  const flow = doc.doc.pages.find((p) => p.kind === "flow");
  for (const b of [{ action: "suggest_layouts" }, { action: "suggest_layouts", target: { pageId: flow.id } }, { action: "suggest_layouts", target: { pageId: "nope" } }]) {
    const r = await call("POST", `/studio/docs/${doc.id}/ai`, "manager", b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(r.json.code, "DS_VALIDATION", JSON.stringify(b));
  }
  assert.equal(stub.requests.length, 0);
});

test("template swap: preview saves nothing; apply saves one rev with every element kept and the new template", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Swap");
  const night = await templateId("ghg-inventory-night");
  const p = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "admin", { templateId: night, rev: doc.rev });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.templateId, night);
  assert.equal(p.json.rev, doc.rev);
  assert.equal(p.json.doc.design.templateId, "ghg-inventory-night");
  assert.equal(p.json.doc.design.theme.look, "night");
  assert.equal(p.json.pages.length, doc.doc.pages.length);
  assert.ok(p.json.pages.some((m) => m.status === "mapped"));
  const ids = (d) => d.pages.flatMap((pg) => (pg.elements || []).filter((e) => !compose.isDecor(e)).map((e) => e.id)).sort();
  assert.deepEqual(ids(p.json.doc), ids(doc.doc), "every text, chart and chip kept");
  assert.equal((await call("GET", `/studio/docs/${doc.id}`, "admin")).json.rev, doc.rev, "preview saves nothing");
  // A stale preview hash or rev is a conflict.
  const stale = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev, previewHash: "0".repeat(64) });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  assert.equal(stale.json.details.rev, doc.rev, "the conflict names the current rev");
  // A stale rev with the right hash is a conflict too.
  const oldRev = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev - 1, previewHash: p.json.previewHash });
  assert.equal(oldRev.status, 409);
  assert.equal(oldRev.json.code, "DS_VERSION_CONFLICT");
  assert.equal(oldRev.json.details.rev, doc.rev);
  // A preview for one template can't be applied as another.
  const other = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: await templateId("ghg-inventory-classic"), rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(other.status, 409, JSON.stringify(other.json));
  assert.equal(other.json.code, "DS_VERSION_CONFLICT");
  assert.equal((await call("GET", `/studio/docs/${doc.id}`, "admin")).json.rev, doc.rev, "refused applies save nothing");
  const a =await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.rev, doc.rev + 1, "one new rev");
  assert.equal(a.json.doc.design.templateId, "ghg-inventory-night");
  assert.deepEqual(ids(a.json.doc), ids(doc.doc));
  const [row] = await q(`SELECT template_id FROM report_doc WHERE id = $1`, [doc.id]);
  assert.equal(Number(row.template_id), night);
  const again = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(again.status, 409);
  assert.equal(again.json.details.rev, doc.rev + 1);
  // Another format is Resize, not a swap.
  const brief = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "admin", { templateId: await templateId("ghg-board-brief-classic"), rev: a.json.rev });
  assert.equal(brief.status, 422, JSON.stringify(brief.json));
  assert.equal(brief.json.code, "DS_FORMAT_INVALID");
  const bad = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "admin", { templateId: night, rev: a.json.rev, extra: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "DS_VALIDATION");
  assert.equal(stub.requests.length, 0, "the swap never calls a model");
});

test("finals stay immutable: apply on a final answers DS_FINAL_IMMUTABLE", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Final");
  const night = await templateId("ghg-inventory-night");
  const p = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "manager", { templateId: night, rev: doc.rev });
  assert.equal(p.status, 200);
  await q(`UPDATE report_doc SET status = 'final' WHERE id = $1`, [doc.id]);
  const a = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "manager", { templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(a.status, 409);
  assert.equal(a.json.code, "DS_FINAL_IMMUTABLE");
  const [row] = await q(`SELECT rev, draft -> 'design' ->> 'templateId' AS t FROM report_doc WHERE id = $1`, [doc.id]);
  assert.equal(Number(row.rev), doc.rev);
  assert.equal(row.t, doc.doc.design.templateId);
  // Preview stays read-only on a final.
  const pf = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "manager", { templateId: night, rev: doc.rev });
  assert.equal(pf.status, 200, JSON.stringify(pf.json));
  const [after] = await q(`SELECT rev, status FROM report_doc WHERE id = $1`, [doc.id]);
  assert.equal(Number(after.rev), doc.rev);
  assert.equal(after.status, "final");
});

test("apply is one write: when the database refuses the new template, neither the draft nor the rev moves", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Atomic");
  const night = await templateId("ghg-inventory-night");
  const p = await call("POST", `/studio/docs/${doc.id}/template-swap/preview`, "admin", { templateId: night, rev: doc.rev });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const [before] = await q(`SELECT template_id FROM report_doc WHERE id = $1`, [doc.id]);
  // A trigger that fails any template_id change on this doc stands in for a write failing mid-apply.
  await q(`CREATE OR REPLACE FUNCTION at2_refuse_template() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'at2 test: template_id refused'; END $$ LANGUAGE plpgsql`);
  await q(`CREATE TRIGGER at2_refuse_template BEFORE UPDATE ON report_doc FOR EACH ROW WHEN (NEW.id = ${Number(doc.id)} AND NEW.template_id IS DISTINCT FROM OLD.template_id) EXECUTE FUNCTION at2_refuse_template()`);
  try {
    const a = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
    assert.ok(a.status >= 500, `the refused write fails the apply (got ${a.status})`);
  } finally {
    await q(`DROP TRIGGER IF EXISTS at2_refuse_template ON report_doc`);
    await q(`DROP FUNCTION IF EXISTS at2_refuse_template()`);
  }
  const [row] = await q(`SELECT rev, template_id, draft -> 'design' ->> 'templateId' AS t FROM report_doc WHERE id = $1`, [doc.id]);
  assert.equal(Number(row.rev), doc.rev, "no new rev");
  assert.equal(row.t, doc.doc.design.templateId, "the draft keeps its template");
  assert.equal(String(row.template_id), String(before.template_id), "template_id unchanged");
  // With nothing in the way, the same preview applies.
  const ok = await call("POST", `/studio/docs/${doc.id}/template-swap/apply`, "admin", { templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.rev, doc.rev + 1);
});

test("a Superadmin previews and applies a swap for the company it names", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("AT-2 Superadmin");
  const night = await templateId("ghg-inventory-night");
  const p = await call("POST", `/studio/docs/${doc.id}/template-swap/preview?company_id=1`, "superadmin", { company_id: 1, templateId: night, rev: doc.rev });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const a = await call("POST", `/studio/docs/${doc.id}/template-swap/apply?company_id=1`, "superadmin", { company_id: 1, templateId: night, rev: doc.rev, previewHash: p.json.previewHash });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.rev, doc.rev + 1);
  assert.equal(a.json.doc.design.templateId, "ghg-inventory-night");
});
