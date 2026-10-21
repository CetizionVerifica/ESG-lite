// IN-0 contract tests: enums, error codes and rule params match
// docs/insights/01-contracts.md; the zod schemas accept valid panel queries and
// reject invalid ones (sites parsing first); the FE snapshot
// (ci/insights-contracts.json) is current. Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const c = require(path.resolve("dist/insights/contracts/index.js"));

test("§1 enums hold the contract values", () => {
  assert.deepEqual([...c.PANEL_IDS], ["summary", "esg_ring", "decoupling", "target_wall", "cards", "pathway", "completeness", "bridge", "flow", "materiality", "stripes"]);
  assert.deepEqual([...c.AVAILABILITIES], ["ok", "kpi_off", "no_data", "setup_incomplete"]);
  assert.deepEqual([...c.TARGET_STATUSES], ["on_track", "at_risk", "off_track", "reached", "no_data"]);
  assert.deepEqual([...c.TARGET_STATUS_ORDER], ["off_track", "at_risk", "on_track", "reached", "no_data"]);
  assert.deepEqual([...c.TARGET_SOURCES], ["sbti", "kpi"]);
  assert.deepEqual([...c.PILLARS], ["environment", "social", "governance"]);
  assert.deepEqual([...c.DRIVERS], ["activity", "intensity_s1", "energy_intensity_s2", "grid_and_renewables_s2", "scope3", "other"]);
  assert.deepEqual([...c.EVENT_KINDS], ["initiative", "acquisition", "divestment", "method_change", "disruption", "other"]);
  assert.deepEqual([...c.CARD_SEVERITIES], ["good", "info", "attention", "critical"]);
  assert.deepEqual([...c.CARD_SEVERITY_RANK], ["critical", "attention", "good", "info"]);
  assert.deepEqual([...c.CARD_SOURCES], ["rule", "ai"]);
  assert.deepEqual([...c.INSIGHTS_ROLES], ["Manager", "Admin", "Superadmin"]);
  assert.deepEqual([...c.KPI_PANELS], ["esg_ring", "materiality"]);
  assert.deepEqual(Object.keys(c.PANEL_PATHS), [...c.PANEL_IDS], "a path for every panel");
  assert.equal(c.PANEL_PATHS.esg_ring, "/esg-ring");
  assert.equal(c.PANEL_PATHS.target_wall, "/target-wall");
});

test("§6 rules: eleven ids, each with its params", () => {
  assert.equal(c.RULE_IDS.length, 11);
  assert.deepEqual(Object.keys(c.RULES), [...c.RULE_IDS]);
  assert.deepEqual([...c.RULES.decoupling.params], ["output_pct", "emissions_pct", "base_year"]);
  assert.deepEqual([...c.RULES.coverage_gap.params], ["pillar", "pct", "missing"]);
  assert.deepEqual([...c.RULES.intensity_change.severities], ["good", "attention"]);
  assert.deepEqual([...c.RULES.pathway_gap.severities], ["critical"]);
  for (const id of c.RULE_IDS) for (const s of c.RULES[id].severities) assert.ok(c.CARD_SEVERITIES.includes(s), `${id}: ${s}`);
  assert.deepEqual("Up {{v:output_pct}}% and {{v:base_year}}".match(c.VALUE_TOKEN), ["{{v:output_pct}}", "{{v:base_year}}"]);
});

test("§7 error codes with their statuses", () => {
  const expect = {
    IN_OFF: 403, IN_FORBIDDEN: 403, IN_SITE_NOT_FOUND: 404, IN_EVENT_NOT_FOUND: 404, IN_EVENT_INVALID: 400,
    IN_SCORES_INVALID: 400, IN_AI_BUDGET: 429, IN_SNAPSHOT_TIMEOUT: 504, IN_SNAPSHOT_UNAVAILABLE: 503, IN_VALIDATION: 400, IN_COMPANY_REQUIRED: 400,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(c.IN_ERRORS).map(([k, v]) => [k, v.status])), expect);
  const e = new c.InError("IN_OFF");
  assert.equal(e.status, 403);
  assert.deepEqual(e.toBody(), { code: "IN_OFF", message: "Insights isn't turned on for your company." });
  assert.deepEqual(new c.InError("IN_EVENT_INVALID", { issues: [] }).toBody().details, { issues: [] });
});

const q = (input) => c.InsightsQuerySchema.safeParse(input);

test("InsightsQuerySchema: defaults, sites parsing, coercion", () => {
  const d = q({});
  assert.ok(d.success);
  assert.equal(d.data.year, new Date().getUTCFullYear());
  assert.equal(d.data.yearType, "CY");
  assert.equal(d.data.sites, "all");
  assert.equal(d.data.compare, "prior");
  assert.equal(d.data.pillar, undefined);
  assert.equal(d.data.company_id, undefined);

  const full = q({ year: "2026", yearType: "FY", sites: "3,1,3", pillar: "social", compare: "base", company_id: "4" });
  assert.ok(full.success, JSON.stringify(full.error?.issues));
  assert.deepEqual(full.data, { year: 2026, yearType: "FY", sites: [1, 3], pillar: "social", compare: "base", company_id: 4 });
  assert.equal(q({ sites: "all" }).data.sites, "all");
  assert.equal(q({ sites: "" }).data.sites, "all");
  assert.deepEqual(q({ sites: "7" }).data.sites, [7]);
  assert.equal(q({ pillar: "" }).data.pillar, undefined, "a blank pillar is no filter");
});

test("InsightsQuerySchema rejects bad values", () => {
  for (const bad of [
    { sites: "1,,2" }, { sites: "a" }, { sites: "0" }, { sites: "-1" }, { sites: "1, 2" }, { sites: "All" },
    { year: "26x" }, { year: "1800" }, { year: "2026.5" }, { yearType: "cy" }, { yearType: "QY" },
    { pillar: "E" }, { pillar: "climate" }, { compare: "last" }, { company_id: "0" }, { company_id: "x" },
  ]) {
    assert.equal(q(bad).success, false, JSON.stringify(bad));
  }
});

test("panel extras: decoupling years, cards ai, events from/to", () => {
  assert.equal(c.DecouplingQuerySchema.parse({}).years, 5);
  assert.equal(c.DecouplingQuerySchema.parse({ years: "10" }).years, 10);
  assert.equal(c.DecouplingQuerySchema.safeParse({ years: "11" }).success, false);
  assert.equal(c.DecouplingQuerySchema.safeParse({ years: "1" }).success, false);
  assert.equal(c.CardsQuerySchema.parse({}).ai, false);
  assert.equal(c.CardsQuerySchema.parse({ ai: "1" }).ai, true);
  assert.equal(c.CardsQuerySchema.safeParse({ ai: "yes" }).success, false);
  assert.ok(c.EventsQuerySchema.safeParse({ from: "2025-01-01", to: "2025-12-31" }).success);
  assert.equal(c.EventsQuerySchema.safeParse({ from: "2025-12-31", to: "2025-01-01" }).success, false);
  assert.equal(c.EventsQuerySchema.safeParse({ from: "2025-13-01" }).success, false);
});

test("event and scores bodies", () => {
  const ok = c.EventCreateSchema.safeParse({ date: "2024-06-01", label: " New boiler ", kind: "initiative" });
  assert.ok(ok.success);
  assert.equal(ok.data.label, "New boiler");
  assert.ok(c.EventCreateSchema.safeParse({ date: "2024-06-01", label: "Sold plant", kind: "divestment", site_id: 3 }).success);
  assert.ok(c.EventCreateSchema.safeParse({ date: "2024-06-01", label: "x", kind: "other", site_id: null }).success);
  for (const bad of [
    { date: "2024-6-1", label: "x", kind: "other" },
    { date: "2024-06-01", label: "", kind: "other" },
    { date: "2024-06-01", label: "x".repeat(61), kind: "other" },
    { date: "2024-06-01", label: "x", kind: "merger" },
    { date: "2024-06-01", label: "x", kind: "other", site_id: 0 },
  ]) assert.equal(c.EventCreateSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.ok(c.EventPatchSchema.safeParse({ label: "Renamed" }).success);
  assert.equal(c.EventPatchSchema.safeParse({}).success, false, "nothing to change");

  assert.ok(c.MaterialityScoresBodySchema.safeParse({ topics: [{ esrs_topic: "E1", impact_score: 8.5, financial_score: null }] }).success);
  for (const bad of [
    { topics: [] },
    { topics: [{ esrs_topic: "E1", impact_score: 10.5, financial_score: 1 }] },
    { topics: [{ esrs_topic: "E1", impact_score: -1, financial_score: 1 }] },
    { topics: [{ esrs_topic: "E1", impact_score: 7.25, financial_score: 1 }] },
    { topics: [{ esrs_topic: "", impact_score: 1, financial_score: 1 }] },
  ]) assert.equal(c.MaterialityScoresBodySchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("ci/insights-contracts.json (the FE mirror's reference) is current", () => {
  const r = spawnSync(process.execPath, [path.resolve("scripts/insights-contracts-snapshot.cjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
