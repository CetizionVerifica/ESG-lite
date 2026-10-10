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
