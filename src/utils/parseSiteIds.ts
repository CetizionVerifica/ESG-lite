/**
 * Parse a site filter from a request query into a de-duplicated list of numeric
 * site ids.
 *
 * Accepts, in order of preference:
 *   - `siteIds` as a comma-separated string  ("1,2,3")
 *   - `siteIds` as a repeated/array param     (["1", "2"])
 *   - legacy single `siteId`                  ("1")
 *
 * Returns an empty array when no valid site id is present, so callers can treat
 * "no filter" and "all sites" explicitly.
 */
export function parseSiteIds(query: {
  siteIds?: unknown;
  siteId?: unknown;
}): number[] {
  const raw = query.siteIds ?? query.siteId;
  if (raw == null) return [];

  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  const ids = parts
    .map((part) => parseInt(String(part).trim(), 10))
    .filter((num) => Number.isFinite(num));

  return Array.from(new Set(ids));
}
