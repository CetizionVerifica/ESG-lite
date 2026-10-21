// IN-9 · the AI wording guard and budget (pure): recorded answers replayed
// (ci/golden/in/ai/recorded.json), digits outside tokens, missing and unknown
// tokens, length, URLs, markup, the blocklist, token substitution, and the
// I14 budget limits. Runs against the build; no model is called.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const g = require(path.resolve("dist/insights/ai/guard.js"));
const b = require(path.resolve("dist/insights/ai/budget.js"));
const p = require(path.resolve("dist/insights/ai/prompts/card.js"));
const { RULES, RULE_IDS } = require(path.resolve("dist/insights/contracts/rules.js"));
const REC = require(path.resolve("ci/golden/in/ai/recorded.json"));

test("recorded answers: the guard's verdict per card matches the golden", () => {
  for (const a of REC.answers) {
    const text = typeof a.content === "string" ? a.content : JSON.stringify(a.content);
    const parsed = g.parseAiAnswer(text);
    if (a.expected === "unparsable") {
      assert.equal(parsed, null, a.name);
      continue;
    }
    assert.ok(parsed, a.name);
    for (const c of REC.cards) {
      const got = parsed.cards.find((x) => x.id === c.id);
      assert.equal(g.checkCardText(got.text, g.requiredTokens(c.rule), [...RULES[c.rule].params]), a.expected[c.id], `${a.name}: ${c.id}`);
    }
  }
});

test("checkCardText: each rejection reason, and a clean sentence passes", () => {
  const req = ["count"];
  const allow = ["count", "link"];
  assert.equal(g.checkCardText("{{v:count}} entries are waiting.", req, allow), null);
  assert.equal(g.checkCardText(42, req, allow), "not_text");
  assert.equal(g.checkCardText("   ", req, allow), "empty");
  assert.equal(g.checkCardText("{{v:count}} " + "a".repeat(180), req, allow), "too_long");
  assert.equal(g.checkCardText("{{v:count}} waiting\nnow", req, allow), "multi_line");
  assert.equal(g.checkCardText("Entries are waiting.", req, allow), "missing_token:count");
  assert.equal(g.checkCardText("{{v:count}} of {{v:total}}", req, allow), "unknown_token:total");
  assert.equal(g.checkCardText("{{v:count}} entries, 3 sites", req, allow), "digit_outside_token");
  assert.equal(g.checkCardText("{{v:count}} entries at www.example.invalid", req, allow), "url");
  assert.equal(g.checkCardText("{{v:count}} <b>entries</b>", req, allow), "markup");
  assert.equal(g.checkCardText("{{v:count}} entries {{v:count", req, allow), "markup");
  assert.equal(g.checkCardText("{{v:count}} certified entries", req, allow), "blocked_word:certified");
  assert.equal(g.checkCardText("{{v:count}} entries {{v:link}}", req, allow), null, "an allowed optional token");
});

test("requiredTokens: every param of the rule except `link`", () => {
  for (const id of RULE_IDS) assert.deepEqual(g.requiredTokens(id), RULES[id].params.filter((k) => k !== "link"), id);
  assert.deepEqual(g.requiredTokens("pending_large"), ["count"]);
});

test("fillTokens: values in, unknown tokens left as written", () => {
  assert.equal(g.fillTokens("{{v:site}} is {{v:share_pct}}% of Scope {{v:scope}}.", { site: "Plant North", share_pct: 61, scope: 1 }), "Plant North is 61% of Scope 1.");
  assert.equal(g.fillTokens("{{v:x}} stays", {}), "{{v:x}} stays");
});

test("budget (I14): over at $10 or 2,000 calls a month", () => {
  assert.equal(b.AI_MONTHLY_USD, 10);
  assert.equal(b.AI_MONTHLY_CALLS, 2000);
  assert.equal(b.overBudget({ calls: 0, cost_usd: 0 }), false);
  assert.equal(b.overBudget({ calls: 1999, cost_usd: 9.9999 }), false);
  assert.equal(b.overBudget({ calls: 2000, cost_usd: 0 }), true);
  assert.equal(b.overBudget({ calls: 1, cost_usd: 10 }), true);
});

test("the prompt carries rule ids, descriptions, tokens with values and the company; no other data", () => {
  assert.deepEqual(Object.keys(p.RULE_DESCRIPTIONS).sort(), [...RULE_IDS].sort());
  const text = p.cardUserPrompt({ name: "IN Fixture Co", sector: "Steel" }, [{ id: "largest_source", rule: "largest_source", params: { category: "Stationary Combustion", share_pct: 54 }, required: ["category", "share_pct"] }]);
  assert.match(text, /IN Fixture Co \(sector: Steel\)/);
  assert.match(text, /rule: largest_source — /);
  assert.match(text, /\{\{v:category\}\} = "Stationary Combustion"; \{\{v:share_pct\}\} = 54/);
  assert.ok(!/@/.test(text), "no emails");
  assert.match(p.CARD_SYSTEM, /180 characters/);
});
