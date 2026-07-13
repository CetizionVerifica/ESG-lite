// One-off: reset the superadmin password to a known local-dev value.
const bcrypt = require("bcrypt");
const { Client } = require("pg");
(async () => {
  const email = process.argv[2] || "shyam.admin@cv.com";
  const pw = process.argv[3] || "piku1234";
  const hash = await bcrypt.hash(pw, 10);
  const c = new Client({ host: "localhost", port: 5433, user: "postgres", password: "postgres", database: "emissions_db" });
  await c.connect();
  const r = await c.query('UPDATE public."user" SET password=$1 WHERE email=$2', [hash, email]);
  console.log(`updated ${r.rowCount} row -> ${email} / ${pw}`);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
