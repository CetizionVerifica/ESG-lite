// PE-2 · uploaded brand fonts (docs/design-studio/pro/PE-2.md, decision E3):
// GET /studio/brand-kit/fonts, POST (multipart), DELETE /:id, GET /:id/files/:fileId.
//
//   - switch off → 403 DS_STUDIO_OFF on every route, every role;
//   - roles: Users DS_ROLE everywhere; Admins read and fetch files but can't
//     upload or delete (DS_ROLE); Managers and the Superadmin (naming the company) can;
//   - validation: the bytes decide (WOFF2 / TTF / OTF magic bytes and a table
//     directory check): a PNG named .ttf → 415 DS_FONT_TYPE; over 5 MB → 413
//     DS_FONT_TOO_LARGE; no licence tick → 422 DS_FONT_LICENCE (who and when are
//     stored); the same weight + style again → 409 DS_FONT_EXISTS; a second
//     weight joins the family (case-blind name);
//   - tenant: company 2 sees none of company 1's fonts, gets 404 on its ids and
//     files, and can't delete them; the brand kit lists the fonts (customFonts);
//   - renders: preview.html embeds a used custom font as @font-face from the
//     stored bytes (data: URL, CSP font-src data:), never another company's;
//     a deleted font falls back to the style's font; the proof PDF embeds it
//     (Chromium only);
//   - migrate:ds-pro-pe-2-fonts runs twice.
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other user 4,
// other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = require(path.resolve(__dirname, "../../fixtures/studio/ghg-doc.json"));

/** A minimal sfnt (TTF/OTF) with one table whose record stays inside the file. */
const sfnt = (magic = [0x00, 0x01, 0x00, 0x00], pad = 0) => {
  const b = Buffer.alloc(32 + pad);
  Buffer.from(magic).copy(b, 0);
  b.writeUInt16BE(1, 4); // numTables
  b.write("head", 12, "latin1");
  b.writeUInt32BE(28, 20); // offset
  b.writeUInt32BE(4, 24); // length
  return b;
};
const woff2 = () => fs.readFileSync(require.resolve("@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-normal.woff2"));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5a00000000049454e44ae426082", "hex");

const form = (bytes, name, fields = {}) => {
  const f = new FormData();
  if (bytes) f.append("file", new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  return f;
};
const fields = (extra = {}) => ({ family: "Midal Sans", weight: 400, style: "normal", licenceConfirmed: "true", ...extra });
const upload = (who, bytes, name, extra = {}, query = "") => call("POST", `/studio/brand-kit/fonts${query}`, who, form(bytes, name, fields(extra)));

async function clean() {
  await q(`DELETE FROM brand_font_file WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM brand_font WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'brand_font'`);
  await q(`DELETE FROM report_job WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'PE-2%')`);
  await q(`DELETE FROM report_doc_version WHERE doc_id IN (SELECT id FROM report_doc WHERE title LIKE 'PE-2%')`);
  await q(`DELETE FROM report_doc WHERE title LIKE 'PE-2%'`);
}

let chromiumOk = false;
let why = "";
test.before(async () => {
  for (const name of ["migrateDs5Docs", "migrateDs11Outputs"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await clean();
  await setStudio(1, true);
  await setStudio(2, true);
  await setKpi(1, false);
  try {
    const { chromium } = require("playwright");
    await (await chromium.launch()).close();
    chromiumOk = true;
  } catch (err) {
    why = `Chromium is not installed (${String(err.message).split("\n")[0]})`;
  }
});
test.after(async () => {
  await clean();
  await setStudio(1, false);
  await setStudio(2, false);
});

test("migrate:ds-pro-pe-2-fonts runs twice and leaves the rows alone", async () => {
  const up = await upload("manager", sfnt(), "a.ttf");
  assert.equal(up.status, 201, JSON.stringify(up.json));
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateDsProPe2Fonts");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const [{ n }] = await q(`SELECT count(*)::int n FROM brand_font_file WHERE company_id = 1`);
  assert.equal(n, 1);
  await clean();
});

test("switch off: every font route answers 403 DS_STUDIO_OFF for every role", async () => {
  await setStudio(1, false);
  try {
    for (const who of ["user", "admin", "manager"]) {
      for (const [m, p, body] of [
        ["GET", "/studio/brand-kit/fonts"],
        ["POST", "/studio/brand-kit/fonts", form(sfnt(), "a.ttf", fields())],
        ["DELETE", "/studio/brand-kit/fonts/1"],
        ["GET", "/studio/brand-kit/fonts/1/files/00000000-0000-4000-8000-000000000000"],
      ]) {
        const r = await call(m, p, who, body);
        assert.equal(r.status, 403, `${who} ${m} ${p}`);
        assert.equal(r.json?.code, "DS_STUDIO_OFF", `${who} ${m} ${p}`);
      }
    }
    const sa = await call("GET", "/studio/brand-kit/fonts?company_id=1", "superadmin");
    assert.equal(sa.json?.code, "DS_STUDIO_OFF");
  } finally {
    await setStudio(1, true);
  }
});

test("roles: Users refused; Admins read but can't upload or delete; Managers and the Superadmin can", async () => {
  const u = await call("GET", "/studio/brand-kit/fonts", "user");
  assert.equal(u.status, 403);
  assert.equal(u.json.code, "DS_ROLE");

  const adm = await upload("admin", sfnt(), "a.ttf");
  assert.equal(adm.status, 403);
  assert.equal(adm.json.code, "DS_ROLE");

  const up = await upload("manager", sfnt(), "midal.ttf");
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const font = up.json;
  assert.equal(font.ref, `custom:${font.id}`);
  assert.equal(font.family, "Midal Sans");
  assert.deepEqual(font.weights, [400]);
  assert.equal(font.files[0].format, "ttf");
  assert.equal(font.files[0].bytes, 32);
  assert.equal(font.licenceConfirmedBy, 2);
  assert.match(font.files[0].url, new RegExp(`^/studio/brand-kit/fonts/${font.id}/files/[0-9a-f-]{36}$`));

  const list = await call("GET", "/studio/brand-kit/fonts", "admin");
  assert.equal(list.status, 200);
  assert.equal(list.json.canEdit, false);
  assert.deepEqual(list.json.fonts.map((f) => f.id), [font.id]);
  const mgrList = await call("GET", "/studio/brand-kit/fonts", "manager");
  assert.equal(mgrList.json.canEdit, true);

  const file = await call("GET", font.files[0].url, "admin");
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "font/ttf");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.ok(file.buffer.equals(sfnt()));

  const kit = await call("GET", "/studio/brand-kit", "admin");
  assert.deepEqual(kit.json.customFonts.map((f) => f.ref), [font.ref]);

  const admDel = await call("DELETE", `/studio/brand-kit/fonts/${font.id}`, "admin");
  assert.equal(admDel.status, 403);
  assert.equal(admDel.json.code, "DS_ROLE");

  const saNone = await call("POST", "/studio/brand-kit/fonts", "superadmin", form(woff2(), "plex.woff2", fields({ family: "Plex" })));
  assert.equal(saNone.status, 400);
  assert.equal(saNone.json.code, "DS_COMPANY_REQUIRED");
  const sa = await upload("superadmin", woff2(), "plex.woff2", { family: "Plex", company_id: 1 }, "?company_id=1");
  assert.equal(sa.status, 201, JSON.stringify(sa.json));
  assert.equal(sa.json.files[0].format, "woff2");
  assert.equal(sa.json.licenceConfirmedBy, 5);

  const del = await call("DELETE", `/studio/brand-kit/fonts/${font.id}`, "manager");
  assert.equal(del.status, 204);
  const gone = await call("GET", font.files[0].url, "manager");
  assert.equal(gone.status, 404);
  const saDel = await call("DELETE", `/studio/brand-kit/fonts/${sa.json.id}?company_id=1`, "superadmin");
  assert.equal(saDel.status, 204);
  const audits = await q(`SELECT action FROM audit_log WHERE entity_type = 'brand_font' ORDER BY id`);
  assert.deepEqual(audits.map((a) => a.action), ["create", "create", "delete", "delete"]);
  await clean();
});

test("validation: magic bytes, size cap, licence tick, duplicate face, family join", async () => {
  const png = await upload("manager", PNG, "renamed.ttf");
  assert.equal(png.status, 415);
  assert.equal(png.json.code, "DS_FONT_TYPE");

  const broken = sfnt();
  broken.writeUInt32BE(9999, 20); // the table runs past the file
  const bad = await upload("manager", broken, "broken.ttf");
  assert.equal(bad.status, 415);
  assert.equal(bad.json.code, "DS_FONT_TYPE");

  const shortWoff = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60)]);
  const sw = await upload("manager", shortWoff, "x.woff2");
  assert.equal(sw.status, 415);

  const big = await upload("manager", sfnt([0x00, 0x01, 0x00, 0x00], 5 * 1024 * 1024), "big.ttf");
  assert.equal(big.status, 413);
  assert.equal(big.json.code, "DS_FONT_TOO_LARGE");

  const noTick = await upload("manager", sfnt(), "a.ttf", { licenceConfirmed: "false" });
  assert.equal(noTick.status, 422);
  assert.equal(noTick.json.code, "DS_FONT_LICENCE");
  const noTick2 = await call("POST", "/studio/brand-kit/fonts", "manager", form(sfnt(), "a.ttf", { family: "X" }));
  assert.equal(noTick2.json.code, "DS_FONT_LICENCE");

  const noFile = await call("POST", "/studio/brand-kit/fonts", "manager", form(null, null, fields()));
  assert.equal(noFile.status, 400);
  assert.equal(noFile.json.code, "DS_VALIDATION");
  const badName = await upload("manager", sfnt(), "a.ttf", { family: 'Evil"}body{' });
  assert.equal(badName.status, 400);
  const badWeight = await upload("manager", sfnt(), "a.ttf", { weight: 450 });
  assert.equal(badWeight.status, 400);

  const [{ n }] = await q(`SELECT count(*)::int n FROM brand_font WHERE company_id = 1`);
  assert.equal(n, 0, "nothing was stored by a refused upload");

  const a = await upload("manager", sfnt(), "a.ttf");
  assert.equal(a.status, 201);
  const again = await upload("manager", sfnt(), "a.ttf", { family: "midal sans " });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "DS_FONT_EXISTS");
  const otf = await upload("manager", sfnt([0x4f, 0x54, 0x54, 0x4f]), "bold.otf", { family: "MIDAL SANS", weight: 700 });
  assert.equal(otf.status, 201, JSON.stringify(otf.json));
  assert.equal(otf.json.id, a.json.id, "a second weight joins the family");
  assert.deepEqual(otf.json.weights, [400, 700]);
  assert.deepEqual(otf.json.files.map((f) => f.format), ["ttf", "otf"]);
  const italic = await upload("manager", sfnt([0x74, 0x72, 0x75, 0x65]), "i.ttf", { style: "italic" });
  assert.equal(italic.status, 201);
  assert.deepEqual(italic.json.styles.sort(), ["italic", "normal"]);
  const rows = await q(`SELECT licence_confirmed_by, licence_confirmed_at FROM brand_font_file WHERE font_id = $1`, [a.json.id]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.licence_confirmed_by === 2 && r.licence_confirmed_at), "who and when are stored per file");
  await clean();
});

test("tenant: company 2 never sees, fetches or deletes company 1's fonts", async () => {
  const a = await upload("manager", sfnt(), "a.ttf");
  assert.equal(a.status, 201);
  const other = await call("GET", "/studio/brand-kit/fonts", "otherManager");
  assert.equal(other.status, 200);
  assert.deepEqual(other.json.fonts, []);
  const named = await call("GET", "/studio/brand-kit/fonts?company_id=1", "otherManager");
  assert.equal(named.status, 404);
  const file = await call("GET", a.json.files[0].url, "otherManager");
  assert.equal(file.status, 404);
  const del = await call("DELETE", `/studio/brand-kit/fonts/${a.json.id}`, "otherManager");
  assert.equal(del.status, 404);
  const still = await q(`SELECT count(*)::int n FROM brand_font WHERE id = $1`, [a.json.id]);
  assert.equal(still[0].n, 1);
  const bogus = await call("GET", `/studio/brand-kit/fonts/${a.json.id}/files/not-a-uuid`, "manager");
  assert.equal(bogus.status, 404);
  const kit = await call("GET", "/studio/brand-kit", "otherManager");
  assert.deepEqual(kit.json.customFonts, []);
  await clean();
});

/** A company-1 (or 2) design with a text box in `font`. */
async function docWithFont(font, who = "manager", title = "PE-2 Font doc") {
  const c = await call("POST", "/studio/docs", who, { kind: "ghg", templateId: "blank", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, format: "a4", title });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.meta = { ...d.meta, year: 2025, title };
  d.assets = [];
  d.pages = d.pages.filter((p) => p.kind === "freeform").slice(0, 1);
  d.pages[0].elements = [
    {
      id: "pe2.t",
      type: "text",
      frame: { x: 20, y: 20, w: 170, h: 30, rotation: 0 },
      z: 1,
      source: "user",
      props: { style: "title", align: "left", font, effects: { shadow: { blur: 20, offsetX: 10, offsetY: 10, colour: "#000000", opacity: 40 } }, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Net zero by 2040" }] }] } },
    },
  ];
  const p = await call("PATCH", `/studio/docs/${c.json.id}`, who, { rev: c.json.rev, doc: d });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return { id: c.json.id, rev: p.json.rev };
}

test("renders: preview.html embeds the used custom font from the stored bytes; another company's or a deleted one falls back", async () => {
  const a = await upload("manager", woff2(), "plex.woff2", { family: "Plex Brand" });
  assert.equal(a.status, 201);
  const b64 = woff2().toString("base64");
  const doc = await docWithFont(a.json.ref);
  const pv = await call("GET", `/studio/docs/${doc.id}/preview.html?mode=paged`, "admin");
  assert.equal(pv.status, 200);
  const html = pv.buffer.toString("utf8");
  assert.match(pv.headers.get("content-security-policy"), /font-src data:/);
  assert.ok(html.includes(`@font-face{font-family:"DS Brand ${a.json.id}";font-style:normal;font-weight:400;font-display:block;src:url("data:font/woff2;base64,${b64}") format("woff2");}`), "the stored bytes are the @font-face");
  assert.ok(html.includes(`font-family:&quot;DS Brand ${a.json.id}&quot;, &quot;Noto Sans&quot;, sans-serif;`), "the text box uses the brand font");
  assert.ok(html.includes(`data-effects="shadow"`) && html.includes("text-shadow:0.3mm 0.3mm 0.8mm rgba(0,0,0,0.4)"), "the effect renders");
  assert.ok(!html.includes("Plex Brand"), "the uploaded family name never reaches the page");

  // Company 2 naming company 1's font ref: not embedded, the style's font is used.
  const other = await docWithFont(a.json.ref, "otherManager", "PE-2 Other doc");
  const opv = await call("GET", `/studio/docs/${other.id}/preview.html?mode=paged`, "otherManager");
  assert.equal(opv.status, 200);
  const ohtml = opv.buffer.toString("utf8");
  assert.ok(!ohtml.includes(b64) && !ohtml.includes("DS Brand"), "another company's font bytes are never embedded");

  if (chromiumOk) {
    const j = await call("POST", `/studio/docs/${doc.id}/jobs`, "manager", { kind: "proof", rev: doc.rev });
    assert.ok([201, 202].includes(j.status), JSON.stringify(j.json));
    let job;
    for (const until = Date.now() + 120_000; ; ) {
      job = (await call("GET", `/studio/jobs/${j.json.id}`, "manager")).json;
      if (job.status === "done" || job.status === "failed") break;
      if (Date.now() > until) throw new Error("proof still running");
      await wait(400);
    }
    assert.equal(job.status, "done", JSON.stringify(job));
    const pdf = await call("GET", `/studio/jobs/${j.json.id}/file`, "manager");
    assert.equal(pdf.status, 200);
    assert.ok(/IBMPlexSerif|IBM Plex Serif/.test(pdf.buffer.toString("latin1")), "the PDF embeds the uploaded face");
  }

  const del = await call("DELETE", `/studio/brand-kit/fonts/${a.json.id}`, "manager");
  assert.equal(del.status, 204);
  const after = (await call("GET", `/studio/docs/${doc.id}/preview.html?mode=paged`, "admin")).buffer.toString("utf8");
  assert.ok(!after.includes("DS Brand"), "a deleted font falls back to the style's font");
  assert.ok(after.includes(`data-font="${a.json.ref}"`), "the box keeps its font ref");
  if (!chromiumOk) test.diagnostic(`PDF embedding not checked: ${why}`);
  await clean();
});
