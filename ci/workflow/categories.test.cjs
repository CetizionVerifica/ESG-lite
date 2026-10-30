// Every category, end to end (ci/workflow/README.md, "Every category"). One
// client reports every Scope 1 and Scope 2 source and all 15 Scope 3
// categories. For each category: the Superadmin sets up the client's own
// activities (or the deploy seeds the standard form), the User sees that
// activity in their list, picks it and enters a month, and the stored tCO₂e,
// its Category 3 twins, the Manager's approval and the report all match the kg
// worked out by hand in categories.scenario.cjs.
//
// Setup steps run in order and stop at the first failure. Each category's
// entry is its own test, so one broken category doesn't hide the others.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, call, withDb, migrateAll, tonnes } = require("./lib.cjs");
const SC = require("./categories.scenario.cjs");
const SUPERADMIN = require("./scenario.cjs").SUPERADMIN;

const S = { cats: {}, people: {}, rows: {}, setupFailed: null };
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.json));

/** A setup step: skipped once an earlier setup step failed. */
function setup(name, fn) {
  test(name, async (t) => {
    if (S.setupFailed) return t.skip(`an earlier step failed: ${S.setupFailed}`);
    try {
      await fn(t);
    } catch (err) {
      S.setupFailed = name;
      throw err;
    }
  });
}
/** A check that needs setup but not the other categories. */
function check(name, fn) {
  test(name, async (t) => {
    if (S.setupFailed) return t.skip(`setup failed: ${S.setupFailed}`);
    await fn(t);
  });
}

const label = (row) => (row.n ? `Category ${row.n}` : SC.scopeOf(row.cat)) + ` (${SC.CATEGORIES[row.cat].category_name.replace(/^CI Cat /, "")})`;
const site = () => S.siteId;

// ── Setup (Superadmin, Admin) ──────────────────────────────────────────────

setup("C0 the Superadmin creates a category for every Scope 1, 2 and 3 source", async () => {
  S.sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  for (const [key, body] of Object.entries(SC.CATEGORIES)) {
    const r = await call("POST", "/admin/categories", S.sa, body);
    if (r.status === 201) S.cats[key] = (r.json.category ?? r.json).category_id;
    else {
      // FERA is shared by name: reuse the platform's one when the workflow test made it.
      assert.equal(key, "fera", JSON.stringify(r.json));
      const found = await withDb((db) => db.query(`SELECT category_id FROM category WHERE lower(category_name) = 'fera'`));
      S.cats[key] = found.rows[0].category_id;
    }
  }
  const nums = await withDb((db) => db.query(`SELECT ghg_category AS n FROM category WHERE category_id = ANY($1) AND ghg_category IS NOT NULL ORDER BY 1`, [Object.values(S.cats)]));
  assert.deepEqual(nums.rows.map((x) => x.n), Array.from({ length: 15 }, (_, i) => i + 1), "every Scope 3 category has its number");
});

setup("C1 the Superadmin onboards the client and assigns all its categories to the site", async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries(SC.CLIENT)) f.append(k, v);
  const r = await call("POST", "/admin/onboarding/company", S.sa, f);
  ok(r, 201);
  S.companyId = r.json.company.company_id;
  S.siteId = r.json.site.site_id;
  S.admin = await login(SC.CLIENT.email, SC.CLIENT.password);
  for (const id of Object.values(S.cats)) {
    const cur = await withDb((db) => db.query(`SELECT site_id FROM site_categories WHERE category_id = $1`, [id]));
    ok(await call("PUT", `/admin/categories/${id}`, S.sa, { site_ids: [...new Set([...cur.rows.map((x) => x.site_id), site()])] }));
  }
  const n = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM site_categories WHERE site_id = $1`, [site()]));
  assert.equal(n.rows[0].n, Object.keys(SC.CATEGORIES).length);
});

setup("C2 the next deploy adds the standard Scope 3 forms and their seeded factors", async () => {
  migrateAll();
  for (const n of [6, 7, 8, 10, 11, 12, 13, 14, 15]) {
    const key = `c${n}`;
    const r = await call("GET", `/user/column-configs/site/${site()}/category/${S.cats[key]}`, S.admin);
    ok(r);
    assert.ok(Array.isArray(r.json) && r.json.some((c) => c.calculation), `Category ${n} has a standard form with a calculation`);
  }
  for (const [ref, s] of Object.entries(SC.SEEDED)) {
    const f = await withDb((db) => db.query(`SELECT factor_value::float8 AS v FROM emission_factors WHERE site_id = $1 AND category_id = $2 AND year = $3 AND emission_category_name = $4`, [site(), S.cats[s.cat], SC.FACTOR_YEAR, s.name]));
    assert.equal(f.rows[0]?.v, s.value, `${ref}: seeded "${s.name}" for factor year ${SC.FACTOR_YEAR}`);
  }
});

setup("C3 the Superadmin loads the client's own activities for each category", async () => {
  for (const f of SC.FACTORS) {
    const { cat, import: viaImport, ...body } = f;
    const row = { ...body, source: "CI test figure", gwp_set: "AR6", site_id: site(), category_id: S.cats[cat], year: SC.FACTOR_YEAR };
    const r = viaImport ? await call("POST", "/admin/emission-factors/bulk", S.sa, { factors: [row] }) : await call("POST", "/admin/emission-factors", S.sa, row);
    ok(r, 201);
    assert.deepEqual(r.json.warnings ?? [], [], `${f.emission_category_name}: factor type fits ${SC.CATEGORIES[cat].category_name}`);
  }
});

setup("C4 the Admin's boundary includes all 15 Scope 3 categories", async () => {
  const list = await call("GET", "/scope3/categories", S.admin);
  ok(list);
  for (const c of list.json.categories) if (c.status !== "included") ok(await call("PUT", `/scope3/categories/${c.n}`, S.admin, { status: "included" }));
  const after = await call("GET", "/scope3/categories", S.admin);
  assert.deepEqual(after.json.categories.filter((c) => c.status !== "included").map((c) => c.n), []);
  assert.equal(after.json.unmapped_count, 0);
});

setup("C5 the Admin invites a Manager and a User, who gets every category but FERA in their list", async () => {
  for (const [key, p] of Object.entries(SC.PEOPLE)) {
    ok(await call("POST", "/company-admin/users", S.admin, { name: p.name, email: p.email, password: p.password, role: p.role, site_ids: [site()] }), 201);
    S.people[key] = await login(p.email, p.password);
  }
  const mine = S.people.user.user.sites?.find((s) => s.site_id === site())?.categories?.map((c) => c.category_id) ?? [];
  for (const row of SC.ROWS) assert.ok(mine.includes(S.cats[row.cat]), `${label(row)} is in the User's categories`);
});

// ── Each category: the User picks the client's activity and enters a month ──

const twinsOf = (id) =>
  withDb((db) => db.query(`SELECT pk_id, scope3_sub, total_emission::float8 AS t FROM emission WHERE fera_linked_id = $1 OR (pk_id <> $1 AND pk_id IN (SELECT fera_linked_id FROM emission WHERE pk_id = $1)) ORDER BY scope3_sub`, [id]));

for (const row of SC.ROWS) {
  check(`${label(row)}: ${row.why} = ${tonnes(row.kg)} tCO₂e`, async () => {
    const choices = await call("GET", `/user/emission-factors/site/${site()}/category/${S.cats[row.cat]}`, S.people.user);
    ok(choices);
    const chosen = choices.json.find((f) => f.emission_category_name === row.activity_data.emission_category && f.year === SC.FACTOR_YEAR);
    assert.ok(chosen, `the User can pick "${row.activity_data.emission_category}" (${choices.json.length} activities listed)`);

    const r = await call("POST", "/user/emissions", S.people.user, {
      site_id: site(),
      category_id: S.cats[row.cat],
      date_of_reporting: row.date,
      reporting_period: "monthly",
      activity_data_unit: row.unit,
      activity_data: row.activity_data,
    });
    ok(r, 201);
    const warnings = r.json.warnings ?? [];
    assert.equal(Number(r.json.emission.total_emission), tonnes(row.kg), `stored tCO₂e; warnings ${JSON.stringify(warnings)}`);
    assert.equal(r.json.emission.status, "pending");
    assert.deepEqual(warnings.filter((w) => /FALLBACK|MISSING|NO_DEFLATOR/.test(w.code ?? "")), [], "the factor of the right year was used");

    const twins = await twinsOf(r.json.emission.pk_id);
    const got = Object.fromEntries(twins.rows.map((x) => [x.scope3_sub, x.t]));
    const want = Object.fromEntries(Object.entries(row.twins ?? {}).map(([k, kg]) => [k, tonnes(kg)]));
    assert.deepEqual(got, want, "Category 3 rows");
    S.rows[row.ref] = { id: r.json.emission.pk_id, twinIds: twins.rows.map((x) => x.pk_id) };
  });
}

// ── Review and report ──────────────────────────────────────────────────────

check("C6 the Manager approves every row; the Category 3 rows follow", async () => {
  const ids = Object.values(S.rows).map((x) => x.id);
  assert.equal(ids.length, SC.ROWS.length, "every category saved a row");
  ok(await call("PUT", "/user/emissions/bulk-approve", S.people.manager, { ids }));
  const all = Object.values(S.rows).flatMap((x) => [x.id, ...x.twinIds]);
  const r = await withDb((db) => db.query(`SELECT status, COUNT(*)::int AS n FROM emission WHERE pk_id = ANY($1) GROUP BY status`, [all]));
  assert.deepEqual(r.rows, [{ status: "approved", n: all.length }]);
});

/** Hand-worked kg per Scope 3 category, Category 3 being the twins of the Scope 1 and 2 rows. */
function expectedScope3Kg() {
  const kg = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 0]));
  for (const row of SC.ROWS) {
    if (row.n) kg[row.n] += row.kg;
    for (const v of Object.values(row.twins ?? {})) kg[3] += v;
  }
  return kg;
}

check("C7 the GHG report's Scope 3 table: each of the 15 categories carries its approved kg", async () => {
  const kg = expectedScope3Kg();
  const r = await call("GET", `/reports/ghg/scope3?siteIds=${site()}&year=${SC.REPORT_YEAR}&yearType=${SC.YEAR_TYPE}`, S.people.manager);
  ok(r);
  const brief = JSON.stringify(r.json.rows.map((x) => [x.n, x.tco2e, x.status]));
  for (let n = 1; n <= 15; n++) {
    const row = r.json.rows.find((x) => x.n === n);
    assert.equal(row.tco2e, tonnes(kg[n]), `Category ${n} in ${brief}`);
    assert.equal(row.status, "included");
  }
  assert.equal(r.json.total_tco2e, tonnes(Object.values(kg).reduce((a, b) => a + b, 0)));
  assert.equal(r.json.rows.find((x) => x.n === null)?.tco2e ?? 0, 0, "nothing unmapped");
});

// D14: the scope totals add the rows' kg and round once, as the Scope 3 table (C7) does, so both
// show the same Scope 3. By hand from ROWS:
//   Scope 1  3,992.325 + 8,040.928 + 27,072 + 22,000 = 61,105.253 kg → 61.105 t
//   Scope 2  43,620 + 20,000 = 63,620 kg → 63.62 t
//   Scope 3  the twins 936.135 + 1,952.032 + 6,600 + 3,120 + 3,000 = 15,608.167 kg, plus Categories
//            1, 2, 4–15: 37,000 + 8,000 + 1,284 + 2,082.1308 + 353.4 + 14,042.16 + 1,090.5 + 400
//            + 14,540 + 76,500 + 5,822.447 + 6,000 + 30,000 + 1,000,000 = 1,212,722.8048 kg → 1,212.723 t
//   Total    61,105.253 + 63,620 + 1,212,722.8048 = 1,337,448.0578 kg → 1,337.448 t
//   (adding the rows' stored tonnes gave Scope 3 1,212.722 t and Total 1,337.447 t, while C7 said 1,212.723)
check("C8 the GHG report's scope totals: Scope 1, 2 and 3 are the stored rows' kg, summed and rounded once", async () => {
  const kg = { "Scope 1": 0, "Scope 2": 0, "Scope 3": 0 };
  for (const row of SC.ROWS) {
    kg[SC.scopeOf(row.cat)] += row.kg;
    for (const v of Object.values(row.twins ?? {})) kg["Scope 3"] += v;
  }
  const r = await call("POST", "/user/ghg/tables", S.people.manager, { siteIds: [site()], year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, frequency: "yearly" });
  ok(r);
  const totals = r.json.totals?.[String(SC.REPORT_YEAR)];
  assert.ok(totals, JSON.stringify(Object.keys(r.json)));
  assert.equal(totals.scope1, tonnes(kg["Scope 1"]), "Scope 1");
  assert.equal(totals.scope2, tonnes(kg["Scope 2"]), "Scope 2");
  assert.equal(totals.scope3, tonnes(kg["Scope 3"]), "Scope 3");
  assert.equal(totals.total, tonnes(kg["Scope 1"] + kg["Scope 2"] + kg["Scope 3"]), "Total");
});
