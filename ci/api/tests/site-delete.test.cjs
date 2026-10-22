// Deleting a site (Setup → Sites, Superadmin) failed with a 500 whenever the site had people
// assigned or bills: user_sites and invoice had no cascade. The delete now clears them, keeps
// people's accounts, and removes the site's entries, evidence and setup as the confirm lists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const UPLOADS = path.resolve(__dirname, "../../../local-uploads");
const SITE = 960;

test.after(async () => {
  await q(`DELETE FROM emission WHERE site_id = $1`, [SITE]);
  await q(`DELETE FROM invoice WHERE site_id = $1`, [SITE]);
  await q(`DELETE FROM user_sites WHERE site_id = $1 OR user_id IN (961, 962)`, [SITE]);
  await q(`DELETE FROM "user" WHERE user_id IN (961, 962)`);
  await q(`DELETE FROM site WHERE site_id = $1`, [SITE]);
});

test("a site with people, entries, evidence and bills is deleted; people keep their accounts", async () => {
  await q(`INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES ($1, 'CI Site To Delete', 'Plot 960', 'CI', 1)`, [SITE]);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES ($1, 1), ($1, 2)`, [SITE]);
  // 961's main site is the one going and they also work at site 1; 962 works only there; 7 is assigned to it.
  await q(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES
             (961, 'CI Two Sites', 'ci-two-sites@example.invalid', 'x', 'User', $1),
             (962, 'CI One Site', 'ci-one-site@example.invalid', 'x', 'User', $1)`, [SITE]);
  await q(`INSERT INTO user_sites (user_id, site_id) VALUES (961, 1), (7, $1)`, [SITE]);
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
           VALUES (9601, '{"activity_value": 1, "emission_category": "Diesel"}', 1, 'tCO2e', '2025-05-31', 'approved', 961, 1, $1, 'monthly'),
                  (9602, '{"activity_value": 2, "emission_category": "Diesel"}', 2, 'tCO2e', '2025-06-30', 'pending', 962, 1, $1, 'monthly')`, [SITE]);
  const form = new FormData();
  form.append("file", new Blob(["evidence for 9601"], { type: "application/pdf" }), "site-delete.pdf");
  form.append("emission_id", "9601");
  const upload = await call("POST", "/user/documents", "superadmin", form);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const file = path.join(UPLOADS, upload.json.document.cloudinary_public_id);
  assert.ok(fs.existsSync(file));
  await q(`INSERT INTO invoice (invoice_id, file_name, cloudinary_url, cloudinary_public_id, file_type, file_size, uploaded_by, site_id, category_id)
           VALUES (9601, 'site-bill.pdf', 'https://res.cloudinary.example.invalid/raw/upload/invoices/site-bill.pdf', 'invoices/site-bill', 'application/pdf', 100, 961, $1, 1)`, [SITE]);

  const res = await call("DELETE", `/admin/sites/${SITE}`, "superadmin");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json.deleted, { entries: 2, bills: 1 });
  assert.equal(res.json.people_kept, 3);
  assert.equal(res.json.people_without_site, 1);

  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM site WHERE site_id = $1`, [SITE]))[0].n, 0);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM emission WHERE site_id = $1`, [SITE]))[0].n, 0, "its entries go with it");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM emission_document WHERE emission_id IN (9601, 9602)`))[0].n, 0);
  assert.equal(fs.existsSync(file), false, "and their evidence files");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM invoice WHERE site_id = $1`, [SITE]))[0].n, 0, "its bills too");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM site_categories WHERE site_id = $1`, [SITE]))[0].n, 0);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM user_sites WHERE site_id = $1`, [SITE]))[0].n, 0);

  const people = await q(`SELECT user_id, site_id FROM "user" WHERE user_id IN (7, 961, 962) ORDER BY user_id`);
  assert.deepEqual(people.map((u) => [u.user_id, u.site_id]), [[7, null], [961, 1], [962, null]], "accounts stay: 961 moves to site 1, 962 has no site");
  assert.deepEqual((await q(`SELECT site_id FROM user_sites WHERE user_id = 7 ORDER BY site_id`)).map((r) => r.site_id), [1, 2], "7 keeps their other sites");
});

test("only the Superadmin deletes a site; bad or unknown ids are refused", async () => {
  for (const who of ["admin", "manager", "user"]) {
    assert.equal((await call("DELETE", "/admin/sites/1", who)).status, 403, who);
  }
  assert.equal((await call("DELETE", "/admin/sites/999999", "superadmin")).status, 404);
  assert.equal((await call("DELETE", "/admin/sites/abc", "superadmin")).status, 400);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM site WHERE site_id = 1`))[0].n, 1, "nothing was deleted");
});
