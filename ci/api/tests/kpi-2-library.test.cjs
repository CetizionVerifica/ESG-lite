// KPI-2 library and catalogue: migrate:kpi-library and the seed run twice
// (adds missing, refreshes unedited rows, keeps edited ones, never deletes),
// /kpi/library/* is Superadmin only (and works whatever the switch says),
// validation (units, formulas, duplicate codes, fit notes, breakdown keys),
// audit rows, and GET /kpi/catalogue behind the switch with tenant isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript } = require("./kpi-lib.cjs");

const seedCounts = () =>
  withDb(async (db) => {
    const n = async (t) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
    return { frameworks: await n("kpi_framework"), definitions: await n("kpi_definition"), disclosures: await n("kpi_disclosure"), mappings: await n("kpi_disclosure_map") };
  });

const cleanup = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM kpi_disclosure_map WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE code LIKE 'TEST\\_%') OR disclosure_id IN (SELECT id FROM kpi_disclosure WHERE code LIKE 'TEST-%')`);
    await db.query(`DELETE FROM kpi_definition WHERE code LIKE 'TEST\\_%'`);
    await db.query(`DELETE FROM kpi_disclosure WHERE code LIKE 'TEST-%'`);
    await db.query(`DELETE FROM kpi_framework WHERE version LIKE 'TEST%'`);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'kpi_library'`);
  });

test.before(async () => {
  await setSwitch(1, false);
  await setSwitch(2, false);
  await cleanup();
});
test.after(async () => {
  await cleanup();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("migrate:kpi-library and migrate:kpi-library-seed run twice; the second run adds nothing", async () => {
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateKpiLibrary");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const first = runScript("seedKpiLibrary");
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const after1 = await seedCounts();
  assert.equal(after1.frameworks, 3);
  assert.ok(after1.definitions >= 40 && after1.definitions <= 60, JSON.stringify(after1));
  assert.ok(after1.mappings >= 100, JSON.stringify(after1));
  const second = runScript("seedKpiLibrary");
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stdout, /definitions: \+0, refreshed 0/);
  assert.deepEqual(await seedCounts(), after1);
});

test("only a Superadmin reaches /kpi/library/*, whatever the switch says", async () => {
  for (const on of [false, true]) {
    await setSwitch(1, on);
    for (const who of ["admin", "manager", "user", "otherManager"]) {
      for (const [method, route] of [["GET", "/kpi/library/definitions"], ["GET", "/kpi/library/frameworks"], ["GET", "/kpi/library/coverage"], ["POST", "/kpi/library/definitions"], ["PUT", "/kpi/library/mappings/1"]]) {
        const r = await call(method, route, who, method === "GET" ? undefined : {});
        assert.equal(r.status, 403, `${who} ${method} ${route}`);
        assert.equal(r.json.code, "KPI_FORBIDDEN");
      }
    }
  }
  await setSwitch(1, false);
  const r = await call("GET", "/kpi/library/frameworks", "superadmin");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.frameworks.map((f) => f.code), ["GRI", "BRSR", "ESRS"]);
});

test("library reads: definitions with mappings and filters, disclosures, mappings, coverage", async () => {
  const all = (await call("GET", "/kpi/library/definitions", "superadmin")).json.definitions;
  const water = all.find((d) => d.code === "WATER_WITHDRAWAL");
  assert.equal(water.canonical_unit, "kL");
  assert.deepEqual(water.mappings.map((m) => `${m.framework} ${m.code}`).sort(), ["BRSR P6-E3", "ESRS E3-4", "GRI 303-3"]);
  const auto = (await call("GET", "/kpi/library/definitions?source=auto", "superadmin")).json.definitions;
  assert.ok(auto.length >= 7 && auto.every((d) => d.source === "auto"));
  const brsr = (await call("GET", "/kpi/library/definitions?framework=BRSR", "superadmin")).json.definitions;
  assert.ok(brsr.some((d) => d.code === "LTIFR") && !brsr.some((d) => d.code === "WATER_RECYCLED"));
  assert.equal((await call("GET", "/kpi/library/definitions?topic=nope", "superadmin")).status, 400);
  const one = await call("GET", `/kpi/library/definitions/${water.id}`, "superadmin");
  assert.equal(one.json.definition.mappings.length, 3);
  assert.equal((await call("GET", "/kpi/library/definitions/999999", "superadmin")).status, 404);

  const discs = (await call("GET", "/kpi/library/disclosures?framework=ESRS", "superadmin")).json.disclosures;
  assert.ok(discs.every((d) => d.framework === "ESRS" && d.source_url));
  const maps = (await call("GET", `/kpi/library/mappings?kpi=${water.id}`, "superadmin")).json.mappings;
  assert.equal(maps.length, 3);
  const cov = (await call("GET", "/kpi/library/coverage", "superadmin")).json.coverage;
  assert.equal(cov.length, 3);
  for (const c of cov) assert.equal(c.mapped, c.disclosures, `${c.code}: every seeded disclosure has a KPI`);
});

const def = (over = {}) => ({
  code: "TEST_STEAM", name: "Steam bought", question: "How much steam did the site buy?", topic: "energy", value_type: "number",
  unit_dimension: "energy", canonical_unit: "GJ", allowed_units: ["GJ", "MWh"], aggregation: "sum", level: "site",
  default_frequency: "monthly", source: "manual", ...over,
});

test("create a KPI: 201 with an audit row; duplicate code, bad units, bad formulas and bad bodies refused", async () => {
  const r = await call("POST", "/kpi/library/definitions", "superadmin", def());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.definition.code, "TEST_STEAM");
  assert.ok(r.json.definition.edited_at, "a Superadmin's row is never overwritten by a seed");
  const audit = await withDb(async (db) => (await db.query(`SELECT action, entity_id, changed_by FROM audit_log WHERE entity_type = 'kpi_library'`)).rows);
  assert.deepEqual(audit, [{ action: "definition_created", entity_id: r.json.definition.id, changed_by: 5 }]);

  const dup = await call("POST", "/kpi/library/definitions", "superadmin", def());
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, "KPI_CODE_TAKEN");
  const seededDup = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "ENERGY_TOTAL" }));
  assert.equal(seededDup.json.code, "KPI_CODE_TAKEN");

  const badUnit = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_BAD_UNIT", allowed_units: ["GJ", "kL"] }));
  assert.equal(badUnit.status, 422);
  assert.equal(badUnit.json.code, "KPI_UNIT_NOT_ALLOWED");
  const wrongDim = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_BAD_DIM", unit_dimension: "volume" }));
  assert.equal(wrongDim.json.code, "KPI_UNIT_NOT_ALLOWED");

  const unknownRef = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_F1", source: "formula", formula: "NOPE_KPI / REVENUE", unit_dimension: "none", canonical_unit: "x", allowed_units: ["x"] }));
  assert.equal(unknownRef.status, 422);
  assert.equal(unknownRef.json.code, "KPI_FORMULA_INVALID");
  const badChars = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_F2", source: "formula", formula: "REVENUE; DROP", unit_dimension: "none", canonical_unit: "x", allowed_units: ["x"] }));
  assert.equal(badChars.json.code, "KPI_FORMULA_INVALID");

  for (const bad of [def({ code: "lower" }), def({ code: "TEST_X", topic: "nope" }), def({ code: "TEST_X", source: "auto" }), { code: "TEST_X" }]) {
    const res = await call("POST", "/kpi/library/definitions", "superadmin", bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.json.code, "KPI_VALIDATION");
  }
});

test("update a KPI: formula cycles refused; edited rows survive a re-seed, unedited rows are refreshed, nothing is deleted", async () => {
  const a = (await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_A" }))).json.definition;
  const b = await call("POST", "/kpi/library/definitions", "superadmin", def({ code: "TEST_B", source: "formula", formula: "TEST_A * 2", unit_dimension: "none", canonical_unit: "GJ", allowed_units: ["GJ"] }));
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const loop = await call("PUT", `/kpi/library/definitions/${a.id}`, "superadmin", { source: "formula", formula: "TEST_B / 2", unit_dimension: "none", canonical_unit: "GJ", allowed_units: ["GJ"] });
  assert.equal(loop.status, 422, JSON.stringify(loop.json));
  assert.equal(loop.json.code, "KPI_FORMULA_INVALID");
  assert.equal((await call("PUT", "/kpi/library/definitions/999999", "superadmin", { name: "x" })).status, 404);
  assert.equal((await call("PUT", `/kpi/library/definitions/${a.id}`, "superadmin", { source: "auto" })).json.code, "KPI_VALIDATION");

  const water = (await call("GET", "/kpi/library/definitions", "superadmin")).json.definitions.find((d) => d.code === "WATER_WITHDRAWAL");
  const edit = await call("PUT", `/kpi/library/definitions/${water.id}`, "superadmin", { question: "Edited by a Superadmin?" });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(edit.json.definition.question, "Edited by a Superadmin?");
  const auditRow = await withDb(async (db) => (await db.query(`SELECT changed_fields FROM audit_log WHERE entity_type = 'kpi_library' AND action = 'definition_updated' AND entity_id = $1`, [water.id])).rows[0]);
  assert.equal(auditRow.changed_fields.question.new, "Edited by a Superadmin?");

  // An unedited seeded row drifted in the database, and a row the seed doesn't know.
  await withDb(async (db) => {
    await db.query(`UPDATE kpi_definition SET name = 'Drifted' WHERE code = 'AIR_PM' AND company_id IS NULL`);
    await db.query(`UPDATE kpi_disclosure SET title = 'Drifted' WHERE code = '305-1'`);
  });
  const before = await seedCounts();
  const r = runScript("seedKpiLibrary");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rows = await withDb(async (db) => ({
    water: (await db.query(`SELECT question FROM kpi_definition WHERE code = 'WATER_WITHDRAWAL' AND company_id IS NULL`)).rows[0].question,
    pm: (await db.query(`SELECT name FROM kpi_definition WHERE code = 'AIR_PM' AND company_id IS NULL`)).rows[0].name,
    disc: (await db.query(`SELECT title FROM kpi_disclosure WHERE code = '305-1'`)).rows[0].title,
    own: (await db.query(`SELECT COUNT(*)::int AS n FROM kpi_definition WHERE code IN ('TEST_A', 'TEST_B', 'TEST_STEAM')`)).rows[0].n,
  }));
  assert.equal(rows.water, "Edited by a Superadmin?", "edited row kept");
  assert.equal(rows.pm, "Particulate matter emissions", "unedited row refreshed");
  assert.notEqual(rows.disc, "Drifted");
  assert.equal(rows.own, 3, "never deletes");
  assert.deepEqual(await seedCounts(), before);
});

test("frameworks, disclosures and mappings: create, update and validation", async () => {
  const fw = await call("POST", "/kpi/library/frameworks", "superadmin", { code: "GRI", version: "TEST 2030", name: "Test version", source_url: "https://www.globalreporting.org/x" });
  assert.equal(fw.status, 201, JSON.stringify(fw.json));
  assert.equal((await call("POST", "/kpi/library/frameworks", "superadmin", { code: "GRI", version: "TEST 2030", name: "Again", source_url: "https://www.globalreporting.org/x" })).json.code, "KPI_CODE_TAKEN");
  const off = await call("PUT", `/kpi/library/frameworks/${fw.json.framework.id}`, "superadmin", { active: false });
  assert.equal(off.json.framework.active, false);

  const disc = await call("POST", "/kpi/library/disclosures", "superadmin", { framework_id: fw.json.framework.id, code: "TEST-1", title: "Test disclosure", section: "Test", requirement: "required", source_url: "https://www.globalreporting.org/x" });
  assert.equal(disc.status, 201, JSON.stringify(disc.json));
  assert.equal((await call("POST", "/kpi/library/disclosures", "superadmin", { framework_id: 999999, code: "TEST-2", title: "t", section: "s", requirement: "required", source_url: "https://x.org" })).status, 400);
  assert.equal((await call("POST", "/kpi/library/disclosures", "superadmin", { framework_id: fw.json.framework.id, code: "TEST-3", title: "t", section: "s", requirement: "required", esrs_topic: "E1", source_url: "https://x.org" })).status, 400);
  const upd = await call("PUT", `/kpi/library/disclosures/${disc.json.disclosure.id}`, "superadmin", { verified: true });
  assert.equal(upd.json.disclosure.verified, true);

  const steam = (await call("GET", "/kpi/library/definitions", "superadmin")).json.definitions.find((d) => d.code === "TEST_STEAM");
  const water = (await call("GET", "/kpi/library/definitions", "superadmin")).json.definitions.find((d) => d.code === "WATER_WITHDRAWAL");
  const body = { disclosure_id: disc.json.disclosure.id, kpi_definition_id: steam.id, fit: "partial" };
  assert.equal((await call("POST", "/kpi/library/mappings", "superadmin", body)).status, 400, "partial needs a note");
  const mp = await call("POST", "/kpi/library/mappings", "superadmin", { ...body, note: "Steam only", display_unit: "GJ" });
  assert.equal(mp.status, 201, JSON.stringify(mp.json));
  assert.equal((await call("POST", "/kpi/library/mappings", "superadmin", { ...body, note: "again" })).json.code, "KPI_CODE_TAKEN");
  assert.equal((await call("POST", "/kpi/library/mappings", "superadmin", { disclosure_id: disc.json.disclosure.id, kpi_definition_id: water.id, fit: "exact", breakdown_key: "colour" })).status, 400);
  assert.equal((await call("POST", "/kpi/library/mappings", "superadmin", { disclosure_id: disc.json.disclosure.id, kpi_definition_id: water.id, fit: "exact", breakdown_key: "source" })).status, 201);
  assert.equal((await call("PUT", `/kpi/library/mappings/${mp.json.mapping.id}`, "superadmin", { note: null })).status, 400, "a partial fit keeps its note");
  const fit = await call("PUT", `/kpi/library/mappings/${mp.json.mapping.id}`, "superadmin", { fit: "exact" });
  assert.equal(fit.json.mapping.fit, "exact");
});

test("GET /kpi/catalogue: behind the switch; the company's own KPIs only; another company's id is 404", async () => {
  await setSwitch(1, false);
  const off = await call("GET", "/kpi/catalogue", "user");
  assert.equal(off.status, 403);
  assert.equal(off.json.code, "KPI_TRACKING_OFF");

  await setSwitch(1, true);
  await setSwitch(2, true);
  await withDb((db) =>
    db.query(`INSERT INTO kpi_definition (code, name, question, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, company_id)
              VALUES ('TEST_OWN', 'Own KPI', 'Own?', 'community', 'integer', 'count', 'count', '["count"]', 'sum', 'company', 'annual', 'manual', 2)`),
  );
  for (const who of ["user", "manager", "admin"]) {
    const r = await call("GET", "/kpi/catalogue", who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.frameworks.map((f) => f.code), ["BRSR", "ESRS", "GRI"], "inactive test version hidden");
    assert.ok(r.json.definitions.some((d) => d.code === "ENERGY_TOTAL"));
    assert.ok(!r.json.definitions.some((d) => d.code === "TEST_OWN"), "company 2's KPI hidden");
    assert.ok(r.json.mappings.length >= 100);
    assert.ok(r.json.disclosures.every((d) => r.json.frameworks.some((f) => f.id === d.framework_id)));
  }
  const other = await call("GET", "/kpi/catalogue", "otherUser");
  assert.ok(other.json.definitions.some((d) => d.code === "TEST_OWN"));
  assert.equal((await call("GET", "/kpi/catalogue?company_id=2", "admin")).status, 404);
  assert.equal((await call("GET", "/kpi/catalogue?company_id=1", "superadmin")).status, 200);
  assert.equal((await call("GET", "/kpi/catalogue", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
});
