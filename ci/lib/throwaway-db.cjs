// Every CI script that opens a database calls this first. It refuses to run
// unless the connection points at the disposable Postgres container the
// workflow starts, so a misconfigured runner can never touch production.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

function assertThrowawayDb() {
  const problems = [];
  if (process.env.CI_THROWAWAY_DB !== "true") problems.push("CI_THROWAWAY_DB is not 'true'");
  if (process.env.DATABASE_URL) problems.push("DATABASE_URL is set (production uses it)");
  if (process.env.NODE_ENV === "production") problems.push("NODE_ENV is production");
  if (!LOCAL_HOSTS.has(String(process.env.DB_HOST || ""))) {
    problems.push(`DB_HOST '${process.env.DB_HOST}' is not a local throwaway host`);
  }
  if (!/^ci_/.test(String(process.env.DB_NAME || ""))) {
    problems.push(`DB_NAME '${process.env.DB_NAME}' does not start with ci_`);
  }
  if (problems.length) {
    console.error("Refusing to touch this database:\n  - " + problems.join("\n  - "));
    process.exit(3);
  }
}

/**
 * A scratch database beside the throwaway one, for a suite that needs an empty
 * database of its own (the audit probes run the calculation snapshot in one).
 * Only `<DB_NAME>_<suffix>` is ever made or removed, after the same checks as
 * assertThrowawayDb, so neither the throwaway database itself nor any other
 * database on the server can be named here.
 */
function scratchDbName(suffix) {
  assertThrowawayDb();
  if (!/^[a-z0-9_]+$/.test(String(suffix || ""))) throw new Error(`scratch database suffix '${suffix}' must be [a-z0-9_]+`);
  return `${process.env.DB_NAME}_${suffix}`;
}

async function onServer(Client, config, sql) {
  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end().catch(() => {});
  }
}

/** Creates `<DB_NAME>_<suffix>` empty (removing a leftover from a crashed run first); returns its name. */
async function createScratchDb(Client, config, suffix) {
  const name = scratchDbName(suffix);
  await onServer(Client, config, `DROP DATABASE IF EXISTS "${name}"`);
  await onServer(Client, config, `CREATE DATABASE "${name}"`);
  return name;
}

/** Removes `<DB_NAME>_<suffix>`; never throws. */
async function dropScratchDb(Client, config, suffix) {
  const name = scratchDbName(suffix);
  await onServer(Client, config, `DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
}

module.exports = { assertThrowawayDb, scratchDbName, createScratchDb, dropScratchDb };
