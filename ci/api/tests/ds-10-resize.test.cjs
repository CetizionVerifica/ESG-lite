// DS-10 resize: POST /studio/docs/:id/resize and GET /studio/docs/:id/source.
//
//   - switch off (DS_STUDIO_OFF) on both routes; Users get DS_ROLE; Admins may resize;
//   - tenant isolation: another company's design is not found on both routes (whatever the body);
//     a Superadmin names the company; a site-scoped Manager can't resize a company-wide design;
//   - DS_KIND_OFF for a sustainability design after KPI tracking is turned off;
//   - Inventory (DS-4 seed) → board deck, one-page summary and social card: a new linked design
//     (source_doc_id, doc.source {docId, rev, dataHash}), built (resize report in build), rev 1
//     with an autosave version, the same bindings resolving the same figures as the source;
//   - DS_FORMAT_INVALID, DS_RESIZE_UNSUPPORTED (a booklet of a deck, a card of flow sections),
//     unknown pages (DS_VALIDATION); `ai: true` without DS-9 cuts text and says so;
//   - the linked source: dataChanged once the source's data moves; exists false once it is deleted;
//     null for a design that isn't a copy.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2 on both sites, admin 3),
// company 2 (site 3; other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const TITLE = "DS-10";

const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE company_id IN (1, 2) AND title LIKE '${TITLE}%')`);
  await q(`DELETE FROM report_doc WHERE company_id IN (1, 2) AND title LIKE '${TITLE}%'`);
  await q(`INSERT INTO user_sites (user_id, site_id) SELECT 2, 2 WHERE NOT EXISTS (SELECT 1 FROM user_sites WHERE user_id = 2 AND site_id = 2)`);
};

let T = {};
test.before(async () => {
  for (const s of ["migrateDs4Library", "migrateDs5Docs"]) {
    const r = runScript(s);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const rows = await q(`SELECT id, slug FROM report_template WHERE company_id IS NULL AND is_active AND slug IN ('ghg-inventory-classic', 'ghg-board-brief-classic', 'sustainability-editorial')`);
  T = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  assert.equal(Object.keys(T).length, 3, "DS-4 seed templates are loaded");
  await reset();
});
test.after(reset);

const build = async (slug, extra = {}, who = "manager") => {
  const kind = slug.startsWith("sustainability") ? "sustainability" : "ghg";
  const r = await call("POST", "/studio/docs", who, {
    kind,
    templateId: T[slug],
    year: 2025,
    yearType: "CY",
    sites: "all",
    frameworks: kind === "ghg" ? ["GHGP"] : ["GRI"],
    inputs: {},
    ai: false,
    title: `${TITLE} ${slug}`,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const resize = (id, body, who = "manager") => call("POST", `/studio/docs/${id}/resize`, who, body);
const deck = { format: "slide_16_9", purpose: "deck" };
const bindingsOf = (doc) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "data" && n.attrs) out.push(n.attrs.binding);
    (n.content ?? []).forEach(walk);
  };
  for (const p of doc.pages) {
    if (p.kind !== "freeform") continue;
    for (const e of p.elements) {
      if (e.props.binding) out.push(e.props.binding);
      if (e.props.doc) walk(e.props.doc);
    }
  }
  return out;
};

test("switch off: both routes answer DS_STUDIO_OFF; Users get DS_ROLE once it's on; Admins resize", async () => {
  await setStudio(1, true);
  const src = await build("ghg-inventory-classic");
  await setStudio(1, false);
  for (const [m, p, b] of [["POST", `/studio/docs/${src.id}/resize`, { ...deck, title: `${TITLE} off` }], ["GET", `/studio/docs/${src.id}/source`]]) {
    const r = await call(m, p, "manager", b);
    assert.equal(r.status, 403, p);
    assert.equal(r.json.code, "DS_STUDIO_OFF", p);
  }
  await setStudio(1, true);
  for (const [m, p, b] of [["POST", `/studio/docs/${src.id}/resize`, { ...deck, title: `${TITLE} user` }], ["GET", `/studio/docs/${src.id}/source`]]) {
    const r = await call(m, p, "user", b);
    assert.equal(r.status, 403, p);
    assert.equal(r.json.code, "DS_ROLE", p);
  }
  const admin = await resize(src.id, { ...deck, title: `${TITLE} admin deck` }, "admin");
  assert.equal(admin.status, 201, JSON.stringify(admin.json));
  await setStudio(1, false);
});

test("tenant isolation: another company's design is 404 on both routes; a Superadmin names the company; site scope", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const src = await build("ghg-inventory-classic");
  for (const [m, p, b] of [["POST", `/studio/docs/${src.id}/resize`, {}], ["POST", `/studio/docs/${src.id}/resize`, deck], ["GET", `/studio/docs/${src.id}/source`], ["POST", "/studio/docs/abc/resize", deck]]) {
    const r = await call(m, p, "otherManager", b);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND", `${m} ${p}`);
  }
  const sa = await call("POST", `/studio/docs/${src.id}/resize?company_id=1`, "superadmin", { ...deck, title: `${TITLE} by superadmin`, company_id: 1 });
  assert.equal(sa.status, 201, JSON.stringify(sa.json));
  const wrongCo = await call("POST", `/studio/docs/${src.id}/resize?company_id=2`, "superadmin", { ...deck, company_id: 2 });
  assert.equal(wrongCo.status, 404);
  const saSource = await call("GET", `/studio/docs/${sa.json.id}/source?company_id=1`, "superadmin");
  assert.equal(saSource.status, 200);
  assert.equal(saSource.json.source.docId, src.id);
  // A Manager who lost a site can't open (or resize) a company-wide design.
  await q(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`);
  const scoped = await resize(src.id, { ...deck, title: `${TITLE} scoped` });
  assert.equal(scoped.status, 404);
  const scopedSource = await call("GET", `/studio/docs/${sa.json.id}/source`, "manager");
  assert.equal(scopedSource.status, 404);
  await reset();
});

test("Inventory → board deck: a new linked design, built and autosaved, with the source's bindings and figures", async () => {
  await setStudio(1, true);
  const src = await build("ghg-inventory-classic");
  const r = await resize(src.id, { ...deck, title: `${TITLE} board deck` });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.title, `${TITLE} board deck`);
  assert.ok(r.json.id !== src.id);
  assert.ok(r.json.pageCount >= 5 && r.json.pageCount <= 10, `${r.json.pageCount} slides`);
  assert.ok(r.json.dropped > 0, "the deck lists what it left out");

  const copy = (await call("GET", `/studio/docs/${r.json.id}`, "manager")).json;
  assert.equal(copy.doc.format, "slide_16_9");
  assert.equal(copy.doc.purpose, "deck");
  assert.equal(copy.doc.kind, "ghg");
  assert.equal(copy.rev, 1);
  assert.equal(copy.status, "draft");
  assert.deepEqual(copy.doc.design, src.doc.design, "brand and look carry over");
  assert.deepEqual(copy.doc.source, { docId: src.id, rev: src.rev, dataHash: copy.doc.source.dataHash });
  assert.match(copy.doc.source.dataHash, /^sha256:/);
  assert.equal(copy.build.state, "done");
  assert.equal(copy.build.resize.profile, "deck");
  assert.equal(copy.build.resize.from.docId, src.id);
  assert.equal(copy.build.resize.dropped.length, r.json.dropped);
  assert.equal(copy.doc.pages[0].id, "r01-title");
  assert.ok(copy.doc.pages[copy.doc.pages.length - 1].id.endsWith("-close"));
  const row = (await q(`SELECT source_doc_id, template_id, purpose, format, data_hash FROM report_doc WHERE id = $1`, [r.json.id]))[0];
  assert.equal(Number(row.source_doc_id), src.id);
  assert.equal(row.template_id, null, "a copy has no template to rebuild from");
  assert.deepEqual([row.purpose, row.format], ["deck", "slide_16_9"]);
  assert.match(row.data_hash, /^sha256:/);
  const versions = await q(`SELECT kind, rev, note FROM report_doc_version WHERE doc_id = $1`, [r.json.id]);
  assert.deepEqual(versions.map((v) => [v.kind, Number(v.rev)]), [["autosave", 1]]);
  assert.match(versions[0].note, /^Made from /);

  // Same bindings → the same figures as the source (resolved live from approved data).
  const srcBindings = new Set(bindingsOf(src.doc).map((b) => JSON.stringify(b)));
  const copyBindings = bindingsOf(copy.doc);
  assert.ok(copyBindings.length > 5);
  for (const b of copyBindings) assert.ok(srcBindings.has(JSON.stringify(b)), `binding from the source: ${JSON.stringify(b)}`);
  const scope = { kind: "ghg", year: 2025, yearType: "CY", sites: "all", tokens: [] };
  const ghg = copyBindings.filter((b) => b.source === "ghg" && !b.breakdown);
  const a = await call("POST", "/studio/resolve", "manager", { ...scope, bindings: ghg, docId: r.json.id });
  const b = await call("POST", "/studio/resolve", "manager", { ...scope, bindings: ghg, docId: src.id });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual(a.json.values.map((v) => v.display), b.json.values.map((v) => v.display));
  // Every bound element is stamped with the copy's data hash.
  for (const p of copy.doc.pages) for (const e of p.elements) if (e.props.binding) assert.equal(e.basedOnHash, row.data_hash, e.id);

  // The copy shows "Made from …" and the data hasn't moved.
  const s = await call("GET", `/studio/docs/${r.json.id}/source`, "manager");
  assert.equal(s.status, 200);
  assert.deepEqual(
    { ...s.json.source, currentDataHash: undefined },
    { docId: src.id, exists: true, title: src.title, rev: src.rev, dataHash: copy.doc.source.dataHash, currentRev: src.rev, currentDataHash: undefined, dataChanged: false },
  );
  assert.equal(s.json.source.currentDataHash, copy.doc.source.dataHash);
  // The list shows it as a copy.
  const list = (await call("GET", "/studio/docs?kind=ghg", "manager")).json;
  assert.equal(list.find((d) => d.id === r.json.id).sourceDocId, src.id);
  await setStudio(1, false);
});

test("summary and social cards: one page each; picked pages; AI asked without DS-9 cuts text and says so", async () => {
  await setStudio(1, true);
  const src = await build("ghg-inventory-classic");
  for (const [format, purpose] of [["a4", "summary"], ["square", "social"], ["social_191", "social"]]) {
    const r = await resize(src.id, { format, purpose, title: `${TITLE} ${purpose} ${format}` });
    assert.equal(r.status, 201, `${format}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.pageCount, 1, format);
    const copy = (await call("GET", `/studio/docs/${r.json.id}`, "manager")).json;
    assert.deepEqual([copy.doc.format, copy.doc.purpose], [format, purpose]);
  }
  const pageIds = src.doc.pages.filter((p) => /scope3/.test(p.id)).map((p) => p.id);
  assert.ok(pageIds.length >= 1);
  const picked = await resize(src.id, { ...deck, pageIds, title: `${TITLE} scope 3 deck`, ai: true });
  assert.equal(picked.status, 201, JSON.stringify(picked.json));
  const copy = (await call("GET", `/studio/docs/${picked.json.id}`, "manager")).json;
  const from = copy.build.resize.pages.flatMap((p) => p.from);
  for (const id of pageIds) assert.ok(from.includes(id), id);
  assert.ok(!from.includes(src.doc.pages.find((p) => /exec_summary/.test(p.id))?.id ?? "x"), "pages not picked stay out");
  assert.equal(copy.build.resize.ai, "unavailable");
  assert.deepEqual(copy.build.resize.summarised, []);
  await setStudio(1, false);
});

test("validation: unknown format and pairs, booklets of decks, cards of flow sections, unknown pages, a running build", async () => {
  await setStudio(1, true);
  const src = await build("ghg-inventory-classic");
  const cases = [
    [{ format: "poster", purpose: "deck" }, 400, "DS_VALIDATION"],
    [{ format: "a4", purpose: "deck" }, 422, "DS_FORMAT_INVALID"],
    [{ format: "slide_16_9", purpose: "social" }, 422, "DS_FORMAT_INVALID"],
    [{ ...deck, pageIds: ["no-such-page"] }, 400, "DS_VALIDATION"],
    [{ ...deck, extra: true }, 400, "DS_VALIDATION"],
  ];
  for (const [body, status, code] of cases) {
    const r = await resize(src.id, body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.json.code, code, JSON.stringify(body));
  }
  const brief = await build("ghg-board-brief-classic");
  const booklet = await resize(brief.id, { format: "a5", purpose: "report" });
  assert.equal(booklet.status, 422);
  assert.equal(booklet.json.code, "DS_RESIZE_UNSUPPORTED");
  // A design of flow sections only can't become a card.
  const flows = src.doc.pages.filter((p) => p.kind === "flow");
  const patched = await call("PATCH", `/studio/docs/${src.id}`, "manager", { rev: src.rev, doc: { ...src.doc, pages: flows } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  const card = await resize(src.id, { format: "square", purpose: "social" });
  assert.equal(card.status, 422);
  assert.equal(card.json.code, "DS_RESIZE_UNSUPPORTED");
  // While a build runs, the design can't be resized.
  await q(`UPDATE report_doc SET build = jsonb_set(build, '{state}', '"running"') WHERE id = $1`, [src.id]);
  const running = await resize(src.id, deck);
  assert.equal(running.status, 409);
  assert.equal(running.json.code, "DS_VERSION_CONFLICT");
  await setStudio(1, false);
});

test("linked source: 'Source data changed' when the source's data moves; gone once it's deleted; null when not a copy", async () => {
  await setStudio(1, true);
  const src = await build("ghg-inventory-classic");
  const r = await resize(src.id, { format: "a4", purpose: "summary", title: `${TITLE} linked` });
  assert.equal(r.status, 201);
  const none = await call("GET", `/studio/docs/${src.id}/source`, "manager");
  assert.deepEqual(none.json, { source: null });
  // Report details are part of the data hash (rule 5): the source's change shows on the copy.
  const inputs = await call("PATCH", `/studio/docs/${src.id}/inputs`, "manager", { rev: src.rev, inputs: { responsible_person: { value: "A. Shah" } } });
  assert.equal(inputs.status, 200, JSON.stringify(inputs.json));
  const changed = (await call("GET", `/studio/docs/${r.json.id}/source`, "manager")).json.source;
  assert.equal(changed.exists, true);
  assert.equal(changed.dataChanged, true);
  assert.notEqual(changed.currentDataHash, changed.dataHash);
  assert.equal(changed.currentRev, src.rev + 1);
  const del = await call("DELETE", `/studio/docs/${src.id}`, "manager");
  assert.equal(del.status, 204);
  const gone = (await call("GET", `/studio/docs/${r.json.id}/source`, "manager")).json.source;
  assert.deepEqual(gone, { docId: src.id, rev: src.rev, dataHash: changed.dataHash, exists: false, title: null, currentRev: null, currentDataHash: null, dataChanged: false });
  // The copy still opens and resolves on its own.
  assert.equal((await call("GET", `/studio/docs/${r.json.id}`, "manager")).status, 200);
  await setStudio(1, false);
});

test("DS_KIND_OFF: a sustainability design can't be resized or linked once KPI tracking is off", async () => {
  await setStudio(1, true);
  await setKpi(1, true);
  const src = await build("sustainability-editorial");
  const r = await resize(src.id, { ...deck, title: `${TITLE} sustainability deck` });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const copy = (await call("GET", `/studio/docs/${r.json.id}`, "manager")).json;
  assert.equal(copy.doc.kind, "sustainability");
  // The source has no KPI values in the fixture, so its data pages were left out at build: a title and the close remain.
  assert.ok(copy.doc.pages.length >= 2);
  assert.equal(copy.doc.pages[0].id, "r01-title");
  await setKpi(1, false);
  for (const [m, p, b] of [["POST", `/studio/docs/${src.id}/resize`, deck], ["GET", `/studio/docs/${r.json.id}/source`]]) {
    const x = await call(m, p, "manager", b);
    assert.equal(x.status, 403, p);
    assert.equal(x.json.code, "DS_KIND_OFF", p);
  }
  await setStudio(1, false);
});
