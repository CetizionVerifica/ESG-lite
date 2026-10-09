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

test("one bill can back several entries; a site-less invoice only by its uploader", async () => {
  // Invoice 2 has no site and was uploaded by user 1.
  const res = await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 2, emission_ids: [1, 3] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json.documents.map((d) => d.emission_id).sort(), [1, 3]);
  // Anyone else gets a 403, even for entries they can reach.
  assert.equal((await call("POST", "/user/documents/from-invoice", "manager", { invoice_id: 2, emission_ids: [6] })).status, 403);
  assert.equal((await call("POST", "/user/documents/from-invoice", "admin", { invoice_id: 2, emission_ids: [1] })).status, 403);
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
  // An invoice of a site the caller cannot reach, even onto their own entry.
  assert.equal((await post("otherManager", { invoice_id: 1, emission_ids: [8] })).status, 403);
  assert.equal((await post("otherUser", { invoice_id: 1, emission_ids: [8] })).status, 403);
  assert.equal((await post(null, { invoice_id: 1, emission_ids: [2] })).status, 401);
});

test("deleting a linked document keeps the invoice", async () => {
  const docs = await withDb((db) => db.query("SELECT document_id FROM emission_document WHERE ai_invoice_id = 2 ORDER BY document_id"));
  const id = docs.rows[0].document_id;
  const del = await call("DELETE", `/user/documents/${id}`, "manager");
  assert.equal(del.status, 200);
  assert.equal(del.json.file_deleted, false); // the invoice still owns its file
  const left = await withDb((db) => db.query("SELECT COUNT(*)::int AS n FROM invoice WHERE invoice_id = 2"));
  assert.equal(left.rows[0].n, 1);
});

// Rows 3 and 4 stand for invoices python_AI_service deletes while documents
// still link them (it keeps the file then); removed afterwards.
test("the last document of a deleted invoice deletes its file", async () => {
  await withDb((db) =>
    db.query(`INSERT INTO invoice (invoice_id, file_name, cloudinary_url, cloudinary_public_id, file_type, file_size, uploaded_by, site_id) VALUES
      (3, 'oct.pdf', 'https://res.cloudinary.example.invalid/raw/upload/invoices/oct.pdf', 'invoices/oct', 'application/pdf', 100, 1, 1),
      (4, 'nov.pdf', 'https://res.cloudinary.example.invalid/raw/upload/invoices/nov.pdf', 'invoices/nov', 'application/pdf', 100, 1, 1)`),
  );
  try {
    for (const invoice_id of [3, 4]) {
      const res = await call("POST", "/user/documents/from-invoice", "user", { invoice_id, emission_ids: [2, 3] });
      assert.equal(res.status, 201);
    }
    await withDb((db) => db.query("DELETE FROM invoice WHERE invoice_id IN (3, 4)"));
    // Linking a deleted invoice is refused.
    assert.equal((await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 3, emission_ids: [1] })).status, 404);

    const docs = async (invoiceId) =>
      (await withDb((db) => db.query("SELECT document_id FROM emission_document WHERE ai_invoice_id = $1 ORDER BY document_id", [invoiceId])))
        .rows.map((r) => r.document_id);
    const [first, last] = await docs(3);
    const d1 = await call("DELETE", `/user/documents/${first}`, "user");
    assert.equal(d1.status, 200);
    assert.equal(d1.json.file_deleted, false); // another document still uses it
    const d2 = await call("DELETE", `/user/documents/${last}`, "user");
    assert.equal(d2.json.file_deleted, true);

    const bulk = await call("DELETE", "/user/documents/bulk-delete", "user", { ids: await docs(4) });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.json.deleted, 2);
    assert.equal(bulk.json.invoice_files_deleted, 1);
  } finally {
    await withDb((db) => db.query("DELETE FROM emission_document WHERE ai_invoice_id IN (3, 4)"));
    await withDb((db) => db.query("DELETE FROM invoice WHERE invoice_id IN (3, 4)"));
  }
});

test("linking holds the invoice row so a concurrent delete waits", async () => {
  // While a link transaction holds invoice 1 FOR SHARE, python_AI_service's
  // SELECT ... FOR UPDATE cannot proceed; check the lock mode is the one used.
  await withDb(async (db) => {
    await db.query("BEGIN");
    try {
      await db.query("SELECT invoice_id FROM invoice WHERE invoice_id = 1 FOR UPDATE");
      const pending = call("POST", "/user/documents/from-invoice", "user", { invoice_id: 1, emission_ids: [2] });
      const raced = await Promise.race([pending.then(() => "done"), new Promise((r) => setTimeout(() => r("waiting"), 700))]);
      assert.equal(raced, "waiting", "the link must wait for the invoice row lock");
      await db.query("COMMIT");
      assert.equal((await pending).status, 201);
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  });
});
