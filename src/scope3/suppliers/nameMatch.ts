/**
 * S3-6 · Which supplier names look like the same firm (the name-match review
 * list, spec §Build.1 and the Suppliers page).
 *
 * The backfill only ever links an exact case-folded name. Anything looser is a
 * suggestion for a person to judge ("Link" / "Not the same"), never merged on
 * its own (D8). Pure, so the rule is tested without a database.
 */

/** Words that say what kind of company it is, not which one. */
const LEGAL_WORDS = new Set([
  "co", "company", "corp", "corporation", "inc", "incorporated", "ltd", "limited", "llc", "llp", "plc",
  "pvt", "private", "pte", "gmbh", "ag", "sa", "sas", "srl", "spa", "bv", "nv", "as", "ab", "oy", "kk",
  "the", "and", "&",
]);

/** A name folded for comparison: lower case, no punctuation, no legal-form words. */
export const looseKey = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(" ");

/** Levenshtein distance, stopping early once it passes `max`. */
export const editDistance = (a: string, b: string, max = 2): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
};

/**
 * Two names look like the same firm when their loose keys are equal, or
 * differ by a typo or two in a name long enough for that to mean something.
 */
export const looksSame = (a: string, b: string): boolean => {
  const ka = looseKey(a);
  const kb = looseKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 6 && editDistance(ka, kb, 2) <= 2;
};

/** A pair key that does not depend on order. */
export const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export interface NamedSupplier {
  supplier_id: number;
  name: string;
}

/**
 * Pairs of suppliers that look the same, minus the ones a person already
 * said are not. Grouped by the loose key's first character, so a company with
 * a long supplier list is not compared all against all.
 */
export const similarPairs = <T extends NamedSupplier>(suppliers: T[], dismissed: Set<string>): Array<[T, T]> => {
  const buckets = new Map<string, T[]>();
  for (const s of suppliers) {
    const k = looseKey(s.name);
    if (!k) continue;
    const b = buckets.get(k[0]) ?? [];
    b.push(s);
    buckets.set(k[0], b);
  }
  const out: Array<[T, T]> = [];
  for (const list of buckets.values()) {
    const sorted = [...list].sort((x, y) => x.supplier_id - y.supplier_id);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [a, b] = [sorted[i], sorted[j]];
        if (dismissed.has(pairKey(a.supplier_id, b.supplier_id))) continue;
        if (looksSame(a.name, b.name)) out.push([a, b]);
      }
    }
  }
  return out;
};
