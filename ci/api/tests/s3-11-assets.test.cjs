// S3-11 leased assets, franchises and investments: the investments register
// and its Category 15 plan, the lease fields on a site with the boundary note
// (2 roles × 2 lease types × 3 approaches), tenant isolation, the role matrix,
// and both migrations run twice (forms, identity factors, D10 backfill).
//
// Fixture: company 1 (sites 1, 2), company 2 (site 3). This file adds
// category 921 "CI Investments" (Scope 3, Category 15) on site 1 with an EEIO
// factor "CI Telecom" (0.6 kgCO₂e per USD), and removes all of it afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const CAT15 = 921;

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM import_plan WHERE source_name LIKE 'Category 15 investments%'`);
    await db.query(`DELETE FROM investment WHERE company_id IN (1, 2)`);
    // This file's category 921 and the ones migrate:scope3-assets created (fixture ids stay below 100),
    // with their site links, forms, units and factors.
    const mine = `SELECT category_id FROM category WHERE (category_id >= 920 AND category_id < 930) OR (category_id > 100 AND ghg_category IN (8, 13, 14, 15))`;
    await db.query(`DELETE FROM site_categories WHERE category_id IN (${mine})`);
    await db.query(`DELETE FROM emission_factors WHERE category_id IN (${mine})`);
    await db.query(`DELETE FROM unit WHERE category_id IN (${mine})`);
    await db.query(`DELETE FROM column_config WHERE category_id IN (${mine})`);
    await db.query(`DELETE FROM category WHERE category_id IN (${mine})`);
    await db.query(`UPDATE site SET lease_role = NULL, lease_type = NULL, floor_area_m2 = NULL WHERE site_id IN (1, 2, 3)`);
    await db.query(`UPDATE company SET consolidation_approach = 'operational_control' WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM company_scope3_category WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM audit_log WHERE entity_type IN ('scope3_investment', 'scope3_site_lease')`);
  });

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await db.query(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, 'CI Investments', 'Scope 3', 15)`, [CAT15]);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (1, $1)`, [CAT15]);
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, emission_category_name, global_category_name, factor_value, denominator_unit, year, source, factor_type)
       VALUES (1, $1, 'CI Telecom', 'CI Telecom', 0.6, 'USD', 2024, 'CI', 'eeio_spend')`,
      [CAT15],
    );
  });
});
test.after(reset);

const investment = { investee: "CI Investee", type: "equity", share_pct: 25, investee_scope12_tco2e: 60000, year: 2025, source: "Annual report 2025" };

test("investments: Admin creates and updates, Manager reads, User and Manager can't change", async () => {
  const created = await call("POST", "/scope3/investments", "admin", investment);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.company_id, 1);
  assert.equal(created.json.share_pct, 25);
  assert.equal(created.json.investee_scope12_tco2e, 60000);

  const list = await call("GET", "/scope3/investments?year=2025", "manager");
  assert.equal(list.status, 200);
  assert.equal(list.json.can_edit, false);
  assert.deepEqual(list.json.investments.map((i) => i.investee), ["CI Investee"]);

  assert.equal((await call("GET", "/scope3/investments", "user")).status, 403);
  assert.equal((await call("POST", "/scope3/investments", "manager", investment)).status, 403);
  assert.equal((await call("PUT", `/scope3/investments/${created.json.id}`, "manager", { share_pct: 30 })).status, 403);
  assert.equal((await call("POST", "/scope3/investments/plan", "manager", { site_id: 1, year: 2025, year_type: "CY" })).status, 403);

  const updated = await call("PUT", `/scope3/investments/${created.json.id}`, "admin", { source: "Investee CDP 2025" });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.source, "Investee CDP 2025");
  assert.equal(updated.json.share_pct, 25);

  const sa = await call("GET", "/scope3/investments", "superadmin");
  assert.equal(sa.status, 400);
  assert.equal(sa.json.code, "SCOPE3_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/scope3/investments?company_id=1", "superadmin")).json.investments.length, 1);

  const audit = await withDb((db) => db.query(`SELECT action, changed_fields FROM audit_log WHERE entity_type = 'scope3_investment' AND entity_id = $1 ORDER BY id`, [created.json.id]));
  assert.deepEqual(audit.rows.map((r) => r.action), ["create", "update"]);
  assert.deepEqual(audit.rows[1].changed_fields.source, { old: "Annual report 2025", new: "Investee CDP 2025" });
});

test("investments: validation", async () => {
  for (const bad of [{ share_pct: 120 }, { type: "loan" }, { investee: "" }, { year: 1800 }, { sector_split: { A: 0.5, B: 0.2 } }, { colour: "red" }]) {
    const r = await call("POST", "/scope3/investments", "admin", { ...investment, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "SCOPE3_VALIDATION");
  }
  assert.equal((await call("PUT", "/scope3/investments/abc", "admin", { share_pct: 10 })).status, 404);
});

test("tenant isolation: company 2 tokens on company 1 ids give 404", async () => {
  const [own] = (await call("GET", "/scope3/investments", "admin")).json.investments;
  const other = await withDb((db) =>
    db.query(`INSERT INTO investment (company_id, investee, type, share_pct, year) VALUES (2, 'CI Other Investee', 'equity', 10, 2025) RETURNING id`),
  );
  const otherId = other.rows[0].id;

  assert.equal((await call("GET", "/scope3/investments?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/scope3/assets/sites?company_id=1", "otherUser")).status, 404);
  // Company 1's Admin on company 2's investment, site and plan.
  assert.equal((await call("PUT", `/scope3/investments/${otherId}`, "admin", { share_pct: 50 })).status, 404);
  assert.equal((await call("PUT", `/scope3/investments/${own.id}`, "admin", { company_id: 2, share_pct: 50 })).status, 404);
  assert.equal((await call("POST", "/scope3/investments", "admin", { ...investment, company_id: 2 })).status, 404);
  assert.equal((await call("PUT", "/scope3/assets/sites/3", "admin", { lease_role: "lessee" })).status, 404);
  assert.equal((await call("POST", "/scope3/investments/plan", "admin", { site_id: 3, year: 2025, year_type: "CY" })).status, 404);
  assert.equal((await call("GET", "/scope3/investments")).status, 401);

  const row = await withDb((db) => db.query(`SELECT share_pct FROM investment WHERE id = $1`, [otherId]));
  assert.equal(Number(row.rows[0].share_pct), 10);
  const site3 = await withDb((db) => db.query(`SELECT lease_role FROM site WHERE site_id = 3`));
  assert.equal(site3.rows[0].lease_role, null);
  // Company 1 never sees company 2's investment.
  const list = await call("GET", "/scope3/investments", "admin");
  assert.ok(list.json.investments.every((i) => i.company_id === 1));
});

test("Category 15 plan: one yearly row per investment, the engine calculates 15,000 tCO₂e", async () => {
  await call("POST", "/scope3/investments", "admin", { investee: "CI Telecom Co", type: "equity", share_pct: 5, revenue: 3000000, currency: "USD", eeio_sector: "CI Telecom", year: 2025 });
  await call("POST", "/scope3/investments", "admin", { investee: "CI Tiny Stake", type: "equity", share_pct: 0.5, investee_scope12_tco2e: 1000, year: 2025 });
  await call("POST", "/scope3/investments", "admin", { investee: "CI Loan", type: "debt", share_pct: 10, investee_scope12_tco2e: 1000, year: 2025 });

  const r = await call("POST", "/scope3/investments/plan", "admin", { site_id: 1, year: 2025, year_type: "CY", threshold_pct: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.plan.channel, "bulk_upload");
  assert.equal(r.json.plan.status, "draft");
  assert.deepEqual(
    r.json.skipped.map((s) => [s.investee, s.reason]).sort(),
    [
      ["CI Loan", "out_of_scope"],
      ["CI Tiny Stake", "below_threshold"],
    ],
  );
  const rows = r.json.plan.rows;
  assert.equal(rows.length, 2, JSON.stringify(rows));
  const specific = rows.find((x) => x.input.activity_name === "Reported emissions [tCO2e]");
  assert.equal(specific.state, "ready", JSON.stringify(specific.issues));
  assert.equal(specific.result.total_tco2e, 15000);
  assert.equal(specific.input.period.kind, "yearly");
  const average = rows.find((x) => x.input.activity_name === "CI Telecom");
  assert.equal(average.state, "ready", JSON.stringify(average.issues));
  assert.equal(average.result.total_tco2e, 90); // 3,000,000 × 0.6 × 5 % = 90,000 kg
  // Plan rows carry no total: the engine works it out.
  for (const x of rows) for (const k of ["total", "total_emission", "total_tco2e"]) assert.equal(k in x.input, false);

  // The plan seeded the form and this year's identity factor (factor year = 2024), once.
  const again = await call("POST", "/scope3/investments/plan", "admin", { site_id: 1, year: 2025, year_type: "CY", threshold_pct: 1 });
  assert.equal(again.status, 201);
  const seeded = await withDb((db) =>
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM emission_factors WHERE category_id = $1 AND emission_category_name LIKE 'Reported emissions%' AND year = 2024) AS factors,
              (SELECT COUNT(*)::int FROM column_config WHERE category_id = $1) AS configs`,
      [CAT15],
    ),
  );
  assert.deepEqual(seeded.rows[0], { factors: 2, configs: 1 });
  // Nothing was saved as an emission row.
  const emissions = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE category_id = $1`, [CAT15]));
  assert.equal(emissions.rows[0].n, 0);
});

test("Category 15 plan: a site without Category 15 and a bad body give 400", async () => {
  const r = await call("POST", "/scope3/investments/plan", "admin", { site_id: 2, year: 2025, year_type: "CY" });
  assert.equal(r.status, 400);
  assert.equal(r.json.details.reason, "CATEGORY_15_NOT_ASSIGNED");
  for (const bad of [{ site_id: 1, year: 2025 }, { site_id: 1, year: 2025, year_type: "Q1" }, { site_id: 1, year: 2025, year_type: "CY", threshold_pct: 200 }]) {
    const out = await call("POST", "/scope3/investments/plan", "admin", bad);
    assert.equal(out.status, 400, JSON.stringify(bad));
  }
});

test("lease fields: the boundary note follows 2 roles × 2 lease types × 3 approaches", async () => {
  const expected = {
    lessee: { finance: ["scope12", "scope12", "scope12"], operating: ["scope12", "cat8", "cat8"] },
    lessor: { finance: ["cat13", "cat13", "cat13"], operating: ["cat13", "scope12", "scope12"] },
  };
  const approaches = ["operational_control", "financial_control", "equity_share"];
  for (const role of ["lessee", "lessor"]) {
    for (const type of ["finance", "operating"]) {
      const put = await call("PUT", "/scope3/assets/sites/1", "admin", { lease_role: role, lease_type: type, floor_area_m2: 200 });
      assert.equal(put.status, 200, JSON.stringify(put.json));
      for (let i = 0; i < approaches.length; i++) {
        await withDb((db) => db.query(`UPDATE company SET consolidation_approach = $1 WHERE company_id = 1`, [approaches[i]]));
        const list = await call("GET", "/scope3/assets/sites", "user");
        const site = list.json.sites.find((s) => s.site_id === 1);
        assert.equal(site.boundary, expected[role][type][i], `${role} ${type} ${approaches[i]}`);
        assert.equal(site.floor_area_m2, 200);
      }
    }
  }
  await withDb((db) => db.query(`UPDATE company SET consolidation_approach = 'financial_control' WHERE company_id = 1`));
  await call("PUT", "/scope3/assets/sites/1", "admin", { lease_role: "lessee", lease_type: "operating" });
  const boundary = await call("GET", "/scope3/categories", "manager");
  assert.equal(boundary.status, 200);
  assert.deepEqual(
    boundary.json.lease_sites.map((s) => [s.site_id, s.boundary, s.note]),
    [[1, "cat8", "With financial control, this site's energy belongs in Category 8 · Upstream leased assets."]],
  );

  assert.equal((await call("PUT", "/scope3/assets/sites/1", "manager", { lease_role: null })).status, 403);
  assert.equal((await call("PUT", "/scope3/assets/sites/1", "admin", { lease_role: "tenant" })).status, 400);
  assert.equal((await call("PUT", "/scope3/assets/sites/1", "admin", { floor_area_m2: -5 })).status, 400);
  // Clearing the role clears the type.
  const cleared = await call("PUT", "/scope3/assets/sites/1", "admin", { lease_role: null });
  assert.equal(cleared.json.lease_type, null);
  assert.equal(cleared.json.note, null);
  const audit = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_type = 'scope3_site_lease' AND entity_id = 1`));
  assert.ok(audit.rows[0].n >= 4);
});

const runScript = (name, args = []) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`), ...args], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

test("migrate:scope3-assets runs twice: categories once, D10 on untouched rows only", async () => {
  // Company 1: Cat 14 still screening (seeded), Cat 13 changed by a person.
  await withDb(async (db) => {
    await db.query(`DELETE FROM company_scope3_category WHERE company_id IN (1, 2)`);
    await db.query(`INSERT INTO company_scope3_category (company_id, ghg_category, status) VALUES (1, 14, 'screening')`);
    await db.query(`INSERT INTO company_scope3_category (company_id, ghg_category, status, updated_by) VALUES (1, 13, 'screening', 3)`);
  });
  const counts = () =>
    withDb(async (db) => {
      const c = await db.query(`SELECT COUNT(*)::int AS n FROM category WHERE ghg_category IN (8, 13, 14, 15)`);
      const b = await db.query(`SELECT COUNT(*)::int AS n FROM company_scope3_category`);
      return { categories: c.rows[0].n, boundary: b.rows[0].n };
    });
  const first = runScript("migrateScope3Assets");
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const after1 = await counts();
  const second = runScript("migrateScope3Assets");
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.deepEqual(await counts(), after1);
  // 8, 13 and 14 created; 15 already exists (category 921).
  const names = await withDb((db) => db.query(`SELECT ghg_category, category_name, scope FROM category WHERE ghg_category IN (8, 13, 14) ORDER BY ghg_category`));
  assert.deepEqual(names.rows.map((r) => [r.ghg_category, r.category_name, r.scope]), [
    [8, "Upstream leased assets", "Scope 3"],
    [13, "Downstream leased assets", "Scope 3"],
    [14, "Franchises", "Scope 3"],
  ]);
  const rows = await withDb((db) => db.query(`SELECT ghg_category, status, reason, updated_by FROM company_scope3_category WHERE company_id = 1 AND ghg_category IN (13, 14, 15) ORDER BY ghg_category`));
  // 13 was changed by a person and stays; 14 was untouched and gets D10; 15 is
  // seeded as included because site 1 uses Category 15 (S3-1's seeding rule).
  assert.deepEqual(rows.rows.map((r) => [r.ghg_category, r.status]), [
    [13, "screening"],
    [14, "not_relevant"],
    [15, "included"],
  ]);
  assert.equal(rows.rows[1].reason, "No leased-out assets, franchises or investments");
  assert.equal(rows.rows[1].updated_by, null);
});

test("migrate:scope3-asset-forms runs twice: one form, its units and the identity factors", async () => {
  const counts = () =>
    withDb(async (db) => {
      const q = (sql) => db.query(sql, [CAT15]).then((r) => r.rows[0].n);
      return {
        configs: await q(`SELECT COUNT(*)::int AS n FROM column_config WHERE category_id = $1`),
        units: await q(`SELECT COUNT(*)::int AS n FROM unit WHERE category_id = $1`),
        factors: await q(`SELECT COUNT(*)::int AS n FROM emission_factors WHERE category_id = $1`),
      };
    });
  const first = runScript("migrateScope3AssetForms", ["1"]);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const after1 = await counts();
  const second = runScript("migrateScope3AssetForms", ["1"]);
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.deepEqual(await counts(), after1);
  assert.equal(after1.configs, 1);
  assert.equal(after1.units, 4);
  const identity = await withDb((db) =>
    db.query(
      `SELECT denominator_unit, factor_value, factor_type, dataset FROM emission_factors
        WHERE category_id = $1 AND emission_category_name = 'Reported emissions [tCO2e]' AND year = 2025`,
      [CAT15],
    ),
  );
  assert.deepEqual(identity.rows.map((r) => [r.denominator_unit, Number(r.factor_value), r.factor_type, r.dataset]), [["tCO2e", 1000, "other", "reported"]]);

  // A client's own form is left alone.
  await withDb((db) => db.query(`UPDATE column_config SET config_name = 'A client form', calculation = NULL WHERE category_id = $1`, [CAT15]));
  const third = runScript("migrateScope3AssetForms", ["1"]);
  assert.equal(third.status, 0);
  const cfg = await withDb((db) => db.query(`SELECT config_name, calculation FROM column_config WHERE category_id = $1`, [CAT15]));
  assert.deepEqual(cfg.rows, [{ config_name: "A client form", calculation: null }]);
});
