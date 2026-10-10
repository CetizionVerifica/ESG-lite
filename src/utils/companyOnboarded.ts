import { AppDataSource } from "../config/data-source";

// Stamps company.created_at, the onboarding date the P16 Console shows. The
// column comes from migrate:company-created-at and has no database default, so
// the entity (select/insert/update false) never touches it and company saves
// work before the migration. Best effort: a missing column is ignored.
export async function stampCompanyOnboarded(companyId: number): Promise<void> {
  try {
    await AppDataSource.query(`UPDATE company SET created_at = now() WHERE company_id = $1 AND created_at IS NULL`, [
      companyId,
    ]);
  } catch (err: any) {
    if (err?.code === "42703") return; // undefined_column: migration not run yet
    console.warn("company.created_at not stamped:", String(err));
  }
}
