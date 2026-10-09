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

module.exports = { assertThrowawayDb };
