// F-06: deleting entries also removes their evidence files from storage.
// The test server runs with LOCAL_FILE_STORAGE=true (ci/api/run.cjs), so
// uploads land under <repo>/local-uploads and can be checked on disk.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const UPLOADS = path.resolve(__dirname, "../../../local-uploads");
const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;

const upload = async (emissionId, name) => {
  const form = new FormData();
  form.append("file", new Blob([`evidence for ${emissionId}`], { type: "application/pdf" }), name);
  form.append("emission_id", String(emissionId));
  const res = await call("POST", "/user/documents", "user", form);
  assert.equal(res.status, 201);
  const file = path.join(UPLOADS, res.json.document.cloudinary_public_id);
  assert.ok(fs.existsSync(file), "uploaded file is on disk");
  return file;
};

test("deleting entries removes their stored files", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id)
           VALUES (951, '{"activity_value": 1}', 1, 'tCO2e', '2025-05-31', 'pending', 1, 1, 1, 'monthly', NULL),
                  (952, '{"activity_value": 2}', 2, 'tCO2e', '2025-05-31', 'pending', 1, 2, 1, 'monthly', NULL),
                  (953, '{"activity_value": 3}', 3, 'tCO2e', '2025-05-31', 'pending', 1, 3, 1, 'monthly', 'ci-files-batch')`);
  try {
    const one = await upload(951, "one.pdf");
    const two = await upload(952, "two.pdf");
    const three = await upload(953, "three.pdf");

    assert.equal((await call("DELETE", "/user/emissions/951", "user")).status, 200);
    assert.equal(fs.existsSync(one), false, "single delete removes the file");

    assert.equal((await call("DELETE", "/user/emissions/bulk-delete", "user", { ids: [952] })).status, 200);
    assert.equal(fs.existsSync(two), false, "bulk delete removes the file");

    assert.equal((await call("DELETE", "/user/emissions/batch/ci-files-batch", "user")).status, 200);
    assert.equal(fs.existsSync(three), false, "batch delete removes the file");

    assert.equal((await q("SELECT COUNT(*)::int AS n FROM emission_document WHERE emission_id IN (951, 952, 953)"))[0].n, 0);
  } finally {
    await q("DELETE FROM emission_document WHERE emission_id IN (951, 952, 953)");
    await q("DELETE FROM emission WHERE pk_id IN (951, 952, 953)");
  }
});

test("deleting an entry keeps a bill file the AI service still owns", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (954, '{"activity_value": 4}', 4, 'tCO2e', '2025-05-31', 'pending', 1, 1, 1, 'monthly')`);
  try {
    // Invoice 1 (fixture) still exists, so its file stays with it.
    const linked = await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 1, emission_ids: [954] });
    assert.equal(linked.status, 201);
    assert.equal((await call("DELETE", "/user/emissions/954", "user")).status, 200);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM invoice WHERE invoice_id = 1"))[0].n, 1);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM emission_document WHERE emission_id = 954"))[0].n, 0);
  } finally {
    await q("DELETE FROM emission_document WHERE emission_id = 954");
    await q("DELETE FROM emission WHERE pk_id = 954");
  }
});

test("deleting an entry keeps a file another document still uses", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (955, '{"activity_value": 5}', 5, 'tCO2e', '2025-05-31', 'pending', 1, 1, 1, 'monthly'),
                  (956, '{"activity_value": 6}', 6, 'tCO2e', '2025-05-31', 'pending', 1, 2, 1, 'monthly')`);
  try {
    const file = await upload(955, "shared.pdf");
    const publicId = path.relative(UPLOADS, file);
    await q(`INSERT INTO emission_document (emission_id, file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, document_type, uploaded_by)
             SELECT 956, file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, document_type, uploaded_by
               FROM emission_document WHERE emission_id = 955`);
    assert.equal((await call("DELETE", "/user/emissions/955", "user")).status, 200);
    assert.ok(fs.existsSync(file), "file still used by entry 956 stays");
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM emission_document WHERE cloudinary_public_id = $1", [publicId]))[0].n, 1);
    assert.equal((await call("DELETE", "/user/emissions/956", "user")).status, 200);
    assert.equal(fs.existsSync(file), false, "last user removes the file");
  } finally {
    await q("DELETE FROM emission_document WHERE emission_id IN (955, 956)");
    await q("DELETE FROM emission WHERE pk_id IN (955, 956)");
  }
});

test("deleting a document keeps a file another document still uses", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (957, '{"activity_value": 7}', 7, 'tCO2e', '2025-05-31', 'pending', 1, 1, 1, 'monthly'),
                  (958, '{"activity_value": 8}', 8, 'tCO2e', '2025-05-31', 'pending', 1, 2, 1, 'monthly'),
                  (959, '{"activity_value": 9}', 9, 'tCO2e', '2025-05-31', 'pending', 1, 3, 1, 'monthly')`);
  try {
    const file = await upload(957, "shared-doc.pdf");
    await q(`INSERT INTO emission_document (emission_id, file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, document_type, uploaded_by)
             SELECT e, file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, document_type, uploaded_by
               FROM emission_document, (VALUES (958), (959)) AS t(e) WHERE emission_id = 957`);
    const ids = async (emissionIds) =>
      (await q("SELECT document_id FROM emission_document WHERE emission_id = ANY($1) ORDER BY document_id", [emissionIds])).map((r) => r.document_id);

    const [first] = await ids([957]);
    assert.equal((await call("DELETE", `/user/documents/${first}`, "user")).status, 200);
    assert.ok(fs.existsSync(file), "single delete keeps a file two documents still use");

    const [second] = await ids([958]);
    assert.equal((await call("DELETE", "/user/documents/bulk-delete", "user", { ids: [second] })).status, 200);
    assert.ok(fs.existsSync(file), "bulk delete keeps a file one document still uses");

    const [last] = await ids([959]);
    assert.equal((await call("DELETE", `/user/documents/${last}`, "user")).status, 200);
    assert.equal(fs.existsSync(file), false, "deleting the last document removes the file");
  } finally {
    await q("DELETE FROM emission_document WHERE emission_id IN (957, 958, 959)");
    await q("DELETE FROM emission WHERE pk_id IN (957, 958, 959)");
  }
});

test("Add data can ask whether a file already backs another entry of the period (F-16)", async () => {
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (961, '{"activity_value": 3.16, "emission_category": "Recycle"}', 0.05, 'tCO2e', '2025-06-30', 'pending', 1, 2, 1, 'monthly'),
                  (962, '{"activity_value": 3.16, "emission_category": "Recover"}', 0.07, 'tCO2e', '2025-06-30', 'approved', 1, 2, 1, 'monthly')`);
  // A re-upload of invoice 1's file: a new invoice id, the same name and size.
  await q(`INSERT INTO invoice (invoice_id, file_name, cloudinary_url, cloudinary_public_id, file_type, file_size, uploaded_by, site_id, category_id)
           VALUES (963, 'Sept-Electricity.pdf', 'https://res.cloudinary.example.invalid/raw/upload/invoices/sept2.pdf', 'invoices/sept2', 'application/pdf', 52000, 1, 1, 2)`);
  try {
    assert.equal((await call("POST", "/user/documents/from-invoice", "user", { invoice_id: 1, emission_ids: [961] })).status, 201);
    await upload(962, "spent-carbon.pdf"); // 16 bytes: "evidence for 962"
    const ask = (files, more = {}) => call("POST", "/user/documents/already-backing", "user", { site_id: 1, category_id: 2, date_of_reporting: "2025-06-30", files, ...more });

    const bill = await ask([{ ref: "row-1", invoice_id: 1 }]);
    assert.equal(bill.status, 200, JSON.stringify(bill.json));
    assert.deepEqual(bill.json.matches, [{ ref: "row-1", file_name: "sept-electricity.pdf", entries: [{ pk_id: 961, emission_category: "Recycle", total_emission: 0.05, status: "pending" }] }]);
    assert.deepEqual((await ask([{ ref: "again", invoice_id: 963 }])).json.matches.map((x) => x.entries.map((e) => e.pk_id)), [[961]], "a re-upload of the same file matches");
    assert.deepEqual((await ask([{ ref: "file", file_name: "SPENT-carbon.pdf", file_size: 16 }])).json.matches[0].entries.map((e) => e.pk_id), [962]);

    assert.deepEqual((await ask([{ ref: "file", file_name: "spent-carbon.pdf", file_size: 17 }])).json.matches, [], "another size is another file");
    assert.deepEqual((await ask([{ ref: "row-1", invoice_id: 1 }], { exclude_ids: [961] })).json.matches, [], "the entry being edited doesn't count");
    assert.deepEqual((await ask([{ ref: "row-1", invoice_id: 1 }], { date_of_reporting: "2025-07-31" })).json.matches, [], "another month");

    assert.equal((await ask([])).status, 400);
    assert.equal((await ask([{ ref: "x" }])).status, 400);
    assert.equal((await call("POST", "/user/documents/already-backing", "otherUser", { site_id: 1, category_id: 2, date_of_reporting: "2025-06-30", files: [{ ref: "a", invoice_id: 1 }] })).status, 403);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM emission_document WHERE emission_id IN (961, 962)"))[0].n, 2, "nothing changed");
  } finally {
    await call("DELETE", "/user/emissions/962", "user");
    await q("DELETE FROM emission_document WHERE emission_id IN (961, 962)");
    await q("DELETE FROM emission WHERE pk_id IN (961, 962)");
    await q("DELETE FROM invoice WHERE invoice_id = 963");
  }
});
