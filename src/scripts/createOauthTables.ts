// Creates the OAuth server tables for the Claude (MCP) connector and the
// per-client "Allow Claude imports" switch (MCP import plan, IM5):
//
//   oauth_client   apps registered through POST /oauth/register
//   oauth_grant    one user's consent for one client (revoked_at = disconnected)
//   oauth_code     one-time authorization codes (hashed)
//   oauth_token    access and refresh tokens (hashed)
//   company.mcp_enabled   boolean, default false
//
//   npm run migrate:oauth
//
// Statements match what TypeORM generates for src/entities/Oauth*.ts and
// Company.mcp_enabled (constraint names included), so ci/schema-diff.cjs sees
// nothing left to do. Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "oauth_client" (
     "client_id" character varying(64) NOT NULL,
     "client_name" character varying(200) NOT NULL,
     "redirect_uris" jsonb NOT NULL,
     "token_endpoint_auth_method" character varying(40) NOT NULL DEFAULT 'none',
     "grant_types" jsonb NOT NULL,
     "client_uri" character varying(500),
     "logo_uri" character varying(500),
     "created_at" TIMESTAMP NOT NULL DEFAULT now(),
     CONSTRAINT "PK_120e591449cf7f49569ee6c95b3" PRIMARY KEY ("client_id"))`,
  `CREATE TABLE IF NOT EXISTS "oauth_grant" (
     "grant_id" SERIAL NOT NULL,
     "user_id" integer NOT NULL,
     "client_id" character varying(64) NOT NULL,
     "scopes" character varying(200) NOT NULL,
     "created_at" TIMESTAMP NOT NULL DEFAULT now(),
     "last_used_at" TIMESTAMP,
     "revoked_at" TIMESTAMP,
     CONSTRAINT "PK_521e77cfed57306aff999edf189" PRIMARY KEY ("grant_id"))`,
  `CREATE TABLE IF NOT EXISTS "oauth_code" (
     "code_hash" character varying(64) NOT NULL,
     "grant_id" integer NOT NULL,
     "client_id" character varying(64) NOT NULL,
     "redirect_uri" character varying(2000) NOT NULL,
     "code_challenge" character varying(128) NOT NULL,
     "resource" character varying(500) NOT NULL,
     "scopes" character varying(200) NOT NULL,
     "expires_at" TIMESTAMP NOT NULL,
     "used_at" TIMESTAMP,
     "created_at" TIMESTAMP NOT NULL DEFAULT now(),
     CONSTRAINT "PK_2f1a9780e196e933b062b845df2" PRIMARY KEY ("code_hash"))`,
  `CREATE TABLE IF NOT EXISTS "oauth_token" (
     "token_id" SERIAL NOT NULL,
     "token_hash" character varying(64) NOT NULL,
     "kind" character varying(8) NOT NULL,
     "grant_id" integer NOT NULL,
     "scopes" character varying(200) NOT NULL,
     "resource" character varying(500) NOT NULL,
     "expires_at" TIMESTAMP NOT NULL,
     "created_at" TIMESTAMP NOT NULL DEFAULT now(),
     "revoked_at" TIMESTAMP,
     "replaced_at" TIMESTAMP,
     CONSTRAINT "PK_6836f0c1ed9903b3253c6a7a5dd" PRIMARY KEY ("token_id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_43fcba2d5c4e0cf263161a94f5" ON "oauth_token" ("token_hash")`,
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "mcp_enabled" boolean NOT NULL DEFAULT false`,
];

const FOREIGN_KEYS: [string, string, string][] = [
  ["oauth_grant", "FK_86155d6f027cbd4e4ae8ed77ac6", `FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  ["oauth_grant", "FK_5055d880f4b75e2cbbff8a7b440", `FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  ["oauth_code", "FK_5f55e929e33d5912a6a785d1e31", `FOREIGN KEY ("grant_id") REFERENCES "oauth_grant"("grant_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  ["oauth_token", "FK_45a8738741c4ddcaeb20cca5ea2", `FOREIGN KEY ("grant_id") REFERENCES "oauth_grant"("grant_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of STATEMENTS) await AppDataSource.query(sql);
    for (const [table, name, definition] of FOREIGN_KEYS) {
      const [{ exists }] = await AppDataSource.query(
        `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS exists`,
        [name],
      );
      if (!exists) await AppDataSource.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${definition}`);
    }
    console.log("oauth_client, oauth_grant, oauth_code, oauth_token and company.mcp_enabled present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
