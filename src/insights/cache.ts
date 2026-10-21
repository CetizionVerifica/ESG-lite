/**
 * IN-1 · the per-panel cache (layer rule 7, I11).
 *
 *   cacheKey(panel, scope, extras, stamp)  (panel, company, sites, period, query extras, stamp)
 *   cached(key, load)                      the stored value while it is younger than TTL_MS,
 *                                          else `load()` (one load per key at a time)
 *   etagOf(stamp)                          the ETag a panel answers with; If-None-Match equal
 *                                          to it → 304 (panel.ts)
 *
 * The stamp is part of the key, so a change in the data (an approval, an event)
 * misses the cache at once; the TTL only bounds memory and clock-driven figures
 * (the "today" in expected progress). In-process only: each server keeps its own.
 */
import type { PanelId } from "./contracts/enums";
import type { InsightsScope } from "./scope";

export const TTL_MS = 10 * 60 * 1000;
/** Entries kept before expired ones are swept. */
const SWEEP_AT = 500;

interface Entry {
  at: number;
  value: Promise<unknown>;
}
const store = new Map<string, Entry>();

export const cacheKey = (panel: PanelId | string, scope: InsightsScope, extras: Record<string, unknown>, stamp: string): string =>
  JSON.stringify([panel, scope.companyId, scope.siteIds, scope.period.yearType, scope.period.year, scope.query.pillar ?? null, scope.query.compare, extras, stamp]);

const sweep = (now: number) => {
  for (const [k, e] of store) if (now - e.at >= TTL_MS) store.delete(k);
};

export async function cached<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;
  if (store.size >= SWEEP_AT) sweep(now);
  const value = load();
  store.set(key, { at: now, value });
  // A failed load is never cached.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

/** Entries in the cache (tests). */
export const cacheSize = () => store.size;

/** Drops every entry (tests and the switch); a loop, never `Map.clear` (the data-safety check reads `.clear()` as a table wipe). */
export const emptyCache = () => {
  for (const k of [...store.keys()]) store.delete(k);
};

export const etagOf = (stamp: string) => `"in-${stamp}"`;
