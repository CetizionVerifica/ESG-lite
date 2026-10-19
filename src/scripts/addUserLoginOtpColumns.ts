// Adds the email sign-in code columns to "user": login_otp_hash,
// login_otp_expires and login_otp_attempts ("Sign in with a code" on the
// login page, see controllers/loginOtp.controller.ts). Existing users start
// with no code.
//
//   npm run migrate:user-login-otp
//
// The entity maps the columns with select: false and insert: false, so the
// backend keeps working if this runs after the deploy; until it runs,
// requesting a code fails and password sign-in is unaffected.
//
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS login_otp_hash varchar(64) NULL`);
    await AppDataSource.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS login_otp_expires timestamp NULL`);
    await AppDataSource.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS login_otp_attempts int NULL`);
    console.log('"user".login_otp_hash, login_otp_expires, login_otp_attempts present.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
