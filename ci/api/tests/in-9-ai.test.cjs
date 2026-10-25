// IN-9 · GET /insights/cards?ai=1: AI wording through a recorded model stub on
// STUDIO_AI_STUB_PORT (ci/api/run.cjs points the server's STUDIO_AI_BASE_URL at
// it; Insights reads that when INSIGHTS_AI_BASE_URL isn't set). No real model.
// Accepted wording → source 'ai' with tokens only, same params and links; a
// rejected answer, a provider error or the monthly budget (I14) → rule text and
// 200; one insight_ai_call row per call (ids, model, tokens, cost, ok; no text);
// a cached wording makes no second call; roles, switch-off, tenant isolation;
// migrate:in-ai-calls twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, runScript, q, panel } = require("./in-lib.cjs");

const stub = { queue: [], requests: [], server: null };

/** A clean wording for every card in the prompt: its required tokens and plain words. */
const goodAnswer = (prompt) => {
  const cards = [];
  let id = null;
  for (const line of prompt.split("\n")) {
    const m = /^- id: (\S+)/.exec(line);
    if (m) id = m[1];
    const t = /^\s+tokens \(all required\): (.*)$/.exec(line);
    if (t && id) {
      const tokens = [...t[1].matchAll(/\{\{v:([a-z_]+)\}\}/g)].map((x) => `{{v:${x[1]}}}`);
      cards.push({ id, text: `Worth a look: ${tokens.join(" and ")} this period.` });
    }
  }
  return { cards };
};

// A draft row from 2010 on sites 1, 2 and 3: no figure reads it, but it moves each scope's data stamp, so
// earlier tests' cached card panels (IN-3 asks for ?ai=1 too) aren't served here.
const stampRows = [];

const reset = async () => {
  if (stampRows.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::bigint[])`, [stampRows.splice(0)]);
  await setInsights(1, false);
  await setInsights(2, false);
  await setKpi(1, false);
  await q(`DELETE FROM insight_ai_call WHERE company_id IN (1, 2)`);
};

test.before(async () => {
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateInAiCalls");
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
      stub.requests.push(body);
      const next = stub.queue.shift() ?? "good";
      if (next.status) {
        res.writeHead(next.status, { "content-type": "application/json" });
        return res.end("{}");
      }
      const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
      const content = next === "good" ? JSON.stringify(goodAnswer(user)) : typeof next === "string" ? next : JSON.stringify(next);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 900, completion_tokens: 150 } }));
    });
  });
  await new Promise((r) => stub.server.listen(Number(process.env.STUDIO_AI_STUB_PORT), "127.0.0.1", r));
  await reset();
  stampRows.push(
    ...(
      await q(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
         SELECT '{}', 1, 'tCO2e', '2010-01-31', 'draft', 1, 1, s, 'monthly' FROM unnest(ARRAY[1, 2, 3]) AS s RETURNING pk_id`,
      )
    ).map((r) => r.pk_id),
  );
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(async () => {
  await reset();
  await new Promise((r) => stub.server.close(r));
});
test.beforeEach(() => {
  stub.queue.length = 0;
  stub.requests.length = 0;
});

const cards = async (who, qs, opts) => (await panel(who, `/cards?${qs}`, opts)).json;
const logRows = () => q(`SELECT company_id, user_id, card_rule, model, tokens_in, tokens_out, cost_usd::float AS cost, ok FROM insight_ai_call WHERE company_id IN (1, 2) ORDER BY id`);

test("migrate:in-ai-calls created the table (ran twice in before)", async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'insight_ai_call' ORDER BY ordinal_position`)).map((r) => r.column_name);
  assert.deepEqual(cols, ["id", "company_id", "user_id", "card_rule", "model", "tokens_in", "tokens_out", "cost_usd", "ok", "created_at"]);
});

test("?ai=1: accepted wording → source 'ai', tokens only; params, links and order unchanged; one log row", async () => {
  const plain = await cards("manager", "year=2025&sites=1");
  const ai = await cards("manager", "year=2025&sites=1&ai=1");
  assert.ok(plain.data.cards.length >= 2);
  assert.equal(stub.requests.length, 1, "one batched call");
  assert.deepEqual(ai.data.cards.map((c) => [c.id, c.rule, c.severity, c.params, c.link, c.panel ?? null]), plain.data.cards.map((c) => [c.id, c.rule, c.severity, c.params, c.link, c.panel ?? null]));
  assert.deepEqual(ai.links, plain.links);
  for (const c of ai.data.cards) {
    assert.equal(c.source, "ai", c.id);
    assert.match(c.text, /\{\{v:[a-z_]+\}\}/);
    assert.ok(!/\d/.test(c.text.replace(/\{\{v:[a-z_]+\}\}/g, "")), `${c.id}: no digit outside tokens`);
  }
  // The request: the model of I13, JSON mode, rule ids, params as tokens, the company; nothing else.
  const req = stub.requests[0];
  assert.equal(req.model, "google/gemini-3-flash-preview");
  assert.deepEqual(req.response_format, { type: "json_object" });
  const user = req.messages.find((m) => m.role === "user").content;
  assert.match(user, /Company: CI Steel Co/);
  for (const c of plain.data.cards) assert.match(user, new RegExp(`- id: ${c.id}\\n  rule: ${c.rule} — `));
  assert.ok(!/@/.test(JSON.stringify(req)), "no emails in the prompt");
  const rows = await logRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    company_id: 1,
    user_id: 2,
    card_rule: plain.data.cards.map((c) => c.rule).join(",").slice(0, 40),
    model: "google/gemini-3-flash-preview",
    tokens_in: 900,
    tokens_out: 150,
    cost: Math.round(((900 * 0.5 + 150 * 3) / 1e6) * 1e4) / 1e4,
    ok: true,
  });
});

test("a cached wording makes no second call (same stamp, another panel cache key)", async () => {
  const again = await cards("manager", "year=2025&sites=1&ai=1&compare=base");
  assert.equal(stub.requests.length, 0);
  assert.ok(again.data.cards.every((c) => c.source === "ai"));
  assert.equal((await logRows()).length, 1);
});

test("a rejected answer keeps the rule text (200), and the call is still logged", async () => {
  stub.queue.push({ cards: [{ id: "largest_source", text: "Business Travel is 74% of everything." }] });
  const body = await cards("manager", "year=2024&sites=1&ai=1");
  assert.equal(stub.requests.length, 1);
  assert.ok(body.data.cards.length >= 1);
  for (const c of body.data.cards) {
    assert.equal(c.source, "rule");
    assert.equal(c.text, undefined);
  }
  const rows = await logRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].ok, true);
});

test("the provider down → rule text and 200, a log row with ok false", async () => {
  stub.queue.push({ status: 500 });
  const body = await cards("admin", "year=2025&sites=2&ai=1");
  assert.equal(stub.requests.length, 1);
  assert.ok(body.data.cards.every((c) => c.source === "rule"));
  const last = (await logRows()).at(-1);
  assert.equal(last.ok, false);
  assert.equal(last.user_id, 3);
  assert.equal(last.tokens_in, 0);
});

test("over the monthly budget (I14): no call, rule text, 200", async () => {
  await q(`INSERT INTO insight_ai_call (company_id, user_id, card_rule, model, tokens_in, tokens_out, cost_usd, ok) SELECT 1, 3, 'seed', 'seed', 0, 0, 0, true FROM generate_series(1, 2000)`);
  try {
    const body = await cards("admin", "year=2024&sites=2&ai=1");
    assert.equal(stub.requests.length, 0);
    assert.ok(body.data.cards.every((c) => c.source === "rule"));
  } finally {
    await q(`DELETE FROM insight_ai_call WHERE company_id = 1 AND card_rule = 'seed'`);
  }
  // Dollars count too: $10 in one row.
  await q(`INSERT INTO insight_ai_call (company_id, user_id, card_rule, model, tokens_in, tokens_out, cost_usd, ok) VALUES (1, 3, 'seed', 'seed', 0, 0, 10, true)`);
  try {
    const body = await cards("manager", "year=2024&ai=1");
    assert.equal(stub.requests.length, 0);
    assert.ok(body.data.cards.every((c) => c.source === "rule"));
  } finally {
    await q(`DELETE FROM insight_ai_call WHERE company_id = 1 AND card_rule = 'seed'`);
  }
});

test("roles, switch-off and tenant isolation on ?ai=1; another company's calls log under its own id", async () => {
  const u = await call("GET", "/insights/cards?year=2025&ai=1", "user");
  assert.equal(u.status, 403);
  assert.equal(u.json.code, "IN_FORBIDDEN");
  assert.equal((await call("GET", "/insights/cards?year=2025&ai=1&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/insights/cards?year=2025&ai=1&sites=3", "manager")).status, 404);
  const before = (await logRows()).filter((r) => r.company_id === 1).length;
  const other = await cards("otherManager", "year=2025&ai=1");
  const rows = await logRows();
  assert.equal(rows.filter((r) => r.company_id === 1).length, before, "company 2's call never logs under company 1");
  if (other.data.cards.length) {
    assert.equal(rows.at(-1).company_id, 2);
    const user = stub.requests.at(-1).messages.find((m) => m.role === "user").content;
    assert.match(user, /Company: CI Other Co/);
    assert.ok(!/CI Steel/.test(user));
  }
  await setInsights(1, false);
  try {
    const off = await call("GET", "/insights/cards?year=2025&ai=1", "manager");
    assert.equal(off.status, 403);
    assert.equal(off.json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
