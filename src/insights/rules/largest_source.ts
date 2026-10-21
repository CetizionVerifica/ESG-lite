/** largest_source (info): the top scoped category is at least 40 % of gross tCO₂e. */
import { share } from "../derive";
import { card, type Rule } from "./card";
import { displayPct, LARGEST_SOURCE_SHARE_PCT } from "./thresholds";

export const largest_source: Rule = (f) => {
  const top = f.categories[0];
  if (!top) return null;
  const pct = share(top.total, f.gross);
  if (pct === null || pct < LARGEST_SOURCE_SHARE_PCT) return null;
  return card("largest_source", "info", { category: top.category_name, share_pct: displayPct(pct) }, `/overview?period=${f.year}#categories`, "flow");
};
