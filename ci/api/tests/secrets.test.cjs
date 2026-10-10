// No built-in secrets (audit finding F-04): the server will not start without
// JWT_SECRET, a token signed with the old fallback secret is refused, and the
// legacy Excel import gives new users a random password that it never returns.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const XLSX = require("xlsx");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test("the server refuses to start without JWT_SECRET", async () => {
  const env = { ...process.env, PORT: "0", RABBITMQ_URL: "amqp://127.0.0.1:1" };
  delete env.JWT_SECRET;
  // Run from an empty directory so no .env file supplies a secret.
  const child = spawn(process.execPath, [path.join(ROOT, "dist/index.js")], { cwd: os.tmpdir(), env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("still running");
    }, 20000);
    child.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  assert.equal(code, 1);
  assert.match(err, /JWT_SECRET is not set/);
});

test("a token signed with the old fallback secret is refused", async () => {
  const forged = jwt.sign({ userId: 5, role: "Superadmin" }, "supersecret");
  const res = await fetch(`${process.env.API_BASE}/user/emissions`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401);
  const report = await fetch(`${process.env.API_BASE}/reports/ghg?siteIds=1&token=${forged}`);
  assert.equal(report.status, 401);
});

test("legacy Excel import creates users with a random password and does not return one", async () => {
  const emails = ["ci-import-a@example.invalid", "ci-import-b@example.invalid"];
  const sheet = XLSX.utils.json_to_sheet(
    emails.map((email, i) => ({ year: "2019", month: "January", email, name: `Import ${i}`, fuelType: "Diesel", unit: "litre", activity: 10 + i, emissionFactor: 2.5, emissionFactorUnit: "kgCO2e/litre", calculatedEmission: 999 })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "import.xlsx");
  form.append("siteName", "CI Plant A");
  form.append("categoryName", "Stationary Combustion");
  try {
    const r = await call("POST", "/admin/upload/emissions", "superadmin", form);
    assert.equal(r.status, 200);
    assert.equal(r.json.summary.usersCreated, 2);
    assert.equal(r.json.summary.defaultPassword, undefined);
    assert.ok(!JSON.stringify(r.json).includes("Welcome@123"));
    const users = await q('SELECT password FROM "user" WHERE email = ANY($1::text[])', [emails]);
    assert.equal(users.length, 2);
    for (const u of users) assert.equal(await bcrypt.compare("Welcome@123", u.password), false);
  } finally {
    await q("DELETE FROM emission WHERE site_id = 1 AND date_of_reporting >= '2019-01-01' AND date_of_reporting < '2020-01-01'");
    await q('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
  }
});
