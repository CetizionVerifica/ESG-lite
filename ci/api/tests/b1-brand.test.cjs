// B1: brand theme fields (logoOnDarkUrl, defaultLook, scope3Colour), the dark
// logo upload and the read-only /brands/mine.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

test("GET /brands/:companyId returns the new fields with defaults for an existing row", async () => {
  const res = await call("GET", "/brands/1", "superadmin");
  assert.equal(res.status, 200);
  assert.equal(res.json.primary, "#123456");
  assert.equal(res.json.logoOnDarkUrl, null);
  assert.equal(res.json.defaultLook, "classic");
  assert.equal(res.json.scope3Colour, null);
});

test("GET /brands/:companyId falls back to defaults (with new fields) when no row exists", async () => {
  const res = await call("GET", "/brands/2", "superadmin");
  assert.equal(res.status, 200);
  assert.deepEqual(
    { name: res.json.name, defaultLook: res.json.defaultLook, logoOnDarkUrl: res.json.logoOnDarkUrl, scope3Colour: res.json.scope3Colour },
    { name: "CI Other Co", defaultLook: "classic", logoOnDarkUrl: null, scope3Colour: null },
  );
});

test("brand management stays superadmin-only", async () => {
  for (const who of ["manager", "admin", "user"]) {
    assert.equal((await call("PUT", "/brands/1", who, { defaultLook: "night" })).status, 403);
    assert.equal((await call("POST", "/brands/1/logo-dark", who)).status, 403);
  }
  assert.equal((await call("GET", "/brands/mine", null)).status, 401);
});

test("PUT /brands/:companyId validates and saves defaultLook and scope3Colour", async () => {
  assert.equal((await call("PUT", "/brands/1", "superadmin", { defaultLook: "dusk" })).status, 400);
  assert.equal((await call("PUT", "/brands/1", "superadmin", { scope3Colour: "teal" })).status, 400);
  assert.equal((await call("PUT", "/brands/1", "superadmin", { logoOnDarkUrl: "https://x" })).status, 400);

  const saved = await call("PUT", "/brands/1", "superadmin", { defaultLook: "night", scope3Colour: "#0f766e" });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.brand.defaultLook, "night");
  assert.equal(saved.json.brand.scope3Colour, "#0f766e");
  // Untouched fields keep their values.
  assert.equal(saved.json.brand.primary, "#123456");

  const cleared = await call("PUT", "/brands/1", "superadmin", { scope3Colour: null });
  assert.equal(cleared.json.brand.scope3Colour, null);
  assert.equal(cleared.json.brand.defaultLook, "night");
});

test("PUT with only the old fields behaves as before", async () => {
  const res = await call("PUT", "/brands/2", "superadmin", { primary: "#222222" });
  assert.equal(res.status, 200);
  assert.equal(res.json.brand.primary, "#222222");
  assert.equal(res.json.brand.defaultLook, "classic");
});

test("POST /brands/:companyId/logo-dark validates the file and needs R2", async () => {
  const none = await call("POST", "/brands/1/logo-dark", "superadmin", new FormData());
  assert.equal(none.status, 400);

  const notImage = new FormData();
  notImage.append("logo", new Blob(["hello"], { type: "text/plain" }), "logo.txt");
  assert.equal((await call("POST", "/brands/1/logo-dark", "superadmin", notImage)).status, 400);

  // CI has no R2 credentials, so a valid image stops at the storage check.
  const png = new FormData();
  png.append("logo", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "logo.png");
  assert.equal((await call("POST", "/brands/1/logo-dark", "superadmin", png)).status, 503);
});

test("GET /brands/mine returns the user's own company brand without storage keys", async () => {
  for (const who of ["manager", "user", "admin"]) {
    const res = await call("GET", "/brands/mine", who);
    assert.equal(res.status, 200, who);
    assert.equal(res.json.companyId, 1);
    assert.equal(res.json.defaultLook, "night");
    assert.ok(!("logoPublicId" in res.json));
    assert.ok(!("logoOnDarkPublicId" in res.json));
  }
  const other = await call("GET", "/brands/mine", "otherUser");
  assert.equal(other.json.companyId, 2);

  assert.equal((await call("GET", "/brands/mine", "superadmin")).status, 404);
});

test("GET /brands/:companyId: company members read their own brand only, without storage keys", async () => {
  for (const who of ["manager", "user", "admin", "multiSiteUser"]) {
    const res = await call("GET", "/brands/1", who);
    assert.equal(res.status, 200, who);
    assert.equal(res.json.companyId, 1);
    assert.equal(res.json.logoUrl, "https://assets.example.invalid/brand-assets/company_1.png");
    assert.ok(!("logoPublicId" in res.json));
    assert.ok(!("logoOnDarkPublicId" in res.json));
    assert.equal((await call("GET", "/brands/2", who)).status, 403, who);
  }
  assert.equal((await call("GET", "/brands/2", "otherManager")).status, 200);
  assert.equal((await call("GET", "/brands/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/brands/1", null)).status, 401);

  assert.equal((await call("GET", "/brands/1.5", "superadmin")).status, 400);

  // Superadmins still get the full row, storage keys included.
  const staff = await call("GET", "/brands/1", "superadmin");
  assert.equal(staff.status, 200);
  assert.equal(staff.json.logoPublicId, "brand-assets/company_1.png");
});

test("colour guideline: upload validates the file, needs R2, and can only be cleared through PUT", async () => {
  for (const who of ["manager", "admin", "user"]) {
    assert.equal((await call("POST", "/brands/1/guideline", who)).status, 403, who);
  }

  assert.equal((await call("POST", "/brands/1/guideline", "superadmin", new FormData())).status, 400);

  const notAllowed = new FormData();
  notAllowed.append("guideline", new Blob(["hello"], { type: "text/plain" }), "guide.txt");
  assert.equal((await call("POST", "/brands/1/guideline", "superadmin", notAllowed)).status, 400);

  const wrongField = new FormData();
  wrongField.append("logo", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "guide.pdf");
  assert.equal((await call("POST", "/brands/1/guideline", "superadmin", wrongField)).status, 400);

  // CI has no R2 credentials, so a valid PDF stops at the storage check.
  const pdf = new FormData();
  pdf.append("guideline", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "guide.pdf");
  assert.equal((await call("POST", "/brands/1/guideline", "superadmin", pdf)).status, 503);
  assert.equal((await call("POST", "/brands/999999/guideline", "superadmin", pdf)).status, 404);

  assert.equal((await call("PUT", "/brands/1", "superadmin", { guidelineUrl: "https://x" })).status, 400);
  const cleared = await call("PUT", "/brands/1", "superadmin", { guidelineUrl: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.brand.guidelineUrl, null);
  assert.equal(cleared.json.brand.guidelineName, null);
});

test("colour guideline fields: null by default, storage key only for superadmins", async () => {
  const fallback = await call("GET", "/brands/999998", "superadmin");
  assert.equal(fallback.status, 404);

  const staff = await call("GET", "/brands/1", "superadmin");
  assert.equal(staff.json.guidelineUrl, null);
  assert.ok("guidelinePublicId" in staff.json);

  const own = await call("GET", "/brands/1", "manager");
  assert.ok(!("guidelinePublicId" in own.json));
  const mine = await call("GET", "/brands/mine", "user");
  assert.ok(!("guidelinePublicId" in mine.json));

  const noRow = await call("GET", "/brands/2", "superadmin");
  assert.equal(noRow.json.guidelineUrl, null);
});
