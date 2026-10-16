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

pendingStep("5a default currency is INR and Users see the total only", "SE-2", () => hasColumn("company", "default_currency"), async () => {
  const r = await withDb((db) => db.query(`SELECT default_currency, entry_detail FROM company WHERE company_id = $1`, [S.companyId]));
  assert.deepEqual(r.rows[0], { default_currency: "INR", entry_detail: "total" });
});

pendingStep("5b review workflow v2 is off until the Superadmin turns it on", "S3-15 parts 3-4", () => hasColumn("company", "review_workflow_v2"), async () => {
  const r = await withDb((db) => db.query(`SELECT review_workflow_v2 FROM company WHERE company_id = $1`, [S.companyId]));
  assert.equal(r.rows[0].review_workflow_v2, false);
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

pendingStep("9 the Admin screens the 15 categories", "S3-12", async () => (await call("GET", `/scope3/screening?year=${SC.REPORT_YEAR}`, S.admin)).status !== 404, async () => {
  const r = await call("GET", `/scope3/screening?year=${SC.REPORT_YEAR}`, S.admin);
  ok(r);
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

pendingStep("14 the Manager records a supplier and its own product figure", "S3-6", async () => (await call("GET", "/suppliers", S.admin)).status !== 404, async () => {
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
  const kg = { s1: 0, s2: 0, cat: { 1: S.spendKg, 3: 0, 6: SC.travelKg() } };
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
  const s3rows = r2(t.cat3 + tonnes(S.spendKg) + tonnes(SC.travelKg()));
  assert.equal(r2(totals.scope3), s3rows, "Scope 3");
  assert.equal(r2(totals.total), r2(t.s1 + t.s2 + s3rows), "Total");
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

// ── Go-live checks still to come ───────────────────────────────────────────

pendingStep("27 the Scope 3 audit probes pass on this stack", "S3-16", async () => require("fs").existsSync("/mnt/project-files/audit/harness/scope3-probes.cjs"), async (t) => t.skip("run audit/harness/scope3-probes.cjs from the audit harness"));
