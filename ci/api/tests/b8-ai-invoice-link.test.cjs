// B8: link an AI-service invoice to EmissionDocument evidence.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

test("links an invoice to the emissions saved from it", async () => {
  const res = await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 1, emission_ids: [2] });
  assert.equal(res.status, 201);
  assert.equal(res.json.documents.length, 1);
  const doc = res.json.documents[0];
  assert.equal(doc.emission_id, 2);
  assert.equal(doc.ai_invoice_id, 1);
  assert.equal(doc.document_type, "invoice");
  assert.equal(doc.original_name, "sept-electricity.pdf");
  assert.equal(doc.secure_url, "https://res.cloudinary.example.invalid/raw/upload/invoices/sept.pdf");

  // Shows on the existing evidence endpoint with the link.
  const list = await call("GET", "/user/documents/emission/2", "user");
  assert.equal(list.status, 200);
  const docs = list.json.documents ?? list.json;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].ai_invoice_id, 1);

  // Idempotent per emission + invoice.
  const again = await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 1, emission_ids: [2] });
  assert.equal(again.json.documents[0].document_id, doc.document_id);
  const count = await withDb((db) => db.query("SELECT COUNT(*)::int AS n FROM emission_document WHERE ai_invoice_id = 1"));
  assert.equal(count.rows[0].n, 1);
});

test("one bill can back several entries; a site-less invoice links anywhere the caller can reach", async () => {
  const res = await call("POST", "/user/documents/from-invoice", "manager", { invoice_id: 2, emission_ids: [1, 6] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json.documents.map((d) => d.emission_id).sort(), [1, 6]);
});

test("validation and access", async () => {
  const post = (who, body) => call("POST", "/user/documents/from-invoice", who, body);
  assert.equal((await post("user", { emission_ids: [2] })).status, 400);
  assert.equal((await post("user", { invoice_id: 1 })).status, 400);
  assert.equal((await post("user", { invoice_id: 1, emission_ids: ["x"] })).status, 400);
  assert.equal((await post("user", { invoice_id: 99, emission_ids: [2] })).status, 404);
  assert.equal((await post("user", { invoice_id: 1, emission_ids: [9999] })).status, 404);
  // Invoice 1 was uploaded for site 1; entry 6 is on site 2.
  assert.equal((await post("manager", { invoice_id: 1, emission_ids: [6] })).status, 400);
  // Another company's entry.
  assert.equal((await post("user", { invoice_id: 2, emission_ids: [8] })).status, 403);
  assert.equal((await post("otherManager", { invoice_id: 2, emission_ids: [1] })).status, 403);
  assert.equal((await post(null, { invoice_id: 1, emission_ids: [2] })).status, 401);
});

test("deleting a linked document keeps the invoice", async () => {
  const docs = await withDb((db) => db.query("SELECT document_id FROM emission_document WHERE ai_invoice_id = 2 ORDER BY document_id"));
  const id = docs.rows[0].document_id;
  assert.equal((await call("DELETE", `/user/documents/${id}`, "manager")).status, 200);
  const left = await withDb((db) => db.query("SELECT COUNT(*)::int AS n FROM invoice WHERE invoice_id = 2"));
  assert.equal(left.rows[0].n, 1);
});
