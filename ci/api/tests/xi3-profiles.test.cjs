// XI3 mapping memory (docs/excel-import/modules/XI3-mapping-memory/CLAUDE.md):
// a bulk_upload plan that carries a confirmed MappingProposal teaches one
// profile per sheet when it commits (never on cancel or a failed commit);
// profiles are read and forgotten only inside the caller's company and site
// scope; a Manager may save a P23 mapping for a site they hold (decision 5).
// Factors: Diesel 2680 kg/litre on sites 1 and 2.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);
const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;

let seq = 0;
// Each row in its own month so rows never read as duplicates of an earlier commit.
const row = (over = {}) => {
  seq += 1;
  const y = 2020 + Math.floor(seq / 12);
  const m = String(1 + (seq % 12)).padStart(2, "0");
  return { row_ref: `Fuel!B${seq}`, site_id: 1, category_id: 1, period: { kind: "monthly", date: `${y}-${m}-01` }, activity_name: "Diesel", activity_value: 100, activity_unit: "litre", meta: { source: "profile", confidence: 0.95 }, ...over };
};

const sheet = (over = {}) => ({
  sheet_name: "Fuel",
  fingerprint: FP_A,
  header_row: 1,
  data_rows: 1,
  layout: "rows",
  site_id: 1,
  site_column: null,
  category: { kind: "fixed", id: 1, label: "Stationary Combustion", confidence: 1, source: "profile" },
  period: { kind: "column", column: "Month" },
  fields: [{ key: "activity_value", label: "Quantity", required: true, column: "Qty", confidence: 0.9, source: "rules", skipped: false }],
  activities: [{ sheet_text: "HSD", category_id: 1, factor_name: "Diesel", confidence: 0.92, source: "llm", save_mapping: true }],
  not_in_context: [],
  confidence: 0.9,
  source: "mixed",
  excluded: false,
  ...over,
});
const proposal = (sheets, site_id = 1) => ({ document_id: 7, site_id, sheets, model: { name: "test", calls: 0, cached_profile_hits: 0 } });

const create = (who, rows, extra = {}) => call("POST", "/imports/plans", who, { source_name: "messy.xlsx", channel: "bulk_upload", rows, ...extra });
const commit = (who, plan) => call("POST", `/imports/plans/${plan.plan_id}/commit`, who, { version: plan.version, skip_rows_with_issues: false, idempotency_key: "xi3-" + plan.plan_id });
const profiles = (fp = FP_A) => q(`SELECT id, company_id, site_id, category_id, confirmed_by, uses, sheet_proposal FROM import_mapping_profile WHERE fingerprint = $1 ORDER BY site_id, category_id`, [fp]);
const audits = () => q(`SELECT action, changed_by, reason, changed_fields FROM audit_log WHERE entity_type = 'import_mapping_profile' ORDER BY id`);
const batches = [];

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (930, 1, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (931, 2, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel')`);
    await db.query(`UPDATE company SET ai_import_enabled = true WHERE company_id IN (1, 2)`);
  });
});

test.after(async () => {
  await withDb(async (db) => {
    for (const b of batches) await db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [b]);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'import_mapping_profile' OR (entity_type = 'category_mapping' AND entity_id IN (SELECT id FROM emission_category_mapping WHERE company_category_name = 'XI3 diesel'))`);
    await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name = 'XI3 diesel'`);
    await db.query(`DELETE FROM import_mapping_profile WHERE fingerprint IN ($1, $2)`, [FP_A, FP_B]);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (930, 931)`);
    await db.query(`UPDATE company SET ai_import_enabled = false WHERE company_id IN (1, 2)`);
  });
});

const committed = async (who, rows, mapping, extra = {}) => {
  const created = await create(who, rows, { mapping, ...extra });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const res = await commit(who, created.json);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  batches.push(res.json.committed.upload_batch_id);
  return res.json;
};

test("mapping on a plan: bulk_upload only, must parse, must be for a site the caller holds, switch must be on", async () => {
  const api = await call("POST", "/imports/plans", "manager", { source_name: "x.xlsx", channel: "api", rows: [row()], mapping: proposal([sheet()]) });
  assert.deepEqual([api.status, api.json.code, api.json.details[0].path], [400, "IMPORT_VALIDATION", "mapping"]);
  const bad = await create("manager", [row()], { mapping: proposal([sheet({ fingerprint: "nope" })]) });
  assert.deepEqual([bad.status, bad.json.code], [400, "IMPORT_VALIDATION"]);
  assert.match(bad.json.details[0].path, /^mapping\.sheets\.0\.fingerprint/);
  const otherSite = await create("manager", [row()], { mapping: proposal([sheet({ site_id: 3 })], 3) });
  assert.deepEqual([otherSite.status, otherSite.json.code, otherSite.json.details], [403, "IMPORT_FORBIDDEN", { site_id: 3 }], "company 2's site is never a Manager's upload site");
  const userSite2 = await create("user", [row()], { mapping: proposal([sheet({ site_id: 2 })], 2) });
  assert.deepEqual([userSite2.status, userSite2.json.code], [403, "IMPORT_FORBIDDEN"], "a User holds site 1 only");
  await withDb((db) => db.query(`UPDATE company SET ai_import_enabled = false WHERE company_id = 1`));
  try {
    const off = await create("manager", [row()], { mapping: proposal([sheet()]) });
    assert.deepEqual([off.status, off.json.code], [403, "AI_IMPORT_DISABLED_FOR_CLIENT"]);
    const list = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "manager");
    assert.deepEqual([list.status, list.json.code], [403, "AI_IMPORT_DISABLED_FOR_CLIENT"]);
    // Without a mapping the plan is an ordinary bulk upload and still works.
    const plain = await create("manager", [row()]);
    assert.equal(plain.status, 201, JSON.stringify(plain.json));
    await call("POST", `/imports/plans/${plain.json.plan_id}/cancel`, "manager");
  } finally {
    await withDb((db) => db.query(`UPDATE company SET ai_import_enabled = true WHERE company_id = 1`));
  }
});

test("learn on commit: one profile per sheet, confirmed by the committer, uses counted; nothing on cancel or a failed commit", async () => {
  // A cancelled plan teaches nothing.
  const cancelled = await create("manager", [row()], { mapping: proposal([sheet()]) });
  assert.equal(cancelled.status, 201, JSON.stringify(cancelled.json));
  assert.equal((await call("POST", `/imports/plans/${cancelled.json.plan_id}/cancel`, "manager")).status, 200);
  assert.deepEqual(await profiles(), []);
  // A commit refused for issues teaches nothing either.
  const broken = await create("manager", [row({ activity_name: "No such fuel" })], { mapping: proposal([sheet()]) });
  assert.equal(broken.json.counts.issue, 1);
  assert.equal((await commit("manager", broken.json)).status, 422);
  assert.deepEqual(await profiles(), []);
  await call("POST", `/imports/plans/${broken.json.plan_id}/cancel`, "manager");

  // First commit: the profile is created from the confirmed proposal, minus the one-off save_mapping flags.
  await committed("manager", [row()], proposal([sheet()]));
  let rows = await profiles();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].company_id, rows[0].site_id, rows[0].category_id, rows[0].confirmed_by, rows[0].uses], [1, 1, 1, 2, 1]);
  assert.deepEqual(rows[0].sheet_proposal.activities, [{ sheet_text: "HSD", category_id: 1, factor_name: "Diesel", confidence: 0.92, source: "llm", save_mapping: false }]);
  assert.equal(rows[0].sheet_proposal.fields[0].column, "Qty");
  const first = rows[0].id;
  let log = await audits();
  assert.deepEqual(log.map((a) => [a.action, a.changed_by, a.changed_fields.profile_id.new, a.changed_fields.uses.new]), [["create", 2, first, 1]]);
  assert.match(log[0].reason, /^Learned from import plan [0-9a-f-]{36} \(batch [0-9a-f-]{36}\)$/);

  // Second commit of the same layout, with a changed field: same row, updated mapping, uses 2.
  await committed("manager", [row()], proposal([sheet({ fields: [{ key: "activity_value", label: "Quantity", required: true, column: "Litres", confidence: 1, source: "profile", skipped: false }] })]));
  rows = await profiles();
  assert.deepEqual([rows.length, rows[0].id, rows[0].uses, rows[0].sheet_proposal.fields[0].column], [1, first, 2, "Litres"]);
  log = await audits();
  assert.deepEqual(log.map((a) => [a.action, a.changed_fields.uses.old, a.changed_fields.uses.new]), [["create", null, 1], ["update", 1, 2]]);

  // Excluded sheets are not learned; a column category stores NULL and still upserts onto one row.
  const column = { kind: "column", column: "Category", values: [{ text: "Fuel", id: 1, confidence: 0.8, source: "llm" }] };
  await committed("manager", [row()], proposal([sheet({ sheet_name: "Skip me", fingerprint: FP_B, excluded: true }), sheet({ sheet_name: "Mixed", fingerprint: FP_B, category: column })]));
  await committed("manager", [row()], proposal([sheet({ sheet_name: "Mixed", fingerprint: FP_B, category: column })]));
  const b = await profiles(FP_B);
  assert.deepEqual(b.map((p) => [p.site_id, p.category_id, p.uses, p.sheet_proposal.sheet_name]), [[1, null, 2, "Mixed"]]);

  // Plans without a mapping (Claude, API, plain bulk upload) teach nothing.
  const plain = await create("manager", [row()]);
  const res = await commit("manager", plain.json);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  batches.push(res.json.committed.upload_batch_id);
  assert.equal((await profiles()).length + (await profiles(FP_B)).length, 2);
});

test("fingerprint hit: served to the company for a site the caller holds; never to another company or another site", async () => {
  const hit = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "manager");
  assert.equal(hit.status, 200, JSON.stringify(hit.json));
  assert.equal(hit.json.length, 1);
  const p = hit.json[0];
  assert.deepEqual([p.company_id, p.site_id, p.category_id, p.fingerprint, p.confirmed_by, p.uses], [1, 1, 1, FP_A, 2, 2]);
  assert.equal(p.sheet_proposal.site_id, 1);
  assert.match(p.confirmed_at, /T/);
  assert.match(p.updated_at, /T/);

  // Same fingerprint, other company: nothing, even with the switch on.
  const other = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=3`, "otherManager");
  assert.deepEqual([other.status, other.json], [200, []]);
  // Site outside the caller's scope: refused, not emptied.
  const foreign = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "otherManager");
  assert.deepEqual([foreign.status, foreign.json.code], [403, "IMPORT_FORBIDDEN"]);
  // A User of site 1 may read site 1's profile but not ask for site 2.
  const user = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "user");
  assert.deepEqual([user.status, user.json.length], [200, 1]);
  const userSite2 = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=2`, "user");
  assert.deepEqual([userSite2.status, userSite2.json.code], [403, "IMPORT_FORBIDDEN"]);
  // The site-1 profile is not served for site 2 (a Manager holding both sites asks per site).
  const site2 = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=2`, "manager");
  assert.deepEqual([site2.status, site2.json], [200, []]);
  // Unknown fingerprint: empty; bad query: 400.
  assert.deepEqual((await call("GET", `/imports/mapping-profiles?fingerprint=${"c".repeat(64)}&site_id=1`, "manager")).json, []);
  assert.equal((await call("GET", `/imports/mapping-profiles?fingerprint=short&site_id=1`, "manager")).status, 400);
  assert.equal((await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}`, "manager")).status, 400);
  // Superadmin names the client.
  const noCompany = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "superadmin");
  assert.deepEqual([noCompany.status, noCompany.json.code], [400, "IMPORT_COMPANY_REQUIRED"]);
  const sa = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1&company_id=1`, "superadmin");
  assert.deepEqual([sa.status, sa.json.length], [200, 1]);
  const saWrongSite = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=3&company_id=1`, "superadmin");
  assert.deepEqual([saWrongSite.status, saWrongSite.json.code], [403, "IMPORT_FORBIDDEN"], "site 3 is not client 1's");
  // An Admin names no company (their own) and may not name another.
  const admin = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1`, "admin");
  assert.deepEqual([admin.status, admin.json.length], [200, 1]);
  const adminOther = await call("GET", `/imports/mapping-profiles?fingerprint=${FP_A}&site_id=1&company_id=2`, "admin");
  assert.deepEqual([adminOther.status, adminOther.json.code], [403, "IMPORT_FORBIDDEN"]);
});

test("forget: the confirming Manager, the client's Admin or a Superadmin; a User is refused; another client sees nothing", async () => {
  const [a] = await profiles();
  const [b] = await profiles(FP_B);
  const del = (who, id) => call("DELETE", `/imports/mapping-profiles/${id}`, who);
  assert.deepEqual([(await del("user", a.id)).status, (await del("user", a.id)).json.code], [403, "IMPORT_FORBIDDEN"]);
  assert.equal((await del("otherManager", a.id)).status, 404);
  assert.equal((await del("otherUser", a.id)).status, 404);
  assert.equal((await del("manager", "not-a-uuid")).status, 404);
  assert.equal((await del("manager", "00000000-0000-4000-8000-000000000000")).status, 404);
  // A Manager who holds the site but did not confirm the profile may not forget it.
  await withDb((db) => db.query(`UPDATE import_mapping_profile SET confirmed_by = NULL WHERE id = $1`, [a.id]));
  assert.deepEqual([(await del("manager", a.id)).status, (await del("manager", a.id)).json.code], [403, "IMPORT_FORBIDDEN"]);
  await withDb((db) => db.query(`UPDATE import_mapping_profile SET confirmed_by = 2 WHERE id = $1`, [a.id]));
  const byManager = await del("manager", a.id);
  assert.deepEqual([byManager.status, byManager.json], [200, { id: a.id, deleted: true }]);
  assert.deepEqual(await profiles(), []);
  assert.equal((await del("manager", a.id)).status, 404, "gone");
  const byAdmin = await del("admin", b.id);
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.json));
  assert.deepEqual(await profiles(FP_B), []);
  const log = (await audits()).filter((x) => x.action === "delete");
  assert.deepEqual(log.map((x) => [x.changed_by, x.changed_fields.profile_id.old, x.changed_fields.profile_id.new]), [[2, a.id, null], [3, b.id, null]]);
  // Superadmin needs no company_id on an id route: the profile names its client.
  await committed("admin", [row()], proposal([sheet()]));
  const [c] = await profiles();
  assert.equal((await del("superadmin", c.id)).status, 200);
  assert.deepEqual(await profiles(), []);
});

test("save_mapping (decision 5): a Manager saves a P23 mapping for a site they hold, never for another site; a User never does", async () => {
  const { json: plan } = await create("manager", [row({ activity_name: "XI3 diesel" })]);
  assert.equal(plan.rows[0].issues[0].code, "UNKNOWN_ACTIVITY");
  const elsewhere = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", {
    version: plan.version,
    activity_matches: [{ site_id: 3, category_id: 1, sheet_name: "XI3 diesel", factor_name: "Diesel", save_mapping: true }],
  });
  assert.deepEqual([elsewhere.status, elsewhere.json.code], [403, "IMPORT_FORBIDDEN"]);
  const own = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", {
    version: plan.version,
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "XI3 diesel", factor_name: "Diesel", save_mapping: true }],
  });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(own.json.rows[0].state, "ready");
  const mapping = await q(`SELECT company_id, site_id, category_id, global_category_name, created_by FROM emission_category_mapping WHERE company_category_name = 'XI3 diesel'`);
  assert.deepEqual(mapping, [{ company_id: 1, site_id: 1, category_id: 1, global_category_name: "Diesel", created_by: 2 }]);
  await call("POST", `/imports/plans/${plan.plan_id}/cancel`, "manager");

  const { json: userPlan } = await create("user", [row({ activity_name: "XI3 petrol" })]);
  const byUser = await call("PATCH", `/imports/plans/${userPlan.plan_id}`, "user", {
    version: userPlan.version,
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "XI3 petrol", factor_name: "Diesel", save_mapping: true }],
  });
  assert.equal(byUser.status, 200, JSON.stringify(byUser.json));
  assert.deepEqual([byUser.json.rows[0].state, byUser.json.rows[0].result.activity.matched_by], ["ready", "plan_match"]);
  assert.deepEqual(await q(`SELECT 1 FROM emission_category_mapping WHERE company_category_name = 'XI3 petrol'`), [], "a User's match stays on the plan");
  await call("POST", `/imports/plans/${userPlan.plan_id}/cancel`, "user");
});
