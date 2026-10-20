// PRO-0 · the Pro editing and AI template routes (docs/design-studio/pro/):
// AT-1 POST /templates/suggest; AT-2 template-swap preview/apply; PE-1
// remove-background + image jobs; PE-2 brand fonts. Until a module lands its
// route answers 501 DS_NOT_BUILT past the guard. For every route: switch off
// → 403 DS_STUDIO_OFF for every role; Users → DS_ROLE; Admins → DS_ROLE on the
// Manager-only font routes (E3); another company's people naming company 1 →
// 404; a Superadmin without company_id → DS_COMPANY_REQUIRED. The modules'
// own ds-pro-* tests cover the built behaviour (tenant rows, payloads).
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other user 4,
// other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setStudio, setKpi, callAs } = require("./ds-lib.cjs");

const ROUTES = [
  { method: "POST", path: "/studio/templates/suggest", module: "AT-1" },
  { method: "POST", path: "/studio/docs/1/template-swap/preview", module: "AT-2" },
  { method: "POST", path: "/studio/docs/1/template-swap/apply", module: "AT-2" },
  { method: "POST", path: "/studio/assets/1/remove-background", module: "PE-1" },
  { method: "GET", path: "/studio/image-jobs/1", module: "PE-1" },
  { method: "GET", path: "/studio/brand-kit/fonts", module: "PE-2" },
  { method: "POST", path: "/studio/brand-kit/fonts", module: "PE-2", manager: true },
  { method: "DELETE", path: "/studio/brand-kit/fonts/1", module: "PE-2", manager: true },
  { method: "GET", path: "/studio/brand-kit/fonts/1/files/1", module: "PE-2" },
];
const label = (r, who) => `${who} ${r.method} ${r.path}`;
const guardCodes = ["DS_STUDIO_OFF", "DS_ROLE", "DS_COMPANY_REQUIRED"];

const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
};
test.before(reset);
test.after(reset);

test("switch off: every PRO route answers 403 DS_STUDIO_OFF for every role", async () => {
  for (const r of ROUTES) {
    for (const who of ["user", "manager", "admin", "superadmin"]) {
      const res = await callAs(r, who, 1);
      assert.equal(res.status, 403, label(r, who));
      assert.equal(res.json?.code, "DS_STUDIO_OFF", label(r, who));
    }
  }
});

test("switch on: Users DS_ROLE, Admins DS_ROLE on Manager-only font routes, Managers past the guard", async () => {
  await setStudio(1, true);
  for (const r of ROUTES) {
    for (const who of ["user", "multiSiteUser"]) {
      const res = await callAs(r, who, 1);
      assert.equal(res.status, 403, label(r, who));
      assert.equal(res.json?.code, "DS_ROLE", label(r, who));
    }
    const adm = await callAs(r, "admin", 1);
    if (r.manager) {
      assert.equal(adm.status, 403, label(r, "admin"));
      assert.equal(adm.json?.code, "DS_ROLE", label(r, "admin"));
    } else {
      assert.ok(!guardCodes.includes(adm.json?.code), `${label(r, "admin")}: ${adm.status} ${adm.json?.code}`);
    }
    for (const who of ["manager", "superadmin"]) {
      const res = await callAs(r, who, 1);
      assert.ok(!guardCodes.includes(res.json?.code), `${label(r, who)}: ${res.status} ${res.json?.code}`);
      assert.ok(res.json?.code || res.status < 300, `${label(r, who)} is routed (a DS error or a success, never Express's 404)`);
      // A stub names its module; once the module lands the route answers for real.
      if (res.status === 501) assert.deepEqual(res.json, { code: "DS_NOT_BUILT", message: "This isn't available yet.", details: { module: r.module } }, label(r, who));
    }
  }
});

test("tenant: another company's people naming company 1 get 404; a Superadmin must name the company", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  for (const r of ROUTES) {
    for (const who of ["otherManager", "otherUser"]) {
      const sep = r.path.includes("?") ? "&" : "?";
      const res = await call(r.method, `${r.path}${sep}company_id=1`, who, r.method === "GET" || r.method === "DELETE" ? undefined : { company_id: 1 });
      assert.equal(res.status, 404, label(r, who));
    }
    const none = await call(r.method, r.path, "superadmin", r.method === "GET" || r.method === "DELETE" ? undefined : {});
    assert.equal(none.status, 400, label(r, "superadmin"));
    assert.equal(none.json?.code, "DS_COMPANY_REQUIRED", label(r, "superadmin"));
  }
});
