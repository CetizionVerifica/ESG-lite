/**
 * Strict ids for the route guards. A guard and the handler behind it must read
 * an id the same way: a lenient guard (Number drops "7x") with a lenient
 * handler (parseInt reads "7x" as 7, Postgres 16 reads "1_0" as 10) let a
 * request name a row the guard never checked. Only whole positive numbers and
 * digit-only strings pass, so every later reader agrees on the value.
 */

/** A JS integer or a digits-only string ("7", " 7 "). Anything else ("7x", "7.5", "1e3", "1_0", "0x7", "") is null. */
export const strictId = (value: unknown): number | null => {
  // ASCII blanks only: Postgres refuses other whitespace (NBSP, BOM) around an integer.
  const n = typeof value === "number" ? value : typeof value === "string" && /^[ \t]*\d+[ \t]*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Placeholders an unset id serialises to. No reader takes them for a row
 * (parseInt gives NaN, Postgres errors), so lists skip them as before.
 */
const PLACEHOLDER = new Set(["", "undefined", "null", "nan"]);
const isPlaceholder = (v: unknown) => v === undefined || v === null || (typeof v === "string" && PLACEHOLDER.has(v.trim().toLowerCase()));

/**
 * An id list from a body array, a comma list ("1,2") or a repeated query key.
 * Missing, empty and placeholder entries are skipped. Any other entry that
 * isn't a strict id makes the whole list null: the caller refuses the request
 * rather than checking only the ids it could read.
 */
export const strictIdList = (value: unknown): number[] | null => {
  const raw = (Array.isArray(value) ? value : [value]).flatMap((v) => (typeof v === "string" ? v.split(",") : [v]));
  const ids = raw.filter((v) => !isPlaceholder(v)).map(strictId);
  return ids.every((id): id is number => id !== null) ? ids : null;
};

/** Ids named by a path `:param` (exactly one) or a body/query list; null when any is malformed. */
export const strictIdsFrom = (value: unknown, single: boolean): number[] | null => {
  if (!single) return strictIdList(value);
  const id = strictId(value);
  return id === null ? null : [id];
};
