/**
 * IN-3 · GET /insights/cards → PanelResponse<Cards> (01-contracts §3 and §6): at most six
 * rule cards for the scope (rules/engine.ts `ruleCards`). `?ai=1` is accepted (part of the cache
 * key); IN-9 rewords cards there (ai/reword.ts), keeping each card's params, link and panel.
 */
import { Router } from "express";
import type { Cards } from "../contracts/panels";
import { CardsQuerySchema, type CardsQuery } from "../contracts/schemas";
import { panelRoute, type PanelBuild } from "../panel";
import { ruleCards } from "../rules/engine";
import type { InsightsScope } from "../scope";
import { rewordCards } from "../ai/reword"; // IN-9
import { dataStamp } from "../sources/stamp"; // IN-9

export async function buildCards(scope: InsightsScope<CardsQuery>): Promise<PanelBuild<Cards>> {
  const rule = await ruleCards(scope);
  const cards = scope.query.ai ? await rewordCards(scope, rule, await dataStamp(scope)) : rule; // IN-9
  const links: Record<string, string> = {};
  for (const c of cards) if (c.link) links[c.id] = c.link;
  return { data: { cards }, links };
}

export const cardsPanel = panelRoute<Cards, CardsQuery>("cards", buildCards, { schema: CardsQuerySchema, extras: (q) => ({ ai: q.ai }) });

const router = Router();
router.get("/cards", cardsPanel);
export default router;
