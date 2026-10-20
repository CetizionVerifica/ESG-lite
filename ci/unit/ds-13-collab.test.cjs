// DS-13 pure logic: approval status (stale, approved for the rev), template-lock changes,
// drift (figures keyed per element and chip, which typed texts drifted, before/after),
// the DATA_CHANGED / OPEN_TASK checks, save-as-template pages, the notice email, contracts.
// Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const { approvalStatus } = dist("studio/collab/approvals.js");
const { lockedChanges } = dist("studio/collab/locks.js");
const { docFigures, driftItems, collabChecks } = dist("studio/collab/drift.js");
const { templatePage, layoutPage } = dist("studio/collab/templates.js");
const { noticeEmail, shorten } = dist("studio/collab/notify.js");
const C = dist("studio/contracts/index.js");

const FIXTURE = require(path.resolve("ci/fixtures/studio/ghg-doc.json"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const doc = () => C.ReportDocSchema.parse(clone(FIXTURE));

test("approvalStatus: approved for this rev, an earlier one (stale), or not approved", () => {
  assert.deepEqual(approvalStatus(null, 4), { stale: false, approvedForRev: false });
  assert.deepEqual(approvalStatus({ state: "requested", rev: 4 }, 4), { stale: false, approvedForRev: false });
  assert.deepEqual(approvalStatus({ state: "approved", rev: 4 }, 4), { stale: false, approvedForRev: true });
  assert.deepEqual(approvalStatus({ state: "approved", rev: 3 }, 4), { stale: true, approvedForRev: false });
  assert.deepEqual(approvalStatus({ state: "changes_requested", rev: 4 }, 4), { stale: false, approvedForRev: false });
});

test("lockedChanges: a template-locked element moved, unlocked or removed; other edits are free", () => {
  const before = { pages: [{ elements: [{ id: "a", templateLocked: true, frame: { x: 1 } }, { id: "b", frame: { x: 1 } }] }] };
  assert.deepEqual(lockedChanges(before, clone(before)), []);
  const keyOrder = { pages: [{ elements: [{ frame: { x: 1 }, templateLocked: true, id: "a" }] }] };
  assert.deepEqual(lockedChanges(before, keyOrder), [], "key order doesn't count");
  const moved = clone(before);
  moved.pages[0].elements[0].frame.x = 2;
  assert.deepEqual(lockedChanges(before, moved), ["a"]);
  const unlocked = clone(before);
  delete unlocked.pages[0].elements[0].templateLocked;
  assert.deepEqual(lockedChanges(before, unlocked), ["a"]);
  assert.deepEqual(lockedChanges(before, { pages: [{ elements: [] }] }), ["a"]);
  const other = clone(before);
  other.pages[0].elements[1].frame.x = 9;
  assert.deepEqual(lockedChanges(before, other), []);
  // Locking something new is fine.
  assert.deepEqual(lockedChanges(other, before), []);
});

const resolved = (d, displays = {}) => {
  const ix = dist("studio/checks/walk.js").docIndex(d);
  return {
    values: ix.bindings.map((b) => ({ source: "ghg", display: displays[b.elementId] ?? `${b.elementId}=1`, value: 1, unit: "tCO2e" })),
    tokens: ix.tokens.map((t, i) => ({ source: "ghg", display: displays[`tok${i}`] ?? `chip${i}`, value: 1, unit: "tCO2e" })),
  };
};

test("docFigures: one figure per bound element and per chip, keyed by element (and chip number)", () => {
  const d = doc();
  const figs = docFigures(d, resolved(d));
  const keys = figs.map((f) => f.key);
  assert.ok(keys.includes("p-summary.split"));
  assert.ok(keys.includes("p-cover.total"));
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  const chips = figs.filter((f) => f.key.includes("#"));
  for (const c of chips) assert.match(c.key, /^[^#]+#\d+$/);
  assert.ok(figs.every((f) => typeof f.display === "string" && f.pageId));
});

test("driftItems: typed text about data whose hash moved and whose page figures changed", () => {
  const d = doc();
  const figs = docFigures(d, resolved(d));
  // p-summary.body was written against sha256:abc (the fixture's stamp).
  const unknown = driftItems(d, figs, "sha256:now", null, new Map());
  const body = unknown.find((x) => x.elementId === "p-summary.body");
  assert.ok(body, "listed when the old figures weren't recorded");
  assert.equal(body.before, null);
  assert.equal(body.basedOnHash, "sha256:abc");
  assert.ok(body.figures.length > 0 && body.figures.every((f) => f.before === null));
  assert.ok(!unknown.some((x) => x.elementId === "p-summary.heading"), "no digits, no chips: not about data");

  const same = Object.fromEntries(figs.map((f) => [f.key, f.display]));
  assert.ok(!driftItems(d, figs, "sha256:now", null, new Map([["sha256:abc", same]])).some((x) => x.elementId === "p-summary.body"), "hash moved because of figures elsewhere: not listed");
  const changed = { ...same, "p-summary.split": "old" };
  const items = driftItems(d, figs, "sha256:now", null, new Map([["sha256:abc", changed]]));
  const b = items.find((x) => x.elementId === "p-summary.body");
  assert.deepEqual(b.figures.map((f) => [f.elementId, f.before, f.after]), [["p-summary.split", "old", "p-summary.split=1"]]);
  assert.match(b.before, /: old$/);
  assert.match(b.after, /: p-summary\.split=1$/);
  assert.equal(b.pageName, "Executive summary");

  assert.ok(!driftItems(d, figs, "sha256:abc", null, new Map()).some((x) => x.elementId === "p-summary.body"), "in step with the data");
  // Text without its own stamp is measured against the design's build hash.
  const d2 = clone(FIXTURE);
  for (const p of d2.pages) for (const e of p.elements ?? []) delete e.basedOnHash;
  const p2 = C.ReportDocSchema.parse(d2);
  const f2 = docFigures(p2, resolved(p2));
  assert.equal(driftItems(p2, f2, "sha256:now", null, new Map()).length, 0, "no stamp and no build hash: nothing to compare");
  assert.ok(driftItems(p2, f2, "sha256:now", "sha256:built", new Map()).some((x) => x.elementId === "p-summary.body"));
  // Hidden text isn't printed: not listed.
  const d3 = clone(FIXTURE);
  for (const p of d3.pages) for (const e of p.elements ?? []) if (e.id === "p-summary.body") e.hidden = true;
  const p3 = C.ReportDocSchema.parse(d3);
  assert.ok(!driftItems(p3, docFigures(p3, resolved(p3)), "sha256:now", null, new Map()).some((x) => x.elementId === "p-summary.body"));
});

test("collabChecks: DATA_CHANGED warnings and OPEN_TASK info, anchored where they can be", () => {
  const checks = collabChecks(
    [{ elementId: "e1", pageId: "p1", pageName: "P", text: "t", basedOnHash: "h", before: "A: 1", after: "A: 2", figures: [] }],
    [
      { id: 4, pageId: "p1", elementId: "e1", body: "Fix it", assignee: "Asha Rao" },
      { id: 5, pageId: "gone", elementId: "e9", body: "x".repeat(200), assignee: "Asha Rao" },
    ],
    new Set(["p1"]),
  );
  assert.equal(checks.length, 3);
  assert.deepEqual([checks[0].id, checks[0].severity, checks[0].elementId], ["DATA_CHANGED", "warning", "e1"]);
  assert.match(checks[0].message, /A: 1 → A: 2/);
  assert.deepEqual([checks[1].id, checks[1].severity, checks[1].pageId, checks[1].elementId], ["OPEN_TASK", "info", "p1", "e1"]);
  assert.equal(checks[1].message, "Open task for Asha Rao: Fix it");
  assert.equal(checks[2].pageId, undefined, "a deleted page isn't linked");
  assert.ok(checks[2].message.endsWith("…"));
  for (const c of checks) assert.ok(C.CheckSchema.safeParse(c).success, JSON.stringify(c));
});

test("templatePage / layoutPage: locked → template-locked, per-design marks dropped, layout ids prefixed", () => {
  const page = { id: "p1", kind: "freeform", elements: [{ id: "p1.a", locked: true, basedOnHash: "h", reviewed: true }, { id: "x9", templateLocked: true }] };
  const t = templatePage(page, true);
  assert.deepEqual(t.elements[0], { id: "p1.a", templateLocked: true });
  assert.deepEqual(t.elements[1], { id: "x9", templateLocked: true });
  assert.equal(page.elements[0].locked, true, "the input isn't changed");
  assert.deepEqual(templatePage(page, false).elements[0], { id: "p1.a", locked: true });
  const l = layoutPage(page, true);
  assert.deepEqual(l.elements.map((e) => e.id), ["p1.a", "p1.x9"]);
});

test("noticeEmail: escaped text and the deep link on the app's base URL", () => {
  const m = noticeEmail({ title: `Asha mentioned you in "<b>FY26</b>"`, message: "Check <script>", link: "/studio/4?page=p1&comment=2" }, "https://app.example.com/");
  assert.equal(m.subject, `Asha mentioned you in "<b>FY26</b>"`);
  assert.ok(m.html.includes("&lt;b&gt;FY26&lt;/b&gt;"));
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes(`href="https://app.example.com/studio/4?page=p1&amp;comment=2"`));
  assert.equal(shorten("abcdef", 4), "abc…");
  assert.equal(shorten("abc", 4), "abc");
});

test("contracts: comment, task, approval and settings bodies", () => {
  assert.ok(C.CreateCommentBodySchema.safeParse({ pageId: "p1", body: "Hi", mentions: [2], x: 10, y: 20 }).success);
  assert.equal(C.CreateCommentBodySchema.safeParse({ pageId: "p1", body: " " }).success, false);
  assert.equal(C.CreateCommentBodySchema.safeParse({ pageId: "p1", body: "x".repeat(4001) }).success, false);
  assert.equal(C.CreateCommentBodySchema.safeParse({ pageId: "p1", body: "x", extra: 1 }).success, false);
  assert.equal(C.PatchCommentBodySchema.safeParse({}).success, false);
  assert.ok(C.AssignTaskBodySchema.safeParse({ assigneeId: null }).success);
  assert.equal(C.DecideApprovalBodySchema.safeParse({ decision: "request_changes" }).success, false, "changes need a note");
  assert.ok(C.DecideApprovalBodySchema.safeParse({ decision: "request_changes", note: "Fix page 3" }).success);
  assert.ok(C.DecideApprovalBodySchema.safeParse({ decision: "approve" }).success);
  assert.equal(C.RequestApprovalBodySchema.safeParse({ reviewerId: 2, rev: 1, dueAt: "28 Oct" }).success, false);
  assert.ok(C.CHECK_IDS.includes("OPEN_TASK"));
  assert.equal(C.CHECK_RULES.OPEN_TASK.severity, "info");
  assert.deepEqual([...C.STUDIO_NOTIFICATION_TYPES], ["studio_mention", "studio_task", "studio_approval_requested", "studio_approval_decided"]);
});
