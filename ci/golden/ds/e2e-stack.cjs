// DS-14F · the real stack for the FE main-path e2e (ESG-lite_FE e2e/ds-14-main-path.spec.ts).
//
//   DB_NAME=ci_<anything> node ci/golden/ds/e2e-stack.cjs <out.json> [apiPort=3995] [appOrigin=http://localhost:4317]
//
// Prepares a throwaway ci_* database the way the DS goldens do (schema from dist/, the API
// fixture, every migrate:ds-*, the DS seed companies and seed docs: ci/golden/ds/lib/seed.cjs),
// boots the compiled server with CORS for the app origin, and writes <out.json>:
//   { api, appOrigin, companyId, tokens: { manager, superadmin }, templates: { "<slug>": id } }
// The manager is DS Seed Cement's (company 11, FY 2026 data, no pending rows). It keeps running
// until SIGINT/SIGTERM. Needs `npm run build` first; Chromium (playwright) for finals.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const OUT = path.resolve(process.argv[2] || "ds-e2e-stack.json");
const PORT = Number(process.argv[3] || 3995);
const APP = process.argv[4] || "http://localhost:4317";
const SECRET = "ds-e2e-only-not-a-real-secret";

require(path.join(ROOT, "ci/lib/throwaway-db.cjs")).assertThrowawayDb();
const { prepare, boot, q, caller } = require("./lib/stack.cjs");
const { ensureSeed } = require("./lib/seed.cjs");

(async () => {
  await prepare(ROOT);
  const stack = await boot(ROOT, PORT, SECRET, { CORS_ORIGIN: APP, FRONTEND_URL: APP, SHARE_BASE_URL: APP });
  const stop = () => {
    stack.server.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const ctx = { root: ROOT, q: (sql, params) => q(sql, params, ROOT), call: caller(ROOT, stack.base, SECRET) };
    await ensureSeed(ctx);
    const jwt = require(require.resolve("jsonwebtoken", { paths: [ROOT] }));
    const templates = Object.fromEntries((await ctx.q(`SELECT slug, id FROM report_template WHERE company_id IS NULL AND is_active ORDER BY id`)).map((r) => [r.slug, r.id]));
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          api: stack.base,
          appOrigin: APP,
          companyId: 11,
          tokens: { manager: jwt.sign({ userId: 11, role: "Manager" }, SECRET), superadmin: jwt.sign({ userId: 5, role: "Superadmin" }, SECRET) },
          templates,
        },
        null,
        2,
      ),
    );
    console.log(`ds e2e stack: ${stack.base} (app ${APP}); wrote ${OUT}`);
  } catch (err) {
    console.error(err);
    console.error(stack.logs.join("").slice(-3000));
    stop();
  }
})();
