/**
 * Parse a category filter from a request query into a de-duplicated list of
 * positive category ids: `categoryIds` ("1,2" or a repeated param), else the
 * single `categoryId`. Empty means no category filter.
 */
export function parseCategoryIds(query: { categoryIds?: unknown; categoryId?: unknown }): number[] {
  const raw = query.categoryIds ?? query.categoryId;
  if (raw == null || raw === "") return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  const ids = parts
    .map((part) => String(part).trim())
    .filter((part) => /^[1-9]\d*$/.test(part))
    .map(Number);
  return Array.from(new Set(ids));
}

/** True when the query names a category that isn't a positive integer. */
export function hasInvalidCategoryIds(query: { categoryIds?: unknown; categoryId?: unknown }): boolean {
  const raw = query.categoryIds ?? query.categoryId;
  if (raw == null || raw === "") return false;
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  return parts.some((part) => !/^[1-9]\d*$/.test(String(part).trim()));
}
