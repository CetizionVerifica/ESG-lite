// P01: GET /brands/public/:slug, the client's theme for its sign-in page
// before anyone signs in, and setting the slug through PUT /brands/:companyId.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

test("PUT /brands/:companyId validates the slug", async () => {
  for (const slug of ["Midal", "-midal", "mi dal", "midal--co", "x".repeat(64), 42]) {
    assert.equal((await call("PUT", "/brands/1", "superadmin", { slug })).status, 400, `slug ${slug}`);
  }
  assert.equal((await call("PUT", "/brands/1", "manager", { slug: "ci-co" })).status, 403);
});

test("a slug is unique across clients", async () => {
  const saved = await call("PUT", "/brands/1", "superadmin", { slug: "ci-co" });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.brand.slug, "ci-co");
  assert.equal((await call("PUT", "/brands/2", "superadmin", { slug: "ci-co" })).status, 409);
  // Saving the same slug again on its own client is fine.
  assert.equal((await call("PUT", "/brands/1", "superadmin", { slug: "ci-co" })).status, 200);
});

test("GET /brands/public/:slug needs no sign-in and returns only the public kit", async () => {
  await call("PUT", "/brands/1", "superadmin", { slug: "ci-co" });
  const res = await call("GET", "/brands/public/ci-co", null);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), [
    "accent", "coverFrom", "coverTo", "defaultLook", "logoOnDarkUrl", "logoUrl", "name", "primary", "slug",
  ]);
  assert.equal(res.json.primary, "#123456");
  assert.equal(res.json.companyId, undefined);
  // Case-insensitive lookup.
  assert.equal((await call("GET", "/brands/public/CI-CO", null)).status, 200);
});

test("unknown or malformed slugs are 404", async () => {
  assert.equal((await call("GET", "/brands/public/nobody", null)).status, 404);
  assert.equal((await call("GET", "/brands/public/bad..slug", null)).status, 404);
});

test("clearing the slug turns the public page off", async () => {
  await call("PUT", "/brands/1", "superadmin", { slug: null });
  assert.equal((await call("GET", "/brands/public/ci-co", null)).status, 404);
});
