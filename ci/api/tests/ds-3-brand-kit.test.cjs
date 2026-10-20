// DS-3 brand kit and styles: GET/PUT /studio/brand-kit and GET /studio/styles.
// Switch-off (DS_STUDIO_OFF) and DS_ROLE for Users on every route; a Manager
// (and a Superadmin naming the company) can PUT, an Admin can't (KPI D11);
// validation; palettes replace the list in order with a contrast report;
// an audit row; tenant isolation (another company's palette id or company_id
// answers 404 and its kit never shows); styles 6–12 built from the kit, the
// kind guard (DS_KIND_OFF); migrate:ds-3-brand-kit running twice.
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other user 4,
// other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const ROUTES = [
  ["GET", "/studio/brand-kit"],
  ["PUT", "/studio/brand-kit"],
  ["GET", "/studio/styles?kind=ghg"],
];

const clean = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM brand_palette WHERE company_id IN (1, 2)`);
    await db.query(`UPDATE brand SET font_heading = NULL, font_body = NULL, voice = '' WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'brand_kit'`);
  });
const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
  await clean();
};
test.before(reset);
test.after(reset);

const PALETTES = [
  { name: "Primary", colors: ["#0F5132", "#F59E0B", "#111827", "#FFFFFF"] },
  { name: "Charts", colors: ["#2563EB", "#16A34A"] },
];

test("switch off: every DS-3 route answers 403 DS_STUDIO_OFF, for every role", async () => {
  for (const [method, path] of ROUTES) {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call(method, path, who, method === "PUT" ? { voice: "x" } : undefined);
      assert.equal(r.status, 403, `${who} ${method} ${path}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF");
    }
    const sep = path.includes("?") ? "&" : "?";
    const sa = await call(method, `${path}${sep}company_id=1`, "superadmin", method === "PUT" ? { company_id: 1, voice: "x" } : undefined);
    assert.equal(sa.json.code, "DS_STUDIO_OFF");
  }
  assert.equal((await call("GET", "/studio/brand-kit")).status, 401);
});

test("roles: Users get DS_ROLE; Admins read but can't PUT; Managers PUT", async () => {
  await setStudio(1, true);
  for (const [method, path] of ROUTES) {
    const r = await call(method, path, "user", method === "PUT" ? { voice: "x" } : undefined);
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "DS_ROLE");
  }
  const adminGet = await call("GET", "/studio/brand-kit", "admin");
  assert.equal(adminGet.status, 200);
  assert.equal(adminGet.json.canEdit, false);
  const adminPut = await call("PUT", "/studio/brand-kit", "admin", { voice: "Admins can't" });
  assert.equal(adminPut.status, 403);
  assert.equal(adminPut.json.code, "DS_ROLE");
  assert.equal((await call("GET", "/studio/brand-kit", "manager")).json.canEdit, true);
  assert.equal((await call("GET", "/studio/styles?kind=ghg", "admin")).status, 200);
});

test("GET returns logos and colours from brand, the defaults for fonts and voice", async () => {
  await setStudio(1, true);
  const r = await call("GET", "/studio/brand-kit", "manager");
  assert.equal(r.status, 200);
  assert.equal(r.json.logos.primary, "https://assets.example.invalid/brand-assets/company_1.png");
  assert.equal(r.json.logos.onDark, null);
  assert.equal(r.json.colors.primary, "#123456");
  assert.deepEqual(r.json.fonts, { heading: null, body: null });
  assert.equal(r.json.voice, "");
  assert.deepEqual(r.json.palettes, []);
  assert.equal(r.json.brandControls, false);
  assert.ok(["classic", "light", "night"].includes(r.json.defaultLook));
});

test("a Manager saves fonts, voice and palettes; the list replaces in order with contrast reports; audited", async () => {
  await setStudio(1, true);
  const put = await call("PUT", "/studio/brand-kit", "manager", { fonts: { heading: "fraunces", body: "ibm-plex-sans" }, voice: "Plain, confident, specific.", palettes: PALETTES });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.deepEqual(put.json.fonts, { heading: "fraunces", body: "ibm-plex-sans" });
  assert.equal(put.json.voice, "Plain, confident, specific.");
  assert.deepEqual(put.json.palettes.map((p) => [p.name, p.sort, p.colors]), [
    ["Primary", 0, ["#0f5132", "#f59e0b", "#111827", "#ffffff"]],
    ["Charts", 1, ["#2563eb", "#16a34a"]],
  ]);
  assert.equal(put.json.palettes[0].contrast.length, 6);
  assert.equal(put.json.palettes[1].contrast.length, 1);
  const gw = put.json.palettes[0].contrast.find((p) => p.a === "#0f5132" && p.b === "#ffffff");
  assert.ok(gw.text && gw.graphic && gw.ratio > 9);
  // Logos and brand colours are untouched.
  assert.equal(put.json.colors.primary, "#123456");
  assert.ok(put.json.logos.primary);

  // GET as an Admin sees the same kit.
  const got = await call("GET", "/studio/brand-kit", "admin");
  assert.deepEqual(got.json.palettes, put.json.palettes);

  // Reorder, rename, drop one, add one: ids kept for kept palettes.
  const [primary, charts] = put.json.palettes;
  const again = await call("PUT", "/studio/brand-kit", "manager", { palettes: [{ id: charts.id, name: "Chart colours", colors: charts.colors }, { name: "Night", colors: ["#0d1526"] }] });
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.palettes.map((p) => [p.id === charts.id, p.name, p.sort]), [[true, "Chart colours", 0], [false, "Night", 1]]);
  assert.ok(!again.json.palettes.some((p) => p.id === primary.id));
  // Fonts and voice untouched by a palettes-only PUT.
  assert.deepEqual(again.json.fonts, { heading: "fraunces", body: "ibm-plex-sans" });
  assert.equal(again.json.voice, "Plain, confident, specific.");

  const audit = await withDb(async (db) => (await db.query(`SELECT entity_id, action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'brand_kit' ORDER BY id`)).rows);
  assert.equal(audit.length, 2);
  assert.equal(audit[0].entity_id, 1);
  assert.equal(audit[0].changed_by, 2);
  const fields = typeof audit[0].changed_fields === "string" ? JSON.parse(audit[0].changed_fields) : audit[0].changed_fields;
  assert.deepEqual(Object.keys(fields).sort(), ["fonts", "palettes", "voice"]);
  assert.equal(JSON.stringify(fields).includes("Plain, confident"), false, "the voice text itself isn't copied into the audit log");

  // A Superadmin names the company.
  const sa = await call("PUT", "/studio/brand-kit?company_id=1", "superadmin", { company_id: 1, voice: "Set by support." });
  assert.equal(sa.status, 200);
  assert.equal(sa.json.voice, "Set by support.");
  assert.equal(sa.json.canEdit, true);
});

test("validation: 400 DS_VALIDATION for bad fonts, long voice, too many colours, bad hex, logos", async () => {
  await setStudio(1, true);
  for (const bad of [
    { fonts: { heading: "comic-sans", body: null } },
    { fonts: { heading: "fraunces" } },
    { voice: "x".repeat(3001) },
    { palettes: [{ name: "P", colors: Array(11).fill("#000000") }] },
    { palettes: [{ name: "P", colors: ["teal"] }] },
    { palettes: [{ name: "", colors: ["#000000"] }] },
    { palettes: Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, colors: ["#000000"] })) },
    { logos: { primary: "https://x" } },
  ]) {
    const r = await call("PUT", "/studio/brand-kit", "manager", bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "DS_VALIDATION");
    assert.ok(Array.isArray(r.json.details.issues));
  }
  assert.equal((await call("PUT", "/studio/brand-kit", "manager", { voice: "x".repeat(3000) })).status, 200);
});

test("tenant isolation: another company's kit never shows; its palette ids and company_id answer 404", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  await call("PUT", "/studio/brand-kit", "manager", { palettes: PALETTES, voice: "Company one." });
  const mine = (await call("GET", "/studio/brand-kit", "manager")).json;

  const other = await call("GET", "/studio/brand-kit", "otherManager");
  assert.equal(other.status, 200);
  assert.deepEqual(other.json.palettes, []);
  assert.notEqual(other.json.voice, "Company one.");

  // Company 2 can't update company 1's palette by id.
  const steal = await call("PUT", "/studio/brand-kit", "otherManager", { palettes: [{ id: mine.palettes[0].id, name: "Mine now", colors: ["#000000"] }] });
  assert.equal(steal.status, 404);
  assert.equal(steal.json.code, "DS_DOC_NOT_FOUND");
  assert.equal((await call("GET", "/studio/brand-kit", "manager")).json.palettes[0].name, "Primary");

  // Naming the other company answers 404.
  for (const [method, path] of ROUTES) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await call(method, `${path}${sep}company_id=1`, "otherManager", method === "PUT" ? { company_id: 1, voice: "x" } : undefined);
    assert.equal(r.status, 404, `${method} ${path}`);
  }

  // Company 2's own PUT works (a brand row is made when it has none) and stays its own.
  const own = await call("PUT", "/studio/brand-kit", "otherManager", { fonts: { heading: "archivo", body: "noto-sans" }, palettes: [{ name: "Two", colors: ["#222222"] }] });
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.fonts, { heading: "archivo", body: "noto-sans" });
  assert.deepEqual((await call("GET", "/studio/brand-kit", "manager")).json.palettes.map((p) => p.name), ["Primary", "Charts"]);
  assert.equal((await call("GET", "/brands/2", "superadmin")).status, 200, "/brands still reads company 2");
});

test("styles: 6–12 presets from the kit, brand first with the brand fonts; kind guard", async () => {
  await setStudio(1, true);
  await call("PUT", "/studio/brand-kit", "manager", { fonts: { heading: "dm-serif-display", body: "source-sans-3" }, palettes: PALETTES });
  const r = await call("GET", "/studio/styles?kind=ghg", "admin");
  assert.equal(r.status, 200);
  assert.ok(r.json.length >= 6 && r.json.length <= 12, String(r.json.length));
  assert.equal(r.json[0].id, "brand");
  assert.deepEqual(r.json[0].fonts, { heading: "dm-serif-display", body: "source-sans-3" });
  assert.equal(r.json[0].palette[0], "#0f5132");
  for (const p of r.json) {
    assert.equal(p.palette.length, 5);
    for (const hex of p.palette) assert.match(hex, /^#[0-9a-f]{6}$/);
  }

  const missing = await call("GET", "/studio/styles", "manager");
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, "DS_VALIDATION");
  const off = await call("GET", "/studio/styles?kind=sustainability", "manager");
  assert.equal(off.status, 403);
  assert.equal(off.json.code, "DS_KIND_OFF");
  await setKpi(1, true);
  assert.equal((await call("GET", "/studio/styles?kind=sustainability", "manager")).status, 200);
});

test("migrate:ds-3-brand-kit runs twice and leaves the data alone", async () => {
  await setStudio(1, true);
  await call("PUT", "/studio/brand-kit", "manager", { voice: "Kept.", palettes: [{ name: "Kept", colors: ["#111111"] }] });
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateDs3BrandKit");
    assert.equal(r.status, 0, r.stderr || r.stdout);
  }
  const kit = (await call("GET", "/studio/brand-kit", "manager")).json;
  assert.equal(kit.voice, "Kept.");
  assert.deepEqual(kit.palettes.map((p) => p.name), ["Kept"]);
  const cols = await withDb(async (db) => (await db.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'brand' AND column_name IN ('font_heading', 'font_body', 'voice') ORDER BY column_name`)).rows);
  assert.deepEqual(cols.map((c) => c.column_name), ["font_body", "font_heading", "voice"]);
  assert.equal(cols.find((c) => c.column_name === "voice").is_nullable, "NO");
});
