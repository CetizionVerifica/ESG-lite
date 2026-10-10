// E1 part 3: /pcf studies, input lines and material factors.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

let rod; // product at site 1 (company 1)
let other; // product at site 3 (company 2)

test.before(async () => {
  await withDb(async (db) => {
    const a = await db.query(
      `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg)
       VALUES ('PCF test rod', 'tonnes', 1, 'kg', 1, 1) RETURNING product_id`,
    );
    const b = await db.query(`INSERT INTO product (name, unit, site_id) VALUES ('PCF other co', 'tonnes', 3) RETURNING product_id`);
    rod = a.rows[0].product_id;
    other = b.rows[0].product_id;
  });
});

const study = (extra = {}) => ({
  product_id: rod,
  reference_start: "2025-01-01",
  reference_end: "2025-12-31",
  ...extra,
});

test("every /pcf route is 403 for User, Admin and other contributors", async () => {
  const routes = [
    ["GET", "/pcf/studies"],
    ["POST", "/pcf/studies"],
    ["GET", "/pcf/studies/1"],
    ["PATCH", "/pcf/studies/1"],
    ["DELETE", "/pcf/studies/1"],
    ["PUT", "/pcf/studies/1/inputs"],
    ["GET", "/pcf/material-factors"],
    ["POST", "/pcf/material-factors"],
    ["PATCH", "/pcf/material-factors/1"],
    ["DELETE", "/pcf/material-factors/1"],
  ];
  for (const who of ["user", "admin", "otherUser", "multiSiteUser"]) {
    for (const [method, route] of routes) {
      const res = await call(method, route, who, method === "GET" || method === "DELETE" ? undefined : {});
      assert.equal(res.status, 403, `${who} ${method} ${route}`);
    }
  }
  const anon = await call("GET", "/pcf/studies");
  assert.equal(anon.status, 401);
});

test("manager creates, reads, edits and deletes a draft; other company cannot see it", async () => {
  const created = await call("POST", "/pcf/studies", "manager", study({ notes: "pilot" }));
  assert.equal(created.status, 201);
  const s = created.json;
  assert.equal(s.status, "draft");
  assert.equal(s.version, 1);
  assert.equal(s.site.site_id, 1);
  assert.equal(s.company_id, 1);
  assert.equal(s.created_by.user_id, 2);
  assert.equal(s.allocation_key, "mass");
  assert.equal(s.product.declared_unit, "kg");

  const list = await call("GET", `/pcf/studies?productId=${rod}`, "manager");
  assert.equal(list.status, 200);
  assert.ok(list.json.some((x) => x.pcf_study_id === s.pcf_study_id && x.result === null));

  const otherList = await call("GET", "/pcf/studies", "otherManager");
  assert.ok(!otherList.json.some((x) => x.pcf_study_id === s.pcf_study_id));
  assert.equal((await call("GET", `/pcf/studies/${s.pcf_study_id}`, "otherManager")).status, 404);
  assert.equal((await call("PATCH", `/pcf/studies/${s.pcf_study_id}`, "otherManager", { notes: "x" })).status, 404);

  const superList = await call("GET", "/pcf/studies", "superadmin");
  assert.ok(superList.json.some((x) => x.pcf_study_id === s.pcf_study_id));

  const patched = await call("PATCH", `/pcf/studies/${s.pcf_study_id}`, "manager", { cut_off_rule_pct: 0.5, allocation_key: "energy" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.cut_off_rule_pct, 0.5);
  assert.equal(patched.json.allocation_key, "energy");

  const bad = await call("PATCH", `/pcf/studies/${s.pcf_study_id}`, "manager", { reference_end: "2024-01-01" });
  assert.equal(bad.status, 400);

  const del = await call("DELETE", `/pcf/studies/${s.pcf_study_id}`, "manager");
  assert.equal(del.status, 204);
  assert.equal((await call("GET", `/pcf/studies/${s.pcf_study_id}`, "manager")).status, 404);
});

test("list rejects an unknown status filter", async () => {
  assert.equal((await call("GET", "/pcf/studies?status=bogus", "manager")).status, 400);
  assert.equal((await call("GET", "/pcf/studies?status=draft", "manager")).status, 200);
});

test("create is validated and scoped to the manager's sites", async () => {
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ product_id: other }))).status, 404);
  assert.equal((await call("POST", "/pcf/studies", "otherManager", study())).status, 404);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ site_id: 3 }))).status, 404);
  assert.equal((await call("POST", "/pcf/studies", "superadmin", study({ site_id: 3 }))).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", { product_id: rod })).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ year_type: "Q" }))).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ cut_off_rule_pct: 9 }))).status, 400);
  // Real dates only, and a twelve-month period matching the year type.
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ reference_start: "2025-02-30" }))).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ reference_start: "0000-01-01" }))).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ reference_end: "2025-06-30" }))).status, 400);
  assert.equal((await call("POST", "/pcf/studies", "manager", study({ year_type: "FY" }))).status, 400);
  const fy = await call("POST", "/pcf/studies", "manager", study({ year_type: "FY", reference_start: "2025-04-01", reference_end: "2026-03-31" }));
  assert.equal(fy.status, 201);
  assert.equal((await call("PATCH", `/pcf/studies/${fy.json.pcf_study_id}`, "manager", { year_type: "CY" })).status, 400);
  await call("DELETE", `/pcf/studies/${fy.json.pcf_study_id}`, "manager");
  const site2 = await call("POST", "/pcf/studies", "manager", study({ site_id: 2 }));
  assert.equal(site2.status, 201);
  assert.equal(site2.json.site.site_id, 2);
  await call("DELETE", `/pcf/studies/${site2.json.pcf_study_id}`, "manager");
});

test("material factors: company scope, global library and ecoinvent values", async () => {
  const global = await call("POST", "/pcf/material-factors", "superadmin", {
    name: "CI aluminium ingot", material_group: "metals", unit: "kg", value_kgco2e: 8.6, licence: "ecoinvent",
  });
  assert.equal(global.status, 201);
  assert.equal(global.json.company_id, null);
  assert.equal(global.json.value_kgco2e, 8.6);

  const own = await call("POST", "/pcf/material-factors", "manager", {
    name: "CI recycled aluminium", material_group: "metals", unit: "kg", value_kgco2e: 0.5, recycled_variant: true,
  });
  assert.equal(own.status, 201);
  assert.equal(own.json.company_id, 1);
  assert.equal(own.json.licence, "open");

  // A manager may not write to another company or to the global library.
  assert.equal((await call("POST", "/pcf/material-factors", "manager", { company_id: 2, name: "x", material_group: "m", unit: "kg", value_kgco2e: 1 })).status, 403);
  assert.equal((await call("PATCH", `/pcf/material-factors/${global.json.material_factor_id}`, "manager", { value_kgco2e: 1 })).status, 403);
  assert.equal((await call("POST", "/pcf/material-factors", "manager", { name: "x", material_group: "m", unit: "kg" })).status, 400);

  const mine = await call("GET", "/pcf/material-factors?q=CI%20", "manager");
  const g = mine.json.find((f) => f.material_factor_id === global.json.material_factor_id);
  assert.equal(g.value_kgco2e, null);
  assert.equal(g.value_hidden, true);
  assert.ok(mine.json.some((f) => f.material_factor_id === own.json.material_factor_id));

  const theirs = await call("GET", "/pcf/material-factors?q=CI%20", "otherManager");
  assert.ok(!theirs.json.some((f) => f.material_factor_id === own.json.material_factor_id));
  assert.equal((await call("PATCH", `/pcf/material-factors/${own.json.material_factor_id}`, "otherManager", { value_kgco2e: 1 })).status, 404);

  // Licensed rows stay superadmin-only, even inside the manager's own company.
  assert.equal((await call("POST", "/pcf/material-factors", "manager", { name: "x", material_group: "m", unit: "kg", value_kgco2e: 1, licence: "ecoinvent" })).status, 403);
  assert.equal((await call("PATCH", `/pcf/material-factors/${own.json.material_factor_id}`, "manager", { licence: "ecoinvent" })).status, 403);
  const licensed = await call("POST", "/pcf/material-factors", "superadmin", {
    company_id: 1, name: "CI licensed copper", material_group: "metals", unit: "kg", value_kgco2e: 4.2, licence: "ecoinvent",
  });
  assert.equal(licensed.status, 201);
  for (const body of [{ licence: "open" }, { value_kgco2e: 1 }]) {
    const res = await call("PATCH", `/pcf/material-factors/${licensed.json.material_factor_id}`, "manager", body);
    assert.equal(res.status, 403);
    assert.equal(JSON.stringify(res.json).includes("4.2"), false);
  }
  assert.equal((await call("DELETE", `/pcf/material-factors/${licensed.json.material_factor_id}`, "manager")).status, 403);
  assert.equal((await call("DELETE", `/pcf/material-factors/${licensed.json.material_factor_id}`, "superadmin")).status, 204);

  const edited = await call("PATCH", `/pcf/material-factors/${own.json.material_factor_id}`, "manager", { value_kgco2e: 0.6 });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.value_kgco2e, 0.6);

  // Required text fields stay non-empty on edit; superadmin company_id must be a real company.
  for (const body of [{ name: "" }, { unit: "  " }, { material_group: null }]) {
    assert.equal((await call("PATCH", `/pcf/material-factors/${own.json.material_factor_id}`, "manager", body)).status, 400);
  }
  const base = { name: "x", material_group: "m", unit: "kg", value_kgco2e: 1 };
  assert.equal((await call("POST", "/pcf/material-factors", "superadmin", { ...base, company_id: "abc" })).status, 400);
  assert.equal((await call("POST", "/pcf/material-factors", "superadmin", { ...base, company_id: 999999 })).status, 404);

  await call("DELETE", `/pcf/material-factors/${own.json.material_factor_id}`, "manager");
  await call("DELETE", `/pcf/material-factors/${global.json.material_factor_id}`, "superadmin");
});

test("input lines: validation, replace, copy to a new version, draft-only", async () => {
  const mk = (body) => call("POST", "/pcf/material-factors", "manager", body).then((r) => r.json.material_factor_id);
  const alu = await mk({ name: "CI primary alu", material_group: "metals", unit: "kg", value_kgco2e: 8 });
  const rec = await mk({ name: "CI scrap alu", material_group: "metals", unit: "kg", value_kgco2e: 0.4, recycled_variant: true });
  const road = await mk({ name: "CI road freight", material_group: "transport", unit: "tonne.km", value_kgco2e: 0.2408 });
  const theirs = await call("POST", "/pcf/material-factors", "otherManager", {
    name: "CI other co factor", material_group: "metals", unit: "kg", value_kgco2e: 1,
  });

  const s = (await call("POST", "/pcf/studies", "manager", study())).json;
  const url = `/pcf/studies/${s.pcf_study_id}/inputs`;

  const invalid = await call("PUT", url, "manager", {
    inputs: [
      { stage: "A9", name: "x", unit: "kg" },
      { stage: "A1", name: "no factor", unit: "kg", quantity: 1 },
      { stage: "A1", name: "recycled without factor", unit: "kg", quantity: 1, material_factor_id: alu, recycled_share_pct: 20 },
      { stage: "A2", name: "no distance", unit: "t", material_factor_id: road, payload_t: 0.001 },
      { stage: "A2", name: "kg factor", unit: "t", material_factor_id: alu, payload_t: 0.001, distance_km: 10 },
      { stage: "A1", name: "other company", unit: "kg", quantity: 1, material_factor_id: theirs.json.material_factor_id },
      { stage: "A1", name: "bad dqr", unit: "kg", quantity: 1, material_factor_id: alu, dqr_time: 4 },
      { stage: "A1", name: "negative", unit: "kg", quantity: -1, material_factor_id: alu },
      { stage: "A1", name: "no quantity", unit: "kg", material_factor_id: alu },
    ],
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json.errors.map((e) => e.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(invalid.json.errors[8].message, /quantity is required/);

  const lines = [
    { stage: "A1", name: "Aluminium", unit: "kg", quantity: 1.002, material_factor_id: alu, recycled_material_factor_id: rec, recycled_share_pct: 10, data_type: "primary", dqr_technology: 1 },
    { stage: "A2", name: "Road", unit: "t", material_factor_id: road, payload_t: 0.001002, distance_km: 25 },
    { stage: "A3_packaging", name: "Pallet", unit: "kg", quantity: 0.002, supplier_pcf_kgco2e: 1.1, ai_suggested: true, ai_confidence: 0.55 },
  ];
  const saved = await call("PUT", url, "manager", { inputs: lines });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.inputs.length, 3);
  assert.deepEqual(saved.json.inputs.map((i) => i.sort_order), [0, 1, 2]);
  assert.equal(saved.json.inputs[0].recycled_share_pct, 10);
  assert.equal(saved.json.inputs[0].dqr_technology, 1);
  assert.equal(saved.json.inputs[0].dqr_time, 3);
  assert.equal(saved.json.inputs[2].ai_confidence, 0.55);

  // Replace keeps only what was sent.
  const replaced = await call("PUT", url, "manager", { inputs: lines.slice(0, 2) });
  assert.equal(replaced.json.inputs.length, 2);
  const got = await call("GET", `/pcf/studies/${s.pcf_study_id}`, "manager");
  assert.equal(got.json.inputs.length, 2);
  assert.equal(got.json.inputs[1].material_factor_id, road);

  // A factor in use cannot be deleted.
  assert.equal((await call("DELETE", `/pcf/material-factors/${alu}`, "manager")).status, 409);

  // Once out of draft, the study is read-only; a copy becomes version 2 with the same lines.
  await withDb((db) => db.query(`UPDATE pcf_study SET status = 'approved' WHERE pcf_study_id = $1`, [s.pcf_study_id]));
  assert.equal((await call("PUT", url, "manager", { inputs: [] })).status, 409);
  assert.equal((await call("PATCH", `/pcf/studies/${s.pcf_study_id}`, "manager", { notes: "x" })).status, 409);
  assert.equal((await call("DELETE", `/pcf/studies/${s.pcf_study_id}`, "manager")).status, 409);

  const copy = await call("POST", "/pcf/studies", "manager", { copy_from_id: s.pcf_study_id });
  assert.equal(copy.status, 201);
  assert.equal(copy.json.version, 2);
  assert.equal(copy.json.parent_version_id, s.pcf_study_id);
  assert.equal(copy.json.status, "draft");
  assert.equal(copy.json.reference_start, "2025-01-01");
  const copied = await call("GET", `/pcf/studies/${copy.json.pcf_study_id}`, "manager");
  assert.deepEqual(copied.json.inputs.map((i) => i.name), ["Aluminium", "Road"]);
  assert.equal(copied.json.inputs[0].recycled_material_factor_id, rec);
  // The original keeps its own lines.
  assert.equal((await call("GET", `/pcf/studies/${s.pcf_study_id}`, "manager")).json.inputs.length, 2);

  // Copying the same study again takes the next free version, never a duplicate.
  const again = await call("POST", "/pcf/studies", "manager", { copy_from_id: s.pcf_study_id });
  assert.equal(again.status, 201);
  assert.equal(again.json.version, copy.json.version + 1);
  const twin = await Promise.all([1, 2].map(() => call("POST", "/pcf/studies", "manager", { copy_from_id: s.pcf_study_id })));
  assert.deepEqual(twin.map((r) => r.status), [201, 201]);
  assert.notEqual(twin[0].json.version, twin[1].json.version);

  assert.equal((await call("POST", "/pcf/studies", "otherManager", { copy_from_id: s.pcf_study_id })).status, 404);
  // A version is for the same product.
  assert.equal((await call("POST", "/pcf/studies", "superadmin", { copy_from_id: s.pcf_study_id, product_id: other })).status, 400);
});
