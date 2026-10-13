// C06: supplier data requests. Manager routes under /pcf/supplier-requests,
// the supplier's public link under /public/supplier-requests/:token.
// Uses a product on site 2 (company 1); company 2's manager must see nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

let product, alu, study, inputId;
const created = []; // supplier_request ids

test.before(async () => {
  await withDb(async (db) => {
    product = (
      await db.query(
        `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg)
         VALUES ('Supplier rod', 'tonnes', 2, 'kg', 1, 1) RETURNING product_id`,
      )
    ).rows[0].product_id;
  });
  alu = (await call("POST", "/pcf/material-factors", "manager", { name: "Supplier test alu", material_group: "aluminium", unit: "kg", value_kgco2e: 8.6 })).json.material_factor_id;
  const s = await call("POST", "/pcf/studies", "manager", { product_id: product, reference_start: "2023-01-01", reference_end: "2023-12-31" });
  assert.equal(s.status, 201);
  study = s.json.pcf_study_id;
  const put = await call("PUT", `/pcf/studies/${study}/inputs`, "manager", {
    inputs: [{ stage: "A1", name: "EC-grade aluminium ingot", unit: "kg", quantity: 1.02, material_factor_id: alu, supplier_name: "Alba" }],
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  inputId = put.json.inputs[0].pcf_input_id;
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM supplier_request WHERE pcf_study_id = $1", [study]);
    await db.query("DELETE FROM pcf_study WHERE product_id = $1", [product]);
    await db.query("DELETE FROM product WHERE product_id = $1", [product]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = $1 OR dataset_ref LIKE 'supplier-request:%'", [alu]);
    await db.query("DELETE FROM audit_log WHERE entity_type = 'pcf_study' AND entity_id = $1", [study]);
  });
});

const ask = (extra = {}) =>
  call("POST", "/pcf/supplier-requests", "manager", { study_id: study, input_id: inputId, supplier_email: "pcf@alba.example", due_date: "2099-06-30", ...extra });

const tokenOf = (link) => link.split("/supplier/")[1];

test("only managers and superadmins reach the manager routes", async () => {
  for (const who of ["user", "admin", "otherUser", "multiSiteUser"]) {
    for (const [method, route] of [["GET", "/pcf/supplier-requests"], ["POST", "/pcf/supplier-requests"], ["POST", "/pcf/supplier-requests/1/accept"]]) {
      const res = await call(method, route, who, method === "GET" ? undefined : {});
      assert.equal(res.status, 403, `${who} ${method} ${route}`);
    }
  }
  assert.equal((await call("GET", "/pcf/supplier-requests")).status, 401);
});

test("create validates, stores the exact message and sinks the mail", async () => {
  assert.equal((await ask({ supplier_email: "not-an-email" })).status, 400);
  assert.equal((await ask({ unit: "pcs" })).status, 400);
  assert.equal((await ask({ due_date: "2001-01-01" })).status, 400);
  assert.equal((await ask({ study_id: 999999 })).status, 404);
  assert.equal((await ask({ input_id: 999999 })).status, 404);
  assert.equal((await call("POST", "/pcf/supplier-requests", "manager", { study_id: study, supplier_email: "a@b.co" })).status, 400, "material needed without an input");

  const preview = await call("GET", `/pcf/supplier-requests/preview?study_id=${study}&material=Ingot&unit=kg&due_date=2099-06-30`, "manager");
  assert.equal(preview.status, 200);
  assert.match(preview.json.text, /cradle-to-gate \(A1–A3\) footprint of Ingot, in kg CO₂e per kg by 30 June 2099/);
  assert.equal(preview.json.mail_mode, "sink");

  const res = await ask({ note: "Our PO 4711." });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const r = res.json.request;
  created.push(r.supplier_request_id);
  assert.equal(r.status, "sent");
  assert.equal(r.material, "EC-grade aluminium ingot"); // from the input line
  assert.equal(r.unit, "kg");
  assert.equal(r.supplier_name, "Alba");
  assert.equal(r.supplier_email, "pcf@alba.example");
  assert.equal(r.input.pcf_input_id, inputId);
  assert.equal(r.study.boundary, "cradle_to_gate");
  assert.match(res.json.link, /\/supplier\/[A-Za-z0-9_-]{32}$/);
  assert.ok(r.message.includes(res.json.link), "the stored message carries the link");
  assert.ok(r.message.includes("Our PO 4711."));
  assert.deepEqual(res.json.mail, { mode: "sink", delivered: false, reason: "Email sending is off on this server, so the message wasn't sent. Copy the link and send it yourself." });
  assert.ok(r.sent_at && !r.opened_at);
  // The token is never stored in clear.
  await withDb(async (db) => {
    const row = (await db.query("SELECT token_hash FROM supplier_request WHERE supplier_request_id = $1", [r.supplier_request_id])).rows[0];
    assert.equal(row.token_hash.length, 64);
    assert.notEqual(row.token_hash, tokenOf(res.json.link));
  });

  const list = await call("GET", `/pcf/supplier-requests?study=${study}`, "manager");
  assert.equal(list.status, 200);
  assert.equal(list.json.requests.length, 1);
  assert.equal(list.json.mail_mode, "sink");
  assert.equal((await call("GET", "/pcf/supplier-requests?status=nope", "manager")).status, 400);
  assert.equal((await call("GET", `/pcf/supplier-requests?study=${study}&status=sent`, "manager")).json.requests.length, 1);
  assert.equal((await call("GET", `/pcf/supplier-requests?study=${study}&status=received`, "manager")).json.requests.length, 0);
});

test("company 2's manager sees and touches nothing", async () => {
  const id = created[0];
  assert.equal((await call("GET", `/pcf/supplier-requests?study=${study}`, "otherManager")).json.requests.length, 0);
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}`, "otherManager")).status, 404);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/resend`, "otherManager", {})).status, 404);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/accept`, "otherManager", { value_kgco2e: 1 })).status, 404);
  assert.equal((await call("DELETE", `/pcf/supplier-requests/${id}`, "otherManager")).status, 404);
  assert.equal((await call("POST", "/pcf/supplier-requests", "otherManager", { study_id: study, input_id: inputId, supplier_email: "x@y.co" })).status, 404);
  // The superadmin sees everything.
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}`, "superadmin")).status, 200);
});

test("the supplier link opens, accepts a typed value or a file, and closes", async () => {
  const res = await ask();
  assert.equal(res.status, 201);
  const id = res.json.request.supplier_request_id;
  created.push(id);
  const token = tokenOf(res.json.link);

  assert.equal((await call("GET", "/public/supplier-requests/nope")).status, 404);
  assert.equal((await call("GET", `/public/supplier-requests/${token.slice(0, -1)}x`)).status, 404);

  const open = await call("GET", `/public/supplier-requests/${token}`);
  assert.equal(open.status, 200, JSON.stringify(open.json));
  assert.equal(open.json.company, "CI Steel Co");
  assert.equal(open.json.material, "EC-grade aluminium ingot");
  assert.equal(open.json.unit, "kg");
  assert.equal(open.json.boundary, "cradle_to_gate");
  assert.equal(open.json.status, "opened");
  assert.equal(open.json.reply, null);
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}`, "manager")).json.request.status, "opened");

  // Typed answer: value needs a boundary; dates are checked.
  const bad = await call("POST", `/public/supplier-requests/${token}/submit`, null, { value_kgco2e: 7.9 });
  assert.equal(bad.status, 400);
  assert.equal((await call("POST", `/public/supplier-requests/${token}/submit`, null, {})).status, 400);
  assert.equal((await call("POST", `/public/supplier-requests/${token}/submit`, null, { value_kgco2e: -1, boundary: "cradle_to_gate" })).status, 400);
  assert.equal((await call("POST", `/public/supplier-requests/${token}/submit`, null, { value_kgco2e: 1, boundary: "cradle_to_gate", valid_from: "2025-01-01", valid_to: "2024-01-01" })).status, 400);

  const typed = await call("POST", `/public/supplier-requests/${token}/submit`, null, {
    value_kgco2e: 7.9, boundary: "cradle_to_grave", standard: "ISO 14067", gwp_set: "AR6",
    reference_start: "2024-01-01", reference_end: "2024-12-31", valid_to: "2027-12-31", verifier: "Verifier Ltd", product_name: "Ingot 99.7",
  });
  assert.equal(typed.status, 200, JSON.stringify(typed.json));
  assert.equal(typed.json.status, "received");
  assert.equal(typed.json.reply.value_kgco2e, 7.9);

  const seen = (await call("GET", `/pcf/supplier-requests/${id}`, "manager")).json.request;
  assert.equal(seen.status, "received");
  assert.equal(seen.reply.boundary, "cradle_to_grave");
  assert.equal(seen.reply.boundary_mismatch, true);
  assert.equal(seen.reply.verifier, "Verifier Ltd");
  assert.equal(seen.reply.file, null);
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}/file`, "manager")).status, 404);

  // The requester is told.
  await withDb(async (db) => {
    const n = await db.query("SELECT type, title FROM notification WHERE user_id = 2 AND link = $1", [`/products/suppliers?request=${id}`]);
    assert.equal(n.rows.length, 1, "owner notified");
    assert.equal(n.rows[0].type, "supplier_request");
  });

  // A file can replace the typed answer while the request is open.
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify({ specVersion: "3.0.0", pcf: { declaredUnitOfMeasurement: "kilogram", pcfExcludingBiogenicUptake: "8.1" } })], { type: "application/json" }), "alba.pact.json");
  form.append("note", "See the attached PACT file.");
  const withFile = await call("POST", `/public/supplier-requests/${token}/submit`, null, form);
  assert.equal(withFile.status, 200, JSON.stringify(withFile.json));
  assert.deepEqual(withFile.json.reply.file, { name: "alba.pact.json", size: withFile.json.reply.file.size });
  assert.equal(withFile.json.reply.value_kgco2e, null);
  const badFile = new FormData();
  badFile.append("file", new Blob(["x"]), "bom.xlsx");
  assert.equal((await call("POST", `/public/supplier-requests/${token}/submit`, null, badFile)).status, 400);

  const dl = await call("GET", `/pcf/supplier-requests/${id}/file`, "manager");
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-disposition"), 'attachment; filename="alba.pact.json"');
  assert.equal((dl.json ?? JSON.parse(dl.buffer.toString())).pcf.pcfExcludingBiogenicUptake, "8.1");
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}/file`, "otherManager")).status, 404);

  // Delete is refused once something came in; reject closes it.
  assert.equal((await call("DELETE", `/pcf/supplier-requests/${id}`, "manager")).status, 409);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/reject`, "manager", {})).status, 400);
  const rejected = await call("POST", `/pcf/supplier-requests/${id}/reject`, "manager", { comment: "Boundary is cradle-to-grave" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.request.status, "rejected");
  assert.equal(rejected.json.request.decided_by.user_id, 2);
  assert.equal((await call("POST", `/public/supplier-requests/${token}/submit`, null, { value_kgco2e: 1, boundary: "cradle_to_gate" })).status, 409);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/resend`, "manager", {})).status, 409);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: 1 })).status, 409);
});

test("accept makes a supplier factor and puts the figure on the draft's line", async () => {
  const res = await ask();
  const id = res.json.request.supplier_request_id;
  created.push(id);
  const token = tokenOf(res.json.link);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: 1 })).status, 409, "nothing received yet");

  const sent = await call("POST", `/public/supplier-requests/${token}/submit`, null, {
    value_kgco2e: 7.9, unit: "kg", boundary: "cradle_to_grave", standard: "ISO 14067", reference_start: "2024-01-01", reference_end: "2024-12-31", valid_to: "2027-12-31", verifier: "Verifier Ltd",
  });
  assert.equal(sent.status, 200);

  // A different boundary is refused unless confirmed.
  const refused = await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: 7.9 });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.boundary_mismatch, true);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: "x", boundary: "cradle_to_gate" })).status, 400);
  assert.equal((await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: 1, boundary: "cradle_to_gate", valid_to: "soon" })).status, 400);

  // The manager corrected the boundary after reading the file: accepted as cradle-to-gate.
  const ok = await call("POST", `/pcf/supplier-requests/${id}/accept`, "manager", { value_kgco2e: 7.85, boundary: "cradle_to_gate", gwp_set: "AR6", comment: "A1-A3 figure per page 4" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.applied_to_input, true);
  assert.equal(ok.json.request.status, "accepted");
  assert.equal(ok.json.request.accepted.value_kgco2e, 7.85);
  assert.equal(ok.json.request.accepted.boundary, "cradle_to_gate");
  assert.equal(ok.json.request.accepted.material_factor_id, ok.json.material_factor_id);

  const factor = await call("GET", `/pcf/material-factors/${ok.json.material_factor_id}`, "manager");
  assert.equal(factor.status, 200);
  assert.equal(factor.json.licence, "supplier");
  assert.equal(factor.json.company_id, 1);
  assert.equal(factor.json.unit, "kg");
  assert.equal(factor.json.value_kgco2e, 7.85);
  assert.equal(factor.json.material_group, "aluminium"); // from the line's factor
  assert.equal(factor.json.source_year, 2024);
  assert.equal(factor.json.valid_to, "2027-12-31");
  assert.match(factor.json.name, /^EC-grade aluminium ingot — Alba \(supplier\)$/);
  assert.match(factor.json.source, /Supplier PCF \(ISO 14067\), verified by Verifier Ltd/);
  assert.equal((await call("GET", `/pcf/material-factors/${ok.json.material_factor_id}`, "otherManager")).status, 404);

  const s = await call("GET", `/pcf/studies/${study}`, "manager");
  const line = s.json.inputs.find((i) => i.pcf_input_id === inputId);
  assert.equal(line.supplier_pcf_kgco2e, 7.85);
  assert.equal(line.data_type, "primary");
  assert.equal(line.dqr_technology, 1);
  assert.equal(line.material_factor_id ?? line.material_factor?.material_factor_id, ok.json.material_factor_id);

  // A confirmed mismatch is recorded as such.
  const again = await ask({ input_id: null, material: "Rolling oil", unit: "kg" });
  assert.equal(again.status, 201, JSON.stringify(again.json));
  created.push(again.json.request.supplier_request_id);
  await call("POST", `/public/supplier-requests/${tokenOf(again.json.link)}/submit`, null, { value_kgco2e: 2.4, boundary: "cradle_to_grave" });
  const confirmed = await call("POST", `/pcf/supplier-requests/${again.json.request.supplier_request_id}/accept`, "manager", { confirm_boundary: true });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.equal(confirmed.json.applied_to_input, false);
  assert.equal(confirmed.json.request.accepted.boundary, "cradle_to_grave");
  assert.equal(confirmed.json.request.accepted.value_kgco2e, 2.4);

  const audit = await call("GET", `/pcf/studies/${study}/audit`, "manager");
  const actions = audit.json.map((a) => a.action);
  for (const a of ["supplier_request_sent", "supplier_request_received", "supplier_request_accepted", "supplier_request_rejected"]) assert.ok(actions.includes(a), a);
  assert.equal(audit.json.find((a) => a.action === "supplier_request_received").changed_by, null);
});

test("resend issues a new link and the old one stops working; expiry is derived", async () => {
  const res = await ask();
  const id = res.json.request.supplier_request_id;
  created.push(id);
  const oldToken = tokenOf(res.json.link);
  const re = await call("POST", `/pcf/supplier-requests/${id}/resend`, "manager", { due_date: "2099-12-31" });
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.notEqual(tokenOf(re.json.link), oldToken);
  assert.equal(re.json.request.due_date, "2099-12-31");
  assert.equal((await call("GET", `/public/supplier-requests/${oldToken}`)).status, 404);
  assert.equal((await call("GET", `/public/supplier-requests/${tokenOf(re.json.link)}`)).status, 200);

  await withDb((db) => db.query("UPDATE supplier_request SET token_expires_at = now() - interval '1 day' WHERE supplier_request_id = $1", [id]));
  assert.equal((await call("GET", `/public/supplier-requests/${tokenOf(re.json.link)}`)).status, 410);
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}`, "manager")).json.request.status, "expired");
  assert.equal((await call("GET", `/pcf/supplier-requests?study=${study}&status=expired`, "manager")).json.requests.length, 1);

  const del = await call("DELETE", `/pcf/supplier-requests/${id}`, "manager");
  assert.equal(del.status, 200);
  assert.equal((await call("GET", `/pcf/supplier-requests/${id}`, "manager")).status, 404);
});
