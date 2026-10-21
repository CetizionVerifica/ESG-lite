/** site_concentration (info): with two or more sites, one site is at least 50 % of a scope (the largest such share). */
import { share } from "../derive";
import { card, type Rule } from "./card";
import { displayPct, SITE_CONCENTRATION_SHARE_PCT } from "./thresholds";

const SCOPES = [1, 2, 3] as const;

export const site_concentration: Rule = (f) => {
  if (f.siteScopes.length < 2) return null;
  let best: { site: string; scope: number; pct: number } | null = null;
  for (const n of SCOPES) {
    const key = `scope_${n}` as const;
    const total = f.siteScopes.reduce((a, s) => a + s[key], 0);
    for (const s of f.siteScopes) {
      const pct = share(s[key], total);
      if (pct !== null && pct >= SITE_CONCENTRATION_SHARE_PCT && (!best || pct > best.pct)) best = { site: s.name, scope: n, pct };
    }
  }
  if (!best) return null;
  return card("site_concentration", "info", { site: best.site, scope: best.scope, share_pct: displayPct(best.pct) }, `/overview?period=${f.year}`, "flow");
};
