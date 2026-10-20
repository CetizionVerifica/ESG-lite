// DS-4 template and element library: GET /studio/templates, /templates/:id, /layouts, /elements
// and the asset routes (POST/GET/PATCH/DELETE /studio/assets, GET /assets/:id/file,
// POST /assets/generate). Switch-off (DS_STUDIO_OFF) for every role and route; Users get DS_ROLE;
// Admins and Managers use everything; the sustainability kind needs KPI tracking (DS_KIND_OFF);
// tenant isolation (another company's template or asset id answers 404 and never shows in a list);
// search; uploads (type sniffing, SVG refused, EXIF stripped, dedupe, size); migrate:ds-4-library
// runs twice and the second run changes nothing (the seed loader is idempotent).
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const sharp = require(path.resolve(__dirname, "../../../node_modules/sharp"));
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const UUID0 = "00000000-0000-4000-8000-000000000000";
const ROUTES = [
  ["GET", "/studio/templates?kind=ghg"],
  ["GET", "/studio/templates/1"],
  ["GET", "/studio/layouts?kind=ghg"],
  ["GET", "/studio/elements"],
  ["GET", "/studio/assets"],
  ["POST", "/studio/assets"],
  ["PATCH", `/studio/assets/${UUID0}`],
  ["DELETE", `/studio/assets/${UUID0}`],
  ["GET", `/studio/assets/${UUID0}/file`],
  ["POST", "/studio/assets/generate"],
];
const bodyFor = (method) => (method === "POST" || method === "PATCH" ? {} : undefined);

const clean = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM report_asset WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM report_template WHERE company_id IS NOT NULL`);
    await db.query(`DELETE FROM report_layout WHERE company_id IS NOT NULL`);
    await db.query(`DELETE FROM report_element WHERE company_id IS NOT NULL`);
  });
const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
};

let firstRun;
let secondRun;
test.before(async () => {
  firstRun = runScript("migrateDs4Library");
  secondRun = runScript("migrateDs4Library");
  await reset();
  await clean();
});
test.after(async () => {
  await reset();
  await clean();
});

const png = (color = "#336699", w = 40, h = 20) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const form = (bytes, name = "photo.png", fields = {}) => {
  const f = new FormData();
  f.append("file", new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

test("migrate:ds-4-library runs twice; the second run changes nothing", async () => {
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.match(secondRun.stdout, /templates 0 new, 0 updated, \d+ unchanged; layouts 0 new, 0 updated, \d+ unchanged; elements 0 new, 0 updated, \d+ unchanged/);
  const counts = await withDb(async (db) => (await db.query(`SELECT (SELECT count(*) FROM report_template WHERE company_id IS NULL AND is_active)::int t, (SELECT count(*) FROM report_layout WHERE company_id IS NULL AND is_active)::int l, (SELECT count(*) FROM report_element WHERE company_id IS NULL AND is_active)::int e`)).rows[0]);
  assert.equal(counts.t, 15);
  assert.ok(counts.l >= 90, `${counts.l} layouts`);
  assert.ok(counts.e >= 350, `${counts.e} elements`);
});

test("a changed seed row is put back on the next run, and an unknown system slug turns inactive", async () => {
  await withDb(async (db) => {
    await db.query(`UPDATE report_template SET name = 'tampered' WHERE slug = 'ghg-inventory-classic' AND company_id IS NULL`);
    await db.query(`INSERT INTO report_element (company_id, slug, "group", name, payload, license) VALUES (NULL, 'gone-element', 'shapes', 'Gone', '{}', 'own')`);
  });
  const r = runScript("migrateDs4Library");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /templates 0 new, 1 updated/);
  const rows = await withDb(async (db) => ({
    name: (await db.query(`SELECT name FROM report_template WHERE slug = 'ghg-inventory-classic' AND company_id IS NULL`)).rows[0].name,
    gone: (await db.query(`SELECT is_active FROM report_element WHERE slug = 'gone-element'`)).rows[0].is_active,
  }));
  assert.equal(rows.name, "GHG Inventory · Classic");
  assert.equal(rows.gone, false);
  await withDb((db) => db.query(`DELETE FROM report_element WHERE slug = 'gone-element'`));
});

test("switch off: every DS-4 route answers 403 DS_STUDIO_OFF, for every role", async () => {
  for (const [method, p] of ROUTES) {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call(method, p, who, bodyFor(method));
      assert.equal(r.status, 403, `${who} ${method} ${p}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF");
    }
    const sep = p.includes("?") ? "&" : "?";
    const sa = await call(method, `${p}${sep}company_id=1`, "superadmin", method === "POST" || method === "PATCH" ? { company_id: 1 } : undefined);
    assert.equal(sa.json.code, "DS_STUDIO_OFF", `superadmin ${method} ${p}`);
  }
  assert.equal((await call("GET", "/studio/templates")).status, 401);
});

test("roles: Users get DS_ROLE on every route; Admins and Managers read and upload", async () => {
  await setStudio(1, true);
  for (const [method, p] of ROUTES) {
    const r = await call(method, p, "user", bodyFor(method));
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.equal(r.json.code, "DS_ROLE");
  }
  for (const who of ["admin", "manager"]) {
    assert.equal((await call("GET", "/studio/templates", who)).status, 200, who);
    assert.equal((await call("GET", "/studio/elements", who)).status, 200, who);
    const up = await call("POST", "/studio/assets", who, form(await png(who === "admin" ? "#112233" : "#445566")));
    assert.equal(up.status, 201, `${who}: ${JSON.stringify(up.json)}`);
  }
  const sa = await call("GET", "/studio/templates?company_id=1", "superadmin");
  assert.equal(sa.status, 200);
  assert.equal((await call("GET", "/studio/templates", "superadmin")).json.code, "DS_COMPANY_REQUIRED");
});

test("templates: GHG only while KPI tracking is off; kind=sustainability answers DS_KIND_OFF; filters and search", async () => {
  await setStudio(1, true);
  const all = await call("GET", "/studio/templates", "manager");
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 12);
  assert.ok(all.json.every((t) => t.kind === "ghg" && t.companyId === null && t.thumbnailUrl === null));
  const t0 = all.json[0];
  for (const k of ["id", "slug", "family", "look", "kind", "purpose", "format", "name", "description", "tags", "version", "pageCount"]) assert.ok(k in t0, k);
  assert.equal((await call("GET", "/studio/templates?kind=sustainability", "manager")).json.code, "DS_KIND_OFF");
  assert.equal((await call("GET", "/studio/layouts?kind=sustainability", "manager")).json.code, "DS_KIND_OFF");
  const deck = await call("GET", "/studio/templates?format=slide_16_9", "manager");
  assert.deepEqual(deck.json.map((t) => t.slug), ["ghg-board-brief-classic", "ghg-board-brief-light", "ghg-board-brief-night"]);
  const iso = await call("GET", "/studio/templates?q=ISO", "manager");
  assert.ok(iso.json.length === 3 && iso.json.every((t) => t.family === "ghg-iso14064"));
  const night = await call("GET", "/studio/templates?look=night", "manager");
  assert.equal(night.json.length, 4);
  const byTag = await call("GET", "/studio/templates?tag=factsheet", "manager");
  assert.deepEqual(byTag.json.map((t) => t.family), ["ghg-one-page", "ghg-one-page", "ghg-one-page"]);
  assert.equal((await call("GET", "/studio/templates?format=a3", "manager")).json.code, "DS_VALIDATION");

  await setKpi(1, true);
  const withKpi = await call("GET", "/studio/templates", "manager");
  assert.equal(withKpi.json.length, 15);
  const sus = await call("GET", "/studio/templates?kind=sustainability", "manager");
  assert.deepEqual(sus.json.map((t) => t.slug).sort(), ["sustainability-editorial", "sustainability-minimal", "sustainability-night"]);
  await setKpi(1, false);
});

test("GET /templates/:id returns a valid doc; a sustainability template by id needs KPI tracking; unknown ids 404", async () => {
  await setStudio(1, true);
  const list = (await call("GET", "/studio/templates?kind=ghg", "admin")).json;
  const inv = list.find((t) => t.slug === "ghg-inventory-classic");
  const r = await call("GET", `/studio/templates/${inv.id}`, "admin");
  assert.equal(r.status, 200);
  assert.equal(r.json.doc.schemaVersion, 2);
  assert.equal(r.json.doc.pages.length, inv.pageCount);
  assert.equal(r.json.doc.design.templateId, "ghg-inventory-classic");
  const susId = await withDb(async (db) => (await db.query(`SELECT id FROM report_template WHERE slug = 'sustainability-editorial'`)).rows[0].id);
  assert.equal((await call("GET", `/studio/templates/${susId}`, "manager")).json.code, "DS_KIND_OFF");
  await setKpi(1, true);
  assert.equal((await call("GET", `/studio/templates/${susId}`, "manager")).status, 200);
  await setKpi(1, false);
  assert.equal((await call("GET", "/studio/templates/999999", "manager")).status, 404);
  assert.equal((await call("GET", "/studio/templates/abc", "manager")).status, 404);
});

test("tenant: another company's template, layout and element never show, and its template id answers 404", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const ids = await withDb(async (db) => {
    const t = await db.query(
      `INSERT INTO report_template (company_id, slug, family, kind, purpose, format, name, tags, doc, version) SELECT 2, 'c2-secret', 'c2-secret', kind, purpose, format, 'Company 2 secret', '{secret}', doc, 1 FROM report_template WHERE slug = 'ghg-one-page-classic' RETURNING id`,
    );
    await db.query(`INSERT INTO report_layout (company_id, slug, family, role, page_kind, kind, format, name, page) SELECT 2, 'c2-secret/summary', 'c2-secret', role, page_kind, kind, format, 'Company 2 layout', page FROM report_layout WHERE slug = 'ghg-one-page/summary'`);
    await db.query(`INSERT INTO report_element (company_id, slug, "group", name, tags, payload, license) SELECT 2, 'c2-secret-shape', "group", 'Company 2 shape', '{secret}', payload, license FROM report_element WHERE slug = 'shape-rect'`);
    return t.rows[0].id;
  });
  const mine = (await call("GET", "/studio/templates?q=secret", "manager")).json;
  assert.deepEqual(mine, []);
  assert.equal((await call("GET", `/studio/templates/${ids}`, "manager")).status, 404);
  assert.ok(!(await call("GET", "/studio/layouts?template=c2-secret", "manager")).json.length);
  assert.ok(!(await call("GET", "/studio/elements?q=secret", "manager")).json.length);
  const theirs = (await call("GET", "/studio/templates?q=secret", "otherManager")).json;
  assert.deepEqual(theirs.map((t) => t.id), [ids]);
  assert.equal((await call("GET", `/studio/templates/${ids}`, "otherManager")).status, 200);
  assert.equal((await call("GET", "/studio/elements?q=secret", "otherManager")).json.length, 1);
  // Company 2's people naming company 1 get 404 from the guard.
  assert.equal((await call("GET", "/studio/templates?company_id=1", "otherManager")).status, 404);
});

test("layouts: by template family or slug, page kind and search", async () => {
  await setStudio(1, true);
  const fam = (await call("GET", "/studio/layouts?template=ghg-inventory", "manager")).json;
  const bySlug = (await call("GET", "/studio/layouts?template=ghg-inventory-night", "manager")).json;
  assert.ok(fam.length >= 15);
  assert.deepEqual(bySlug.map((l) => l.id), fam.map((l) => l.id));
  const l = fam[0];
  for (const k of ["id", "slug", "family", "role", "pageKind", "kind", "format", "name", "page", "sort", "thumbnailUrl"]) assert.ok(k in l, k);
  assert.equal(l.page.kind, "freeform");
  assert.deepEqual(fam.map((x) => x.sort), [...fam.map((x) => x.sort)].sort((a, b) => a - b));
  const covers = (await call("GET", "/studio/layouts?kind=ghg&pageKind=cover", "manager")).json;
  assert.ok(covers.length >= 3 && covers.every((x) => x.pageKind === "cover"));
  const slides = (await call("GET", "/studio/layouts?format=slide_16_9", "manager")).json;
  assert.ok(slides.length >= 8 && slides.every((x) => x.format === "slide_16_9"));
  const scope = (await call("GET", "/studio/layouts?q=scope", "manager")).json;
  assert.ok(scope.some((x) => x.role === "scope3"));
});

test("elements: every group, search by name and tags", async () => {
  await setStudio(1, true);
  const all = (await call("GET", "/studio/elements", "admin")).json;
  for (const g of ["shapes", "lines", "frames", "grids", "icons", "sdg", "esg", "data"]) assert.ok(all.some((e) => e.group === g), g);
  const e = all[0];
  for (const k of ["id", "companyId", "group", "name", "tags", "payload", "license"]) assert.ok(k in e, k);
  const icons = (await call("GET", "/studio/elements?group=icons", "admin")).json;
  assert.ok(icons.length >= 280 && icons.every((x) => x.group === "icons"));
  const leaf = (await call("GET", "/studio/elements?q=leaf", "admin")).json;
  assert.ok(leaf.some((x) => x.payload.props?.name === "lucide:leaf"));
  const transport = (await call("GET", "/studio/elements?group=icons&q=transport", "admin")).json;
  assert.ok(transport.length >= 10, "tag search");
  const scope = (await call("GET", "/studio/elements?q=scope", "admin")).json;
  assert.ok(scope.some((x) => x.payload.type === "group"));
  assert.equal((await call("GET", "/studio/elements?group=nope", "admin")).json.code, "DS_VALIDATION");
  assert.deepEqual((await call("GET", "/studio/elements?q=%25", "admin")).json, [], "LIKE wildcards are escaped");
});

test("assets: upload, list by folder, move, file, dedupe; tenant isolation", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  await clean();
  const bytes = await png("#0f5132", 64, 32);
  const up = await call("POST", "/studio/assets", "manager", form(bytes, "cover.png", { folder: "Covers", alt: "Plant at dawn" }));
  assert.equal(up.status, 201);
  const a = up.json;
  for (const k of ["id", "kind", "w", "h", "alt", "folder", "url", "bytes", "mime", "sha256", "createdAt"]) assert.ok(k in a, k);
  assert.deepEqual([a.kind, a.w, a.h, a.mime, a.folder, a.alt], ["image", 64, 32, "image/png", "Covers", "Plant at dawn"]);
  const again = await call("POST", "/studio/assets", "admin", form(bytes, "copy.png"));
  assert.equal(again.status, 200, "same bytes return the existing asset");
  assert.equal(again.json.id, a.id);
  const other = await call("POST", "/studio/assets", "manager", form(await png("#ff0000")));
  assert.equal(other.status, 201);
  assert.equal(other.json.folder, null);
  assert.deepEqual((await call("GET", "/studio/assets?folder=Covers", "manager")).json.map((x) => x.id), [a.id]);
  assert.equal((await call("GET", "/studio/assets", "manager")).json.length, 2);
  const moved = await call("PATCH", `/studio/assets/${other.json.id}`, "admin", { folder: "Sites", alt: "A site" });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.json.folder, moved.json.alt], ["Sites", "A site"]);
  assert.equal((await call("PATCH", `/studio/assets/${other.json.id}`, "admin", { folder: "a/b" })).json.code, "DS_VALIDATION");
  const file = await call("GET", `/studio/assets/${a.id}/file`, "manager");
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(file.buffer.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // Company 2 sees none of it and gets 404 for every id; nothing changes.
  assert.deepEqual((await call("GET", "/studio/assets", "otherManager")).json, []);
  for (const [method, p, body] of [["GET", `/studio/assets/${a.id}/file`], ["PATCH", `/studio/assets/${a.id}`, { folder: "Theirs" }], ["DELETE", `/studio/assets/${a.id}`]]) {
    const r = await call(method, p, "otherManager", body);
    assert.equal(r.status, 404, `${method} ${p}`);
  }
  const theirCopy = await call("POST", "/studio/assets", "otherManager", form(bytes));
  assert.equal(theirCopy.status, 201, "dedupe is per company");
  assert.notEqual(theirCopy.json.id, a.id);
  assert.equal((await call("GET", "/studio/assets?folder=Covers", "manager")).json[0].folder, "Covers");

  const del = await call("DELETE", `/studio/assets/${a.id}`, "manager");
  assert.equal(del.status, 204);
  assert.equal((await call("GET", `/studio/assets/${a.id}/file`, "manager")).status, 404);
  assert.equal((await call("DELETE", `/studio/assets/${a.id}`, "manager")).status, 404);
  assert.equal((await call("DELETE", "/studio/assets/not-a-uuid", "manager")).status, 404);
});

test("assets: the bytes decide the type; SVG with script, onload or an external href is refused; EXIF stripped; size limit", async () => {
  await setStudio(1, true);
  const bad = [
    ["text.png", Buffer.from("just text, called .png")],
    ["x.gif", Buffer.from("GIF89a\x01\x00\x01\x00")],
    ["s.svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)],
    ["o.svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)],
    ["h.svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/t.png"/></svg>`)],
  ];
  for (const [name, bytes] of bad) {
    const r = await call("POST", "/studio/assets", "manager", form(bytes, name));
    assert.equal(r.status, 415, name);
    assert.equal(r.json.code, "DS_ASSET_TYPE", name);
  }
  const svg = await call("POST", "/studio/assets", "manager", form(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="#0f5132"/></svg>`), "logo.svg"));
  assert.equal(svg.status, 201);
  assert.deepEqual([svg.json.mime, svg.json.w, svg.json.h], ["image/svg+xml", 120, 60]);
  const svgFile = await call("GET", `/studio/assets/${svg.json.id}/file`, "manager");
  assert.match(svgFile.headers.get("content-security-policy"), /default-src 'none'/);

  const jpeg = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#336699" } }).withMetadata({ exif: { IFD0: { Copyright: "camera-owner-name" } } }).jpeg().toBuffer();
  const j = await call("POST", "/studio/assets", "manager", form(jpeg, "photo.jpg"));
  assert.equal(j.status, 201);
  const stored = await call("GET", `/studio/assets/${j.json.id}/file`, "manager");
  assert.ok(!stored.buffer.includes(Buffer.from("camera-owner-name")), "EXIF stripped");

  const big = await call("POST", "/studio/assets", "manager", form(Buffer.alloc(10 * 1024 * 1024 + 10, 1), "big.png"));
  assert.equal(big.status, 413);
  assert.equal(big.json.code, "DS_ASSET_TOO_LARGE");
  const none = await call("POST", "/studio/assets", "manager", new FormData());
  assert.equal(none.json.code, "DS_VALIDATION");
});

test("assets: generate needs an image provider (503 DS_AI_UNAVAILABLE here), and validates the prompt", async () => {
  await setStudio(1, true);
  assert.equal((await call("POST", "/studio/assets/generate", "manager", { prompt: "x" })).json.code, "DS_VALIDATION");
  const r = await call("POST", "/studio/assets/generate", "manager", { prompt: "An abstract landscape in brand green" });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "DS_AI_UNAVAILABLE");
});
