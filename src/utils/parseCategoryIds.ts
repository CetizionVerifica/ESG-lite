type CategoryQuery = { categoryIds?: unknown; categoryId?: unknown };

/** Largest id Postgres `integer` holds; bigger ids would fail the query. */
const MAX_ID = 2147483647;
/** More ids than this in one filter is a malformed request. */
export const MAX_CATEGORY_IDS = 100;
export const CATEGORY_IDS_ERROR = `categoryIds must be up to ${MAX_CATEGORY_IDS} positive integers`;

const isBlank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.every((p) => String(p).trim() === ""));

/** The raw parts: `categoryIds` ("1,2" or a repeated param), else the single `categoryId`. */
function parts(query: CategoryQuery): string[] {
  const raw = isBlank(query.categoryIds) ? query.categoryId : query.categoryIds;
  if (isBlank(raw)) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((p) => String(p).split(",")).map((p) => p.trim());
}

const valid = (part: string) => /^[1-9]\d*$/.test(part) && Number(part) <= MAX_ID;

/**
 * Parse a category filter from a request query into a de-duplicated list of
 * positive category ids. Empty means no category filter. Check
 * `hasInvalidCategoryIds` first: a bad id must not widen the filter to all.
 */
export function parseCategoryIds(query: CategoryQuery): number[] {
  return Array.from(new Set(parts(query).filter(valid).map(Number)));
}

/** True when the query names a category that isn't a usable id, or too many. */
export function hasInvalidCategoryIds(query: CategoryQuery): boolean {
  const p = parts(query);
  return p.length > MAX_CATEGORY_IDS || p.some((part) => !valid(part));
}
