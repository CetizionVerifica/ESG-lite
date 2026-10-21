// IN-4 · Insights events: migrate:in-events twice, the CRUD role matrix
// (creator / Admin / Superadmin edit and delete; Managers write for their
// sites, company-level only when they reach every site), site scope,
// validation (IN_EVENT_INVALID, the data-range window), IN_EVENT_NOT_FOUND,
// tenant isolation, switch-off, audit rows, and the stamp moving with events.
//
// A Manager of site 1 only (user 9401) is created here and removed by id.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { call } = require("../helpers.cjs");
const { setInsights, runScript, q } = require("./in-lib.cjs");

const PARTIAL = { userId: 9401, role: "Manager" };
const asPartial = async (method, route, body) => {
  const headers = { Authorization: `Bearer ${jwt.sign(PARTIAL, process.env.JWT_SECRET)}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${process.env.API_BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const ok = { date: "2025-06-01", label: "New boiler", kind: "initiative" };

const reset = async () => {
  await q(`DELETE FROM insight_event WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'insight_event'`);
  await q(`DELETE FROM user_sites WHERE user_id = 9401`);
  await q(`DELETE FROM "user" WHERE user_id = 9401`);
  await setInsights(1, false);
  await setInsights(2, false);
};
test.before(async () => {
  await reset();
  await q(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES (9401, 'IN-4 Site-1 Manager', 'in4-partial@example.invalid', 'x', 'Manager', NULL)`);
  await q(`INSERT INTO user_sites (user_id, site_id) VALUES (9401, 1)`);
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(reset);

test("migrate:in-events runs twice and leaves the table and its index", async () => {
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateInEvents");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const cols = (await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'insight_event' ORDER BY ordinal_position`)).map((c) => `${c.column_name}:${c.is_nullable}`);
  assert.deepEqual(cols, ["id:NO", "company_id:NO", "site_id:YES", "date:NO", "label:NO", "kind:NO", "created_by:NO", "created_at:NO", "updated_at:NO"]);
  assert.equal((await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_insight_event_company_date'`)).length, 1);
});

test("create: a Manager for their sites and company-level (all sites), an Admin, a Superadmin with company_id", async () => {
  const m = await call("POST", "/insights/events", "manager", { ...ok, site_id: 1 });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  assert.deepEqual({ ...m.json.event, id: 0 }, { id: 0, date: "2025-06-01", label: "New boiler", kind: "initiative", site_id: 1, created_by: 2, can_edit: true });
  const company = await call("POST", "/insights/events", "manager", { ...ok, label: "Company wide", site_id: null });
  assert.equal(company.status, 201);
  assert.equal(company.json.event.site_id, null);
  assert.equal((await call("POST", "/insights/events", "admin", { ...ok, label: "Admin event", site_id: 2, kind: "disruption" })).status, 201);
  const sa = await call("POST", "/insights/events", "superadmin", { ...ok, label: "SA event", company_id: 1 });
  assert.equal(sa.status, 201, JSON.stringify(sa.json));
  assert.equal(sa.json.event.created_by, 5);
  assert.equal((await call("POST", "/insights/events", "superadmin", ok)).json.code, "IN_COMPANY_REQUIRED");
  const rows = await q(`SELECT action FROM audit_log WHERE entity_type = 'insight_event' ORDER BY id`);
  assert.equal(rows.filter((r) => r.action === "create").length, 4);
});

test("site scope: a site outside the caller's is 404; company-level needs every site (403)", async () => {
  const other = await call("POST", "/insights/events", "manager", { ...ok, site_id: 3 });
  assert.equal(other.status, 404);
  assert.equal(other.json.code, "IN_SITE_NOT_FOUND");
  const p2 = await asPartial("POST", "/insights/events", { ...ok, site_id: 2 });
  assert.equal(p2.status, 404);
  const pc = await asPartial("POST", "/insights/events", { ...ok, site_id: null });
  assert.equal(pc.status, 403);
  assert.equal(pc.json.code, "IN_FORBIDDEN");
  const p1 = await asPartial("POST", "/insights/events", { ...ok, label: "Partial's own", site_id: 1 });
  assert.equal(p1.status, 201);
});

test("validation: IN_EVENT_INVALID for a long label, an unknown kind, a bad date or one outside the data range ± 1 year", async () => {
  for (const body of [
    { ...ok, label: "x".repeat(61) },
    { ...ok, label: "   " },
    { ...ok, kind: "party" },
    { ...ok, date: "2025-13-01" },
    { ...ok, date: "01/06/2025" },
    { ...ok, date: "2010-01-01" },
    { ...ok, date: "2031-01-01" },
    {},
  ]) {
    const r = await call("POST", "/insights/events", "admin", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, "IN_EVENT_INVALID", JSON.stringify(body));
    assert.ok(Array.isArray(r.json.details.issues));
  }
  assert.equal((await call("POST", "/insights/events", "admin", { ...ok, label: "x".repeat(60) })).status, 201);
});

test("list: company-level and the scope's sites, by date; sites, from and to narrow it", async () => {
  const all = (await call("GET", "/insights/events", "admin")).json.events;
  assert.ok(all.length >= 5);
  assert.deepEqual(all.map((e) => e.date), [...all.map((e) => e.date)].sort());
  const partial = (await asPartial("GET", "/insights/events")).json.events;
  assert.ok(partial.every((e) => e.site_id === null || e.site_id === 1));
  assert.ok(partial.some((e) => e.site_id === null));
  assert.ok(!partial.some((e) => e.site_id === 2));
  // A Manager may not edit another's event; the Admin may.
  assert.ok(partial.filter((e) => e.created_by !== 9401).every((e) => e.can_edit === false));
  const site2 = (await call("GET", "/insights/events?sites=2", "admin")).json.events;
  assert.ok(site2.every((e) => e.site_id === null || e.site_id === 2));
  assert.equal((await call("GET", "/insights/events?from=2025-06-02", "admin")).json.events.length, 0);
  assert.equal((await call("GET", "/insights/events?from=2025-06-02&to=2025-01-01", "admin")).json.code, "IN_VALIDATION");
  assert.equal((await call("GET", "/insights/events?sites=3", "admin")).status, 404);
});

test("edit and delete: creator, Admin or Superadmin; others 403; unseen or unknown ids 404", async () => {
  const mine = (await call("POST", "/insights/events", "manager", { ...ok, label: "Manager's", site_id: 2 })).json.event;
  const partials = (await asPartial("GET", "/insights/events")).json.events.find((e) => e.created_by === 9401);
  // creator
  const p = await call("PATCH", `/insights/events/${mine.id}`, "manager", { label: "Renamed", kind: "other" });
  assert.equal(p.status, 200);
  assert.equal(p.json.event.label, "Renamed");
  assert.equal(p.json.event.kind, "other");
  // another Manager (the partial one can't even see a site-2 event)
  assert.equal((await asPartial("PATCH", `/insights/events/${mine.id}`, { label: "x" })).json.code, "IN_EVENT_NOT_FOUND");
  // a Manager who sees it but didn't create it
  const r = await call("PATCH", `/insights/events/${partials.id}`, "manager", { label: "x" });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "IN_FORBIDDEN");
  // Admin and Superadmin
  assert.equal((await call("PATCH", `/insights/events/${partials.id}`, "admin", { date: "2025-07-01" })).json.event.date, "2025-07-01");
  assert.equal((await call("PATCH", `/insights/events/${partials.id}?company_id=1`, "superadmin", { label: "SA renamed" })).status, 200);
  // bad bodies and ids
  assert.equal((await call("PATCH", `/insights/events/${mine.id}`, "manager", {})).json.code, "IN_EVENT_INVALID");
  assert.equal((await call("PATCH", `/insights/events/${mine.id}`, "manager", { date: "2009-01-01" })).json.code, "IN_EVENT_INVALID");
  assert.equal((await call("PATCH", `/insights/events/${mine.id}`, "manager", { site_id: 3 })).json.code, "IN_SITE_NOT_FOUND");
  for (const id of ["999999", "abc", "0"]) {
    const x = await call("PATCH", `/insights/events/${id}`, "admin", { label: "x" });
    assert.equal(x.status, 404, id);
    assert.equal(x.json.code, "IN_EVENT_NOT_FOUND");
  }
  // delete
  assert.equal((await call("DELETE", `/insights/events/${partials.id}`, "manager")).status, 403);
  assert.equal((await asPartial("DELETE", `/insights/events/${partials.id}`)).json.removed, partials.id);
  assert.equal((await call("DELETE", `/insights/events/${mine.id}`, "admin")).json.removed, mine.id);
  assert.equal((await call("DELETE", `/insights/events/${mine.id}`, "admin")).status, 404);
  const actions = (await q(`SELECT action FROM audit_log WHERE entity_type = 'insight_event' AND entity_id = $1 ORDER BY id`, [mine.id])).map((x) => x.action);
  assert.deepEqual(actions, ["create", "update", "delete"]);
  const upd = (await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'insight_event' AND entity_id = $1 AND action = 'update'`, [mine.id]))[0].changed_fields;
  assert.deepEqual(upd, { kind: { old: "initiative", new: "other" }, label: "changed" });
});

test("tenant isolation: company 2 never sees or changes company 1's events", async () => {
  const ev = (await call("POST", "/insights/events", "admin", { ...ok, label: "Company 1 only", site_id: 1 })).json.event;
  assert.ok(!(await call("GET", "/insights/events", "otherManager")).json.events.some((e) => e.id === ev.id));
  for (const [method, body] of [["PATCH", { label: "x" }], ["DELETE", undefined]]) {
    const r = await call(method, `/insights/events/${ev.id}`, "otherManager", body);
    assert.equal(r.status, 404, method);
    assert.equal(r.json.code, "IN_EVENT_NOT_FOUND");
  }
  assert.equal((await call("GET", "/insights/events?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("POST", "/insights/events", "otherManager", { ...ok, site_id: 1 })).status, 404);
  const sa = await call("GET", "/insights/events?company_id=2", "superadmin");
  assert.ok(!sa.json.events.some((e) => e.id === ev.id));
});

test("an event moves the data stamp (cached panels refresh)", async () => {
  const before = (await call("GET", "/insights/summary?year=2025", "admin")).json.stamp;
  const ev = (await call("POST", "/insights/events", "admin", { ...ok, label: "Stamp mover" })).json.event;
  const after = (await call("GET", "/insights/summary?year=2025", "admin")).json.stamp;
  assert.notEqual(after, before);
  await call("DELETE", `/insights/events/${ev.id}`, "admin");
  assert.notEqual((await call("GET", "/insights/summary?year=2025", "admin")).json.stamp, after);
});

test("roles and switch-off: Users IN_FORBIDDEN; IN_OFF on every events route while off", async () => {
  for (const [method, path, body] of [["GET", "/insights/events"], ["POST", "/insights/events", ok], ["PATCH", "/insights/events/1", { label: "x" }], ["DELETE", "/insights/events/1"]]) {
    assert.equal((await call(method, path, "user", body)).json.code, "IN_FORBIDDEN", `${method} user`);
  }
  await setInsights(1, false);
  try {
    for (const [method, path, body] of [["GET", "/insights/events"], ["POST", "/insights/events", ok], ["PATCH", "/insights/events/1", { label: "x" }], ["DELETE", "/insights/events/1"]]) {
      const r = await call(method, path, "admin", body);
      assert.equal(r.status, 403, method);
      assert.equal(r.json.code, "IN_OFF");
    }
  } finally {
    await setInsights(1, true);
  }
});
