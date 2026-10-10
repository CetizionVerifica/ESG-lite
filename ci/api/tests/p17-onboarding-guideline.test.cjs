// P17: onboarding keeps the colour guideline. CI has no R2, so a supported
// file comes back as a storage warning and an unsupported one as a type
// warning; the company is created either way.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const form = (email, file) => {
  const f = new FormData();
  f.append("companyName", `CI Guideline Co ${email}`);
  f.append("contactPerson", "Guide Admin");
  f.append("email", email);
  f.append("password", "long enough");
  if (file) f.append("colorGuideline", file.blob, file.name);
  return f;
};

test("onboarding with a PDF colour guideline creates the client and warns when storage is missing", async () => {
  const pdf = { blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), name: "colours.pdf" };
  const res = await call("POST", "/admin/onboarding/company", "superadmin", form("guide-pdf@ci.example", pdf));
  assert.equal(res.status, 201);
  assert.ok(res.json.company.company_id);
  assert.deepEqual(res.json.warnings, [
    "Colour guideline was not saved: asset storage (R2) is not configured on the server. Upload it in the client's Brand tab.",
  ]);
});

test("onboarding with an unsupported colour guideline still creates the client, with a warning", async () => {
  const txt = { blob: new Blob(["hello"], { type: "text/plain" }), name: "colours.txt" };
  const res = await call("POST", "/admin/onboarding/company", "superadmin", form("guide-txt@ci.example", txt));
  assert.equal(res.status, 201);
  assert.equal(res.json.warnings.length, 1);
  assert.match(res.json.warnings[0], /^Colour guideline was not saved: unsupported file type/);
});

test("an SVG is not accepted as a colour guideline", async () => {
  const svg = new FormData();
  svg.append("guideline", new Blob(["<svg/>"], { type: "image/svg+xml" }), "colours.svg");
  assert.equal((await call("POST", "/brands/1/guideline", "superadmin", svg)).status, 400);
});
