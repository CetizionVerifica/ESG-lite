// IN-8 · unit: derive/stripes.ts (window, nulls, leading months dropped, min/max), the snapshot
// time limit helpers, and the snapshot HTML (every data text escaped; footer; KPI-off layout;
// card print copy for every rule). Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { stripesSeries } = require(path.resolve("dist/insights/derive/stripes.js"));
const html = require(path.resolve("dist/insights/panels/snapshotHtml.js"));
const snap = require(path.resolve("dist/insights/panels/snapshot.js"));
const { RULE_IDS, RULES } = require(path.resolve("dist/insights/contracts/rules.js"));

const m = (month, gross, saved = 0) => [month, { month, gross, saved, net: gross - saved }];

test("stripesSeries: the last `max` months, null when nothing approved, leading empties dropped", () => {
  const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"];
  const by = new Map([m("2025-02", 0), m("2025-03", 5, 1), m("2025-05", 0, 2)]);
  const s = stripesSeries(months, by, 4);
  assert.deepEqual(s.months, ["2025-03", "2025-04", "2025-05"]);
  assert.deepEqual(s.values, [4, null, -2]);
  assert.equal(s.min, -2);
  assert.equal(s.max, 4);
  assert.equal(s.count, 2);
  const empty = stripesSeries(months, new Map(), 72);
  assert.deepEqual(empty, { months: [], values: [], min: 0, max: 0, count: 0 });
});

test("snapshotTimeout: 60 s by default; the env var; the test header only under NODE_ENV=test", () => {
  assert.equal(snap.SNAPSHOT_TIMEOUT_MS, 60000);
  assert.equal(snap.snapshotTimeout(undefined, {}), 60000);
  assert.equal(snap.snapshotTimeout(undefined, { INSIGHTS_SNAPSHOT_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(snap.snapshotTimeout("1", { NODE_ENV: "production" }), 60000);
  assert.equal(snap.snapshotTimeout("1", { NODE_ENV: "test" }), 1);
  assert.equal(snap.snapshotTimeout("x", { NODE_ENV: "test", INSIGHTS_SNAPSHOT_TIMEOUT_MS: "-3" }), 60000);
});

test("withTimeout: the work when it is fast, IN_SNAPSHOT_TIMEOUT when it is slow", async () => {
  assert.equal(await snap.withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(snap.withTimeout(new Promise((r) => setTimeout(() => r(1), 200)), 5), (e) => e.code === "IN_SNAPSHOT_TIMEOUT" && e.status === 504);
});

test("printerMissing: Chromium that can't start, not other print failures", () => {
  assert.equal(snap.printerMissing(new Error("browserType.launch: Executable doesn't exist at /ms-playwright/chromium_headless_shell-1/chrome")), true);
  assert.equal(snap.printerMissing(new Error("browserType.launch: Host system is missing dependencies to run browsers.")), true);
  assert.equal(snap.printerMissing(new Error("In-page rendering failed:\nTypeError: x")), false);
  assert.equal(snap.printerMissing(new Error("page.waitForFunction: Timeout 60000ms exceeded")), false);
});

const EVIL = `<script>alert("x")</script>&'`;
const input = (over = {}) => ({
  company: EVIL,
  label: `CY 2025 · ${EVIL}`,
  generated: "2026-10-21",
  summary: {
    net: { value: 2670, unit: "tCO2e", prior: 2790, change_pct: -4.3, good: true },
    pathway: { status: "on_track", gap_pct: -0.18, target_year: 2030 },
    intensity: { value: 0.1376, unit: EVIL, combined: true, change_pct: -7.26, good: true },
    readiness: null,
    attention: { total: 1, items: [{ kind: "approvals", count: 1, link: "/data/approvals" }] },
    renewable_share_pct: 41.38,
  },
  decoupling: {
    base_year: 2021,
    years: [2021, 2022],
    series: [
      { key: "output", label: "Output", index: [100, 104], raw: [1, 2], unit: "t" },
      { key: "emissions", label: "Emissions", index: [100, null], raw: [1, null], unit: "tCO2e" },
      { key: "intensity", label: "Intensity", index: [100, 95], raw: [1, 1], unit: "x" },
    ],
    combined_output: false,
    decoupled: true,
    headline: { output_change_pct: 4, emissions_change_pct: -3, intensity_change_pct: -5 },
  },
  ring: null,
  pathway: null,
  wall: { items: [{ id: "kpi:1", source: "kpi", pillar: "social", name: EVIL, unit: "%", progress_pct: 40, expected_pct: 50, status: "at_risk", baseline: { year: 2020, value: 1 }, target: { year: 2030, value: 2 }, latest: null, direction_good: "up", link: "/kpi/targets" }] },
  cards: [{ id: "largest_source", rule: "largest_source", severity: "info", source: "rule", params: { category: EVIL, share_pct: 45 }, link: null }],
  pending: { emissions: 1, kpi_values: 0 },
  ...over,
});

test("snapshotHtml: data text is escaped everywhere; figures formatted; footer says approved data", () => {
  const out = html.snapshotHtml(input(), { withScripts: false });
  assert.ok(!out.includes("<script>alert"), "no raw script from data");
  assert.ok(out.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;"));
  assert.ok(!out.includes("<script"), "no script at all without paged.js");
  assert.match(out, /2,670/);
  assert.match(out, /down 4\.3 %/);
  assert.match(out, /On track/);
  assert.match(out, /Renewable share/);
  assert.match(out, /Generated 2026-10-21 from approved data/);
  assert.match(out, /1 entries and 0 KPI values waiting/);
  assert.match(out, /size: A4 landscape/);
  assert.match(out, /Set a base year in Targets/);
  assert.match(out, /<svg /);
  const withRing = html.snapshotHtml(input({ ring: { pct: 50, pillars: [{ pillar: "environment", label: EVIL, kpis: 2, approved: 1, coverage_pct: 50, topics: [] }] }, summary: { ...input().summary, readiness: { pct: 50, by_pillar: { environment: 50, social: null, governance: 0 } } } }), { withScripts: false });
  assert.match(withRing, /ESG readiness/);
  assert.match(withRing, /ESG data readiness · 50 %/);
  assert.match(withRing, /S — %/);
  assert.ok(!withRing.includes("<script>alert"));
  const scripted = html.snapshotHtml(input());
  assert.match(scripted, /window\.__ready=true/);
});

test("cardSentence: print copy for every rule, params escaped", () => {
  for (const rule of RULE_IDS) {
    const params = Object.fromEntries(RULES[rule].params.map((k) => [k, k === "category" ? EVIL : 3]));
    const s = html.cardSentence({ id: rule, rule, severity: RULES[rule].severities[0], source: "rule", params, link: null });
    assert.ok(s.length > 10, rule);
    assert.ok(!s.includes("<script"), rule);
    for (const k of RULES[rule].params) if (k !== "link") assert.ok(s.includes(k === "category" ? "&lt;script&gt;" : "3"), `${rule} shows ${k}`);
  }
  assert.equal(html.change(null), "—");
  assert.equal(html.change(0), "no change");
  assert.equal(html.change(2.5), "up 2.5 %");
  assert.equal(html.fmt(1234.56, 0), "1,235");
});
