// S3-6 · /suppliers, the supplier-specific and hybrid methods through a typed
// entry, the coverage read model, the name-match review list and the C06 link.
//
// Company 1 (sites 1 and 2) owns everything made here; company 2's manager
// (site 3) must reach none of it. A Category 1 form on site 1 carries the
// factors the hybrid lines resolve against.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

// Ids well clear of ci/api/fixture.sql and the other S3 tests.
const CAT1 = 9611;
const FIRST_FACTOR = 961100;
const RAW_EMISSION = 961900;
const TAG = "S36api"; // every supplier name made here starts with it
const DATE = "2025-06-30";

const made = { emissions: [], products: [], studies: [] };

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, 'S3-6 Purchased goods', 'Scope 3', 1) ON CONFLICT (category_id) DO NOTHING`, [CAT1]);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (1, $1) ON CONFLICT DO NOTHING`, [CAT1]);
    const factors = [
      [FIRST_FACTOR, "Aluminium ingot", 10, "kg"],
      [FIRST_FACTOR + 1, "Alumina", 1.2, "kg"],
      [FIRST_FACTOR + 2, "Truck freight", 0.1, "tonne.km"],
      [FIRST_FACTOR + 3, "Grid electricity", 0.5, "kwh"],
    ];
    for (const [id, name, value, unit] of factors) {
      await db.query(
        `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type)
         VALUES ($1, 1, $2, 2024, $3, $4, 'CI', $5, $5, 'cradle_to_gate')`,
        [id, CAT1, value, unit, name],
      );
    }
  });
});

test.after(async () => {
  await withDb(async (db) => {
    const sups = (await db.query(`SELECT supplier_id FROM "supplier" WHERE name ILIKE $1`, [`${TAG}%`])).rows.map((r) => r.supplier_id);
    await db.query(`DELETE FROM emission WHERE category_id = $1`, [CAT1]);
    await db.query(`DELETE FROM emission WHERE pk_id >= $1 AND pk_id < $2`, [RAW_EMISSION, RAW_EMISSION + 100]);
    await db.query(`DELETE FROM emission_factors WHERE category_id = $1`, [CAT1]);
    await db.query(`DELETE FROM site_categories WHERE category_id = $1`, [CAT1]);
    await db.query(`DELETE FROM category WHERE category_id = $1`, [CAT1]);
    if (made.studies.length) {
      await db.query(`DELETE FROM supplier_request WHERE pcf_study_id = ANY($1)`, [made.studies]);
      await db.query(`DELETE FROM pcf_study WHERE pcf_study_id = ANY($1)`, [made.studies]);
    }
    if (made.products.length) await db.query(`DELETE FROM product WHERE product_id = ANY($1)`, [made.products]);
    const pcfFactors = (await db.query(`SELECT material_factor_id FROM supplier_factor WHERE supplier_id = ANY($1) AND material_factor_id IS NOT NULL`, [sups])).rows.map((r) => r.material_factor_id);
    await db.query(`DELETE FROM audit_log WHERE entity_type LIKE 'scope3_supplier%' AND entity_id = ANY($1)`, [sups]);
    await db.query(`DELETE FROM "supplier" WHERE supplier_id = ANY($1)`, [sups]);
    if (pcfFactors.length) await db.query(`DELETE FROM material_factor WHERE material_factor_id = ANY($1)`, [pcfFactors]);
  });
});

const createSupplier = async (name, extra = {}) => {
  const res = await call("POST", "/suppliers", "manager", { name, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
};

const enter = (who, body) =>
  call("POST", "/user/emissions", who, {
    site_id: 1,
    category_id: CAT1,
    date_of_reporting: DATE,
    activity_data_unit: "kg",
    ...body,
  });

test("suppliers: managers write, everyone in the company reads, company 2 sees none of it", async () => {
  const gulf = await createSupplier(`${TAG} Gulf Smelter`, { country: "ae", email: "data@gulf.example" });
  assert.equal(gulf.country, "AE");

  // Case-folded names are one supplier.
  const dup = await call("POST", "/suppliers", "manager", { name: `${TAG} gulf smelter` });
  assert.equal(dup.status, 400);
  assert.equal(dup.json.details.supplier_id, gulf.supplier_id);

  // A contributor reads (the add-data field) but can't write.
  const asUser = await call("GET", "/suppliers?year=2025", "user");
  assert.equal(asUser.status, 200);
  assert.ok(asUser.json.suppliers.some((s) => s.supplier_id === gulf.supplier_id));
  assert.equal(asUser.json.can_edit, false);
  // …but may add one by name from Add data; its details and figures stay with managers.
  const byUser = await call("POST", "/suppliers", "user", { name: `${TAG} Added by a contributor` });
  assert.equal(byUser.status, 201, JSON.stringify(byUser.json));
  assert.equal((await call("POST", `/suppliers/${byUser.json.supplier_id}/factors`, "user", { item: "x", unit: "kg", kgco2e_per_unit: 1, reference_year: 2025 })).status, 403);
  assert.equal((await call("POST", `/suppliers/${byUser.json.supplier_id}/facility-data`, "user", { year: 2025, scope12_tco2e: 1, output_qty: 1, output_unit: "kg" })).status, 403);
  assert.equal((await call("PUT", `/suppliers/${gulf.supplier_id}`, "user", { country: "IN" })).status, 403);

  // Company 2 can't see or touch company 1's supplier, its figures or facility data.
  const other = await call("GET", "/suppliers", "otherManager");
  assert.equal(other.status, 200);
  assert.ok(!other.json.suppliers.some((s) => s.supplier_id === gulf.supplier_id));
  for (const [method, route, body] of [
    ["GET", `/suppliers/${gulf.supplier_id}`],
    ["PUT", `/suppliers/${gulf.supplier_id}`, { country: "IN" }],
    ["GET", `/suppliers/${gulf.supplier_id}/factors`],
    ["POST", `/suppliers/${gulf.supplier_id}/factors`, { item: "x", unit: "kg", kgco2e_per_unit: 1, reference_year: 2025 }],
    ["GET", `/suppliers/${gulf.supplier_id}/facility-data`],
    ["POST", `/suppliers/${gulf.supplier_id}/facility-data`, { year: 2025, scope12_tco2e: 1, output_qty: 1, output_unit: "kg" }],
  ]) {
    assert.equal((await call(method, route, "otherManager", body)).status, 404, `${method} ${route}`);
    // Naming company 1 explicitly doesn't help either.
    assert.equal((await call(method, `${route}?company_id=1`, "otherManager", body)).status, 404, `${method} ${route}?company_id=1`);
  }

  // Superadmin names the company.
  assert.equal((await call("GET", "/suppliers", "superadmin")).status, 400);
  const sa = await call("GET", "/suppliers?company_id=1", "superadmin");
  assert.ok(sa.json.suppliers.some((s) => s.supplier_id === gulf.supplier_id));

  const put = await call("PUT", `/suppliers/${gulf.supplier_id}`, "manager", { country: "BH" });
  assert.equal(put.status, 200);
  assert.equal(put.json.country, "BH");
  assert.equal((await call("PUT", `/suppliers/${gulf.supplier_id}`, "manager", { country: "Bahrain" })).status, 400);
});

test("a figure that isn't cradle-to-gate needs confirm_boundary (SUPPLIER_FACTOR_BOUNDARY)", async () => {
  const s = await createSupplier(`${TAG} Boundary Co`);
  const body = { item: "Billet", unit: "kg", kgco2e_per_unit: 9.1, reference_year: 2024, boundary: "cradle_to_grave" };
  const refused = await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", body);
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, "SUPPLIER_FACTOR_BOUNDARY");
  const ok = await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { ...body, confirm_boundary: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.boundary, "cradle_to_grave");
  assert.equal(ok.json.gwp_set, "AR6");
  assert.equal(ok.json.source, "manual");

  // Another company's document is never evidence here.
  const doc = await withDb(async (db) => {
    const e = await db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, category_id, site_id) VALUES ($1, '{}', 0, 'kg', '2025-01-31', 1, 3) RETURNING pk_id`,
      [RAW_EMISSION + 50],
    );
    const d = await db.query(
      `INSERT INTO emission_document (file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, emission_id) VALUES ('f', 'f.pdf', 'x', 'x', 'application/pdf', $1) RETURNING document_id`,
      [e.rows[0].pk_id],
    );
    return d.rows[0].document_id;
  });
  const foreign = await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "Billet", unit: "kg", kgco2e_per_unit: 9, reference_year: 2024, evidence_document_id: doc });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.json.details.field, "evidence_document_id");

  const audit = await withDb((db) => db.query(`SELECT action, reason FROM audit_log WHERE entity_type = 'scope3_supplier_factor' AND entity_id = $1`, [ok.json.supplier_factor_id]));
  assert.equal(audit.rows.length, 1);
  assert.match(audit.rows[0].reason, /Boundary confirmed/);
  await withDb((db) => db.query(`DELETE FROM emission WHERE pk_id = $1`, [RAW_EMISSION + 50]));
});

let supplierRowId;

test("Supplier's own figure: a typed Cat 1 entry is calculated from the supplier's figure", async () => {
  const s = await createSupplier(`${TAG} Ingot Works`, { country: "AE" });
  await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "P1020 ingot", unit: "kg", kgco2e_per_unit: 7.5, reference_year: 2023 });
  const newest = await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "P1020 ingot", unit: "kg", kgco2e_per_unit: 8.6, reference_year: 2025 });
  await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "P1020 ingot", unit: "kg", kgco2e_per_unit: 9.9, reference_year: 2026 });
  await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "Sow", unit: "kg", kgco2e_per_unit: 5, reference_year: 2025 });

  const res = await enter("manager", {
    activity_data: { emission_category: "P1020 ingot", activity_value: "1000" },
    method: "supplier_specific",
    supplier_id: s.supplier_id,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const e = res.json.emission;
  supplierRowId = e.pk_id;
  // The newest figure up to 2025: 1,000 kg × 8.6 (not 2026's 9.9).
  assert.equal(Number(e.total_emission), 8.6);
  assert.equal(e.total_kgco2e, "8600.0000");
  assert.equal(e.method, "supplier_specific");
  assert.equal(e.data_type, "primary");
  assert.equal(e.emission_factor_snapshot.factor_type, "supplier");
  assert.equal(e.emission_factor_snapshot.supplier_factor_id, newest.json.supplier_factor_id);
  assert.equal(e.emission_factor_snapshot.reference_year, 2025);
  assert.equal(e.emission_factor_snapshot.gwp_set, "AR6");
  assert.equal(e.dq.reliability, 2, "no evidence yet");
  const stored = await withDb((db) => db.query(`SELECT supplier_id FROM emission WHERE pk_id = $1`, [e.pk_id]));
  assert.equal(stored.rows[0].supplier_id, s.supplier_id);

  // The list returns the supplier on the row.
  const list = await call("GET", `/user/emissions?categoryId=${CAT1}`, "manager");
  const listed = (Array.isArray(list.json) ? list.json : list.json.data).find((r) => r.pk_id === e.pk_id);
  assert.deepEqual(listed.supplier, { supplier_id: s.supplier_id, name: `${TAG} Ingot Works` });

  // Two items and no name match: the row must say which figure.
  const ambiguous = await enter("manager", { activity_data: { emission_category: "Wire rod", activity_value: "1" }, method: "supplier_specific", supplier_id: s.supplier_id });
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.json.code, "FIELD_REQUIRED");
  // A supplier with no figure at all gets the hint, not an average.
  const bare = await createSupplier(`${TAG} No Figures`);
  const none = await enter("manager", { date_of_reporting: "2025-07-31", activity_data: { emission_category: "P1020 ingot", activity_value: "1" }, method: "supplier_specific", supplier_id: bare.supplier_id });
  assert.equal(none.status, 400);
  assert.match(none.json.message, /No figure from this supplier yet/);

  // An edit recalculates from the same supplier and figure.
  const edit = await call("PUT", `/user/emissions/${e.pk_id}`, "manager", { activity_data: { emission_category: "P1020 ingot", activity_value: "2000" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(Number(edit.json.emission.total_emission), 17.2);
  assert.equal(edit.json.emission.emission_factor_snapshot.supplier_factor_id, newest.json.supplier_factor_id);
});

test("company 2 can't calculate with company 1's supplier", async () => {
  const [{ supplier_id }] = (await withDb((db) => db.query(`SELECT supplier_id FROM "supplier" WHERE name = $1`, [`${TAG} Ingot Works`]))).rows;
  const res = await call("POST", "/user/emissions", "otherManager", {
    site_id: 3,
    category_id: 1,
    date_of_reporting: DATE,
    activity_data: { emission_category: "Diesel", activity_value: "1" },
    activity_data_unit: "litre",
    supplier_id,
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.equal(res.json.code, "FIELD_INVALID");
});

test("hybrid by mass: facility Scope 1+2 allocated by what was bought, plus the input lines", async () => {
  const s = await createSupplier(`${TAG} Hybrid Mass`);
  const first = await call("POST", `/suppliers/${s.supplier_id}/facility-data`, "manager", { year: 2025, scope12_tco2e: 400, output_qty: 100000, output_unit: "kg" });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  // Sending the year again replaces it.
  const again = await call("POST", `/suppliers/${s.supplier_id}/facility-data`, "manager", { year: 2025, scope12_tco2e: 500, output_qty: 100000, output_unit: "kg" });
  assert.equal(again.status, 200);
  assert.equal(again.json.replaced, true);
  assert.equal((await call("GET", `/suppliers/${s.supplier_id}/facility-data`, "manager")).json.facility_data.length, 1);

  const res = await enter("manager", {
    date_of_reporting: "2025-05-31",
    activity_data: { emission_category: "Aluminium ingot", activity_value: "1" },
    activity_data_unit: "tonne",
    method: "hybrid",
    supplier_id: s.supplier_id,
    extra_data: {
      inputs: [
        { kind: "material", name: "Alumina", quantity: 1930, unit: "kg" },
        { kind: "transport", name: "Truck freight", quantity: 500, unit: "tonne.km" },
      ],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const e = res.json.emission;
  // 500 t × 1,000 kg / 100,000 kg = 5,000 kg; 1,930 × 1.2 = 2,316; 500 × 0.1 = 50.
  assert.equal(e.total_kgco2e, "7366.0000");
  assert.equal(Number(e.total_emission), 7.37);
  const comps = e.emission_factor_snapshot.components;
  assert.deepEqual(comps.map((c) => c.kind), ["supplier_scope12", "material", "transport"]);
  assert.equal(comps[0].allocation_key, "mass");
  assert.equal(comps[0].share, 0.01);
  assert.equal(e.method, "hybrid");
  assert.equal(e.dq.reliability, 2);

  // A line naming no factor of this category is refused by name.
  const bad = await enter("manager", {
    date_of_reporting: "2025-01-31",
    activity_data: { emission_category: "Aluminium ingot", activity_value: "1" },
    method: "hybrid",
    supplier_id: s.supplier_id,
    extra_data: { inputs: [{ kind: "material", name: "Unobtainium", quantity: 1, unit: "kg" }] },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "NO_FACTOR_FOR_YEAR");
});

test("hybrid by economic value: allocated by what was paid", async () => {
  const s = await createSupplier(`${TAG} Hybrid Value`);
  await call("POST", `/suppliers/${s.supplier_id}/facility-data`, "manager", { year: 2024, scope12_tco2e: 200, output_qty: 1000000, output_unit: "USD", allocation_key: "economic" });
  const missing = await enter("manager", { date_of_reporting: "2025-04-30", activity_data: { emission_category: "Aluminium ingot", activity_value: "2000" }, method: "hybrid", supplier_id: s.supplier_id });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, "FIELD_REQUIRED");

  const res = await enter("manager", {
    date_of_reporting: "2025-04-30",
    activity_data: { emission_category: "Aluminium ingot", activity_value: "2000" },
    method: "hybrid",
    supplier_id: s.supplier_id,
    extra_data: { purchased_value: 50000, inputs: [{ kind: "energy", name: "Grid electricity", quantity: 10, unit: "kwh" }] },
  });
  // Energy lines stand for the supplier's Scope 1+2: no facility allocation on top.
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.emission.total_kgco2e, "5.0000");

  const econ = await enter("manager", {
    date_of_reporting: "2025-03-31",
    activity_data: { emission_category: "Aluminium ingot", activity_value: "2001" },
    method: "hybrid",
    supplier_id: s.supplier_id,
    extra_data: { purchased_value: 50000 },
  });
  assert.equal(econ.status, 201, JSON.stringify(econ.json));
  // 200 t × 50,000 / 1,000,000 = 10 t, from the 2024 facility data (newest up to 2025).
  assert.equal(econ.json.emission.total_kgco2e, "10000.0000");
  const comp = econ.json.emission.emission_factor_snapshot.components[0];
  assert.equal(comp.allocation_key, "economic");
  assert.equal(comp.year, 2024);
});

test("coverage: the share of Cat 1/2 tCO₂e from supplier data and the top suppliers", async () => {
  const avg = await enter("manager", { date_of_reporting: "2025-02-28", activity_data: { emission_category: "Aluminium ingot", activity_value: "100" } });
  assert.equal(avg.status, 201, JSON.stringify(avg.json));
  assert.equal(avg.json.emission.method, "average_data");

  const all = await call("GET", "/suppliers/coverage?year=2025&status=all", "manager");
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const c = all.json;
  // Supplier-specific 17.2 t (edited), hybrid 7.366 + 0.005 + 10 t, average 1 t (and anything else in Cat 1).
  assert.equal(c.supplier_specific_tco2e, 17.2);
  assert.equal(c.hybrid_tco2e, 17.37);
  assert.ok(c.cat12_tco2e >= 35.57);
  assert.ok(c.coverage_pct > 90 && c.coverage_pct < 100, String(c.coverage_pct));
  assert.equal(c.top_suppliers[0].name, `${TAG} Ingot Works`);
  assert.ok(c.top_suppliers.length <= 20);

  // Approved rows only by default: nothing here is approved yet.
  const approved = await call("GET", "/suppliers/coverage?year=2025", "manager");
  assert.ok(!approved.json.top_suppliers.some((t) => t.name.startsWith(TAG)));

  // Company 2 sees only its own.
  const other = await call("GET", "/suppliers/coverage?year=2025&status=all", "otherManager");
  assert.equal(other.status, 200);
  assert.ok(!other.json.top_suppliers.some((t) => t.name.startsWith(TAG)));

  // The list carries this year's rows and tCO₂e.
  const list = await call("GET", "/suppliers?year=2025", "manager");
  const ingot = list.json.suppliers.find((s) => s.name === `${TAG} Ingot Works`);
  assert.equal(ingot.rows_this_year, 1);
  assert.equal(ingot.tco2e, 17.2);
  assert.equal(ingot.has_factor, true);
});

test("name-match review: Link merges two spellings, Not the same is remembered, unlinked rows link", async () => {
  const a = await createSupplier(`${TAG} Delta Metals Ltd`);
  const b = await createSupplier(`${TAG} Delta Metals Limited`);
  const matches = await call("GET", "/suppliers/name-matches", "manager");
  assert.equal(matches.status, 200);
  const pair = matches.json.matches.find((m) => m.type === "similar_suppliers" && [m.a.supplier_id, m.b.supplier_id].sort().join() === [a.supplier_id, b.supplier_id].sort().join());
  assert.ok(pair, "the two spellings are suggested");

  // Contributors and company 2 can't decide.
  assert.equal((await call("GET", "/suppliers/name-matches", "user")).status, 403);
  assert.equal((await call("POST", "/suppliers/name-matches", "otherManager", { type: "similar_suppliers", keep_id: a.supplier_id, other_id: b.supplier_id, decision: "link" })).status, 404);

  const notSame = await call("POST", "/suppliers/name-matches", "manager", { type: "similar_suppliers", keep_id: a.supplier_id, other_id: b.supplier_id, decision: "not_same" });
  assert.equal(notSame.status, 200, JSON.stringify(notSame.json));
  const after = await call("GET", "/suppliers/name-matches", "manager");
  assert.ok(!after.json.matches.some((m) => m.type === "similar_suppliers" && [m.a.supplier_id, m.b.supplier_id].includes(b.supplier_id) && [m.a.supplier_id, m.b.supplier_id].includes(a.supplier_id)));

  // Link: the other spelling's rows and figures move, then it goes.
  const keep = await createSupplier(`${TAG} Omega Alloys`);
  const other = await createSupplier(`${TAG} Omega Alloys Co.`, { email: "esg@omega.example" });
  await call("POST", `/suppliers/${other.supplier_id}/factors`, "manager", { item: "Ingot", unit: "kg", kgco2e_per_unit: 4, reference_year: 2025 });
  await withDb((db) =>
    db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, category_id, site_id, supplier_id, extra_data) VALUES
         ($1, '{}', 0, 'kg', '2025-01-31', 3, 1, $2, '{}'),
         ($3, '{}', 0, 'kg', '2025-01-31', 3, 1, NULL, $4)`,
      [RAW_EMISSION, other.supplier_id, RAW_EMISSION + 1, JSON.stringify({ supplier_name: `${TAG.toLowerCase()} omega alloys co` })],
    ),
  );
  const link = await call("POST", "/suppliers/name-matches", "manager", { type: "similar_suppliers", keep_id: keep.supplier_id, other_id: other.supplier_id, decision: "link" });
  assert.equal(link.status, 200, JSON.stringify(link.json));
  assert.equal(link.json.rows_moved, 1);
  assert.equal(link.json.factors_moved, 1);
  const kept = await call("GET", `/suppliers/${keep.supplier_id}`, "manager");
  assert.equal(kept.json.supplier.email, "esg@omega.example", "the email fills the gap");
  assert.equal(kept.json.factors.length, 1);
  assert.equal((await call("GET", `/suppliers/${other.supplier_id}`, "manager")).status, 404);

  // An unlinked name that looks like a supplier is offered; Link links its rows.
  const review = await call("GET", "/suppliers/name-matches", "manager");
  const unlinked = review.json.matches.find((m) => m.type === "unlinked_name" && m.name === `${TAG.toLowerCase()} omega alloys co`);
  assert.ok(unlinked, JSON.stringify(review.json.matches.filter((m) => m.type === "unlinked_name")));
  assert.equal(unlinked.candidate.supplier_id, keep.supplier_id);
  const linked = await call("POST", "/suppliers/name-matches", "manager", { type: "unlinked_name", name: unlinked.name, supplier_id: keep.supplier_id, decision: "link" });
  assert.equal(linked.status, 200, JSON.stringify(linked.json));
  assert.equal(linked.json.rows_linked, 1);
  const row = await withDb((db) => db.query(`SELECT supplier_id FROM emission WHERE pk_id = $1`, [RAW_EMISSION + 1]));
  assert.equal(row.rows[0].supplier_id, keep.supplier_id);
});

test("C06 accept writes the PCF factor and a supplier_factor, linking the supplier", async () => {
  const product = await withDb(async (db) =>
    (await db.query(`INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES ('S3-6 rod', 'tonnes', 2, 'kg', 1, 1) RETURNING product_id`)).rows[0].product_id,
  );
  made.products.push(product);
  const study = await call("POST", "/pcf/studies", "manager", { product_id: product, reference_start: "2024-01-01", reference_end: "2024-12-31" });
  assert.equal(study.status, 201, JSON.stringify(study.json));
  made.studies.push(study.json.pcf_study_id);

  const existing = await createSupplier(`${TAG} C06 Smelter`);
  const ask = (extra) =>
    call("POST", "/pcf/supplier-requests", "manager", {
      study_id: study.json.pcf_study_id,
      material: "P1020 ingot",
      unit: "kg",
      supplier_name: `${TAG} c06 smelter`,
      supplier_email: "pcf@c06.example",
      due_date: "2099-06-30",
      ...extra,
    });
  const req = await ask({});
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const token = req.json.link.split("/supplier/")[1];
  const sent = await call("POST", `/public/supplier-requests/${token}/submit`, null, { value_kgco2e: 8.6, unit: "kg", boundary: "cradle_to_gate", reference_start: "2024-01-01", reference_end: "2024-12-31" });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));

  const ok = await call("POST", `/pcf/supplier-requests/${req.json.request.supplier_request_id}/accept`, "manager", {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.material_factor_id, "PCF's factor is still written");
  assert.equal(ok.json.supplier_id, existing.supplier_id, "linked to the existing supplier by its case-folded name");

  const factors = await call("GET", `/suppliers/${existing.supplier_id}/factors`, "manager");
  const f = factors.json.factors.find((x) => x.supplier_factor_id === ok.json.supplier_factor_id);
  assert.ok(f);
  assert.equal(f.source, "supplier_request");
  assert.equal(f.material_factor_id, ok.json.material_factor_id);
  assert.equal(f.supplier_request_id, req.json.request.supplier_request_id);
  assert.equal(f.kgco2e_per_unit, 8.6);
  assert.equal(f.reference_year, 2024);
  assert.equal(f.boundary, "cradle_to_gate");
  assert.equal(f.has_evidence, false, "a typed answer has no file");
  assert.equal((await call("GET", `/suppliers/${existing.supplier_id}/factors`, "otherManager")).status, 404);

  // A request naming a supplier the company doesn't have yet creates it.
  const fresh = await ask({ supplier_name: `${TAG} Brand New Supplier`, supplier_email: "pcf@new.example" });
  const t2 = fresh.json.link.split("/supplier/")[1];
  await call("POST", `/public/supplier-requests/${t2}/submit`, null, { value_kgco2e: 3.1, unit: "kg", boundary: "cradle_to_gate" });
  const ok2 = await call("POST", `/pcf/supplier-requests/${fresh.json.request.supplier_request_id}/accept`, "manager", {});
  assert.equal(ok2.status, 200, JSON.stringify(ok2.json));
  const created = await withDb((db) => db.query(`SELECT name, email, company_id FROM "supplier" WHERE supplier_id = $1`, [ok2.json.supplier_id]));
  assert.deepEqual(created.rows[0], { name: `${TAG} Brand New Supplier`, email: "pcf@new.example", company_id: 1 });
});

test("routing: @method and a form that offers the supplier's own figure first", async (t) => {
  const s = await createSupplier(`${TAG} Routing Co`);
  await call("POST", `/suppliers/${s.supplier_id}/factors`, "manager", { item: "Aluminium ingot", unit: "kg", kgco2e_per_unit: 5, reference_year: 2025 });

  // A row naming the method in "@method" (rows sent before they had `method`) routes to it.
  const viaRowMethod = await enter("manager", {
    date_of_reporting: "2025-08-31",
    activity_data: { emission_category: "Aluminium ingot", activity_value: "100", "@method": "supplier_specific" },
    supplier_id: s.supplier_id,
  });
  assert.equal(viaRowMethod.status, 201, JSON.stringify(viaRowMethod.json));
  assert.equal(viaRowMethod.json.emission.method, "supplier_specific");
  assert.equal(viaRowMethod.json.emission.total_kgco2e, "500.0000");

  // A form offering the supplier's own figure first.
  await withDb((db) =>
    db.query(`INSERT INTO column_config (config_name, site_id, category_id, method_options) VALUES ('S3-6 routing', 1, $1, $2)`, [
      CAT1,
      JSON.stringify([{ method: "supplier_specific", units: ["kg"] }, { method: "average_data", units: ["kg"] }]),
    ]),
  );
  t.after(() => withDb((db) => db.query(`DELETE FROM column_config WHERE category_id = $1`, [CAT1])));

  // …with a supplier named: calculated from its figure.
  const withSupplier = await enter("manager", { date_of_reporting: "2025-09-30", activity_data: { emission_category: "Aluminium ingot", activity_value: "100" }, supplier_id: s.supplier_id });
  assert.equal(withSupplier.status, 201, JSON.stringify(withSupplier.json));
  assert.equal(withSupplier.json.emission.method, "supplier_specific");
  assert.equal(withSupplier.json.emission.total_kgco2e, "500.0000");

  // …with none: calculated and recorded as average data, as before S3-6, never refused.
  const noSupplier = await enter("manager", { date_of_reporting: "2025-10-31", activity_data: { emission_category: "Aluminium ingot", activity_value: "100" } });
  assert.equal(noSupplier.status, 201, JSON.stringify(noSupplier.json));
  assert.equal(noSupplier.json.emission.method, "average_data");
  assert.equal(noSupplier.json.emission.total_kgco2e, "1000.0000");
});
