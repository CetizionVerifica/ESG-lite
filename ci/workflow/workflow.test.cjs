// End-to-end data workflow (ci/workflow/README.md). One client is onboarded
// from nothing in the order of the onboarding workflow
// (/mnt/project-files/onboarding/client-onboarding-workflow.md); the step
// numbers in the test names are that document's. Each step runs as the role
// that does it in the app. Steps run in order and share state; once one
// fails, the later ones are skipped so the first failure is the one to read.
//
// A step for a module that hasn't merged yet is skipped with "waits on S3-n";
// the lane that builds the module replaces the skip with real checks.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, call, withDb, hasColumn, migrateAll, tonnes } = require("./lib.cjs");
const SC = require("./scenario.cjs");

const S = { cats: {}, sites: {}, people: {}, rows: {}, failed: null };

/** A workflow step: skipped once an earlier step failed. */
function step(name, fn) {
  test(name, async (t) => {
    if (S.failed) return t.skip(`an earlier step failed: ${S.failed}`);
    try {
      await fn(t);
    } catch (err) {
      S.failed = name;
      throw err;
    }
  });
}

/** A step for a module that may not be merged yet: runs `fn` only when `ready()` is true. */
function pendingStep(name, module, ready, fn) {
  step(name, async (t) => {
    if (!(await ready())) return t.skip(`waits on ${module}`);
    await fn(t);
  });
}

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.json));
const siteIds = () => [S.sites.main, S.sites.plantB];
const year = SC.YEAR;

// ── Phase 0 · Platform readiness (Superadmin) ──────────────────────────────

step("0.0 the Superadmin signs in", async () => {
  S.sa = await login(SC.SUPERADMIN.email, SC.SUPERADMIN.password);
  assert.equal(S.sa.user.role, "Superadmin");
});

step("0.1 Superadmin creates the shared categories with their GHG Protocol numbers", async () => {
  for (const [key, body] of Object.entries(SC.CATEGORIES)) {
    const r = await call("POST", "/admin/categories", S.sa, body);
    ok(r, 201);
    const cat = r.json.category ?? r.json;
    assert.equal(cat.scope, body.scope);
    assert.equal(cat.ghg_category ?? null, body.ghg_category ?? null, `${key} keeps its GHG number`);
    S.cats[key] = cat.category_id;
  }
  // A Scope 1 category can't carry a Scope 3 number.
  const bad = await call("POST", "/admin/categories", S.sa, { category_name: "CI Workflow bad", scope: "Scope 1", ghg_category: 4 });
  assert.equal(bad.status, 400);
});

step("0.2 Superadmin adds the country the client's sites are in", async () => {
  const r = await call("POST", "/admin/countries", S.sa, SC.COUNTRY);
  ok(r, 201);
  S.countryId = (r.json.country ?? r.json).country_id;
  assert.ok(S.countryId);
});

step("0.3 the deploy loaded the USEEIO spend library", async () => {
  const lib = await call("GET", `/scope3/spend/library?q=${encodeURIComponent(SC.SPEND.sector)}`, S.sa);
  ok(lib);
  const sector = lib.json.factors.find((f) => f.name.startsWith(SC.SPEND.sector));
  assert.ok(sector, "USEEIO sector in the library");
  assert.equal(sector.dataset, "USEEIO");
  S.spendLibraryFactor = sector;
});

step("0.3a the deploy seeded the US price index for the spend year", async () => {
  const r = await withDb((db) => db.query(`SELECT "index"::float8 AS i FROM price_deflator WHERE country = 'US' AND year = $1`, [year]));
  assert.equal(r.rows[0]?.i, SC.SPEND.deflator_2025, `US CPI-U ${year} seeded by migrate:scope3-spend`);
});

// ── Phase 1 · Create the client (Superadmin) ───────────────────────────────

step("1-4 Superadmin onboards the client with its Admin (Company, Admin user, Access, Review)", async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries(SC.CLIENT)) f.append(k, v);
  const r = await call("POST", "/admin/onboarding/company", S.sa, f);
  ok(r, 201);
  S.companyId = r.json.company.company_id;
  S.sites.main = r.json.site.site_id;
  assert.equal(r.json.admin.role, "Admin");
  S.admin = await login(SC.CLIENT.email, SC.CLIENT.password);
  assert.equal(S.admin.user.role, "Admin");
});

step("5 the client's switches start off: Smart import and Claude imports", async () => {
  const r = await withDb((db) => db.query(`SELECT ai_import_enabled, mcp_enabled FROM company WHERE company_id = $1`, [S.companyId]));
  assert.deepEqual(r.rows[0], { ai_import_enabled: false, mcp_enabled: false });
});

step("5a default currency is INR and Users see the total only (SE-2)", async () => {
  const r = await withDb((db) => db.query(`SELECT default_currency, entry_detail FROM company WHERE company_id = $1`, [S.companyId]));
  assert.deepEqual(r.rows[0], { default_currency: "INR", entry_detail: "total" });
  // The session's company carries both, so the entry screens read them (SE-1).
  const me = await call("GET", "/auth/me", S.admin);
  ok(me);
  // An Admin belongs to the company (user.company); others read it through their sites.
  const sites = me.json.user?.sites?.length ? me.json.user.sites : [me.json.user?.site].filter(Boolean);
  const companies = me.json.user?.company ? [me.json.user.company] : sites.map((s) => s.company);
  assert.ok(companies.length > 0, JSON.stringify(me.json).slice(0, 300));
  for (const c of companies) assert.deepEqual({ entry_detail: c?.entry_detail, default_currency: c?.default_currency }, { entry_detail: "total", default_currency: "INR" });
});

step("5b review workflow v2 (drafts and month lock) is off until the Superadmin turns it on", async () => {
  const r = await withDb((db) => db.query(`SELECT review_workflow_v2 FROM company WHERE company_id = $1`, [S.companyId]));
  assert.equal(r.rows[0].review_workflow_v2, false);
  // Off means today's behaviour: no month can be closed (step 25 checks entries are Pending).
  const lock = await call("POST", "/periods/lock", S.admin, { site_id: S.sites.main, year: SC.YEAR, month: 4 });
  assert.equal(lock.status, 403);
  assert.equal(lock.json.code, "REVIEW_WORKFLOW_OFF");
});

// ── Phase 2 · Sites and categories (Superadmin) ────────────────────────────

step("6 Superadmin adds the second site", async () => {
  const r = await call("POST", "/admin/sites", S.sa, { ...SC.PLANT_B, company_id: S.companyId, country_id: S.countryId });
  ok(r, 201);
  S.sites.plantB = (r.json.site ?? r.json).site_id;
});

step("7 Superadmin assigns the categories each site reports", async () => {
  for (const key of Object.keys(SC.CATEGORIES)) {
    const r = await call("PUT", `/admin/categories/${S.cats[key]}`, S.sa, { site_ids: siteIds() });
    ok(r);
  }
  const r = await withDb((db) => db.query(`SELECT site_id, COUNT(*)::int AS n FROM site_categories WHERE site_id = ANY($1) GROUP BY site_id ORDER BY site_id`, [siteIds()]));
  assert.deepEqual(r.rows.map((x) => x.n), [5, 5]);
});

// ── Phase 3 · Scope 3 boundary (client Admin) ──────────────────────────────

step("9 the Admin screens the 15 categories: a headcount estimate for Category 7, a Table II tick, a suggestion applied by hand", async () => {
  const q = `/scope3/screening?year=${SC.REPORT_YEAR}&year_type=${SC.YEAR_TYPE}`;
  const rowsOfClient = async () => Number((await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE site_id = ANY($1)`, [siteIds()]))).rows[0].n);
  const before = await rowsOfClient();

  const first = await call("GET", q, S.admin);
  ok(first);
  assert.equal(first.json.categories.length, 15);
  assert.equal(first.json.can_edit, true);
  assert.deepEqual(first.json.period, { start: `${SC.YEAR}-04-01`, end: `${SC.REPORT_YEAR}-03-31` }, "FY 2026 is April 2025 to March 2026");
  const c2 = first.json.categories.find((c) => c.n === 2);
  assert.deepEqual([c2.recorded_tco2e, c2.estimate_tco2e, c2.suggestion.status, c2.suggestion.reason], [0, null, "not_relevant", `No activity in this category in ${SC.REPORT_YEAR}`]);

  // The Admin gives the headcount; the estimate is the hand-worked commute, shown but never saved.
  // Inputs are kept per year type: this client screens its financial year (FY), not calendar 2026.
  ok(await call("PUT", "/scope3/screening/inputs", S.admin, { year: SC.REPORT_YEAR, year_type: SC.YEAR_TYPE, inputs: [{ ghg_category: 7, basis: "headcount", amount: SC.SCREENING.headcount }] }));
  const calendar = (await call("GET", `/scope3/screening?year=${SC.REPORT_YEAR}&year_type=CY`, S.admin)).json.categories.find((c) => c.n === 7);
  assert.equal(calendar.estimate_tco2e, null, "CY 2026 doesn't see the FY 2026 headcount");
  // Table II "Stakeholders" on Category 6 goes through the boundary (S3-1), status and reason unchanged.
  const six = first.json.categories.find((c) => c.n === SC.SCREENING.tick.n);
  ok(await call("PUT", `/scope3/categories/${six.n}`, S.admin, { status: six.status, reason: six.reason, relevance: { [SC.SCREENING.tick.key]: true } }));

  const r = await call("GET", q, S.admin);
  ok(r);
  const c7 = r.json.categories.find((c) => c.n === 7);
  assert.equal(c7.estimate_tco2e, tonnes(SC.screeningKg()), "120 employees × 15 km × 2 × 230 days × 0.16725 kg");
  assert.equal(c7.basis, "headcount");
  assert.equal(c7.share_pct, 100, "the only sized category");
  assert.equal(c7.suggestion.status, "included");
  assert.equal(r.json.totals.estimate_tco2e, tonnes(SC.screeningKg()));
  const c6 = r.json.categories.find((c) => c.n === SC.SCREENING.tick.n);
  assert.deepEqual(c6.relevance, { [SC.SCREENING.tick.key]: true });
  assert.deepEqual([c6.status, c6.suggestion.status, c6.suggestion.reason], [six.status, "included", "Relevant: stakeholders"]);
  assert.equal(await rowsOfClient(), before, "a screening estimate is never saved as an emission row");

  // Nothing changes without the Admin's click: Apply sends the suggestion, reason edited, through the boundary.
  assert.notEqual(c7.status, "included", "the suggestion alone changed nothing");
  ok(await call("PUT", "/scope3/categories/7", S.admin, { status: c7.suggestion.status, reason: `${c7.suggestion.reason}; refine with a commuting survey` }));
  const applied = (await call("GET", q, S.admin)).json.categories.find((c) => c.n === 7);
  assert.equal(applied.status, "included");
});

step("10 the Admin sets the boundary: 15 categories, reasons for exclusions, no Unmapped category", async () => {
  const list = await call("GET", "/scope3/categories", S.admin);
  ok(list);
  assert.equal(list.json.categories.length, 15);
  assert.equal(list.json.can_edit, true);
  for (const n of [13, 14, 15]) {
    const row = list.json.categories.find((c) => c.n === n);
    assert.equal(row.status, "not_relevant", `Category ${n} starts not relevant (D10)`);
  }
  const noReason = await call("PUT", `/scope3/categories/9`, S.admin, { status: "excluded" });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, "EXCLUSION_REASON_REQUIRED");
  for (const b of SC.BOUNDARY.set) ok(await call("PUT", `/scope3/categories/${b.n}`, S.admin, { status: b.status, reason: b.reason }));
  ok(await call("PUT", `/company/${S.companyId}/consolidation-approach`, S.admin, { consolidation_approach: SC.BOUNDARY.consolidation_approach }));

  const map = await call("GET", "/scope3/category-map", S.admin);
  ok(map);
  assert.deepEqual(map.json.unmapped, [], "every Scope 3 category the client uses has its number");
  const after = await call("GET", "/scope3/categories", S.admin);
  assert.equal(after.json.unmapped_count, 0);
  assert.equal(after.json.consolidation_approach, SC.BOUNDARY.consolidation_approach);
  for (const [key, n] of [["goods", 1], ["fera", 3], ["travel", 6]]) {
    const row = after.json.categories.find((c) => c.n === n);
    assert.deepEqual(row.mapped_categories.map((m) => m.category_id), [S.cats[key]], `Category ${n} lists the client's category`);
    assert.equal(row.status, "included", `Category ${n} in use is included`);
  }
  for (const x of SC.BOUNDARY.set) assert.deepEqual([after.json.categories.find((c) => c.n === x.n).status, after.json.categories.find((c) => c.n === x.n).reason], [x.status, x.reason]);
});

// ── Phase 4 · Factors (Superadmin) ─────────────────────────────────────────

step("11 Superadmin loads the site factors for both factor years FY 2025 uses (2024 and 2025)", async () => {
  for (const site_id of siteIds()) {
    for (const [key, f] of Object.entries(SC.FACTORS)) for (const fy of SC.FACTOR_YEARS) {
      const { cat, import: viaImport, values, ...body } = f;
      const row = { ...body, factor_value: values[fy], site_id, category_id: S.cats[cat], year: fy };
      const r = viaImport ? await call("POST", "/admin/emission-factors/bulk", S.sa, { factors: [row] }) : await call("POST", "/admin/emission-factors", S.sa, row);
      ok(r, 201);
      assert.deepEqual(r.json.warnings ?? [], [], `${key} type fits its category`);
    }
  }
});

step("12 Superadmin copies the USEEIO sector to the main site for factor year 2024 (API only, no screen yet)", async () => {
  const body = { site_id: S.sites.main, category_id: S.cats.goods, factor_ids: [S.spendLibraryFactor.emission_factor_id], year: SC.factorYearOf(SC.SPEND.row_date), company_id: S.companyId };
  const r = await call("POST", "/scope3/spend/library/copy", S.sa, body);
  ok(r, 201);
  assert.equal(r.json.copied, 1);
});

step("14 the Manager records a supplier and its own product figure", async () => {
  // The client Admin stands in for the Manager, who is invited in step 20 (suppliers are Manager and above).
  const created = await call("POST", "/suppliers", S.admin, { name: SC.SUPPLIER.name, country: SC.SUPPLIER.country });
  ok(created, 201);
  const id = created.json.supplier_id ?? created.json.supplier?.supplier_id;
  assert.ok(id, JSON.stringify(created.json));
  // A figure that isn't cradle-to-gate needs an explicit confirmation (SUPPLIER_FACTOR_BOUNDARY).
  const gate = await call("POST", `/suppliers/${id}/factors`, S.admin, { ...SC.SUPPLIER.factor, boundary: "gate_to_gate" });
  assert.equal(gate.status, 422, JSON.stringify(gate.json));
  ok(await call("POST", `/suppliers/${id}/factors`, S.admin, SC.SUPPLIER.factor), 201);
  const factors = await call("GET", `/suppliers/${id}/factors`, S.admin);
  ok(factors);
  const list = Array.isArray(factors.json) ? factors.json : (factors.json.factors ?? factors.json.data ?? []);
  assert.deepEqual(
    list.map((f) => [f.item, f.unit, Number(f.kgco2e_per_unit), f.reference_year, f.boundary]),
    [[SC.SUPPLIER.factor.item, SC.SUPPLIER.factor.unit, SC.SUPPLIER.factor.kgco2e_per_unit, SC.SUPPLIER.factor.reference_year, "cradle_to_gate"]],
  );
  S.supplierId = id;
});

// ── Phase 5 · Data-entry forms (Superadmin) ────────────────────────────────

step("15a after the next deploy the sites have the standard Category 6 form and its DEFRA factors", async () => {
  migrateAll(); // stands in for the redeploy that applies the standard Scope 3 forms
  const r = await call("GET", `/admin/column-configs/site/${S.sites.main}/category/${S.cats.travel}`, S.sa);
  ok(r);
  const forms = Array.isArray(r.json) ? r.json : (r.json.columnConfigs ?? r.json.data ?? [r.json]);
  assert.ok(forms.length >= 1, "a Category 6 form exists");
  const factors = await withDb((db) => db.query(`SELECT factor_value::float8 AS v FROM emission_factors WHERE site_id = $1 AND category_id = $2 AND year = $3 AND emission_category_name = $4`, [S.sites.main, S.cats.travel, SC.factorYearOf(SC.TRAVEL.date), SC.FLIGHT.name]));
  assert.equal(factors.rows[0]?.v, SC.FLIGHT.kg_per_pkm);
});

// The methods the Category 6 form offers, most specific first, with the units each takes (01-contracts §6).
const TRAVEL_METHODS = [
  { method: "distance_based", units: ["passenger.km", "vehicle.km", "night"] },
  { method: "fuel_based", units: ["litre"] },
  { method: "spend_based", units: ["INR", "USD"] },
];

pendingStep("16-17 each Scope 3 form fixes its method for this client", "S3-3", () => hasColumn("column_config", "method_options"), async () => {
  const forms = await withDb((db) => db.query(`SELECT pk_id FROM column_config WHERE site_id = $1 AND category_id = $2 ORDER BY pk_id`, [S.sites.main, S.cats.travel]));
  assert.ok(forms.rows.length >= 1, "the standard Category 6 form is there (15a)");
  for (const { pk_id } of forms.rows) ok(await call("PUT", `/admin/column-configs/${pk_id}`, S.sa, { method_options: TRAVEL_METHODS }));
  const stored = await withDb((db) => db.query(`SELECT method_options FROM column_config WHERE pk_id = $1`, [forms.rows[0].pk_id]));
  assert.deepEqual(stored.rows[0].method_options, TRAVEL_METHODS);
  // Only a Superadmin sets a form's methods.
  assert.equal((await call("PUT", `/admin/column-configs/${forms.rows[0].pk_id}`, S.admin, { method_options: TRAVEL_METHODS })).status, 403);
});

pendingStep("18 forms pass the form check and are published", "SE-4", async () => (await call("GET", "/admin/column-configs/0/check", S.sa)).status !== 404, async () => {});

// ── Phase 6 · People (client Admin) ────────────────────────────────────────

step("20 the Admin invites a Manager for both sites and a User per site", async () => {
  const sitesOf = { manager: siteIds(), userMain: [S.sites.main], userPlantB: [S.sites.plantB] };
  for (const [key, p] of Object.entries(SC.PEOPLE)) {
    const r = await call("POST", "/company-admin/users", S.admin, { name: p.name, email: p.email, password: p.password, role: p.role, site_ids: sitesOf[key] });
    ok(r, 201);
    S.people[key] = await login(p.email, p.password);
  }
  // A User gets the categories of their sites when invited (so sites and categories come first).
  const cats = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM user_categories WHERE user_id = $1`, [S.people.userMain.user.user_id]));
  assert.equal(cats.rows[0].n, 5);
});

// ── Monthly cycle · Users enter, the Manager reviews ───────────────────────

const twinsOf = (json) => [json.fera_emission, ...(json.fera_emissions ?? []), json.td_loss_emission].filter(Boolean);

step("25 Users enter the month: each row's tCO₂e and Category 3 twins match the hand-worked figures", async () => {
  for (const e of SC.ENTRIES) {
    const r = await call("POST", "/user/emissions", S.people[e.who], {
      site_id: S.sites[e.site],
      category_id: S.cats[e.cat],
      date_of_reporting: e.date,
      activity_data_unit: e.unit,
      activity_data: { emission_category: e.activity, activity_value: String(e.value) },
    });
    ok(r, 201);
    const want = SC.expectedFor(e);
    assert.equal(Number(r.json.emission.total_emission), tonnes(want.kg), `${e.ref} tCO₂e`);
    assert.equal(r.json.emission.status, "pending");
    const twins = await withDb((db) => db.query(`SELECT pk_id, scope3_sub, total_emission::float8 AS t, status FROM emission WHERE fera_linked_id = $1 OR (pk_id <> $1 AND pk_id IN (SELECT fera_linked_id FROM emission WHERE pk_id = $1)) ORDER BY scope3_sub`, [r.json.emission.pk_id]));
    const got = Object.fromEntries(twins.rows.map((x) => [x.scope3_sub, x.t]));
    const exp = Object.fromEntries(Object.entries(want.twins).map(([k, kg]) => [k, tonnes(kg)]));
    assert.deepEqual(got, exp, `${e.ref} Category 3 twins; warnings: ${JSON.stringify(r.json.warnings)}`);
    S.rows[e.ref] = { id: r.json.emission.pk_id, twinIds: twins.rows.map((x) => x.pk_id), e, want };
  }
});

step("25b a Category 6 flight through the standard form: travellers × distance × the DEFRA factor", async () => {
  const T = SC.TRAVEL;
  const r = await call("POST", "/user/emissions", S.people[T.who], {
    site_id: S.sites[T.site],
    category_id: S.cats.travel,
    date_of_reporting: T.date,
    activity_data_unit: SC.FLIGHT.unit,
    activity_data: { emission_category: SC.FLIGHT.name, "Trip mode": "Air", "Trip class": "Domestic, average passenger", "Radiative forcing": "With RF", Travellers: String(T.travellers), "Distance (km)": String(T.distance_km), "Trip ref": "WF-1" },
  });
  ok(r, 201);
  assert.equal(Number(r.json.emission.total_emission), tonnes(SC.travelKg()));
  S.rows[T.ref] = { id: r.json.emission.pk_id, twinIds: [] };
});

step("25c a Category 1 spend row in INR: converted on the invoice date and deflated to the factor's price year", async () => {
  await withDb((db) =>
    db.query(`INSERT INTO fx_rate (currency, date, rate_to_usd, source) VALUES ('INR', $1, $2, 'ci-workflow') ON CONFLICT DO NOTHING`, [SC.SPEND.invoice_date, SC.SPEND.inr_per_usd]),
  );
  const copied = await withDb((db) => db.query(`SELECT emission_category_name, factor_value::float8 AS v, price_base_year FROM emission_factors WHERE site_id = $1 AND category_id = $2`, [S.sites.main, S.cats.goods]));
  const factor = copied.rows[0];
  const base = await withDb((db) => db.query(`SELECT "index"::float8 AS i FROM price_deflator WHERE country = 'US' AND year = $1`, [factor.price_base_year]));
  const r = await call("POST", "/user/emissions", S.people.userMain, {
    site_id: S.sites.main,
    category_id: S.cats.goods,
    date_of_reporting: SC.SPEND.row_date,
    activity_data: { emission_category: factor.emission_category_name, "@method": "spend_based", spent_value: String(SC.SPEND.amount_inr), currency: "INR" },
    extra_data: { invoice_date: SC.SPEND.invoice_date },
  });
  ok(r, 201);
  assert.deepEqual(r.json.warnings ?? [], []);
  const kg = SC.spendKg({ factor_value: factor.v, base_index: base.rows[0].i, spend_index: SC.SPEND.deflator_2025 });
  assert.equal(Number(r.json.emission.total_emission), tonnes(kg));
  S.spendKg = kg;
  S.rows["spend-jun"] = { id: r.json.emission.pk_id, twinIds: [] };
});

step("25d people stay inside their own sites", async () => {
  const e = SC.ENTRIES[0];
  const r = await call("POST", "/user/emissions", S.people.userMain, { site_id: S.sites.plantB, category_id: S.cats[e.cat], date_of_reporting: e.date, activity_data_unit: e.unit, activity_data: { emission_category: e.activity, activity_value: "1" } });
  assert.equal(r.status, 403);
  assert.equal((await call("PUT", `/user/emissions/${S.rows[e.ref].id}/approve`, S.people.userMain)).status, 403, "a User can't approve");
});

step("25f a Category 1 purchase with the supplier's own figure: quantity × the supplier's figure, the supplier on the row", async () => {
  const P = SC.SUPPLIER.purchase;
  const r = await call("POST", "/user/emissions", S.people.userMain, {
    site_id: S.sites.main,
    category_id: S.cats.goods,
    date_of_reporting: P.date,
    activity_data_unit: P.unit,
    activity_data: { emission_category: SC.SUPPLIER.factor.item, "@method": "supplier_specific", activity_value: String(P.quantity) },
    supplier_id: S.supplierId,
  });
  ok(r, 201);
  assert.equal(Number(r.json.emission.total_emission), tonnes(P.kg));
  const row = await withDb((db) => db.query(`SELECT supplier_id, method, data_type, total_kgco2e::float8 AS kg, emission_factor_snapshot AS snap FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]));
  const got = row.rows[0];
  assert.equal(got.supplier_id, S.supplierId);
  assert.equal(got.method, "supplier_specific");
  assert.equal(got.kg, P.kg);
  assert.equal(got.snap.factor_type, "supplier");
  assert.equal(Number(got.snap.factor_value), SC.SUPPLIER.factor.kgco2e_per_unit);
  assert.equal(got.snap.reference_year, SC.SUPPLIER.factor.reference_year);
  // Another client's supplier id reads as unknown (tenant isolation through the engine). Another
  // month, so the duplicate check doesn't answer first.
  const other = await call("POST", "/user/emissions", S.people.userMain, {
    site_id: S.sites.main,
    category_id: S.cats.goods,
    date_of_reporting: `${SC.YEAR}-08-31`,
    activity_data_unit: P.unit,
    activity_data: { emission_category: SC.SUPPLIER.factor.item, "@method": "supplier_specific", activity_value: "1" },
    supplier_id: S.supplierId + 100000,
  });
  assert.equal(other.status, 400, JSON.stringify(other.json));
  assert.equal(other.json.field, "supplier_id");
  S.supplierKg = P.kg;
  S.rows["supplier-jul"] = { id: r.json.emission.pk_id, twinIds: [] };
});

pendingStep("25e every new row records its method and data quality", "S3-3", () => hasColumn("emission", "method"), async () => {
  // Scope 1 and Scope 2 rows carry no method; every Scope 3 row (twins included) has one and a quality.
  const r = await withDb((db) =>
    db.query(
      `SELECT COUNT(*)::int AS n FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE e.site_id = ANY($1) AND c.scope = 'Scope 3' AND (e.method IS NULL OR e.dq IS NULL OR e.data_type IS NULL)`,
      [siteIds()],
    ),
  );
  assert.equal(r.rows[0].n, 0);
  const notScope3 = await withDb((db) =>
    db.query(
      `SELECT COUNT(*)::int AS n FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE e.site_id = ANY($1) AND c.scope <> 'Scope 3' AND e.method IS NOT NULL`,
      [siteIds()],
    ),
  );
  assert.equal(notScope3.rows[0].n, 0, "Scope 1 and 2 rows record no method");
  const flight = await withDb((db) => db.query(`SELECT method, dq FROM emission WHERE pk_id = $1`, [S.rows[SC.TRAVEL.ref].id]));
  assert.equal(flight.rows[0].method, "distance_based", "the form's first method");
  assert.equal(flight.rows[0].dq.source, "auto");
  const spend = await withDb((db) => db.query(`SELECT method, dq FROM emission WHERE pk_id = $1`, [S.rows["spend-jun"].id]));
  assert.equal(spend.rows[0].method, "spend_based");
  assert.equal(spend.rows[0].dq.reliability, 3, "spend data is poor on reliability (contracts §3)");
});

step("26 the Manager approves, rejects the wrong row and leaves one pending", async () => {
  const toApprove = [];
  for (const [ref, row] of Object.entries(S.rows)) {
    const review = row.e?.review ?? "approve";
    if (review === "approve") toApprove.push(row.id);
    if (review === "reject") ok(await call("PUT", `/user/emissions/${row.id}/reject`, S.people.manager, { comment: "Litres look like a typo; check the bill." }));
  }
  ok(await call("PUT", "/user/emissions/bulk-approve", S.people.manager, { ids: toApprove }));
  const statuses = await withDb((db) => db.query(`SELECT status, COUNT(*)::int AS n FROM emission WHERE site_id = ANY($1) GROUP BY status ORDER BY status`, [siteIds()]));
  const by = Object.fromEntries(statuses.rows.map((x) => [x.status, x.n]));
  // Twins follow their parent row.
  const twins = (refs) => refs.reduce((n, ref) => n + 1 + S.rows[ref].twinIds.length, 0);
  assert.equal(by.rejected, twins(["diesel-jun-wrong"]));
  assert.equal(by.pending, twins(["diesel-mar-pending"]));
  assert.equal(by.approved, Object.keys(S.rows).filter((ref) => !["diesel-jun-wrong", "diesel-mar-pending"].includes(ref)).reduce((n, ref) => n + 1 + S.rows[ref].twinIds.length, 0));
});

// ── Reports ────────────────────────────────────────────────────────────────

/** Approved kg by scope and by Scope 3 category, from the scenario alone. */
function expectedTotals() {
  const approved = SC.ENTRIES.filter((e) => e.review === "approve");
  const kg = { s1: 0, s2: 0, cat: { 1: S.spendKg + S.supplierKg, 3: 0, 6: SC.travelKg() } };
  const t = { s1: 0, s2: 0, cat3: 0 }; // sums of stored 2-dp rows
  for (const e of approved) {
    const w = SC.expectedFor(e);
    if (e.cat === "fuel") (kg.s1 += w.kg), (t.s1 += tonnes(w.kg));
    if (e.cat === "electricity") (kg.s2 += w.kg), (t.s2 += tonnes(w.kg));
    for (const v of Object.values(w.twins)) (kg.cat[3] += v), (t.cat3 += tonnes(v));
  }
  return { kg, t };
}
const r2 = (n) => Math.round(n * 100) / 100;

step("26a the GHG report's Scope 3 table: every category's status, and approved rows only (kg summed, then rounded)", async () => {
  const { kg } = expectedTotals();
  const r = await call("GET", `/reports/ghg/scope3?siteIds=${siteIds().join(",")}&year=${SC.REPORT_YEAR}&yearType=${SC.YEAR_TYPE}`, S.people.manager);
  ok(r);
  assert.equal(r.json.company_id, S.companyId);
  assert.equal(r.json.consolidation_approach, SC.BOUNDARY.consolidation_approach);
  const brief = JSON.stringify(r.json.rows.map((x) => [x.n, x.tco2e, x.status]));
  for (const n of [1, 3, 6]) assert.equal(r.json.rows.find((x) => x.n === n).tco2e, tonnes(kg.cat[n]), `Category ${n} in ${brief}`);
  assert.equal(r.json.total_tco2e, tonnes(kg.cat[1] + kg.cat[3] + kg.cat[6]));
  for (const b of SC.BOUNDARY.set) {
    const row = r.json.rows.find((x) => x.n === b.n);
    assert.deepEqual([row.status, row.reason], [b.status, b.reason]);
  }
  const unmapped = r.json.rows.find((x) => x.n === null);
  assert.equal(unmapped.tco2e, 0);
  // The GWP sets disclosed are exactly those of the factors behind approved Scope 3 rows
  // (DEFRA travel factors are AR5; the USEEIO library rows carry none, so they add nothing).
  const used = await withDb((db) => db.query(`SELECT DISTINCT e.emission_factor_snapshot->>'gwp_set' AS g FROM emission e JOIN category c USING (category_id) WHERE e.site_id = ANY($1) AND e.status = 'approved' AND c.scope = 'Scope 3' AND e.emission_factor_snapshot->>'gwp_set' IS NOT NULL ORDER BY 1`, [siteIds()]));
  assert.deepEqual(r.json.gwp_sets, used.rows.map((x) => x.g));
});

step("26b the GHG report's scope totals: Scope 1, 2 and 3 from approved rows only", async () => {
  const { t } = expectedTotals();
  const r = await call("POST", "/user/ghg/tables", S.people.manager, { siteIds: siteIds(), year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, frequency: "yearly" });
  ok(r);
  const totals = r.json.totals?.[String(SC.REPORT_YEAR)];
  assert.ok(totals, JSON.stringify(Object.keys(r.json)));
  assert.equal(r2(totals.scope1), r2(t.s1), "Scope 1");
  assert.equal(r2(totals.scope2), r2(t.s2), "Scope 2");
  const s3rows = r2(t.cat3 + tonnes(S.spendKg) + tonnes(S.supplierKg) + tonnes(SC.travelKg()));
  assert.equal(r2(totals.scope3), s3rows, "Scope 3");
  assert.equal(r2(totals.total), r2(t.s1 + t.s2 + s3rows), "Total");
});

step("26d supplier coverage for reports: the share of Category 1 and 2 from supplier data, and the top suppliers", async () => {
  const q = `year=${SC.REPORT_YEAR}&year_type=${SC.YEAR_TYPE}`;
  const r = await call("GET", `/suppliers/coverage?${q}`, S.people.manager);
  ok(r);
  const all = S.spendKg + S.supplierKg;
  assert.equal(r.json.cat12_tco2e, tonnes(all));
  assert.equal(r.json.supplier_specific_tco2e, tonnes(S.supplierKg));
  assert.equal(r.json.hybrid_tco2e, 0);
  assert.equal(r.json.coverage_pct, Math.round((S.supplierKg / all) * 1000) / 10);
  assert.deepEqual(r.json.top_suppliers.map((x) => [x.supplier_id, x.tco2e, x.rows]), [[S.supplierId, tonnes(S.supplierKg), 1]]);
});

step("26c tenant isolation: another client's Admin and Manager see none of this client's data", async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries(SC.OTHER_CLIENT)) f.append(k, v);
  const created = await call("POST", "/admin/onboarding/company", S.sa, f);
  ok(created, 201);
  const other = await login(SC.OTHER_CLIENT.email, SC.OTHER_CLIENT.password);
  assert.equal((await call("GET", `/reports/ghg/scope3?siteIds=${S.sites.main}&year=${SC.REPORT_YEAR}&yearType=${SC.YEAR_TYPE}`, other)).status, 403);
  assert.equal((await call("POST", "/user/ghg/tables", other, { siteIds: siteIds(), year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, frequency: "yearly" })).status, 403);
  assert.equal((await call("GET", `/scope3/categories?company_id=${S.companyId}`, other)).status, 404);
  assert.equal((await call("PUT", `/user/emissions/${S.rows["diesel-mar-pending"].id}/approve`, other)).status, 403);
  const theirs = await call("GET", `/user/emissions?siteId=${S.sites.main}`, other);
  const leaked = theirs.status === 200 ? JSON.stringify(theirs.json).includes(`"pk_id":${S.rows["diesel-apr"].id},`) : false;
  assert.ok(theirs.status === 403 || !leaked, `GET /user/emissions → ${theirs.status}`);
});

// ── Phase 7 · Yearly inputs (client Admin) ─────────────────────────────────

step("24 the Admin freezes the base year: the preview shows the approved Scope 3 per category", async () => {
  const { kg } = expectedTotals();
  const preview = await call("GET", `/scope3/base-year/preview?base_year=${SC.REPORT_YEAR}&year_type=${SC.YEAR_TYPE}`, S.admin);
  ok(preview);
  for (const n of [1, 3, 6]) assert.equal(preview.json.categories.find((c) => c.n === n).tco2e, tonnes(kg.cat[n]), `Category ${n}`);
  assert.equal(preview.json.total_tco2e, tonnes(kg.cat[1] + kg.cat[3] + kg.cat[6]));
  assert.equal((await call("PUT", "/scope3/base-year", S.people.manager, { base_year: SC.REPORT_YEAR, year_type: SC.YEAR_TYPE })).status, 403, "only the Admin freezes it");
  ok(await call("PUT", "/scope3/base-year", S.admin, { base_year: SC.REPORT_YEAR, year_type: SC.YEAR_TYPE }));
  const got = await call("GET", "/scope3/base-year", S.people.manager);
  ok(got);
  assert.equal(got.json.base_year?.base_year ?? got.json.base_year, SC.REPORT_YEAR);
});

// ── Review workflow v2 (S3-15 parts 3–4): drafts, submit, close the month ──

const V2 = SC.REVIEW_V2;
const v2Rows = {};
const lockBody = () => ({ site_id: S.sites.main, year: V2.year, month: V2.month });

step("29a the Superadmin turns review workflow v2 on; a User's entries are Drafts (twins too) the Manager doesn't see", async () => {
  ok(await call("PUT", `/admin/companies/${S.companyId}`, S.sa, { review_workflow_v2: true }));
  for (const e of V2.entries) {
    const r = await call("POST", "/user/emissions", S.people.userMain, {
      site_id: S.sites.main,
      category_id: S.cats[e.cat],
      date_of_reporting: e.date,
      activity_data_unit: e.unit,
      activity_data: { emission_category: e.activity, activity_value: String(e.value) },
    });
    ok(r, 201);
    assert.equal(r.json.emission.status, "draft", e.ref);
    assert.equal(Number(r.json.emission.total_emission), tonnes(SC.expectedFor(e).kg), `${e.ref} tCO₂e`);
    const twins = await withDb((db) => db.query(`SELECT pk_id, status::text AS status FROM emission WHERE fera_linked_id = $1 OR pk_id = (SELECT fera_linked_id FROM emission WHERE pk_id = $1)`, [r.json.emission.pk_id]));
    assert.equal(twins.rows.length, Object.keys(SC.expectedFor(e).twins).length, `${e.ref} twins`);
    assert.ok(twins.rows.every((t) => t.status === "draft"), `${e.ref} twins are Drafts`);
    v2Rows[e.ref] = r.json.emission.pk_id;
  }
  const list = await call("GET", `/user/emissions?siteId=${S.sites.main}&year=${V2.year}&month=${V2.month}&page=1&limit=50`, S.people.manager);
  ok(list);
  assert.equal(list.json.total, 0, "the Manager's list has none of the Drafts");
  const mm = await call("GET", `/user/my-month?month=${V2.period}`, S.people.userMain);
  ok(mm);
  assert.equal(mm.json.review_workflow_v2, true);
  const fuel = mm.json.sites.find((x) => x.site_id === S.sites.main).categories.find((c) => c.category_id === S.cats.fuel);
  assert.equal(fuel.status, "draft");
  assert.equal(fuel.total_emission, 0, "a Draft adds nothing to My month");
});

step("29b the Manager can't close the month while Drafts and missing categories are left", async () => {
  const st = await call("GET", `/periods/lock?year=${V2.year}&month=${V2.month}&site_id=${S.sites.main}`, S.people.manager);
  ok(st);
  const left = Object.fromEntries(st.json.left.map((l) => [l.category_id, l.reason]));
  assert.deepEqual(left, { [S.cats.fuel]: "draft", [S.cats.electricity]: "draft", [S.cats.travel]: "missing", [S.cats.goods]: "missing" });
  const refused = await call("POST", "/periods/lock", S.people.manager, lockBody());
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, "PERIOD_INCOMPLETE");
});

step("29c the User submits the month and marks the rest Nothing this month; the Manager gets one notification", async () => {
  const ids = Object.values(v2Rows);
  const r = await call("POST", "/user/emissions/submit", S.people.userMain, { ids });
  ok(r);
  assert.deepEqual(r.json, { submitted: [...ids].sort((a, b) => a - b), refused: [] });
  const statuses = await withDb((db) => db.query(`SELECT DISTINCT status::text AS s FROM emission WHERE site_id = $1 AND date_of_reporting = $2`, [S.sites.main, V2.entries[0].date]));
  assert.deepEqual(statuses.rows.map((x) => x.s), ["pending"], "rows and twins are Pending");
  const notes = await withDb((db) => db.query(`SELECT user_id FROM notification WHERE type = 'draft_submitted'`));
  assert.deepEqual(notes.rows.map((n) => n.user_id), [S.people.manager.user.user_id]);
  for (const cat of ["travel", "goods"]) {
    ok(await call("POST", "/user/my-month/nothing", S.people.userMain, { site_id: S.sites.main, category_id: S.cats[cat], month: V2.period }));
  }
});

step("29d the Manager approves and closes the month: every category done, the totals are the hand-worked ones", async () => {
  ok(await call("PUT", "/user/emissions/bulk-approve", S.people.manager, { ids: Object.values(v2Rows) }));
  const st = await call("GET", `/periods/lock?year=${V2.year}&month=${V2.month}&site_id=${S.sites.main}`, S.people.manager);
  assert.deepEqual(st.json.left, []);
  const states = Object.fromEntries(st.json.sites[0].categories.map((c) => [c.category_id, c.state]));
  assert.deepEqual(states, { [S.cats.fuel]: "approved", [S.cats.electricity]: "approved", [S.cats.travel]: "nothing", [S.cats.goods]: "nothing" });
  assert.equal(st.json.sites[0].scope3.find((c) => c.n === 3).data, true, "the twins are Category 3 data");
  const lock = await call("POST", "/periods/lock", S.people.manager, lockBody());
  ok(lock);
  assert.equal(lock.json.sites[0].locked, true);
  const mm = await call("GET", `/user/my-month?month=${V2.period}`, S.people.userMain);
  const site = mm.json.sites.find((x) => x.site_id === S.sites.main);
  assert.equal(site.locked, true);
  for (const e of V2.entries) {
    const c = site.categories.find((x) => x.category_id === S.cats[e.cat]);
    assert.equal(c.status, "approved", e.ref);
    assert.equal(c.total_emission, tonnes(SC.expectedFor(e).kg), `${e.ref} in My month`);
  }
  const audit = await withDb((db) => db.query(`SELECT action FROM audit_log WHERE entity_type = 'scope3_period_lock'`));
  assert.deepEqual(audit.rows.map((a) => a.action), ["lock"]);
});

step("29e a closed month refuses every write (PERIOD_LOCKED); reopening needs a reason and opens it again", async () => {
  const e = V2.entries[0];
  const late = { site_id: S.sites.main, category_id: S.cats[e.cat], date_of_reporting: V2.late_date, activity_data_unit: e.unit, activity_data: { emission_category: e.activity, activity_value: "10" } };
  const refused = await call("POST", "/user/emissions", S.people.userMain, late);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, "PERIOD_LOCKED");
  assert.equal((await call("DELETE", `/user/emissions/${v2Rows[e.ref]}`, S.people.manager)).json.code, "PERIOD_LOCKED");
  assert.equal((await call("PUT", "/user/emissions/bulk-reject", S.people.manager, { ids: [v2Rows[e.ref]], comment: "late" })).json.code, "PERIOD_LOCKED");
  const short = await call("POST", "/periods/unlock", S.people.manager, { ...lockBody(), reason: "oops" });
  assert.equal(short.status, 400);
  assert.equal(short.json.code, "UNLOCK_REASON_REQUIRED");
  const reopened = await call("POST", "/periods/unlock", S.people.manager, { ...lockBody(), reason: "A late fuel invoice arrived" });
  ok(reopened);
  assert.equal(reopened.json.sites[0].locked, false);
  assert.equal(reopened.json.sites[0].reopened.reason, "A late fuel invoice arrived");
  const again = await call("POST", "/user/emissions", S.people.userMain, late);
  ok(again, 201);
  assert.equal(again.json.emission.status, "draft");
  assert.equal(Number(again.json.emission.total_emission), tonnes(10 * SC.FACTORS.diesel.values[SC.factorYearOf(V2.late_date)]));
});

// ── KPI tracking (KPI-13: K1–K8, D17 topic owners, D18 Superadmin parity) ──
// The same client, its FY 2026. Figures are worked by hand in scenario.cjs (KPI).

const K = SC.KPI;
const kq = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const kpiIds = {};
const kv = {};
/** The emission figures a KPI change must never move: the GHG tables and the Scope 3 report, volatile keys dropped. */
const emissionReports = async () => {
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !/^(generated_?at|generatedAt|created_at|updated_at)$/i.test(k)).map((k) => [k, strip(v[k])])) : v);
  const tables = await call("POST", "/user/ghg/tables", S.people.manager, { siteIds: siteIds(), year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, frequency: "yearly" });
  const scope3 = await call("GET", `/reports/ghg/scope3?siteIds=${siteIds().join(",")}&year=${SC.REPORT_YEAR}&yearType=${SC.YEAR_TYPE}`, S.people.manager);
  ok(tables);
  ok(scope3);
  const rows = await kq(`SELECT pk_id, total_emission::text AS t, status::text AS s FROM emission WHERE site_id = ANY($1::int[]) ORDER BY pk_id`, [siteIds()]);
  return JSON.stringify(strip({ tables: tables.json, scope3: scope3.json, rows }));
};

step("K0 before KPI tracking: the emission reports this client has (to compare once KPIs are on and off)", async () => {
  S.kpiEmissionsBefore = await emissionReports();
  S.kpiTables = JSON.parse(S.kpiEmissionsBefore).tables;
});

step("K1 the Superadmin switches KPI tracking on for this client; the other client stays off and sees nothing", async () => {
  ok(await call("PUT", `/admin/companies/${S.companyId}`, S.sa, { kpi_tracking_enabled: true }));
  assert.deepEqual((await call("GET", "/kpi/status", S.admin)).json, { enabled: true, setup_completed: false });
  const note = await kq(`SELECT link FROM notification WHERE user_id = $1 AND type = 'kpi_enabled'`, [S.admin.user.user_id]);
  assert.deepEqual(note.map((n) => n.link), ["/kpi/setup"]);
  S.otherAdmin = await login(SC.OTHER_CLIENT.email, SC.OTHER_CLIENT.password);
  assert.deepEqual((await call("GET", "/kpi/status", S.otherAdmin)).json, { enabled: false, setup_completed: false });
  const off = await call("GET", "/kpi/setup", S.otherAdmin);
  assert.deepEqual([off.status, off.json.code], [403, "KPI_TRACKING_OFF"]);
  assert.equal((await call("GET", `/kpi/setup?company_id=${S.companyId}`, S.otherAdmin)).status, 404, "another client's id");
});

step("K2 the Admin sets up GRI + BRSR + ESRS, E3 not material with a reason, the KPIs, and finishes", async () => {
  const setup = (await call("GET", "/kpi/setup", S.admin)).json;
  // Monthly emission rows carry no year type, so the prefill is CY here; the Admin picks FY like the reports.
  assert.ok(["CY", "FY"].includes(setup.settings.year_type));
  ok(await call("PUT", "/kpi/setup", S.admin, { settings: { year_type: SC.YEAR_TYPE, first_year: K.report_year } }));
  const fw = K.frameworks.map((code) => (setup.available_frameworks.find((f) => f.code === code && f.default_for_new) ?? setup.available_frameworks.find((f) => f.code === code)).id);
  ok(await call("PUT", "/kpi/setup", S.admin, { frameworks: fw }));
  const noReason = await call("PUT", "/kpi/setup", S.admin, { material_topics: [{ esrs_topic: K.not_material.esrs_topic, material: false }] });
  assert.equal(noReason.json.code, "KPI_REASON_REQUIRED");
  ok(await call("PUT", "/kpi/setup", S.admin, { material_topics: [{ esrs_topic: K.not_material.esrs_topic, material: false, reason: K.not_material.reason }] }));
  const after = (await call("GET", "/kpi/setup", S.admin)).json;
  const lib = (await call("GET", "/kpi/catalogue", S.admin)).json;
  const defs = lib.definitions ?? lib.kpis ?? [];
  for (const code of K.selected) kpiIds[code] = (defs.find((d) => d.code === code) ?? {}).id;
  assert.ok(K.selected.every((c) => kpiIds[c]), JSON.stringify(Object.keys(lib)));
  const kpis = [
    ...K.selected.map((code) => ({ kpi_definition_id: kpiIds[code], selected: true })),
    ...after.recommended.filter((id) => !Object.values(kpiIds).includes(id)).map((id) => ({ kpi_definition_id: id, selected: false, reason_excluded: K.left_out_reason })),
  ];
  const saved = await call("PUT", "/kpi/setup", S.admin, { kpis, settings: { year_type: "FY", due_day: 15, complete: true } });
  ok(saved);
  assert.ok(saved.json.settings.setup_completed_at);
  assert.deepEqual(saved.json.frameworks.map((f) => f.code), K.frameworks);
  assert.deepEqual(saved.json.kpis.filter((k) => k.selected).map((k) => k.code).sort(), [...K.selected].sort());
  assert.deepEqual((await call("GET", "/kpi/status", S.people.userMain)).json, { enabled: true, setup_completed: true });
});

step("D17 who enters what, by topic: water and waste at the main site, water at Plant B moved from the Manager to its User", async () => {
  const main = S.sites.main;
  const b = S.sites.plantB;
  const mgr = S.people.manager.user.user_id;
  const r = await call("PUT", "/kpi/setup", S.admin, {
    topic_assignments: [
      { site_id: main, topic: "water", owner_user_id: S.people.userMain.user.user_id, reviewer_user_id: mgr },
      { site_id: main, topic: "waste", owner_user_id: S.people.userMain.user.user_id },
      { site_id: b, topic: "water", owner_user_id: mgr },
    ],
  });
  ok(r);
  assert.deepEqual(r.json.topics_in_use.map((t) => t.topic), ["climate", "water", "waste"]);
  // The Users drawer's "KPI topics" field: Plant B's User takes water there; the toast says from whom.
  const moved = await call("PATCH", `/company-admin/users/${S.people.userPlantB.user.user_id}`, S.admin, { kpi_topics: ["water"] });
  ok(moved);
  assert.deepEqual(moved.json.kpi_topic_moves.map((m) => [m.site_id, m.topic, m.from_user_id]), [[b, "water", mgr]]);
  const owners = (await call("GET", "/kpi/setup", S.admin)).json.topic_assignments.map((t) => [t.site_id, t.topic, t.owner_user_id]);
  assert.deepEqual(owners, [[main, "water", S.people.userMain.user.user_id], [b, "water", S.people.userPlantB.user.user_id], [main, "waste", S.people.userMain.user.user_id]]);
  // My KPIs follows: Uma owes water and waste at the main site; Bala water at Plant B only; nobody else's.
  const uma = (await call("GET", `/kpi/my?period=${K.month}`, S.people.userMain)).json.items.filter((i) => i.group !== "auto");
  assert.deepEqual([...new Set(uma.map((i) => `${i.code}@${i.site_id}`))].sort(), [`WATER_DISCHARGE@${main}`, `WATER_WITHDRAWAL@${main}`]);
  assert.ok(uma.every((i) => i.assigned_via === "topic" && i.topic_label === "Water"));
  const bala = (await call("GET", `/kpi/my?period=${K.month}`, S.people.userPlantB)).json.items.filter((i) => i.group !== "auto");
  assert.ok(bala.length && bala.every((i) => i.site_id === b && i.topic === "water"));
  const notMine = await call("PUT", "/kpi/values", S.people.userPlantB, { items: [{ kpi_code: K.withdrawal.kpi, site_id: main, period_start: K.withdrawal.period_start, value_numeric: 1, unit: "kL" }] });
  assert.equal(notMine.json.results[0].code, "KPI_NOT_ASSIGNED", "the main site's water is Uma's");
});

step("K3 the contributor enters water and waste with evidence and submits; the reviewer is told", async () => {
  const items = [K.withdrawal, K.discharge, K.waste].map((x) => ({ kpi_code: x.kpi, site_id: S.sites.main, period_start: x.period_start, value_numeric: x.value, unit: x.unit }));
  const r = await call("PUT", "/kpi/values", S.people.userMain, { items });
  ok(r);
  assert.equal(r.json.saved, 3, JSON.stringify(r.json.results));
  for (const [i, x] of [K.withdrawal, K.discharge, K.waste].entries()) {
    const v = r.json.results[i].value;
    assert.deepEqual([v.status, v.value_canonical], ["draft", x.canonical], x.kpi);
    kv[x.kpi] = v.id;
    ok(await call("POST", `/kpi/values/${v.id}/evidence`, S.people.userMain, K.evidence), 201);
  }
  const sub = await call("POST", "/kpi/values/submit", S.people.userMain, { ids: Object.values(kv) });
  ok(sub);
  assert.deepEqual(sub.json.refused, []);
  const notes = await kq(`SELECT user_id, link FROM notification WHERE type = 'kpi_submitted'`);
  assert.deepEqual(notes.map((n) => [n.user_id, n.link]), [[S.people.manager.user.user_id, "/data/approvals?view=kpi"]]);
});

step("K4 auto Scope 1 and 2 equal the GHG report's figures for the same year (step 26b's report)", async () => {
  const r = await call("POST", `/kpi/auto/refresh?year=${K.report_year}`, S.admin);
  ok(r);
  const totals = S.kpiTables.totals[String(SC.REPORT_YEAR)];
  for (const [code, key] of [["GHG_SCOPE1", "scope1"], ["GHG_SCOPE2_LB", "scope2"]]) {
    const vals = (await call("GET", `/kpi/values?kpi=${code}&frequency=annual`, S.admin)).json.values.filter((v) => v.period_start === `${SC.YEAR}-04-01`);
    assert.ok(vals.length >= 1, code);
    assert.ok(vals.every((v) => v.source === "auto" && v.status === "approved"));
    const sum = vals.reduce((a, v) => a + v.value_canonical, 0);
    assert.equal(r2(sum), r2(totals[key]), `${code}: Σ sites = the report's ${key}`);
  }
  // KPI tracking on and auto values written: the emission figures haven't moved.
  assert.equal(await emissionReports(), S.kpiEmissionsBefore);
});

step("K5 the Manager approves the ready values, sends one back, the fix comes back, and April closes at the main site", async () => {
  const mgr = S.people.manager;
  const rej = await call("PUT", "/kpi/values/reject", mgr, { ids: [kv[K.discharge.kpi]], reason: K.discharge.reject_reason });
  ok(rej);
  assert.deepEqual(rej.json.updated, [kv[K.discharge.kpi]]);
  const appr = await call("PUT", "/kpi/values/approve", mgr, { ids: [kv[K.withdrawal.kpi], kv[K.waste.kpi], kv[K.discharge.kpi]], only_ready: true });
  ok(appr);
  assert.deepEqual(appr.json.updated.sort(), [kv[K.withdrawal.kpi], kv[K.waste.kpi]].sort());
  assert.deepEqual(appr.json.refused.map((x) => x.code), ["KPI_NOT_PENDING"], "the sent-back one");
  const back = await kq(`SELECT meta->>'reason' AS reason FROM notification WHERE type = 'kpi_rejected' AND user_id = $1`, [S.people.userMain.user.user_id]);
  assert.deepEqual(back.map((b) => b.reason), [K.discharge.reject_reason]);
  // The lock refuses while the sent-back value is left.
  const body = { ...K.lock, site_id: S.sites.main };
  const refused = await call("POST", "/kpi/periods/lock", mgr, body);
  assert.deepEqual([refused.status, refused.json.code, refused.json.details.left.map((l) => [l.code, l.reason, l.owner_user_id])], [422, "KPI_PERIOD_INCOMPLETE", [[K.discharge.kpi, "rejected", S.people.userMain.user.user_id]]]);
  const fix = await call("PUT", "/kpi/values", S.people.userMain, { items: [{ kpi_code: K.discharge.kpi, site_id: S.sites.main, period_start: K.discharge.period_start, value_numeric: K.discharge.fixed, unit: "kL" }] });
  assert.equal(fix.json.results[0].value.status, "draft");
  ok(await call("POST", "/kpi/values/submit", S.people.userMain, { ids: [kv[K.discharge.kpi]] }));
  assert.deepEqual((await call("PUT", "/kpi/values/approve", mgr, { ids: [kv[K.discharge.kpi]] })).json.updated, [kv[K.discharge.kpi]]);
  const lock = await call("POST", "/kpi/periods/lock", mgr, body);
  ok(lock);
  assert.equal(lock.json.lock.site_id, S.sites.main);
  const late = await call("PUT", "/kpi/values", S.people.userMain, { items: [{ kpi_code: K.discharge.kpi, site_id: S.sites.main, period_start: K.discharge.period_start, value_numeric: 1, unit: "kL" }] });
  assert.equal(late.json.results[0].code, "KPI_PERIOD_LOCKED");
});

step("K6 the dashboard: coverage per framework, the gaps with their owners, the cards", async () => {
  const d = await call("GET", `/kpi/dashboard?year=${K.report_year}`, S.people.manager);
  ok(d);
  assert.deepEqual(d.json.coverage.map((c) => c.framework), K.frameworks);
  const gri = d.json.coverage.find((c) => c.framework === "GRI");
  const state = (code) => gri.disclosures.find((x) => x.code === code)?.state;
  assert.equal(state("305-1"), "approved", "Scope 1 is auto, from approved rows");
  assert.equal(state("306-3"), "approved", "waste: approved at the only site that owns it");
  assert.equal(state("303-3"), "missing", "water: 11 months at the main site and 12 at Plant B still missing");
  assert.equal(gri.percent, Math.round((gri.approved / gri.required) * 100));
  const esrs = d.json.coverage.find((c) => c.framework === "ESRS");
  assert.ok(esrs.excluded_disclosures.some((x) => x.code.startsWith("E3") && x.reason_kind === "not_material" && x.reason === K.not_material.reason));
  // Gaps: water at both sites, each with its topic owner; waste has none.
  const gaps = d.json.gaps.map((g) => [g.code, g.site_id, g.periods_missing.length, g.owner?.id ?? null]).sort();
  const uma = S.people.userMain.user.user_id;
  const bala = S.people.userPlantB.user.user_id;
  assert.deepEqual(gaps, [
    [K.discharge.kpi, S.sites.main, 11, uma],
    [K.discharge.kpi, S.sites.plantB, 12, bala],
    [K.withdrawal.kpi, S.sites.main, 11, uma],
    [K.withdrawal.kpi, S.sites.plantB, 12, bala],
  ].sort());
  const card = (code) => d.json.cards.find((c) => c.code === code);
  // The card's figure rolls up every site in scope (KPI-10): Plant B has no waste value, so it reads partial.
  assert.deepEqual([card(K.waste.kpi).value, card(K.waste.kpi).status], [K.waste.canonical, "partial"]);
  assert.equal(r2(card("GHG_SCOPE1").value), r2(S.kpiTables.totals[String(SC.REPORT_YEAR)].scope1));
  // The Overview tiles.
  const ov = (await call("GET", "/kpi/overview", S.people.manager)).json;
  assert.deepEqual(ov.readiness.map((x) => x.framework), K.frameworks);
});

step("K6b the ESG dashboard (D19): GHG Scope 1 + 2 is the GHG report's; water and waste under Environment", async () => {
  const r = await call("GET", `/kpi/esg?year=${K.report_year}`, S.people.manager);
  ok(r);
  assert.deepEqual(r.json.pillars.map((p) => p.pillar), ["environment", "social", "governance"]);
  const env = r.json.pillars.find((p) => p.pillar === "environment");
  assert.equal(env.kpis, K.selected.length, "every selected KPI is an Environment one");
  const totals = S.kpiTables.totals[String(SC.REPORT_YEAR)];
  const ghg = r.json.trends.find((t) => t.code === "GHG_SCOPE1_2");
  assert.equal(r2(ghg.value), r2(totals.scope1 + totals.scope2), "the approved auto values, from the GHG report's functions");
  assert.deepEqual(r.json.trends.map((t) => t.code), ["GHG_SCOPE1_2", "WATER_WITHDRAWAL", "WASTE_GENERATED"]);
  assert.equal(r.json.trends.find((t) => t.code === "WASTE_GENERATED").value, K.waste.canonical);
  assert.equal((await call("GET", `/kpi/esg?year=${K.report_year}`, S.people.userMain)).json.code, "KPI_FORBIDDEN");
  assert.equal(await emissionReports(), S.kpiEmissionsBefore, "reading the ESG dashboard moves no emission figure");
});

step("K7 the framework exports carry exactly the approved values, in each framework's unit", async () => {
  const gri = await call("GET", `/kpi/reports/GRI?year=${K.report_year}`, S.people.manager);
  ok(gri);
  const row = (code) => gri.json.rows.find((r) => r.code === code);
  const water = row("303-3").items.find((i) => i.code === K.withdrawal.kpi);
  assert.deepEqual([water.value, water.unit, water.complete], [K.withdrawal.gri_ml, "ML", false], "April only: 1,200 kL = 1.2 ML, the other months missing");
  const waste = row("306-3").items.find((i) => i.code === K.waste.kpi);
  assert.deepEqual([waste.value, waste.unit], [K.waste.canonical, "tonne"]);
  assert.equal(r2(row("305-1").items[0].value), r2(S.kpiTables.totals[String(SC.REPORT_YEAR)].scope1));
  assert.ok(gri.json.omissions.some((o) => o.reason === K.left_out_reason || o.reason_kind === "excluded"));
  assert.deepEqual(gri.json.pending_ids, [], "nothing pending is in");
  const ids = new Set(gri.json.audit_trail.map((a) => a.value_id));
  for (const id of Object.values(kv)) if (id !== kv[K.discharge.kpi]) assert.ok(ids.has(id), `value ${id} in the audit trail`);
  for (const fw of K.frameworks) {
    const x = await fetch(`${process.env.API_BASE}/kpi/reports/${fw}?year=${K.report_year}&format=xlsx`, { headers: { Authorization: `Bearer ${S.people.manager.token}` } });
    assert.equal(x.status, 200, fw);
    assert.match(x.headers.get("content-type") || "", /spreadsheetml/);
  }
});

step("D18 the Superadmin does what the Admin does for this client (company_id): setup, owners, targets, reopen and close, remind, reports", async () => {
  const cid = `company_id=${S.companyId}`;
  assert.equal((await call("GET", "/kpi/setup", S.sa)).json.code, "KPI_COMPANY_REQUIRED");
  const setup = await call("GET", `/kpi/setup?${cid}`, S.sa);
  ok(setup);
  assert.ok(setup.json.people.length >= 4, "the pickers, as for the Admin");
  ok(await call("PUT", `/kpi/people/${S.people.userPlantB.user.user_id}/topics?${cid}`, S.sa, { topics: ["water"] }));
  const t = await call("PUT", `/kpi/targets?${cid}`, S.sa, { kpi_definition_id: kpiIds[K.waste.kpi], site_id: S.sites.main, baseline_year: K.report_year, baseline_value: K.waste.canonical, target_year: K.report_year + 4, target_value: 3, direction: "reduce" });
  ok(t);
  assert.equal(t.json.target.label.includes("by"), true);
  ok(await call("DELETE", `/kpi/targets/${t.json.target.id}?${cid}`, S.sa));
  const reopen = await call("POST", `/kpi/periods/unlock?${cid}`, S.sa, { ...K.lock, site_id: S.sites.main, reason: "Superadmin check" });
  ok(reopen);
  ok(await call("POST", `/kpi/periods/lock?${cid}`, S.sa, { ...K.lock, site_id: S.sites.main }));
  const remind = await call("POST", `/kpi/dashboard/remind?${cid}`, S.sa, { kpi: kpiIds[K.withdrawal.kpi], site: S.sites.plantB });
  ok(remind);
  assert.deepEqual(remind.json.notified, [S.people.userPlantB.user.user_id]);
  ok(await call("GET", `/kpi/dashboard?year=${K.report_year}&${cid}`, S.sa));
  const x = await fetch(`${process.env.API_BASE}/kpi/reports/BRSR?year=${K.report_year}&format=xlsx&${cid}`, { headers: { Authorization: `Bearer ${S.sa.token}` } });
  assert.equal(x.status, 200);
});

step("K8 switching off hides everything and keeps the data; the emission figures are the same as before KPIs", async () => {
  const before = (await kq(`SELECT COUNT(*)::int AS n FROM kpi_value WHERE company_id = $1`, [S.companyId]))[0].n;
  ok(await call("PUT", `/admin/companies/${S.companyId}`, S.sa, { kpi_tracking_enabled: false }));
  for (const who of [S.people.userMain, S.people.manager, S.admin]) {
    const r = await call("GET", "/kpi/my", who);
    assert.deepEqual([r.status, r.json.code], [403, "KPI_TRACKING_OFF"]);
  }
  assert.deepEqual((await call("GET", "/kpi/status", S.admin)).json, { enabled: false, setup_completed: false });
  assert.equal((await kq(`SELECT COUNT(*)::int AS n FROM kpi_value WHERE company_id = $1`, [S.companyId]))[0].n, before, "data kept");
  assert.equal(await emissionReports(), S.kpiEmissionsBefore, "byte-identical with KPI tracking on and off");
});

// KPI-13: the KPI audit probes (audit/harness/kpi-probes.cjs) in a scratch database with the API
// fixture and their own server (KPI_PROBE_PORT): switch-off, tenant isolation and the role matrix
// for every /kpi route. Zero findings: any fail or error is red.
step("K9 the KPI audit probes report zero findings on this stack", async (t) => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { Client } = require("pg");
  const { spawnSync } = require("child_process");
  const harness = path.resolve(__dirname, "../../audit/harness/kpi-probes.cjs");
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: "postgres" };
  const scratch = `${process.env.DB_NAME}_kpiprobes`;
  assert.match(scratch, /^ci_[a-z0-9_]+$/);
  const admin = new Client(config);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
  await admin.query(`CREATE DATABASE "${scratch}"`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-probes-"));
  const out = path.join(dir, "kpi-probes.json");
  try {
    const run = spawnSync(process.execPath, [harness, path.resolve(__dirname, "../.."), out], { env: { ...process.env, DB_NAME: scratch }, encoding: "utf8", timeout: 15 * 60 * 1000 });
    assert.ok(fs.existsSync(out), `the harness wrote no result (exit ${run.status}): ${`${run.stdout}${run.stderr}`.slice(-2000)}`);
    const { counts, results } = JSON.parse(fs.readFileSync(out, "utf8"));
    t.diagnostic(String(run.stdout).trim().split("\n").pop());
    const findings = results.filter((r) => r.status === "fail" || r.status === "error");
    assert.deepEqual(findings.map((r) => `${r.ids.join(",")}: ${String(r.observed).slice(0, 300)}`), []);
    assert.equal(run.status, 0, `harness exited ${run.status}`);
    assert.ok(counts.pass > 0);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// KPI-13: the emissions calculation snapshot (ci/golden) is byte-identical with KPI tracking on for
// every client of its fixture (GOLDEN_KPI_TRACKING=1: set up, every KPI selected, auto KPIs refreshed
// by the approvals), in a scratch database of its own.
step("K10 the emissions golden snapshot is byte-identical with KPI tracking on", async (t) => {
  const path = require("path");
  const { Client } = require("pg");
  const { spawnSync } = require("child_process");
  const root = path.resolve(__dirname, "../..");
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: "postgres" };
  const scratch = `${process.env.DB_NAME}_kpigold`;
  assert.match(scratch, /^ci_[a-z0-9_]+$/);
  const admin = new Client(config);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
  await admin.query(`CREATE DATABASE "${scratch}"`);
  try {
    const env = { ...process.env, DB_NAME: scratch, GOLDEN_KPI_TRACKING: "1", GOLDEN_PORT: String(Number(process.env.WORKFLOW_PORT || 3997) + 3) };
    const sync = spawnSync(process.execPath, [path.join(root, "ci/schema-sync.cjs"), path.join(root, "dist")], { env, encoding: "utf8" });
    assert.equal(sync.status, 0, sync.stderr);
    const run = spawnSync(process.execPath, [path.join(root, "ci/golden/run.cjs")], { env, encoding: "utf8", timeout: 10 * 60 * 1000 });
    const last = String(run.stdout).trim().split("\n").filter((l) => !l.includes("dotenv")).pop();
    t.diagnostic(last);
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`.slice(-3000));
    assert.match(last, /Calculation snapshot matches .* with KPI tracking on \(\d+ auto KPI values written\)/);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.end();
  }
});

// ── Design Studio (DS-14: DS-W0–DS-W11) ── DS-14 ─────────────────────────────
// The same client. DS-W1 and DS-W9 run now (DS-0); the steps between wait on the module that
// routes them and are filled by DS-14 final (ci/golden/ds/CLAUDE.md). DS-W10 runs the DS
// audit probes and DS-W11 the DS goldens, each in a scratch database of its own.
const DS_ROOT = require("path").resolve(__dirname, "../..");
const dsRoutes = require("../golden/ds/lib/routes.cjs");
const dsBuilt = (method, p) => async () => dsRoutes.isBuilt(DS_ROOT, method, p);
const dsLater = (module) => async (t) => t.skip(`${module} is routed; DS-14 final writes this step's checks`);
// The switch's own audit rows (DS-13's review_settings rows share the entity; DS-W6 checks those). [Wave 5 integrate]
const dsAudit = () => kq(`SELECT changed_fields FROM audit_log WHERE entity_type = 'design_studio' AND entity_id = $1 AND changed_fields ? 'design_studio_enabled' ORDER BY id`, [S.companyId]);
/** A scratch ci_* database next to DB_NAME for `fn(name)`, dropped afterwards. */
async function dsScratch(suffix, fn) {
  const { Client } = require("pg");
  const scratch = `${process.env.DB_NAME}_${suffix}`;
  assert.match(scratch, /^ci_[a-z0-9_]+$/);
  const admin = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: "postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
  await admin.query(`CREATE DATABASE "${scratch}"`);
  try {
    return await fn(scratch);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.end();
  }
}

step("DS-W0 before Design Studio: the emission reports this client has (to compare once the studio is on and off)", async () => {
  S.dsEmissionsBefore = await emissionReports();
});

step("DS-W1 the Superadmin switches Design Studio on for this client; GHG only (KPI off); Users and the other client stay out", async () => {
  ok(await call("PUT", `/admin/companies/${S.companyId}`, S.sa, { design_studio_enabled: true }));
  assert.deepEqual((await dsAudit()).map((r) => r.changed_fields), [{ design_studio_enabled: { old: false, new: true } }]);
  for (const who of [S.admin, S.people.manager, S.people.userMain]) assert.deepEqual((await call("GET", "/studio/status", who)).json, { enabled: true, kinds: { ghg: true, sustainability: false } });
  const user = await call("GET", "/studio/docs", S.people.userMain);
  assert.deepEqual([user.status, user.json.code], [403, "DS_ROLE"]);
  const other = S.otherAdmin || (await login(SC.OTHER_CLIENT.email, SC.OTHER_CLIENT.password));
  assert.deepEqual((await call("GET", "/studio/status", other)).json, { enabled: false, kinds: { ghg: false, sustainability: false } });
  const off = await call("GET", "/studio/docs", other);
  assert.deepEqual([off.status, off.json.code], [403, "DS_STUDIO_OFF"]);
  const named = await call("GET", `/studio/status?company_id=${S.companyId}`, other);
  assert.deepEqual([named.status, named.json.code], [404, "DS_DOC_NOT_FOUND"], "another client's id");
});

// ── DS-14F · the studio main path (DS-W2–W8), as the client's Manager ── DS-14F ───────────────
const dsGhg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const dsScope = () => ({ kind: "ghg", year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, sites: siteIds() });
const dsResolve = async (bindings, tokens = []) => {
  const r = await call("POST", "/studio/resolve", S.people.manager, { ...dsScope(), bindings, tokens });
  ok(r);
  return r.json;
};
const dsGet = async (id) => {
  const r = await call("GET", `/studio/docs/${id}`, S.people.manager);
  ok(r);
  return r.json;
};
const dsPatch = async (id, rev, doc) => {
  const r = await call("PATCH", `/studio/docs/${id}`, S.people.manager, { rev, doc });
  ok(r);
  return r.json.rev;
};
const dsChecks = async (id, rev) => {
  const r = await call("POST", `/studio/docs/${id}/checks`, S.people.manager, { rev });
  ok(r);
  return r.json;
};
const dsClose = (a, b, what) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.01, `${what}: ${a} vs ${b}`);
/** A file the API streams (a PDF): status and bytes. */
async function dsFile(route, who) {
  const res = await fetch(`${process.env.API_BASE}${route}`, { headers: who ? { Authorization: `Bearer ${who.token}` } : {} });
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "" };
}
const dsSha = (buf) => require("crypto").createHash("sha256").update(buf).digest("hex");
async function dsJob(body) {
  const r = await call("POST", `/studio/docs/${S.ds.id}/jobs`, S.people.manager, body);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  for (let i = 0; i < 600; i++) {
    const j = await call("GET", `/studio/jobs/${r.json.id}`, S.people.manager);
    ok(j);
    if (j.json.status === "done") return j.json;
    if (j.json.status === "failed") assert.fail(`${body.kind} job failed: ${JSON.stringify(j.json)}`);
    await new Promise((res) => setTimeout(res, 500));
  }
  assert.fail(`${body.kind} job still running after 5 minutes`);
}
let dsChromium = null;
async function dsHasChromium() {
  if (dsChromium === null) {
    try {
      const { chromium } = require("playwright");
      await (await chromium.launch()).close();
      dsChromium = true;
    } catch {
      dsChromium = false;
    }
  }
  return dsChromium;
}

pendingStep("DS-W2 GHG report page → Design this report → the Manager builds a GHG Inventory", "DS-5", dsBuilt("POST", "/docs"), async () => {
  const m = S.people.manager;
  // "Design this report" carries the GHG page's year, year type and sites into the new-design flow: readiness first.
  const ready = await call("GET", `/studio/readiness?kind=ghg&year=${SC.REPORT_YEAR}&yearType=${SC.YEAR_TYPE}&sites=${siteIds().join(",")}`, m);
  ok(ready);
  assert.equal(ready.json.kind, "ghg");
  assert.notEqual(ready.json.state, "ready", "step 26 left a pending and a rejected row");
  assert.ok(ready.json.pendingRows >= 1 && ready.json.rejectedRows >= 1, JSON.stringify(ready.json));
  assert.equal(ready.json.sitesTotal, 2);
  const templates = await call("GET", "/studio/templates?kind=ghg&format=a4", m);
  ok(templates);
  const inventory = templates.json.find((t) => t.slug === "ghg-inventory-classic");
  assert.ok(inventory, templates.json.map((t) => t.slug).join(", "));
  const built = await call("POST", "/studio/docs", m, { kind: "ghg", templateId: inventory.id, year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, sites: siteIds(), compareYear: SC.REPORT_YEAR - 1, frameworks: ["GHGP"], inputs: {}, ai: false });
  assert.equal(built.status, 201, JSON.stringify(built.json));
  assert.equal(built.json.build.state, "done");
  assert.ok(built.json.doc.pages.length >= 15, `${built.json.doc.pages.length} pages`);
  S.ds = { id: built.json.id, rev: built.json.rev };
  // The design's numbers are the GHG report's (step 26b): same approved rows, same totals.
  const t = (await call("POST", "/user/ghg/tables", m, { siteIds: siteIds(), year: SC.REPORT_YEAR, yearType: SC.YEAR_TYPE, frequency: "yearly" })).json.totals[String(SC.REPORT_YEAR)];
  const [total, s1, s2, s3] = (await dsResolve([dsGhg("total"), dsGhg("scope1"), dsGhg("scope2_location"), dsGhg("scope3")])).values;
  dsClose(total.value, t.total, "total");
  dsClose(s1.value, t.scope1, "Scope 1");
  dsClose(s2.value, t.scope2, "Scope 2");
  dsClose(s3.value, t.scope3, "Scope 3");
  // Listed on the studio home; the Admin sees it, a User and the other client don't.
  assert.ok((await call("GET", "/studio/docs?kind=ghg", S.admin)).json.some((d) => d.id === S.ds.id));
  assert.equal((await call("GET", `/studio/docs/${S.ds.id}`, S.people.userMain)).json.code, "DS_ROLE");
});

pendingStep("DS-W3 the Manager edits: moves a chart, adds a data chip (PATCH with rev)", "DS-5, DS-6", dsBuilt("PATCH", "/docs/:id"), async () => {
  const cur = await dsGet(S.ds.id);
  const doc = cur.doc;
  const page = doc.pages.find((p) => p.kind !== "flow" && p.elements.some((e) => e.type === "chart"));
  assert.ok(page, "the Inventory has a chart");
  const chart = page.elements.find((e) => e.type === "chart");
  const moved = { ...chart.frame, x: chart.frame.x + 5, y: chart.frame.y + 4 };
  chart.frame = moved;
  // A note with a Scope 1 chip, and Scope 1 typed by hand 30 % too high (the mismatch DS-W5 finds).
  const s1 = (await dsResolve([dsGhg("scope1")])).values[0].value;
  S.dsWrong = (Math.round(s1 * 1.3 * 10) / 10).toLocaleString("en-US");
  S.dsNote = { pageId: page.id, id: `${page.id}.ds-note` };
  page.elements.push({
    id: S.dsNote.id,
    type: "text",
    frame: { x: 20, y: 262, w: 120, h: 12, rotation: 0 },
    z: 90,
    source: "user",
    props: {
      style: "body",
      align: "left",
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Scope 1 came to " }, { type: "data", attrs: { binding: dsGhg("scope1"), measure: "value" } }, { type: "text", text: ` tCO₂e; the plant log says ${S.dsWrong} tCO₂e.` }] }] },
    },
  });
  const stale = await call("PATCH", `/studio/docs/${S.ds.id}`, S.people.manager, { rev: cur.rev - 1, doc });
  assert.deepEqual([stale.status, stale.json.code], [409, "DS_VERSION_CONFLICT"], "an old rev never overwrites");
  S.ds.rev = await dsPatch(S.ds.id, cur.rev, doc);
  assert.equal(S.ds.rev, cur.rev + 1);
  const after = (await dsGet(S.ds.id)).doc.pages.find((p) => p.id === page.id);
  assert.deepEqual(after.elements.find((e) => e.id === chart.id).frame, moved);
  const chip = JSON.stringify(after.elements.find((e) => e.id === S.dsNote.id).props.doc);
  assert.match(chip, /"type":"data".*"metric":"scope1"/);
  // The page view renders the chip with the approved figure.
  const html = await dsFile(`/studio/docs/${S.ds.id}/preview.html?mode=sheet&pageId=${page.id}`, S.people.manager);
  assert.equal(html.status, 200);
  const shown = (await dsResolve([], [{ type: "data", attrs: { binding: dsGhg("scope1"), measure: "value" } }])).tokens[0].display;
  assert.ok(html.buffer.toString("utf8").includes(shown), `the preview shows Scope 1 (${shown})`);
});

pendingStep("DS-W4 resize to a Board brief deck (a linked copy, bound elements carried over)", "DS-10", dsBuilt("POST", "/docs/:id/resize"), async () => {
  const r = await call("POST", `/studio/docs/${S.ds.id}/resize`, S.people.manager, { format: "slide_16_9", purpose: "deck" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.pageCount >= 6 && r.json.pageCount <= 12, `${r.json.pageCount} slides`);
  const deck = await dsGet(r.json.id);
  assert.equal(deck.doc.format, "slide_16_9");
  assert.equal(deck.doc.purpose, "deck");
  assert.equal(deck.doc.source.docId, S.ds.id);
  const bound = deck.doc.pages.flatMap((p) => (p.kind === "flow" ? [] : p.elements)).filter((e) => e.props?.binding?.source === "ghg");
  assert.ok(bound.some((e) => e.props.binding.metric === "total"), "the total travels to the deck");
  const src = await call("GET", `/studio/docs/${r.json.id}/source`, S.people.manager);
  ok(src);
  const link = src.json.source ?? src.json;
  assert.deepEqual([link.docId, link.exists, link.dataChanged], [S.ds.id, true, false]);
  S.dsDeck = r.json.id;
});

pendingStep("DS-W5 checks: the planted mismatch is found, fixed, and the doc passes", "DS-12", dsBuilt("POST", "/docs/:id/checks"), async () => {
  const first = await dsChecks(S.ds.id, S.ds.rev);
  assert.equal(first.blocking, true);
  assert.equal(first.checks[0].id, "GHG_PENDING_ENTRIES", "pending entries lead the list");
  assert.ok(first.checks[0].details.pending >= 1 && first.checks[0].details.rejected >= 1);
  const mm = first.checks.find((c) => c.id === "NUMBER_MISMATCH" && c.elementId === S.dsNote.id);
  assert.ok(mm, JSON.stringify(first.checks.map((c) => `${c.id}@${c.elementId ?? ""}`)));
  assert.equal(mm.severity, "error");
  // The fix: the chip the check suggests when the near figure is a single one, else the Manager picks Scope 1 in the Data drawer.
  const chip = mm.fix === "replace_with_token" ? mm.details.chip : { binding: dsGhg("scope1"), measure: "value" };
  // The typed figure becomes the chip; the template's empty placeholders go.
  const cur = await dsGet(S.ds.id);
  const empty = new Set(first.checks.filter((c) => c.id === "EMPTY_PLACEHOLDER").map((c) => c.elementId));
  for (const p of cur.doc.pages) if (p.kind !== "flow") p.elements = p.elements.filter((e) => !empty.has(e.id));
  const note = cur.doc.pages.find((p) => p.id === S.dsNote.pageId).elements.find((e) => e.id === S.dsNote.id);
  const para = note.props.doc.content[0].content;
  para.splice(2, 1, { type: "text", text: " tCO₂e; the plant log agrees: " }, { type: "data", attrs: chip }, { type: "text", text: " tCO₂e." });
  S.ds.rev = await dsPatch(S.ds.id, cur.rev, cur.doc);
  // Report details the data can't give: who is responsible, uncertainty, verification, and a
  // reason for every Scope 3 category the boundary leaves without data.
  const inputs = await call("GET", `/studio/docs/${S.ds.id}/inputs`, S.people.manager);
  ok(inputs);
  const was = inputs.json.inputs.exclusions?.value ?? inputs.json.prefill.exclusions?.value ?? [];
  const mid = await dsChecks(S.ds.id, S.ds.rev);
  const unaddressed = mid.checks.filter((c) => c.id === "SCOPE3_CATEGORY_UNADDRESSED").map((c) => c.details.category);
  const patch = {
    consolidation_approach: { value: "Operational control" },
    responsible_person: { value: "Plant head, CI Workflow" },
    uncertainty_statement: { value: "Activity data is metered or invoiced; factor uncertainty follows the published sources." },
    verification: { value: { status: "none" } },
    exclusions: { value: [...was, ...unaddressed.map((n) => ({ what: `Category ${n}`, reason: "Not relevant for this client in the Scope 3 screening." }))] },
  };
  const saved = await call("PATCH", `/studio/docs/${S.ds.id}/inputs`, S.people.manager, { rev: S.ds.rev, inputs: patch });
  ok(saved);
  S.ds.rev = saved.json.rev;
  const last = await dsChecks(S.ds.id, S.ds.rev);
  assert.ok(!last.checks.some((c) => c.id === "NUMBER_MISMATCH"), "the mismatch is gone");
  // What is left blocking is the data itself: step 26's pending and rejected rows (DS-W7).
  assert.deepEqual(last.checks.filter((c) => c.severity === "error").map((c) => c.id), ["GHG_PENDING_ENTRIES"]);
});

pendingStep("DS-W6 request approval; the reviewer approves the current rev", "DS-13", dsBuilt("POST", "/docs/:id/approvals"), async () => {
  // [Wave 5 integrate] The Manager requires an approval before finals (audited); the Admin asks the Manager.
  assert.equal((await call("PUT", "/studio/review-settings", S.admin, { requireReview: true })).json.code, "DS_ROLE", "Admins don't set require-review");
  const set = await call("PUT", "/studio/review-settings", S.people.manager, { requireReview: true });
  ok(set);
  assert.equal(set.json.requireReview, true);
  const [audit] = await kq(`SELECT changed_fields FROM audit_log WHERE entity_type = 'design_studio' AND entity_id = $1 AND action = 'review_settings' ORDER BY id`, [S.companyId]);
  assert.deepEqual(audit.changed_fields, { report_require_review: { old: false, new: true } });
  const final = () => call("POST", `/studio/docs/${S.ds.id}/jobs`, S.people.manager, { kind: "final", rev: S.ds.rev });
  let gate = await final();
  assert.deepEqual([gate.status, gate.json.code, gate.json.details?.reason], [409, "DS_APPROVAL_PENDING", "none"], JSON.stringify(gate.json));
  const managerId = S.people.manager.user.user_id;
  const asked = await call("POST", `/studio/docs/${S.ds.id}/approvals`, S.admin, { reviewerId: managerId, rev: S.ds.rev, note: "Ready for the board pack" });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  gate = await final();
  assert.deepEqual([gate.status, gate.json.code, gate.json.details?.reason], [409, "DS_APPROVAL_PENDING", "requested"], JSON.stringify(gate.json));
  assert.equal((await call("POST", `/studio/approvals/${asked.json.id}/decide`, S.admin, { decision: "approve" })).json.code, "DS_ROLE", "an Admin can't approve");
  ok(await call("POST", `/studio/approvals/${asked.json.id}/decide`, S.people.manager, { decision: "approve" }));
  const list = await call("GET", `/studio/docs/${S.ds.id}/approvals`, S.admin);
  ok(list);
  assert.deepEqual([list.json.current.id, list.json.current.state, list.json.current.rev, list.json.stale, list.json.requireReview], [asked.json.id, "approved", S.ds.rev, false, true]);
  // The approval lets the final through to DS-12's checks gate: DS-W7 still finds the period unsettled.
});

pendingStep("DS-W7 the Manager generates the final; it is immutable and its SHA matches the download", "DS-11", dsBuilt("POST", "/docs/:id/jobs"), async (t) => {
  if (!(await dsHasChromium())) return t.skip("Chromium is not installed (npx playwright install chromium)");
  // Nothing the studio did so far moved an emission figure.
  assert.equal(await emissionReports(), S.dsEmissionsBefore, "byte-identical with the studio on");
  assert.equal((await call("POST", `/studio/docs/${S.ds.id}/jobs`, S.admin, { kind: "final", rev: S.ds.rev })).json.code, "DS_ROLE", "Admins don't make finals");
  const blocked = await call("POST", `/studio/docs/${S.ds.id}/jobs`, S.people.manager, { kind: "final", rev: S.ds.rev });
  assert.deepEqual([blocked.status, blocked.json.code, blocked.json.details.checks[0].id], [409, "DS_CHECKS_BLOCKING", "GHG_PENDING_ENTRIES"]);
  // The Manager settles the period in Review: approves the pending row, deletes the rejected one.
  ok(await call("PUT", `/user/emissions/${S.rows["diesel-mar-pending"].id}/approve`, S.people.manager, {}));
  ok(await call("DELETE", `/user/emissions/${S.rows["diesel-jun-wrong"].id}`, S.people.manager));
  // Review moved the figures, not the studio: DS-W9 compares with this.
  S.dsEmissionsBefore = await emissionReports();
  const proof = await dsJob({ kind: "proof", rev: S.ds.rev });
  assert.ok(proof.pageCount >= 15);
  const c = await dsChecks(S.ds.id, S.ds.rev);
  assert.deepEqual(c.checks.filter((x) => x.severity === "error").map((x) => `${x.id}@${x.elementId ?? ""}`), [], "nothing blocks once the period is settled");
  assert.equal(c.layout, "render", "the proof's measurements count");
  const final = await dsJob({ kind: "final", rev: S.ds.rev, acknowledgedWarnings: c.warnings });
  assert.equal(final.pageCount, proof.pageCount, "proof and final have the same pages");
  const [v] = await kq(`SELECT id, n, kind, rev, pdf_sha256, doc FROM report_doc_version WHERE id = $1`, [final.versionId]);
  assert.deepEqual([v.kind, v.rev], ["final", S.ds.rev]);
  const file = await dsFile(final.downloadUrl, S.people.manager);
  assert.equal(file.status, 200);
  assert.match(file.type, /application\/pdf/);
  assert.equal(dsSha(file.buffer), v.pdf_sha256, "the download is the stored final");
  assert.equal(dsSha((await dsFile(`/studio/docs/${S.ds.id}/versions/${v.n}/pdf`, S.admin)).buffer), v.pdf_sha256);
  // Immutable: editing the draft afterwards leaves the final as it was.
  const cur = await dsGet(S.ds.id);
  cur.doc.meta.title = `${cur.doc.meta.title} (draft after the final)`;
  S.ds.rev = await dsPatch(S.ds.id, cur.rev, cur.doc);
  const [v2] = await kq(`SELECT pdf_sha256, doc FROM report_doc_version WHERE id = $1`, [final.versionId]);
  assert.equal(v2.pdf_sha256, v.pdf_sha256);
  assert.deepEqual(v2.doc, v.doc);
  assert.equal(dsSha((await dsFile(`/studio/docs/${S.ds.id}/versions/${v.n}/pdf`, S.people.manager)).buffer), v.pdf_sha256);
  S.dsFinal = { versionId: final.versionId, n: v.n, sha: v.pdf_sha256 };
});

pendingStep("DS-W8 a share link serves the stored final PDF; revoked, it answers 410", "DS-11", dsBuilt("POST", "/docs/:id/shares"), async (t) => {
  if (!S.dsFinal) return t.skip("no final (DS-W7 skipped)");
  assert.equal((await call("POST", `/studio/docs/${S.ds.id}/shares`, S.admin, { versionId: S.dsFinal.versionId })).json.code, "DS_ROLE", "links are Manager only");
  const made = await call("POST", `/studio/docs/${S.ds.id}/shares`, S.people.manager, { versionId: S.dsFinal.versionId, expiresInDays: 30 });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const token = new URL(made.json.url).pathname.split("/").pop();
  const page = await dsFile(`/s/${token}`, null);
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  const pdf = await dsFile(`/s/${token}/file`, null);
  assert.equal(pdf.status, 200);
  assert.equal(dsSha(pdf.buffer), S.dsFinal.sha, "the link serves the stored final, logged out");
  assert.equal((await call("DELETE", `/studio/shares/${made.json.id}`, S.people.manager)).status, 204);
  assert.equal((await dsFile(`/s/${token}`, null)).status, 410);
  assert.equal((await dsFile(`/s/${token}/file`, null)).status, 410);
  // A second link stays active: switching the studio off (DS-W9) must stop it too.
  const keep = await call("POST", `/studio/docs/${S.ds.id}/shares`, S.people.manager, { versionId: S.dsFinal.versionId });
  assert.equal(keep.status, 201);
  S.dsShareToken = new URL(keep.json.url).pathname.split("/").pop();
  assert.equal((await dsFile(`/s/${S.dsShareToken}/file`, null)).status, 200);
});

step("DS-W9 switching off hides everything: /studio/* answers 403 DS_STUDIO_OFF; the emission figures are the same as before the studio", async () => {
  ok(await call("PUT", `/admin/companies/${S.companyId}`, S.sa, { design_studio_enabled: false }));
  assert.deepEqual((await dsAudit()).map((r) => r.changed_fields.design_studio_enabled), [{ old: false, new: true }, { old: true, new: false }]);
  for (const who of [S.admin, S.people.manager, S.people.userMain]) assert.deepEqual((await call("GET", "/studio/status", who)).json, { enabled: false, kinds: { ghg: false, sustainability: false } }, "the FE hides the nav item and routes on this");
  const wrong = [];
  for (const r of dsRoutes.gatedRoutes(DS_ROOT)) {
    for (const who of [S.admin, S.people.manager, S.people.userMain]) {
      const res = await call(r.method, dsRoutes.concrete(r.path), who, r.method === "GET" || r.method === "DELETE" ? undefined : {});
      if (!(res.status === 403 && res.json?.code === "DS_STUDIO_OFF")) wrong.push(`${who.user.role} ${r.method} ${r.path}: ${res.status} ${res.json?.code ?? ""}`);
    }
  }
  assert.deepEqual(wrong, []);
  if (S.dsShareToken) assert.equal((await dsFile(`/s/${S.dsShareToken}/file`, null)).status, 410, "a view link stops with the studio off"); // DS-14F
  assert.equal(await emissionReports(), S.dsEmissionsBefore, "byte-identical with the studio on and off");
});

step("DS-W10 the Design Studio audit probes report zero findings on this stack", async (t) => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { spawnSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-probes-"));
  const out = path.join(dir, "ds-probes.json");
  try {
    await dsScratch("dsprobes", async (scratch) => {
      const port = process.env.DS_PROBE_PORT || process.env.API_TEST_PORT || String(Number(process.env.WORKFLOW_PORT || 3997) + 4);
      const run = spawnSync(process.execPath, [path.join(DS_ROOT, "audit/harness/ds-probes.cjs"), DS_ROOT, out], { env: { ...process.env, DB_NAME: scratch, DS_PROBE_PORT: port }, encoding: "utf8", timeout: 15 * 60 * 1000 });
      assert.ok(fs.existsSync(out), `the harness wrote no result (exit ${run.status}): ${`${run.stdout}${run.stderr}`.slice(-2000)}`);
      const { counts, results } = JSON.parse(fs.readFileSync(out, "utf8"));
      t.diagnostic(String(run.stdout).trim().split("\n").pop());
      assert.deepEqual(results.filter((r) => r.status === "fail" || r.status === "error").map((r) => `${r.ids.join(",")} ${r.title}: ${String(r.observed).slice(0, 300)}`), []);
      assert.equal(run.status, 0, `harness exited ${run.status}`);
      assert.ok(counts.pass > 0);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

step("DS-W11 the Design Studio goldens match (ci/golden/ds)", async (t) => {
  const path = require("path");
  const { spawnSync } = require("child_process");
  await dsScratch("dsgold", async (scratch) => {
    const port = process.env.DS_GOLDEN_PORT || process.env.GOLDEN_PORT || String(Number(process.env.WORKFLOW_PORT || 3997) + 5);
    const run = spawnSync(process.execPath, [path.join(DS_ROOT, "ci/golden/ds/run.cjs")], { env: { ...process.env, DB_NAME: scratch, DS_GOLDEN_PORT: port, UPDATE_SNAPSHOT: "" }, encoding: "utf8", timeout: 10 * 60 * 1000 });
    const last = String(run.stdout).trim().split("\n").pop();
    t.diagnostic(last);
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`.slice(-3000));
    assert.match(last, /^DS golden: (\d+) run, \1 matched, 0 failed/);
  });
});

// ── Go-live checks still to come ───────────────────────────────────────────

pendingStep("27 the Scope 3 audit probes pass on this stack", "S3-16", async () => require("fs").existsSync("/mnt/project-files/audit/harness/scope3-probes.cjs"), async (t) => t.skip("run audit/harness/scope3-probes.cjs from the audit harness"));
