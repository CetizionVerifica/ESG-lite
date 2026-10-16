/**
 * S3-11 · which inventory a leased or franchised site's energy belongs to,
 * given the company's consolidation approach (Scope 3 Standard Appendix A,
 * guidance L4595-4597). Pure: it never moves rows. GET /scope3/categories and
 * GET /scope3/assets/sites show it as a per-site note; S3-13 uses it for the
 * boundary text.
 *
 *   lessee, finance lease    → Scope 1/2 (the asset is the company's own)
 *   lessee, operating lease  → Scope 1/2 under operational control,
 *                              Category 8 under equity share or financial control
 *   lessor, finance lease    → Category 13 (the lessee carries it)
 *   lessor, operating lease  → Category 13 under operational control,
 *                              Scope 1/2 under equity share or financial control
 *   franchisor               → Category 14 (the franchisee's Scope 1/2)
 *   franchisee               → Scope 1/2 (its own operations)
 *
 * A lessee or lessor with no lease type yet gives null: the note asks for it.
 */
import type { ConsolidationApproach } from "../boundary/service";
import { LEASE_ROLES, LEASE_TYPES } from "../contracts/schemas";

export type LeaseRole = (typeof LEASE_ROLES)[number];
export type LeaseType = (typeof LEASE_TYPES)[number];
export type LeaseBoundary = "scope12" | "cat8" | "cat13" | "cat14";

const isRole = (v: unknown): v is LeaseRole => typeof v === "string" && (LEASE_ROLES as readonly string[]).includes(v);
const isType = (v: unknown): v is LeaseType => typeof v === "string" && (LEASE_TYPES as readonly string[]).includes(v);

export function leaseBoundary(role: unknown, type: unknown, approach: ConsolidationApproach | string | null | undefined): LeaseBoundary | null {
  if (!isRole(role)) return null;
  if (role === "franchisor") return "cat14";
  if (role === "franchisee") return "scope12";
  if (!isType(type)) return null;
  const operational = (approach ?? "operational_control") === "operational_control";
  if (role === "lessee") return type === "finance" || operational ? "scope12" : "cat8";
  // lessor
  return type === "finance" || operational ? "cat13" : "scope12";
}

const APPROACH_WORDS: Record<string, string> = {
  operational_control: "operational control",
  financial_control: "financial control",
  equity_share: "equity share",
};

const WHERE: Record<LeaseBoundary, string> = {
  scope12: "your Scope 1 and 2",
  cat8: "Category 8 · Upstream leased assets",
  cat13: "Category 13 · Downstream leased assets",
  cat14: "Category 14 · Franchises",
};

/** The plain note the Sites form and the boundary page show, e.g. "With financial control, this site's energy belongs in Category 8 · Upstream leased assets." */
export function leaseBoundaryNote(role: unknown, type: unknown, approach: string | null | undefined): string | null {
  if (!isRole(role)) return null;
  const where = leaseBoundary(role, type, approach);
  if (!where) return "Choose the lease type (finance or operating) to see where this site's energy belongs.";
  const words = APPROACH_WORDS[approach ?? "operational_control"] ?? APPROACH_WORDS.operational_control;
  if (role === "franchisor") return `This site is run by a franchisee: its Scope 1 and 2 belong in ${WHERE.cat14}.`;
  if (role === "franchisee") return "This franchise site's energy belongs in your Scope 1 and 2.";
  return `With ${words}, this site's energy belongs in ${WHERE[where]}.`;
}
