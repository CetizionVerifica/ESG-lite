// Unit tests for the email fixes: each person's bulk review email counts their
// own entries, Managers hear about every site in one escalation, typed text is
// escaped, the product is called ESGLite, and a failed email alerts the admin once.
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { reviewSummaries } = require(path.resolve("dist/services/reviewMail.js"));
const t = require(path.resolve("dist/templates/emailTemplates.js"));
const { escalationsByManager, siteNamesByEmail } = require(path.resolve("dist/workers/deadlineScheduler.js"));
const { isPermanentError, alertDeliveryFailed } = require(path.resolve("dist/workers/emailConsumer.js"));

const asha = { user_id: 1, email: "asha@x.test" };
const ravi = { user_id: 2, email: "ravi@x.test" };
const row = (creator, category) => ({ created_by: creator, category: { category_name: category } });
const label = (r) => r.category.category_name;

test("a bulk review tells each person about their own entries only", () => {
  const rows = [row(asha, "Stationary"), row(ravi, "Mobile"), row(asha, "Stationary"), row(ravi, "Mobile"), row(asha, "Fugitive"), row(ravi, "Mobile")];
  const out = reviewSummaries(rows, (r) => r.created_by, label);
  assert.equal(out.length, 2);
  const a = out.find((s) => s.creator === asha);
  const r = out.find((s) => s.creator === ravi);
  assert.equal(a.count, 3);
  assert.deepEqual(a.items, [{ categoryName: "Stationary", count: 2 }, { categoryName: "Fugitive", count: 1 }]);
  assert.equal(r.count, 3);
  assert.deepEqual(r.items, [{ categoryName: "Mobile", count: 3 }]);
});

test("rows with no creator or no email are left out of the review emails", () => {
  const out = reviewSummaries([row(null, "X"), row({ user_id: 3, email: "" }, "X"), row(asha, "X")], (r) => r.created_by, label);
  assert.deepEqual(out.map((s) => s.creator), [asha]);
});

test("emails say ESGLite, never ESG Pro, and label the time UTC", () => {
  const all = [
    t.successTemplate("A", "Cat", "Site"),
    t.rejectTemplate("A", "Cat", "Site", "why"),
    t.bulkApprovedTemplate("A", 2, [{ categoryName: "Cat", count: 2 }]),
    t.bulkRejectedTemplate("A", 2, [{ categoryName: "Cat", count: 2 }], "why"),
    t.productionApprovedTemplate("A", "P", "Site"),
    t.productionRejectedTemplate("A", "P", "Site", "why"),
    t.bulkProductionApprovedTemplate("A", 1, [{ categoryName: "P", count: 1 }]),
    t.bulkProductionRejectedTemplate("A", 1, [{ categoryName: "P", count: 1 }], "why"),
    t.deadlineReminderTemplate("A", "September", 2026, "Site"),
    t.escalationTemplate("M", "September", 2026, [{ name: "A", email: "a@x.test", role: "user", siteName: "S" }]),
    t.failureTemplate("a@x.test"),
    t.uploadPendingTemplate("M", 1, 1, ["S"], "Sep 2026"),
  ];
  for (const m of all) {
    assert.ok(m.subject.endsWith("— ESGLite"), m.subject);
    assert.ok(!/ESG Pro/.test(m.subject + m.html), m.subject);
    assert.match(m.html, /\d{2}:\d{2} [AP]M UTC/);
  }
});

test("a rejection reason with < and & arrives as typed, line breaks kept", () => {
  const m = t.rejectTemplate("Asha <b>", "Fuel & oil", "Plant <1>", "Value < 10 & rising\nCheck the unit", { managerName: "Ravi & Co" });
  assert.ok(m.html.includes("Value &lt; 10 &amp; rising<br/>Check the unit"));
  assert.ok(m.html.includes("Hi <strong>Asha &lt;b&gt;</strong>"));
  assert.ok(m.html.includes("Fuel &amp; oil"));
  assert.ok(m.html.includes("Plant &lt;1&gt;"));
  assert.ok(m.html.includes("Ravi &amp; Co"));
  assert.ok(!m.html.includes("<b>"));
});

test("a reason that arrives as a number still renders", () => {
  const m = t.bulkRejectedTemplate("A", 1, [{ categoryName: "Cat", count: 1 }], 123);
  assert.ok(m.html.includes(">123</p>"));
});

test("category and product names in a bulk email are escaped", () => {
  const m = t.bulkApprovedTemplate("A", 1, [{ categoryName: "Heat <steam>", count: 1 }]);
  assert.ok(m.html.includes("Heat &lt;steam&gt;"));
});

test("the upload email escapes once, not twice", () => {
  const m = t.uploadPendingTemplate("Mia & Co", 3, 1.25, ["A & B"], "Mar 2026");
  assert.ok(m.html.includes("A &amp; B"));
  assert.ok(!m.html.includes("&amp;amp;"));
  assert.ok(m.html.includes("Mia &amp; Co"));
});

test("the escalation counts people, not site rows, and its button opens the Overview", () => {
  const users = [
    { name: "A", email: "a@x.test", role: "user", siteName: "Pune" },
    { name: "A", email: "a@x.test", role: "user", siteName: "Noida" },
    { name: "B <x>", email: "b@x.test", role: "user", siteName: "Pune" },
  ];
  const m = t.escalationTemplate("M", "September", 2026, users);
  assert.ok(m.subject.startsWith("2 users haven't submitted data for September 2026"));
  assert.ok(m.html.includes("/overview"));
  assert.ok(m.html.includes("B &lt;x&gt;"));
  assert.ok(t.escalationTemplate("M", "September", 2026, users.slice(0, 1)).subject.startsWith("1 user hasn't"));
});

test("a Manager of several sites gets one escalation listing all of them", () => {
  const m1 = { user_id: 10, email: "m1@x.test" };
  const m2 = { user_id: 11, email: "m2@x.test" };
  const noMail = { user_id: 12, email: null };
  const pending = [
    { siteId: 1, email: "a@x.test", siteName: "Pune" },
    { siteId: 2, email: "b@x.test", siteName: "Noida" },
    { siteId: 3, email: "c@x.test", siteName: "Dubai" },
  ];
  const out = escalationsByManager(pending, new Map([[1, [m1, noMail]], [2, [m1, m2]], [3, []]]));
  assert.equal(out.length, 2);
  assert.deepEqual(out.find((e) => e.manager === m1).users.map((u) => u.siteName), ["Pune", "Noida"]);
  assert.deepEqual(out.find((e) => e.manager === m2).users.map((u) => u.siteName), ["Noida"]);
});

test("a reminder names every site the person still owes", () => {
  const sites = siteNamesByEmail([
    { email: "a@x.test", siteName: "Pune" },
    { email: "b@x.test", siteName: "Pune" },
    { email: "a@x.test", siteName: "Noida" },
    { email: "a@x.test", siteName: "Pune" },
  ]);
  assert.deepEqual(sites.get("a@x.test"), ["Pune", "Noida"]);
  assert.deepEqual(sites.get("b@x.test"), ["Pune"]);
});

test("Brevo refusing an email (400) isn't retried; a rate limit or outage is", () => {
  assert.equal(isPermanentError(new Error("Brevo 400: email is not valid (invalid_parameter)")), true);
  assert.equal(isPermanentError(new Error("Brevo 429: Too many requests")), false);
  assert.equal(isPermanentError(new Error("Brevo 502: Bad Gateway")), false);
  assert.equal(isPermanentError(new Error("fetch failed")), false);
});

test("without ADMIN_EMAIL a failed email is logged, not sent to a made-up address", async () => {
  const before = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAIL;
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await alertDeliveryFailed("a@x.test", "Brevo 400");
  } finally {
    console.warn = warn;
    if (before !== undefined) process.env.ADMIN_EMAIL = before;
  }
  assert.ok(warnings.some((w) => /a@x\.test/.test(w) && /ADMIN_EMAIL is not set/.test(w)), warnings.join("\n"));
});

test("bulk review emails say 1 entry, 2 entries", () => {
  const cat = (n) => [{ categoryName: "Cat", count: n }];
  assert.equal(t.bulkApprovedTemplate("A", 1, cat(1)).subject, "1 emission entry approved — ESGLite");
  assert.equal(t.bulkRejectedTemplate("A", 1, cat(1), "why").subject, "1 emission entry rejected — ESGLite");
  assert.equal(t.bulkApprovedTemplate("A", 2, cat(2)).subject, "2 emission entries approved — ESGLite");
  assert.equal(t.bulkProductionApprovedTemplate("A", 1, cat(1)).subject, "1 production entry approved — ESGLite");
  assert.equal(t.bulkProductionRejectedTemplate("A", 3, cat(3), "why").subject, "3 production entries rejected — ESGLite");
  assert.match(t.bulkRejectedTemplate("A", 1, cat(1), "why").html, /<strong>1<\/strong> of your emission entries has been/);
  assert.match(t.bulkApprovedTemplate("A", 2, cat(2)).html, /<strong>2<\/strong> of your emission entries have been/);
  assert.match(t.bulkProductionApprovedTemplate("A", 1, cat(1)).html, /<strong>1<\/strong> production data entry has been/);
  assert.match(t.bulkProductionRejectedTemplate("A", 2, cat(2), "why").html, /<strong>2<\/strong> production data entries have been/);
});
