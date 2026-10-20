// DS-13 collaboration: comments, @mentions, tasks, approvals (+ the require-review gate),
// version history (restore, pruning), drift, review settings, brand controls and template locks,
// save as template / layout.
//
//   - switch off (DS_STUDIO_OFF) on every DS-13 route, Users (DS_ROLE), no session (401);
//   - tenant isolation: another company's design, comment, approval and template ids are 404;
//     a Superadmin names the company;
//   - kind off: a sustainability design while KPI tracking is off → DS_KIND_OFF;
//   - a mention notifies only people with access (not Users, not another company, not unknown ids);
//   - tasks: assignee must have access, notified, "My tasks", done, OPEN_TASK info check;
//   - approval roles: only the named Manager decides; a note for "Request changes"; the requester withdraws;
//   - require review: a final needs an approval for the current rev (none, requested, stale);
//   - a restored version makes a new rev; pruning keeps finals and named versions;
//   - drift lists typed text whose figures changed, and DATA_CHANGED appears in the checks;
//   - brand controls: only a Superadmin sets them; an Admin can't change a template-locked element;
//   - save as template / layout: company-owned, locked elements become template-locked.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3, multi-site user 7), company 2
// (site 3; other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript, readyForFinal } = require("./ds-lib.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/ghg-doc.json"));
const SUS_FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/sustainability-doc.json"));
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test.before(async () => {
  for (const name of ["migrateDs4Library", "migrateDs5Docs", "migrateDs11Outputs", "migrateDs13Collab", "migrateDs13Collab"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await reset();
});
test.after(async () => {
  await reset();
  await setStudio(1, false);
  await setStudio(2, false);
});

async function reset() {
  const docs = `SELECT id FROM report_doc WHERE title LIKE 'DS-13%'`;
  await q(`DELETE FROM report_comment WHERE doc_id IN (${docs})`);
  await q(`DELETE FROM report_approval WHERE doc_id IN (${docs})`);
  await q(`DELETE FROM report_data_baseline WHERE doc_id IN (${docs})`);
  await q(`DELETE FROM report_job WHERE doc_id IN (${docs})`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (${docs})`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'DS-13%'`);
  await q(`DELETE FROM report_layout WHERE company_id IN (1, 2) AND (family LIKE 'c1-%' OR family LIKE 'c2-%')`);
  await q(`DELETE FROM report_template WHERE company_id IN (1, 2) AND name LIKE 'DS-13%'`);
  await q(`DELETE FROM notification WHERE type LIKE 'studio_%'`);
  await q(`UPDATE company SET report_require_review = false, brand_controls = false WHERE company_id IN (1, 2)`);
  await setKpi(1, false);
}

const fixtureDoc = (year, title) => {
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.meta = { ...d.meta, year, title, compareYear: year - 1 };
  d.assets = [];
  for (const p of d.pages) if (p.elements) p.elements = p.elements.filter((e) => !(e.props && e.props.assetId));
  // DS-12: the fixture's page number sits in the print margin (OUTSIDE_SAFE_AREA blocks a final).
  for (const p of d.pages) for (const e of p.elements ?? []) if (e.id === "p-summary.pn") e.frame.y = 281;
  return d;
};

async function makeDoc(title, { year = 2023, who = "manager", edit = (d) => d } = {}) {
  const c = await call("POST", "/studio/docs", who, { kind: "ghg", templateId: "blank", year, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, format: "a4", title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const p = await call("PATCH", `/studio/docs/${c.json.id}`, who, { rev: c.json.rev, doc: edit(fixtureDoc(year, title)) });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return { id: c.json.id, rev: p.json.rev, doc: p.json.doc };
}

const notices = (userId, type, docId) => q(`SELECT title, message, link, meta FROM notification WHERE user_id = $1 AND type = $2 AND meta->>'docId' = $3 ORDER BY id`, [userId, type, String(docId)]);
const comment = (docId, body, who = "admin", extra = {}) => call("POST", `/studio/docs/${docId}/comments`, who, { pageId: "p-summary", elementId: "p-summary.body", x: 30, y: 40, body, ...extra });

/** Runs a function of the compiled history module against the test database. */
const runHistory = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "dist/studio/collab/history.js")], { cwd: ROOT, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout.trim().split("\n").pop());
};

const DS13_ROUTES = (id, cid, aid) => [
  ["GET", `/studio/docs/${id}/people`],
  ["GET", `/studio/docs/${id}/comments`],
  ["POST", `/studio/docs/${id}/comments`],
  ["PATCH", `/studio/comments/${cid}`],
  ["DELETE", `/studio/comments/${cid}`],
  ["POST", `/studio/comments/${cid}/task`],
  ["PATCH", `/studio/comments/${cid}/task`],
  ["GET", `/studio/docs/${id}/approvals`],
  ["POST", `/studio/docs/${id}/approvals`],
  ["POST", `/studio/approvals/${aid}/decide`],
  ["DELETE", `/studio/approvals/${aid}`],
  ["GET", `/studio/docs/${id}/drift`],
  ["GET", `/studio/docs/${id}/versions/1/preview.html?mode=paged`],
  ["GET", "/studio/review-settings"],
  ["PUT", "/studio/review-settings"],
  ["POST", "/studio/templates/from-doc"],
  ["POST", "/studio/layouts/from-page"],
  ["DELETE", "/studio/templates/1"],
];

test("switch off → DS_STUDIO_OFF on every DS-13 route; Users → DS_ROLE; no session → 401", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Switch");
  const c = await comment(doc.id, "Check this");
  const a = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  await setStudio(1, false);
  for (const [method, route] of DS13_ROUTES(doc.id, c.json.id, a.json.id)) {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call(method, route, who, method === "GET" || method === "DELETE" ? undefined : {});
      assert.equal(r.status, 403, `${who} ${method} ${route}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF", `${who} ${method} ${route}`);
    }
  }
  await setStudio(1, true);
  for (const [method, route] of DS13_ROUTES(doc.id, c.json.id, a.json.id)) {
    const u = await call(method, route, "user", method === "GET" || method === "DELETE" ? undefined : {});
    assert.equal(u.status, 403, `user ${method} ${route}`);
    assert.equal(u.json.code, "DS_ROLE", `user ${method} ${route}`);
    assert.equal((await call(method, route, undefined, method === "GET" || method === "DELETE" ? undefined : {})).status, 401, `no session ${method} ${route}`);
  }
});

test("tenant isolation: another company's design, comment, approval and template are not found", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await makeDoc("DS-13 Tenant");
  const c = await comment(doc.id, "Ours");
  const a = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev });
  const t = await call("POST", "/studio/templates/from-doc", "admin", { docId: doc.id, name: "DS-13 Tenant template" });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const other = [
    ["GET", `/studio/docs/${doc.id}/people`],
    ["GET", `/studio/docs/${doc.id}/comments`],
    ["POST", `/studio/docs/${doc.id}/comments`, { pageId: "p-summary", body: "x" }],
    ["PATCH", `/studio/comments/${c.json.id}`, { resolved: true }],
    ["DELETE", `/studio/comments/${c.json.id}`],
    ["POST", `/studio/comments/${c.json.id}/task`, { assigneeId: 6 }],
    ["PATCH", `/studio/comments/${c.json.id}/task`, { done: true }],
    ["GET", `/studio/docs/${doc.id}/approvals`],
    ["POST", `/studio/docs/${doc.id}/approvals`, { reviewerId: 6, rev: doc.rev }],
    ["POST", `/studio/approvals/${a.json.id}/decide`, { decision: "approve" }],
    ["DELETE", `/studio/approvals/${a.json.id}`],
    ["GET", `/studio/docs/${doc.id}/drift`],
    ["GET", `/studio/docs/${doc.id}/versions/1/preview.html?mode=paged`],
    ["POST", "/studio/templates/from-doc", { docId: doc.id, name: "DS-13 stolen" }],
    ["POST", "/studio/layouts/from-page", { docId: doc.id, pageId: "p-cover", name: "DS-13 stolen" }],
    ["DELETE", `/studio/templates/${t.json.id}`],
    ["GET", `/studio/templates/${t.json.id}`],
  ];
  for (const [method, route, body] of other) {
    const r = await call(method, route, "otherManager", body);
    assert.equal(r.status, 404, `${method} ${route}: ${JSON.stringify(r.json)}`);
  }
  // Nothing changed for company 1.
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments`, "manager")).json.length, 1);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/approvals`, "manager")).json.current.state, "requested");
  assert.equal((await call("GET", "/studio/templates?kind=ghg", "otherManager")).json.some((x) => x.id === t.json.id), false, "company 2 doesn't list company 1's template");
  // A Superadmin names the company.
  const sa = await call("GET", `/studio/docs/${doc.id}/comments?company_id=1`, "superadmin");
  assert.equal(sa.status, 200);
  assert.equal(sa.json.length, 1);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments?company_id=2`, "superadmin")).status, 404);
  assert.equal((await call("GET", `/studio/docs/999999/comments`, "manager")).status, 404);
});

test("kind off: a sustainability design's comments and drift answer DS_KIND_OFF while KPI tracking is off", async () => {
  await setStudio(1, true);
  await setKpi(1, true);
  const c = await call("POST", "/studio/docs", "manager", { kind: "sustainability", templateId: "blank", year: 2025, yearType: "FY", sites: "all", frameworks: ["GRI"], inputs: {}, ai: false, format: "a4", title: "DS-13 Kind" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const cm = await call("POST", `/studio/docs/${c.json.id}/comments`, "manager", { pageId: c.json.doc.pages[0].id, body: "Ok" });
  assert.equal(cm.status, 201, JSON.stringify(cm.json));
  await setKpi(1, false);
  for (const [method, route, body] of [
    ["GET", `/studio/docs/${c.json.id}/comments`],
    ["GET", `/studio/docs/${c.json.id}/drift`],
    ["GET", `/studio/docs/${c.json.id}/approvals`],
    ["PATCH", `/studio/comments/${cm.json.id}`, { resolved: true }],
  ]) {
    const r = await call(method, route, "manager", body);
    assert.equal(r.status, 403, `${method} ${route}`);
    assert.equal(r.json.code, "DS_KIND_OFF", `${method} ${route}`);
  }
  void SUS_FIXTURE;
});

test("people: Managers and Admins of the company with access to the design's sites, never Users", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 People");
  const r = await call("GET", `/studio/docs/${doc.id}/people`, "admin");
  assert.equal(r.status, 200);
  const ids = r.json.map((p) => p.id).sort();
  assert.deepEqual(ids, [2, 3]);
  assert.deepEqual(r.json.find((p) => p.id === 2), { id: 2, name: "CI Manager", role: "Manager", canApprove: true });
  assert.equal(r.json.find((p) => p.id === 3).canApprove, false);
  assert.ok(!r.json.some((p) => "email" in p), "no emails in the list");
});

test("a mention notifies only people with access; the link opens the page, element and thread", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Mention");
  const c = await comment(doc.id, "@CI Manager can you check the Scope 1 sentence?", "admin", { mentions: [2, 1, 6, 7, 999, 3] });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.deepEqual(c.json.mentions, [2], "a User, another company's Manager, an unknown id and the author are dropped");
  assert.deepEqual(c.json.mentionNames, ["CI Manager"]);
  assert.equal(c.json.authorName, "CI Admin");
  assert.equal(c.json.x, 30);
  const m = await notices(2, "studio_mention", doc.id);
  assert.equal(m.length, 1);
  assert.match(m[0].title, /CI Admin mentioned you in "DS-13 Mention"/);
  assert.equal(m[0].link, `/studio/${doc.id}?page=p-summary&el=p-summary.body&comment=${c.json.id}`);
  assert.equal(m[0].meta.docId, doc.id);
  for (const uid of [1, 3, 6, 7]) assert.equal((await notices(uid, "studio_mention", doc.id)).length, 0, `user ${uid} isn't notified`);
  // A page or element that isn't in the design.
  assert.equal((await call("POST", `/studio/docs/${doc.id}/comments`, "admin", { pageId: "nope", body: "x" })).json.code, "DS_VALIDATION");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/comments`, "admin", { pageId: "p-summary", elementId: "nope", body: "x" })).json.code, "DS_VALIDATION");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/comments`, "admin", { pageId: "p-summary", body: "  " })).json.code, "DS_VALIDATION");
});

test("threads: replies, resolve hides the thread, author-only edits, delete by the author or a Manager", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Threads");
  const root = await comment(doc.id, "Root", "admin");
  const reply = await call("POST", `/studio/docs/${doc.id}/comments`, "manager", { pageId: "ignored", parentId: root.json.id, body: "Reply" });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  assert.equal(reply.json.parentId, root.json.id);
  assert.equal(reply.json.pageId, "p-summary", "a reply sits where its thread is");
  const reply2 = await call("POST", `/studio/docs/${doc.id}/comments`, "admin", { pageId: "p-summary", parentId: reply.json.id, body: "Reply to reply" });
  assert.equal(reply2.json.parentId, root.json.id, "one level of replies");
  assert.equal((await call("PATCH", `/studio/comments/${root.json.id}`, "manager", { body: "Edited by someone else" })).json.code, "DS_ROLE");
  const ed = await call("PATCH", `/studio/comments/${root.json.id}`, "admin", { body: "Root (edited)" });
  assert.equal(ed.json.body, "Root (edited)");
  const res = await call("PATCH", `/studio/comments/${root.json.id}`, "manager", { resolved: true });
  assert.ok(res.json.resolvedAt);
  assert.equal(res.json.resolvedByName, "CI Manager");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments`, "admin")).json.length, 0, "a resolved thread is hidden");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments?resolved=1`, "admin")).json.length, 3, "Show resolved");
  await call("PATCH", `/studio/comments/${root.json.id}`, "admin", { resolved: false });
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments`, "admin")).json.length, 3);
  assert.equal((await call("DELETE", `/studio/comments/${reply.json.id}`, "admin")).json.code, "DS_ROLE", "an Admin can't delete someone else's comment");
  assert.equal((await call("DELETE", `/studio/comments/${reply2.json.id}`, "admin")).status, 204);
  assert.equal((await call("DELETE", `/studio/comments/${root.json.id}`, "manager")).status, 204, "a Manager can");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments`, "admin")).json.length, 1);
});

test("tasks: assign to someone with access (notified), My tasks, tick done, OPEN_TASK info check", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Tasks");
  const c = await comment(doc.id, "Rewrite the Scope 1 sentence", "manager");
  assert.equal((await call("POST", `/studio/comments/${c.json.id}/task`, "manager", { assigneeId: 1 })).json.code, "DS_VALIDATION", "a User has no studio access");
  assert.equal((await call("POST", `/studio/comments/${c.json.id}/task`, "manager", { assigneeId: 6 })).json.code, "DS_VALIDATION", "another company's Manager");
  const t = await call("POST", `/studio/comments/${c.json.id}/task`, "manager", { assigneeId: 3 });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.taskAssigneeId, 3);
  assert.equal(t.json.taskAssigneeName, "CI Admin");
  const n = await notices(3, "studio_task", doc.id);
  assert.equal(n.length, 1);
  assert.match(n[0].title, /CI Manager assigned you a task/);
  assert.equal(n[0].link, `/studio/${doc.id}?page=p-summary&el=p-summary.body&comment=${c.json.id}`);
  // Assigning again to the same person doesn't notify twice.
  await call("POST", `/studio/comments/${c.json.id}/task`, "manager", { assigneeId: 3 });
  assert.equal((await notices(3, "studio_task", doc.id)).length, 1);
  // "Assign as task" while writing.
  const c2 = await comment(doc.id, "Add the base year", "admin", { taskAssigneeId: 2 });
  assert.equal(c2.json.taskAssigneeId, 2);
  assert.equal((await notices(2, "studio_task", doc.id)).length, 1);

  const mine = await call("GET", `/studio/docs/${doc.id}/comments?tasks=mine`, "admin");
  assert.deepEqual(mine.json.map((x) => x.id), [c.json.id]);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments?tasks=open`, "admin")).json.length, 2);
  const checks = await call("POST", `/studio/docs/${doc.id}/checks`, "manager", { rev: doc.rev });
  assert.equal(checks.status, 200, JSON.stringify(checks.json));
  const open = checks.json.checks.filter((x) => x.id === "OPEN_TASK");
  assert.equal(open.length, 2);
  assert.ok(open.every((x) => x.severity === "info"));
  assert.ok(open.some((x) => x.message.startsWith("Open task for CI Admin: Rewrite the Scope 1 sentence") && x.elementId === "p-summary.body"));

  const done = await call("PATCH", `/studio/comments/${c.json.id}/task`, "admin", { done: true });
  assert.ok(done.json.taskDoneAt);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/comments?tasks=mine`, "admin")).json.length, 0);
  const after = await call("POST", `/studio/docs/${doc.id}/checks`, "manager", { rev: doc.rev });
  assert.equal(after.json.checks.filter((x) => x.id === "OPEN_TASK").length, 1);
  const cleared = await call("POST", `/studio/comments/${c2.json.id}/task`, "admin", { assigneeId: null });
  assert.equal(cleared.json.taskAssigneeId, null);
  const plain = await comment(doc.id, "Not a task", "admin");
  assert.equal((await call("PATCH", `/studio/comments/${plain.json.id}/task`, "admin", { done: true })).json.code, "DS_VALIDATION");
});

test("approval roles: a Manager reviews; only the reviewer decides; changes need a note; the requester withdraws", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Approval");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/approvals`, "manager", { reviewerId: 3, rev: doc.rev })).json.code, "DS_VALIDATION", "an Admin can't be the reviewer");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/approvals`, "manager", { reviewerId: 2, rev: doc.rev })).json.code, "DS_VALIDATION", "not yourself");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 6, rev: doc.rev })).json.code, "DS_VALIDATION", "another company's Manager");
  assert.equal((await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev - 1 })).json.code, "DS_VERSION_CONFLICT");
  const a = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev, dueAt: "2026-10-28", note: "Board meeting on Friday" });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.state, "requested");
  assert.equal(a.json.rev, doc.rev);
  assert.equal(a.json.dueAt, "2026-10-28");
  assert.equal(a.json.reviewerName, "CI Manager");
  const n = await notices(2, "studio_approval_requested", doc.id);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /Due 28 Oct\. Board meeting on Friday/);
  assert.equal(n[0].link, `/studio/${doc.id}?approval=${a.json.id}`);

  assert.equal((await call("POST", `/studio/approvals/${a.json.id}/decide`, "admin", { decision: "approve" })).json.code, "DS_ROLE", "an Admin can't approve");
  assert.equal((await call("POST", `/studio/approvals/${a.json.id}/decide`, "manager", { decision: "request_changes" })).json.code, "DS_VALIDATION", "a note is required");
  assert.equal((await call("DELETE", `/studio/approvals/${a.json.id}`, "manager")).json.code, "DS_ROLE", "only the requester withdraws");
  const ch = await call("POST", `/studio/approvals/${a.json.id}/decide`, "manager", { decision: "request_changes", note: "Explain the Scope 2 drop" });
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  assert.equal(ch.json.state, "changes_requested");
  assert.equal(ch.json.decisionNote, "Explain the Scope 2 drop");
  const d = await notices(3, "studio_approval_decided", doc.id);
  assert.equal(d.length, 1);
  assert.match(d[0].title, /CI Manager requested changes/);
  assert.equal((await call("POST", `/studio/approvals/${a.json.id}/decide`, "manager", { decision: "approve" })).json.code, "DS_VALIDATION", "already decided");

  // A new request; a second one withdraws the first; the requester withdraws the second.
  const b1 = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev });
  const b2 = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev });
  let list = await call("GET", `/studio/docs/${doc.id}/approvals`, "admin");
  assert.equal(list.json.approvals.find((x) => x.id === b1.json.id).state, "none");
  assert.equal(list.json.current.id, b2.json.id);
  assert.equal((await call("DELETE", `/studio/approvals/${b2.json.id}`, "admin")).status, 204);
  list = await call("GET", `/studio/docs/${doc.id}/approvals`, "admin");
  assert.equal(list.json.current.id, a.json.id, "the newest request that wasn't withdrawn");
  assert.equal(list.json.requireReview, false);

  // Approve, then an edit makes it an earlier version.
  const c = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: doc.rev });
  const ok = await call("POST", `/studio/approvals/${c.json.id}/decide`, "manager", { decision: "approve" });
  assert.equal(ok.json.state, "approved");
  assert.equal(ok.json.rev, doc.rev);
  assert.equal((await call("GET", `/studio/docs/${doc.id}/approvals`, "admin")).json.stale, false);
  const cur = await call("GET", `/studio/docs/${doc.id}`, "admin");
  const p = await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: cur.json.rev, title: "DS-13 Approval (edited)" });
  assert.equal(p.status, 200);
  const stale = await call("GET", `/studio/docs/${doc.id}/approvals`, "admin");
  assert.equal(stale.json.stale, true, "Approved an earlier version");
  assert.equal(stale.json.rev, p.json.rev);
});

test("require review: a final needs an approval for the current rev", async () => {
  await setStudio(1, true);
  assert.equal((await call("PUT", "/studio/review-settings", "admin", { requireReview: true })).json.code, "DS_ROLE", "Admins can't");
  const on = await call("PUT", "/studio/review-settings", "manager", { requireReview: true });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.requireReview, true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'design_studio' AND action = 'review_settings' AND entity_id = 1`))[0].n >= 1, true);

  const doc = await makeDoc("DS-13 Gate");
  const ready = await readyForFinal(doc.id);
  const final = () => call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "final", rev: ready.rev, acknowledgedWarnings: ready.acknowledgedWarnings });
  let r = await final();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "DS_APPROVAL_PENDING");
  assert.equal(r.json.details.reason, "none");
  const a = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: ready.rev });
  r = await final();
  assert.equal(r.json.code, "DS_APPROVAL_PENDING");
  assert.equal(r.json.details.reason, "requested");
  const rc = await call("POST", `/studio/approvals/${a.json.id}/decide`, "manager", { decision: "request_changes", note: "No" });
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  assert.equal((await final()).json.details.reason, "changes_requested");
  const a2 = await call("POST", `/studio/docs/${doc.id}/approvals`, "admin", { reviewerId: 2, rev: ready.rev });
  await call("POST", `/studio/approvals/${a2.json.id}/decide`, "manager", { decision: "approve" });
  r = await final();
  assert.equal(r.status, 202, JSON.stringify(r.json));

  // An approval of an earlier rev doesn't count.
  const doc2 = await makeDoc("DS-13 Gate stale");
  const r2 = await readyForFinal(doc2.id);
  const a3 = await call("POST", `/studio/docs/${doc2.id}/approvals`, "admin", { reviewerId: 2, rev: r2.rev });
  await call("POST", `/studio/approvals/${a3.json.id}/decide`, "manager", { decision: "approve" });
  const p = await call("PATCH", `/studio/docs/${doc2.id}`, "manager", { rev: r2.rev, title: "DS-13 Gate stale (edited)" });
  const s = await call("POST", `/studio/docs/${doc2.id}/jobs`, "manager", { kind: "final", rev: p.json.rev, acknowledgedWarnings: r2.acknowledgedWarnings });
  assert.equal(s.json.code, "DS_APPROVAL_PENDING");
  assert.equal(s.json.details.reason, "stale");
  // Proofs are never gated by review.
  assert.equal((await call("POST", `/studio/docs/${doc2.id}/jobs`, "manager", { kind: "proof", rev: p.json.rev })).status, 202);
  await call("PUT", "/studio/review-settings", "manager", { requireReview: false });
});

test("version history: a restored version makes a new rev; pruning keeps finals and named versions", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 History");
  const snap = await call("POST", `/studio/docs/${doc.id}/versions`, "admin", { note: "Before the rewrite" });
  assert.equal(snap.status, 201, JSON.stringify(snap.json));
  const p = await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: doc.rev, title: "DS-13 History (rewritten)" });
  const restored = await call("POST", `/studio/docs/${doc.id}/versions/${snap.json.n}/restore`, "admin", { rev: p.json.rev });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.rev, p.json.rev + 1, "a new rev");
  assert.equal(restored.json.doc.meta.title, "DS-13 History");
  // The snapshot previews read-only, as it was (title), while the draft moved on.
  const pv = await call("GET", `/studio/docs/${doc.id}/versions/${snap.json.n}/preview.html?mode=paged`, "admin");
  assert.equal(pv.status, 200);
  assert.equal(pv.headers.get("x-doc-version"), String(snap.json.n));
  assert.match(pv.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.ok(pv.buffer.toString("utf8").includes("data-page-id"), "the version's pages are drawn");
  assert.equal((await call("GET", `/studio/docs/${doc.id}/versions/999/preview.html`, "admin")).status, 404);
  const versions = (await call("GET", `/studio/docs/${doc.id}/versions`, "admin")).json;
  assert.ok(versions.some((v) => v.kind === "autosave" && v.note === `Restored from version ${snap.json.n}` && v.rev === restored.json.rev));

  // Pruning: 205 autosaves and a final and a snapshot, all 100 days old.
  await q(`DELETE FROM report_doc_version WHERE doc_id = $1`, [doc.id]);
  await q(
    `INSERT INTO report_doc_version (doc_id, n, kind, rev, doc, created_at)
     SELECT $1, g, CASE WHEN g = 1 THEN 'final' WHEN g = 2 THEN 'snapshot' ELSE 'autosave' END, 1, '{}'::jsonb, now() - interval '100 days' + (g || ' seconds')::interval
       FROM generate_series(1, 207) g`,
    [doc.id],
  );
  const run = runHistory();
  assert.ok(run.docs >= 1);
  const left = await q(`SELECT kind, count(*)::int AS n FROM report_doc_version WHERE doc_id = $1 GROUP BY kind ORDER BY kind`, [doc.id]);
  assert.deepEqual(left, [{ kind: "autosave", n: 200 }, { kind: "final", n: 1 }, { kind: "snapshot", n: 1 }]);
  const oldest = await q(`SELECT MIN(n)::int AS n FROM report_doc_version WHERE doc_id = $1 AND kind = 'autosave'`, [doc.id]);
  assert.equal(oldest[0].n, 8, "the newest 200 autosaves are kept");
  // Recent autosaves are never pruned, whatever their number.
  await q(`UPDATE report_doc_version SET created_at = now() WHERE doc_id = $1`, [doc.id]);
  await q(`INSERT INTO report_doc_version (doc_id, n, kind, rev, doc) SELECT $1, 300 + g, 'autosave', 1, '{}'::jsonb FROM generate_series(1, 10) g`, [doc.id]);
  runHistory();
  assert.equal((await q(`SELECT count(*)::int AS n FROM report_doc_version WHERE doc_id = $1 AND kind = 'autosave'`, [doc.id]))[0].n, 210);
});

test("drift: typed text whose figures changed is listed with before and after; DATA_CHANGED until marked as checked", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Drift");
  // Nothing recorded under the fixture's old hash yet: the text is listed, "before" unknown.
  const d0 = await call("GET", `/studio/docs/${doc.id}/drift`, "admin");
  assert.equal(d0.status, 200, JSON.stringify(d0.json));
  assert.match(d0.json.dataHash, /^sha256:/);
  const body0 = d0.json.changed.find((x) => x.elementId === "p-summary.body");
  assert.ok(body0, JSON.stringify(d0.json.changed));
  assert.equal(body0.basedOnHash, "sha256:abc");
  assert.equal(body0.before, null);
  assert.ok(!d0.json.changed.some((x) => x.elementId === "p-summary.heading"), "a heading with no figures isn't listed");
  // The figures as they were under the old hash: the split chart showed something else.
  const [cur] = await q(`SELECT values FROM report_data_baseline WHERE doc_id = $1 AND data_hash = $2`, [doc.id, d0.json.dataHash]);
  assert.ok(cur, "the current figures were recorded");
  const old = { ...cur.values, "p-summary.split": "999 tCO₂e" };
  await q(`INSERT INTO report_data_baseline (doc_id, data_hash, values) VALUES ($1, 'sha256:abc', $2::jsonb) ON CONFLICT (doc_id, data_hash) DO UPDATE SET values = EXCLUDED.values`, [doc.id, JSON.stringify(old)]);
  const d1 = await call("GET", `/studio/docs/${doc.id}/drift`, "admin");
  const body1 = d1.json.changed.find((x) => x.elementId === "p-summary.body");
  assert.equal(body1.figures.length, 1);
  assert.equal(body1.figures[0].elementId, "p-summary.split");
  assert.equal(body1.figures[0].before, "999 tCO₂e");
  assert.equal(body1.figures[0].after, cur.values["p-summary.split"]);
  assert.match(body1.before, /999 tCO₂e/);
  const checks = await call("POST", `/studio/docs/${doc.id}/checks`, "admin", { rev: doc.rev });
  const dc = checks.json.checks.filter((x) => x.id === "DATA_CHANGED");
  assert.ok(dc.some((x) => x.elementId === "p-summary.body" && x.severity === "warning"), JSON.stringify(dc));
  assert.ok(checks.json.warnings.includes("DATA_CHANGED"), "a final needs it acknowledged");
  // "Mark as checked": the editor stamps the current hash on the element.
  const d = JSON.parse(JSON.stringify(doc.doc));
  for (const pg of d.pages) for (const e of pg.elements ?? []) if (e.id === "p-summary.body") e.basedOnHash = d1.json.dataHash;
  const p = await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: doc.rev, doc: d });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const d2 = await call("GET", `/studio/docs/${doc.id}/drift`, "admin");
  assert.ok(!d2.json.changed.some((x) => x.elementId === "p-summary.body"));
  const c2 = await call("POST", `/studio/docs/${doc.id}/checks`, "admin", { rev: p.json.rev });
  assert.ok(!c2.json.checks.some((x) => x.id === "DATA_CHANGED" && x.elementId === "p-summary.body"));
});

test("brand controls: a Superadmin sets them; an Admin can't change a template-locked element, a Manager can", async () => {
  await setStudio(1, true);
  await q(`UPDATE company SET report_require_review = false, brand_controls = false WHERE company_id = 1`);
  assert.equal((await call("PUT", "/studio/review-settings", "manager", { brandControls: true })).json.code, "DS_ROLE");
  const s0 = await call("GET", "/studio/review-settings", "admin");
  assert.deepEqual(s0.json, { requireReview: false, brandControls: false, canEditRequireReview: false, canEditBrandControls: false });
  const doc = await makeDoc("DS-13 Locks", { who: "admin" });
  const move = (d) => {
    const x = JSON.parse(JSON.stringify(d));
    for (const pg of x.pages) for (const e of pg.elements ?? []) if (e.id === "p-cover.title") { e.templateLocked = true; }
    return x;
  };
  // The cover title becomes template-locked (as a template made it).
  const locked = await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: doc.rev, doc: move(doc.doc) });
  assert.equal(locked.status, 200, JSON.stringify(locked.json));
  const unlock = (d) => {
    const x = JSON.parse(JSON.stringify(d));
    for (const pg of x.pages) for (const e of pg.elements ?? []) if (e.id === "p-cover.title") { delete e.templateLocked; e.frame.x += 5; }
    return x;
  };
  // Brand controls off: an Admin may still unlock it.
  const off = await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: locked.json.rev, doc: unlock(locked.json.doc) });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  const relocked = await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: off.json.rev, doc: move(off.json.doc) });
  const sa = await call("PUT", "/studio/review-settings?company_id=1", "superadmin", { brandControls: true, company_id: 1 });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.equal(sa.json.brandControls, true);
  assert.equal((await call("GET", "/studio/brand-kit", "admin")).json.brandControls, true, "the brand kit reports it (DS-3 pickers)");
  const refused = await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: relocked.json.rev, doc: unlock(relocked.json.doc) });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, "DS_ROLE");
  assert.equal(refused.json.details.reason, "template_locked");
  assert.deepEqual(refused.json.details.elementIds, ["p-cover.title"]);
  // Other edits by the Admin are fine.
  const other = JSON.parse(JSON.stringify(relocked.json.doc));
  other.meta.title = "DS-13 Locks (renamed)";
  assert.equal((await call("PATCH", `/studio/docs/${doc.id}`, "admin", { rev: relocked.json.rev, doc: other })).status, 200);
  const cur = await call("GET", `/studio/docs/${doc.id}`, "manager");
  assert.equal((await call("PATCH", `/studio/docs/${doc.id}`, "manager", { rev: cur.json.rev, doc: unlock(cur.json.doc) })).status, 200, "a Manager may unlock");
  await call("PUT", "/studio/review-settings?company_id=1", "superadmin", { brandControls: false, company_id: 1 });
});

test("save as template and as layout: company-owned, locked elements become template-locked, re-save and archive", async () => {
  await setStudio(1, true);
  const doc = await makeDoc("DS-13 Template", {
    edit: (d) => {
      for (const pg of d.pages) for (const e of pg.elements ?? []) if (e.id === "p-summary.rule") e.locked = true;
      return d;
    },
  });
  const t = await call("POST", "/studio/templates/from-doc", "admin", { docId: doc.id, name: "DS-13 Company look", tags: ["Board"] });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  assert.equal(t.json.companyId, 1);
  assert.equal(t.json.kind, "ghg");
  assert.equal(t.json.version, 1);
  assert.deepEqual(t.json.tags, ["board"]);
  const qr = t.json.doc.pages.find((p) => p.id === "p-summary").elements.find((e) => e.id === "p-summary.rule");
  assert.equal(qr.templateLocked, true);
  assert.equal(qr.locked, undefined);
  assert.ok(!JSON.stringify(t.json.doc).includes("basedOnHash"), "per-design drift marks are dropped");
  const listed = await call("GET", "/studio/templates?kind=ghg", "manager");
  assert.ok(listed.json.some((x) => x.id === t.json.id));
  const layouts = await call("GET", `/studio/layouts?template=${t.json.slug}`, "manager");
  assert.equal(layouts.json.length, 3, "one layout per free-form page");
  assert.ok(layouts.json.every((l) => l.companyId === 1));
  // A design built from it keeps the lock.
  const built = await call("POST", "/studio/docs", "manager", { kind: "ghg", templateId: t.json.id, year: 2023, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, title: "DS-13 From template" });
  assert.equal(built.status, 201, JSON.stringify(built.json));
  const els = built.json.doc.pages.flatMap((p) => p.elements ?? []);
  assert.ok(els.some((e) => e.id.endsWith(".rule") && e.templateLocked === true), `the built design keeps the template lock: ${JSON.stringify(els.map((e) => [e.id, e.templateLocked]))}`);
  // Re-save: version 2, version 1 archived.
  const t2 = await call("POST", "/studio/templates/from-doc", "manager", { docId: doc.id, name: "DS-13 Company look", replaceTemplateId: t.json.id, lockLocked: false });
  assert.equal(t2.status, 201, JSON.stringify(t2.json));
  assert.equal(t2.json.version, 2);
  assert.equal(t2.json.slug, t.json.slug);
  const after = (await call("GET", "/studio/templates?kind=ghg", "manager")).json.filter((x) => x.slug === t.json.slug);
  assert.deepEqual(after.map((x) => x.id), [t2.json.id]);
  // Archive.
  assert.equal((await call("DELETE", `/studio/templates/${t2.json.id}`, "admin")).status, 204);
  assert.ok(!(await call("GET", "/studio/templates?kind=ghg", "manager")).json.some((x) => x.slug === t.json.slug));
  const sys = (await call("GET", "/studio/templates?kind=ghg", "manager")).json.find((x) => x.companyId === null);
  if (sys) assert.equal((await call("DELETE", `/studio/templates/${sys.id}`, "manager")).status, 404, "system templates can't be archived");

  const l = await call("POST", "/studio/layouts/from-page", "admin", { docId: doc.id, pageId: "p-summary", name: "DS-13 Summary" });
  assert.equal(l.status, 201, JSON.stringify(l.json));
  assert.equal(l.json.companyId, 1);
  assert.equal(l.json.name, "DS-13 Summary");
  assert.ok(l.json.page.elements.every((e) => e.id.startsWith("p-summary.")));
  assert.equal(l.json.page.elements.find((e) => e.id === "p-summary.rule").templateLocked, true, "locked → locked for others");
  assert.equal((await call("POST", "/studio/layouts/from-page", "admin", { docId: doc.id, pageId: "p-categories", name: "DS-13 Flow" })).json.code, "DS_VALIDATION", "flow sections aren't layouts");
  assert.equal((await call("POST", "/studio/layouts/from-page", "admin", { docId: doc.id, pageId: "nope", name: "x" })).status, 404);
  assert.equal((await call("POST", "/studio/templates/from-doc", "admin", { docId: doc.id })).json.code, "DS_VALIDATION");
});
