/**
 * Category 3 sub-activities (docs/scope3/01-contracts.md §1, `Scope3Sub`).
 *
 * S3-0 owns this folder and defines these in ghgCategory.ts. S3-7 wrote this
 * file from the contract because it needs it before S3-0 merges; when S3-0
 * lands, S3-7 imports from ghgCategory.ts and this file goes.
 */
export const SCOPE3_SUBS = ["3a_upstream_fuels", "3b_upstream_electricity", "3c_td_losses", "3d_resold_energy"] as const;
export type Scope3Sub = (typeof SCOPE3_SUBS)[number];
export const isScope3Sub = (v: unknown): v is Scope3Sub => typeof v === "string" && (SCOPE3_SUBS as readonly string[]).includes(v);
