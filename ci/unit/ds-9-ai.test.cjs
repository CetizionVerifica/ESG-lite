// DS-9 pure logic: the token guard (literal numbers, allowlist, token scope, chips),
// text ↔ TipTap, the chat intent matcher and router answer, budget limits at the
// boundary, prices, the brief proposals check, and the OpenRouter extraction
// (ai-narrative sends the same request and reads a recorded response the same way).
// No network: model answers are recorded (ci/fixtures/studio/ai/recorded.json).
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const guard = dist("studio/ai/guard.js");
const chat = dist("studio/ai/chat.js");
const { budgetVerdict } = dist("studio/ai/budget.js");
const { costUsd } = dist("studio/ai/prices.js");
const { readProposals } = dist("studio/ai/brief.js");
const { interpret, resolveTarget } = dist("studio/ai/runner.js");
const { ACTIONS } = dist("studio/ai/actions.js");
const { draftTarget, replaceElement } = dist("studio/ai/draft.js");
const { TextDocSchema, AI_BUDGET } = dist("studio/contracts/index.js");
const { RECORDED, DOCS, scopeFor, replay, tokensOf } = require(path.resolve("ci/golden/ds/lib/ai.cjs"));

const ghgScope = () => scopeFor("ghg", 2025);

// ---------------------------------------------------------------------------
// Token guard
// ---------------------------------------------------------------------------

test("guard: a literal reported figure in GHG text is rejected, in every common shape", () => {
  for (const text of [
    "Emissions fell to 48,620 t in 2025.",
    "Emissions fell to 48620 tCO2e.",
    "Scope 1 was 1.5 t.",
    "A 12% fall against 2024.",
    "We spent $5 on offsets.",
    "We emitted 3 million tonnes.",
    "Scope 2 fell by 7 percent.",
  ]) {
    assert.ok(guard.literalNumberIssues(text).length > 0, `should reject: ${text}`);
  }
});

test("guard: token-only text passes, and the allowlist keeps codes, years, scopes and categories", () => {
  const ok = [
    "Total emissions were {{data:total|current|value}} tCO₂e in 2025, {{data:total|current|change_pct}} against 2024.",
    "Reported under GRI 305-1, ESRS E1-6, ISO 14064-1:2018 and BRSR P6, with a target for 2030.",
    "Scope 1, Scope 2 and Scope 3; Categories 1 to 15; Category 9 is excluded.",
    "Factors use AR6 values for CO2, CH4, N2O and SF6. FY 2025–26 and FY25 are allowlisted; SDG 13 too.",
    "Three sites reported in 2 regions.",
  ];
  for (const text of ok) assert.deepEqual(guard.literalNumberIssues(text), [], text);
});

test("guard: tokens must name a fact the prompt offered, in the doc's source", () => {
  const scope = ghgScope();
  assert.deepEqual(guard.tokenIssues("{{data:scope1|current|value}} and {{data:scope3_category.4|prior|change_pct}}", scope), []);
  assert.match(guard.tokenIssues("{{data:scope2_market|current|value}}", scope)[0], /isn't one of the FACTS/);
  assert.match(guard.tokenIssues("{{data:scope3_category.8|current|value}}", scope)[0], /isn't one of the FACTS/);
  assert.match(guard.tokenIssues("{{data:revenue|current|value}}", scope)[0], /isn't a GHG figure/);
  assert.match(guard.tokenIssues("{{kpi:ENERGY_TOTAL|current|value}}", scope)[0], /GHG figures only/);
  assert.match(guard.tokenIssues("{{data:total|lastyear|value}}", scope)[0], /year must be/);
  assert.match(guard.tokenIssues("{{data:total|current|average}}", scope)[0], /measure must be/);
  assert.match(guard.tokenIssues("{{data total}}", scope)[0], /malformed/);
  assert.match(guard.tokenIssues("{{input:responsible_person}}", scope)[0], /REPORT DETAILS/);
  const sus = scopeFor("sustainability", 2025);
  assert.deepEqual(guard.tokenIssues("{{kpi:ENERGY_TOTAL|prior|value}}", sus), []);
  assert.match(guard.tokenIssues("{{kpi:GHG_UNSELECTED|current|value}}", sus)[0], /selected KPIs/);
});

test("guard: prose with tokens → TipTap with data chips bound to approved data, bullets and report details", () => {
  const { doc, sources } = guard.toTextDoc(
    ["Total was {{data:total|current|value}} tCO₂e, {{data:total|current|change_pct}}% vs 2024 under {{input:consolidation_approach}}.", "- Scope 1: {{data:scope1|prior|value}}\n- Category 4: {{data:scope3_category.4|base|value}}"],
    ghgScope(),
  );
  assert.ok(TextDocSchema.safeParse(doc).success);
  const chips = tokensOf(doc).map((t) => t.attrs);
  assert.deepEqual(chips[0], { binding: { source: "ghg", metric: "total", years: { last: 1 }, sites: "all" }, measure: "value" });
  assert.deepEqual(chips[1], { binding: { source: "ghg", metric: "total", years: { last: 1 }, sites: "all" }, measure: "change_pct" });
  assert.deepEqual(chips[2], { binding: { source: "ghg", metric: "scope1", years: { last: 2 }, sites: "all" }, measure: "value", year: "prior" });
  assert.deepEqual(chips[3], { binding: { source: "ghg", metric: "scope3_category", scope3Category: 4, years: { last: 1 }, sites: "all", compare: "base" }, measure: "value", year: "base" });
  // The typed % after a percent chip is dropped (the chip prints its own).
  const para = doc.content[0].content.map((n) => n.text ?? "⟨chip⟩").join("");
  assert.equal(para, "Total was ⟨chip⟩ tCO₂e, ⟨chip⟩ vs 2024 under Operational control.");
  assert.equal(doc.content[1].type, "bulletList");
  assert.deepEqual(sources, [
    { source: "ghg", metric: "total", year: 2025 },
    { source: "input", key: "consolidation_approach" },
    { source: "ghg", metric: "scope1", year: 2024 },
    { source: "ghg", metric: "scope3_category", year: 2025, scope3Category: 4 },
  ]);
});

test("guard: a rewrite keeps each existing chip's exact binding (sites, years, format)", () => {
  const el = DOCS.ghg.pages.find((p) => p.id === "p-summary").elements.find((e) => e.id === "p-summary.body");
  const { text, existing } = guard.textDocToTokens(el.props.doc, 2025);
  assert.equal(text, "Scope 1 emissions were {{data:scope1|current|value}} tCO₂e, {{data:total|current|change_pct}} versus 2024.");
  const scope = { ...ghgScope(), ghg: new Set(), existing };
  const { doc } = guard.toTextDoc(["Our total moved {{data:total|current|change_pct}}; Scope 1 was {{data:scope1|current|value}} tCO₂e."], scope);
  const chips = tokensOf(doc).map((t) => t.attrs);
  assert.deepEqual(chips[0], { binding: { source: "ghg", metric: "total", years: [2024, 2025], sites: "all", compare: "prior" }, measure: "change_pct", format: "pct1" });
  assert.deepEqual(chips[1], { binding: { source: "ghg", metric: "scope1", years: { last: 1 }, sites: "all" }, measure: "value", format: "1dp" });
});

// ---------------------------------------------------------------------------
// Recorded answers through interpret (the runner's zod → guard step)
// ---------------------------------------------------------------------------

test("recorded answers: every GHG action validates and its text chips are bound", () => {
  for (const action of ["ghg_exec_summary", "ghg_methodology_text", "scope3_category_text", "exclusion_reason_draft", "missing_disclosures"]) {
    const r = replay(action);
    assert.ok(r, action);
    assert.equal(r.result.issues, undefined, `${action}: ${JSON.stringify(r.result.issues)}`);
  }
  const s = replay("ghg_exec_summary").result;
  assert.ok(tokensOf(s.text).every((t) => t.attrs.binding.source === "ghg"));
  assert.equal(tokensOf(s.text).length, 6);
});

test("interpret: a literal figure fails the guard; not JSON fails; findings drop unknown pages", () => {
  const doc = DOCS.ghg;
  const spec = ACTIONS.ghg_exec_summary;
  const bad = interpret(spec, JSON.stringify({ paragraphs: ["Total emissions were 48,620 tCO₂e."] }), ghgScope(), doc, null);
  assert.ok(bad.issues.some((i) => /literal number \(48,620\)/.test(i)));
  assert.deepEqual(interpret(spec, "Sure! Here is your summary.", ghgScope(), doc, null), { issues: ["The answer wasn't one JSON object"] });
  assert.ok(interpret(spec, JSON.stringify({ paragraphs: [] }), ghgScope(), doc, null).issues.length);
  const f = interpret(ACTIONS.missing_disclosures, JSON.stringify({ findings: [{ message: "No base year.", pageId: "nope", severity: "error" }] }), ghgScope(), doc, null);
  assert.deepEqual(f, { findings: [{ message: "No base year.", severity: "warning" }] });
  const t = interpret(ACTIONS.chart_title, JSON.stringify({ title: "Emissions fell 12%" }), ghgScope(), doc, null);
  assert.ok(t.issues.length);
});

test("targets: text actions need text, chart and image actions need theirs, slots fill when nothing is selected", () => {
  const doc = DOCS.ghg;
  assert.throws(() => resolveTarget(ACTIONS.rewrite_shorter, doc, { pageId: "p-summary" }), (e) => e.code === "DS_VALIDATION");
  assert.throws(() => resolveTarget(ACTIONS.chart_title, doc, { pageId: "p-summary", elementId: "p-summary.body" }), (e) => e.code === "DS_VALIDATION");
  assert.throws(() => resolveTarget(ACTIONS.body, doc, { pageId: "missing" }), (e) => e.code === "DS_VALIDATION");
  assert.equal(resolveTarget(ACTIONS.alt_text, doc, { pageId: "p-cover", elementId: "p-cover.bg" }).element.id, "p-cover.bg");
  const slotDoc = JSON.parse(JSON.stringify(doc));
  slotDoc.pages[1].elements[1].id = "exec_summary.summary";
  assert.equal(resolveTarget(ACTIONS.ghg_exec_summary, slotDoc, undefined).element.id, "exec_summary.summary");
  assert.equal(draftTarget(slotDoc, "ghg_exec_summary").element.id, "exec_summary.summary");
  const r = resolveTarget(ACTIONS.ghg_exec_summary, doc, { pageId: "p-scope3" });
  assert.equal(r.page.id, "p-scope3");
  assert.equal(r.element, null);
  const next = replaceElement(slotDoc, "p-summary", { ...slotDoc.pages[1].elements[1], source: "ai" });
  assert.equal(next.pages[1].elements[1].source, "ai");
  assert.equal(next.pages[0], slotDoc.pages[0], "untouched pages keep identity");
});

// ---------------------------------------------------------------------------
// Chat intent
// ---------------------------------------------------------------------------

test("chat: the quick chips and common asks map to actions that fit the kind and the selection", () => {
  const m = (text, kind = "ghg", sel = "none") => chat.matchIntent(text, kind, sel);
  assert.deepEqual(m("Write the executive summary").actions, [{ action: "ghg_exec_summary" }]);
  assert.deepEqual(m("Explain the change in Scope 2").actions, [{ action: "explain_change" }]);
  assert.deepEqual(m("Draft exclusion reasons").actions, [{ action: "exclusion_reason_draft" }]);
  assert.deepEqual(m("Check for missing disclosures").actions, [{ action: "missing_disclosures" }]);
  assert.deepEqual(m("Make it more concise", "ghg", "text").actions, [{ action: "rewrite_shorter" }]);
  assert.equal(m("Make it more concise", "ghg", "none"), null, "a rewrite needs selected text: the router decides");
  assert.deepEqual(m("Write the text for Scope 3 category 9").actions, [{ action: "scope3_category_text", params: { category: 9 } }]);
  assert.deepEqual(m("Suggest a better title", "ghg", "chart").actions, [{ action: "chart_title" }]);
  assert.deepEqual(m("Write alt text", "ghg", "image").actions, [{ action: "alt_text" }]);
  assert.deepEqual(m("Rewrite this in our brand voice", "sustainability", "text").actions, [{ action: "apply_brand_voice" }]);
  assert.equal(m("Write the executive summary", "sustainability"), null, "the GHG summary isn't a sustainability action");
  assert.deepEqual(m("Draft the leadership message", "sustainability").actions, [{ action: "leadership_draft" }]);
  const layout = m("Suggest a layout for this page");
  assert.deepEqual(layout.actions, []);
  assert.match(layout.reply, /aren't available yet/);
  assert.equal(m("How are we doing on suppliers?"), null);
});

test("chat: the router answer keeps fitting actions only (at most 3) and guards its reply", () => {
  const ctx = { kind: "ghg", scope: ghgScope() };
  const r = chat.readRouterAnswer(
    JSON.stringify({ reply: "Scope 3 was {{data:scope3|current|value}} tCO₂e.", actions: [{ action: "rewrite_shorter" }, { action: "nonsense" }, { action: "body" }, { action: "honesty_check" }, { action: "jargon_check" }, { action: "missing_disclosures" }] }),
    ctx,
    "none",
  );
  assert.equal(r.reply, "Scope 3 was {{data:scope3|current|value}} tCO₂e.");
  assert.deepEqual(r.actions.map((a) => a.action), ["body", "honesty_check", "jargon_check"]);
  const bad = chat.readRouterAnswer(JSON.stringify({ reply: "Scope 3 was 41,200 tCO₂e.", actions: [] }), ctx, "none");
  assert.ok(bad.issues.length);
  assert.equal(chat.actionFits("chart_title", "ghg", "text"), false);
  assert.equal(chat.actionFits("leadership_draft", "ghg", "none"), false);
});

test("chat: reply tokens are filled by the server, never by the model", async () => {
  const out = await chat.fillTokens("Scope 3 was {{data:scope3|current|value}} and {{data:total|current|change_pct}}.", { displayToken: async (raw) => (raw.includes("scope3") ? "41,200 tCO₂e" : "−4.1%") });
  assert.equal(out, "Scope 3 was 41,200 tCO₂e and −4.1%.");
});

// ---------------------------------------------------------------------------
// Budget, prices, brief
// ---------------------------------------------------------------------------

test("budget: limits trigger at the boundary (D10)", () => {
  const u = (todayUsd, calls, monthUsd) => ({ todayUsd, calls, monthUsd });
  assert.equal(budgetVerdict(u(0, 0, 0)), null);
  assert.equal(budgetVerdict(u(4.99999, 199, 49.99999)), null);
  assert.equal(budgetVerdict(u(5, 0, 0)), "doc_day_usd");
  assert.equal(budgetVerdict(u(0, AI_BUDGET.perDocPerDayCalls, 0)), "doc_day_calls");
  assert.equal(budgetVerdict(u(0, 0, 50)), "company_month_usd");
  assert.equal(budgetVerdict(u(9, 999, 0), AI_BUDGET, { hasDoc: false }), null, "a brief (no doc) only counts the company month");
  assert.equal(budgetVerdict(u(0, 0, 50), AI_BUDGET, { hasDoc: false }), "company_month_usd");
});

test("prices: cost from the table; an unknown model is priced as the dearest", () => {
  assert.equal(costUsd("google/gemini-3-flash-preview", 1_000_000, 0), 0.5);
  assert.equal(costUsd("anthropic/claude-sonnet-5.5", 1000, 1000), 0.018);
  assert.equal(costUsd("someone/new-model", 1000, 1000), 0.018);
});

test("brief: proposals keep only the company's templates and styles, chapters from the template, at most 3", () => {
  const cat = {
    templates: [
      { id: 11, name: "GHG Inventory", look: "classic", format: "a4", purpose: "report", chapters: ["Cover", "Executive summary", "Scope 3"] },
      { id: 12, name: "Board brief", look: "night", format: "slide_16_9", purpose: "deck", chapters: ["Cover", "Headline", "Scope 3"] },
    ],
    styles: [{ id: "brand-night", name: "Brand night" }],
  };
  const r = readProposals(
    JSON.stringify({
      proposals: [
        { templateId: 12, styleId: "brand-night", title: "Board GHG brief", chapters: ["cover", "Scope 3", "Made up"], reason: "A dark deck for the board." },
        { templateId: 99, styleId: null, title: "x", chapters: [], reason: "y" },
        { templateId: 11, styleId: "not-a-style", title: "Inventory", chapters: [], reason: "The full inventory." },
      ],
    }),
    cat,
  );
  assert.deepEqual(r.map((p) => [p.templateId, p.look, p.styleId, p.chapters]), [
    [12, "night", "brand-night", ["Cover", "Scope 3"]],
    [11, "classic", null, ["Cover", "Executive summary", "Scope 3"]],
  ]);
  assert.deepEqual(readProposals(JSON.stringify({ proposals: [{ templateId: 5, title: "t", reason: "r" }] }), cat), { issues: ["templateId 5 isn't in TEMPLATES"] });
});

test("recorded fixture covers every built action", () => {
  assert.deepEqual(Object.keys(ACTIONS).filter((a) => !RECORDED[a]), []);
});

// ---------------------------------------------------------------------------
// OpenRouter extraction: ai-narrative behaves byte-identically
// ---------------------------------------------------------------------------

test("openrouter: ai-narrative sends the same request through src/lib/openrouter.ts and reads a recorded answer", async () => {
  const { writeNarrative } = dist("reporting/ai-narrative.js");
  const realFetch = global.fetch;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.OPENROUTER_MODEL;
  const calls = [];
  const recorded = { summary: ["One.", "Two.", "Three."], siteNote: "Sites.", scopeNote: "Scopes.", categoryNote: "Cats.", coverageNote: "Coverage.", recommendations: ["A", "B"] };
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(recorded) + "\n```" } }] }) };
  };
  try {
    const input = { companyName: "CI Steel Co", year: 2025, total: 1234.5, scope1: 1000.4, scope2: 234.1, coverage: 100, sites: [{ name: "Plant", t: 1234.5 }], categories: [{ name: "Diesel", t: 1000.4 }], missingSites: [], renewable: 0, months: 12 };
    const out = await writeNarrative(input);
    assert.deepEqual(out, recorded);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(Object.entries(calls[0].init.headers), [
      ["authorization", "Bearer test-key"],
      ["content-type", "application/json"],
      ["HTTP-Referer", "https://esg-lite.local"],
      ["X-Title", "ESG-Lite GHG"],
    ]);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(body), ["model", "max_tokens", "temperature", "messages"]);
    assert.equal(body.model, "google/gemini-3-flash-preview");
    assert.equal(body.max_tokens, 2200);
    assert.equal(body.temperature, 0.7);
    assert.equal(body.messages.length, 1);
    assert.match(body.messages[0].content, /^You are an ESG\/GHG analyst writing a professional, board-facing Carbon Accounting Report for CI Steel Co, reporting year 2025\./);
    assert.match(body.messages[0].content, /- Total: 1,235\n- Scope 1: 1,000\n- Scope 2: 234\n/);
    assert.equal(calls[0].init.signal, undefined, "no time limit added to the GHG narrative call");
    // Failure paths are unchanged: not ok → null; no key → null without a call.
    global.fetch = async () => ({ ok: false, json: async () => ({}) });
    assert.equal(await writeNarrative(input), null);
    delete process.env.OPENROUTER_API_KEY;
    global.fetch = async () => {
      throw new Error("must not be called");
    };
    assert.equal(await writeNarrative(input), null);
  } finally {
    global.fetch = realFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel !== undefined) process.env.OPENROUTER_MODEL = oldModel;
  }
});
