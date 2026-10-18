// D19 (KPI wave E): the ESG pillars and the ESG dashboard's headline list.
//   - TOPIC_PILLAR: every topic in exactly one pillar, as docs/kpi/wave-e.md's table;
//   - the pillar labels and letters;
//   - the headline list: real library KPIs of the right topic, parts in one unit, the
//     first four per pillar as the spec names them, and their directions;
//   - every library KPI has a direction (DIRECTION_GOOD), and isGood reads it;
//   - the library seed gives each KPI its topic's pillar.
// Runs against the compiled build: npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const enums = require(path.resolve("dist/kpi/contracts/enums.js"));
const labels = require(path.resolve("dist/kpi/contracts/labels.js"));
const schemas = require(path.resolve("dist/kpi/contracts/schemas.js"));
const headlines = require(path.resolve("dist/kpi/esg/headlines.js"));
const esg = require(path.resolve("dist/kpi/esg/service.js"));
const migration = require(path.resolve("dist/scripts/migrateKpiPillars.js"));
const definitions = require(path.resolve("data/kpi/definitions.json"));

test("KPI_PILLARS, labels and letters", () => {
  assert.deepEqual([...enums.KPI_PILLARS], ["environment", "social", "governance"]);
  assert.deepEqual(labels.PILLAR_LABELS, { environment: "Environment", social: "Social", governance: "Governance" });
  assert.deepEqual(labels.PILLAR_LETTERS, { environment: "E", social: "S", governance: "G" });
  assert.ok(schemas.KpiEsgQuerySchema.safeParse({ year: "2025", pillar: "social" }).success);
  assert.ok(!schemas.KpiEsgQuerySchema.safeParse({ year: "2025", pillar: "economic" }).success);
  assert.ok(!schemas.KpiEsgQuerySchema.safeParse({}).success, "year is required, as /kpi/dashboard");
});

test("TOPIC_PILLAR: every topic in exactly one pillar, as the wave E table", () => {
  assert.deepEqual(Object.keys(enums.TOPIC_PILLAR).sort(), [...enums.KPI_TOPICS].sort(), "each topic once");
  for (const p of Object.values(enums.TOPIC_PILLAR)) assert.ok(enums.KPI_PILLARS.includes(p), p);
  const by = (pillar) => enums.KPI_TOPICS.filter((t) => enums.TOPIC_PILLAR[t] === pillar);
  assert.deepEqual(by("environment"), ["climate", "energy", "water", "waste", "pollution", "biodiversity", "materials"]);
  assert.deepEqual(by("social"), ["workforce", "health_safety", "diversity", "training", "human_rights", "community", "customers"]);
  assert.deepEqual(by("governance"), ["governance", "ethics"]);
  assert.equal(by("environment").length + by("social").length + by("governance").length, 16);
  assert.equal(enums.pillarOfTopic("water"), "environment");
  assert.equal(enums.pillarOfTopic("nope"), null);
});

test("the backfill SQL maps every topic to its pillar", () => {
  for (const t of enums.KPI_TOPICS) assert.ok(migration.TOPIC_PILLAR_CASE.includes(`WHEN '${t}' THEN '${enums.TOPIC_PILLAR[t]}'`), t);
  assert.match(migration.BACKFILL_PILLARS, /WHERE "pillar" IS NULL$/, "only empty rows: an override is never touched");
  assert.deepEqual(migration.KPI_PILLAR_SCHEMA, [`ALTER TABLE "kpi_definition" ADD COLUMN IF NOT EXISTS "pillar" character varying(20)`]);
});

test("the headline list: library KPIs of its topic, one unit per headline, at most 4 per pillar", () => {
  const def = new Map(definitions.map((d) => [d.code, d]));
  const codes = new Set();
  for (const h of headlines.HEADLINES) {
    assert.ok(!codes.has(h.code), `${h.code} once`);
    codes.add(h.code);
    assert.ok(enums.KPI_TOPICS.includes(h.topic), h.code);
    assert.ok(["down", "up", null].includes(h.direction_good), h.code);
    assert.ok(h.parts.length >= 1);
    for (const c of h.parts) {
      const d = def.get(c);
      assert.ok(d, `${c} is a library KPI`);
      assert.equal(d.topic, h.topic, `${c} is a ${h.topic} KPI`);
      assert.ok(["number", "percent", "integer", "currency"].includes(d.value_type), `${c} is numeric`);
      assert.equal(d.canonical_unit, def.get(h.parts[0]).canonical_unit, `${h.code}: its parts share a unit`);
    }
    if (h.parts.length > 1) assert.ok(h.name, `${h.code} names itself`);
    else assert.equal(h.code, h.parts[0]);
  }
  assert.equal(headlines.HEADLINES_PER_PILLAR, 4);
  // With every library KPI selected, the first four per pillar (each KPI in its topic's pillar).
  const picked = (pillar) => headlines.HEADLINES.filter((h) => enums.TOPIC_PILLAR[h.topic] === pillar).slice(0, 4).map((h) => h.code);
  assert.deepEqual(picked("environment"), ["GHG_SCOPE1_2", "ENERGY_TOTAL", "WATER_WITHDRAWAL", "WASTE_GENERATED"]);
  assert.deepEqual(picked("social"), ["EMPLOYEES_TOTAL", "LTIFR", "WOMEN_IN_WORKFORCE", "TRAINING_HOURS_AVG"]);
  assert.deepEqual(picked("governance"), ["WOMEN_ON_BOARD", "BOARD_INDEPENDENCE", "CORRUPTION_INCIDENTS", "ANTI_CORRUPTION_TRAINING_SHARE"]);
  const ghg = headlines.HEADLINES.find((h) => h.code === "GHG_SCOPE1_2");
  assert.deepEqual(ghg.parts, ["GHG_SCOPE1", "GHG_SCOPE2_LB"], "Scope 1 + location-based Scope 2, both KPI-5 auto KPIs from the GHG report");
  for (const c of ghg.parts) assert.equal(def.get(c).source, "auto");
});

test("headline directions: less energy, emissions, water, waste, injuries and corruption is good; more women, training and board independence is good", () => {
  const dir = Object.fromEntries(headlines.HEADLINES.map((h) => [h.code, h.direction_good]));
  assert.deepEqual(dir, {
    GHG_SCOPE1_2: "down",
    ENERGY_TOTAL: "down",
    WATER_WITHDRAWAL: "down",
    WASTE_GENERATED: "down",
    GHG_SCOPE3: "down",
    ENERGY_RENEWABLE_SHARE: "up",
    WATER_CONSUMPTION: "down",
    WASTE_HAZARDOUS: "down",
    EMPLOYEES_TOTAL: null,
    LTIFR: "down",
    WOMEN_IN_WORKFORCE: "up",
    TRAINING_HOURS_AVG: "up",
    FATALITIES: "down",
    EMPLOYEE_TURNOVER_RATE: "down",
    COMPLAINTS_RECEIVED: "down",
    WOMEN_ON_BOARD: "up",
    BOARD_INDEPENDENCE: "up",
    CORRUPTION_INCIDENTS: "down",
    ANTI_CORRUPTION_TRAINING_SHARE: "up",
  });
  // Every headline's direction is the KPI's own in DIRECTION_GOOD.
  for (const h of headlines.HEADLINES) for (const c of h.parts) assert.equal(headlines.DIRECTION_GOOD[c], h.direction_good, c);
});

test("DIRECTION_GOOD covers every library KPI; custom KPIs follow their target; isGood", () => {
  assert.deepEqual(Object.keys(headlines.DIRECTION_GOOD).sort(), definitions.map((d) => d.code).sort());
  assert.equal(headlines.directionGood("ENERGY_TOTAL"), "down");
  assert.equal(headlines.directionGood("REVENUE", "increase"), null, "a library KPI keeps its own direction");
  assert.equal(headlines.directionGood("C1_OWN", "reduce"), "down");
  assert.equal(headlines.directionGood("C1_OWN", "increase"), "up");
  assert.equal(headlines.directionGood("C1_OWN", "maintain"), null);
  assert.equal(headlines.directionGood("C1_OWN"), null);
  assert.deepEqual([headlines.isGood("down", -5), headlines.isGood("down", 5), headlines.isGood("up", 5), headlines.isGood("up", -5), headlines.isGood(null, 5), headlines.isGood("down", 0)], [true, false, true, false, false, false]);
});

test("coverage_pct: approved over approved + pending + missing; null when nothing is counted", () => {
  assert.equal(esg.coveragePct({ approved: 2, pending: 1, missing: 2 }), 40);
  assert.equal(esg.coveragePct({ approved: 4, pending: 1, missing: 1 }), 67);
  assert.equal(esg.coveragePct({ approved: 0, pending: 0, missing: 0 }), null);
  assert.equal(esg.ANNUAL_SERIES_YEARS, 5);
  assert.equal(esg.MOVERS, 5);
});

test("the library seed gives each KPI its topic's pillar (applySeed on a stub manager)", async () => {
  const seed = require(path.resolve("dist/kpi/library/seed.js"));
  const inserted = [];
  const m = {
    query: async (sql, params) => {
      if (sql.startsWith("SELECT")) return [];
      if (sql.startsWith('INSERT INTO "kpi_definition"')) {
        const cols = /\(([^)]*)\) VALUES/.exec(sql)[1].split(", ").map((c) => c.replace(/"/g, ""));
        inserted.push(Object.fromEntries(cols.map((c, i) => [c, params[i]])));
      }
      return [{ id: inserted.length + 1 }];
    },
  };
  await seed.applySeed(m, { ...seed.readSeed(), disclosures: [], mappings: [] });
  assert.equal(inserted.length, definitions.length);
  for (const row of inserted) assert.equal(row.pillar, enums.TOPIC_PILLAR[row.topic], row.code);
  const pillar = (code) => inserted.find((r) => r.code === code).pillar;
  assert.equal(pillar("WOMEN_ON_BOARD"), "governance", "board composition is a governance topic (ESRS 2 GOV-1, GRI 2-9)");
  assert.equal(pillar("DATA_BREACHES"), "social", "customer data sits under the customers topic");
  assert.deepEqual(inserted.filter((r) => r.pillar === "governance").map((r) => r.code).sort(),
    ["ANTI_CORRUPTION_TRAINING_SHARE", "BOARD_INDEPENDENCE", "CORRUPTION_INCIDENTS", "DAYS_PAYABLE", "ETHICS_CONCERNS", "FINES_PAID", "REVENUE", "WOMEN_ON_BOARD"]);
});
