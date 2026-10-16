/**
 * Checks the `ghg_category` sent with a category create or update (S3-1):
 *   - it must be 1–15, and only on a Scope 3 category (GHG_CATEGORY_INVALID);
 *   - once the company map is confirmed, a new Scope 3 category must carry
 *     one (GHG_CATEGORY_REQUIRED);
 *   - a category moved out of Scope 3 loses its number.
 * Returns the value to save: a number, null (clear) or undefined (unchanged).
 */
import { Scope3Error } from "../contracts/errors";
import { isScope3, isMapConfirmed, Queryable } from "./service";
import { AppDataSource } from "../../config/data-source";

export interface CategoryGhgInput {
  /** The scope after this request (the new one, or the stored one when not sent). */
  scope: unknown;
  /** As sent; undefined when the body has no ghg_category. */
  ghg_category: unknown;
  isNew: boolean;
  /** The stored number, for updates. */
  current?: number | null;
}

export async function resolveCategoryGhgInput(
  input: CategoryGhgInput,
  q: Queryable = AppDataSource,
): Promise<number | null | undefined> {
  const scope3 = isScope3(input.scope);
  const sent = input.ghg_category;

  if (sent === undefined || sent === null || sent === "") {
    if (input.isNew && scope3 && (await isMapConfirmed(q))) throw new Scope3Error("GHG_CATEGORY_REQUIRED");
    if (sent === undefined) {
      // Moving a category out of Scope 3 drops its number.
      return !scope3 && input.current != null ? null : undefined;
    }
    return null;
  }

  const n = typeof sent === "string" ? Number(sent.trim()) : sent;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 15) {
    throw new Scope3Error("GHG_CATEGORY_INVALID", { field: "ghg_category" });
  }
  if (!scope3) throw new Scope3Error("GHG_CATEGORY_INVALID", { field: "scope" });
  return n;
}
