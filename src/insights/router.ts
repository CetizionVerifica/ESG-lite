/**
 * Insights API (IN-0): mounted once at `/insights` in src/index.ts, behind
 * `authenticate`. Each module appends ONE `router.use` line here, in module
 * order, with a `// IN-n` comment, and keeps its own routes in its folder
 * (docs/insights/03-lane-map.md "Shared files").
 *
 * Order matters: GET /insights/status comes before `requireInsights`; every
 * other route sits behind it (403 IN_OFF, then IN_FORBIDDEN for Users).
 * KPI panels answer `availability: 'kpi_off'` themselves (insightsScope().kpiOn).
 */
import { Router } from "express";
import { insightsSites, insightsStatus, requireInsights } from "./guard";
import summaryRoutes from "./panels/summary";
import in2Routes from "./panels/in2";
import in4Routes from "./panels/in4";
import flowRoutes from "./panels/flow";
import cardsRoutes from "./panels/cards";
import bridgeRoutes from "./panels/bridge";
import materialityRoutes from "./panels/materiality";

const router = Router();

router.get("/status", insightsStatus); // IN-0: {enabled, kpi_tracking}, answers when off
router.use(requireInsights); // IN-0: 403 IN_OFF / IN_FORBIDDEN below this line
router.get("/sites", insightsSites); // IN-0: the caller's sites for the header chips
router.use(summaryRoutes); // IN-1: GET /summary
router.use(in2Routes); // IN-2: GET /esg-ring, /decoupling, /target-wall
router.use(in4Routes); // IN-4: /pathway, /completeness, /events
router.use(flowRoutes); // IN-6: GET /flow
router.use(cardsRoutes); // IN-3: GET /cards
router.use(bridgeRoutes); // IN-5: GET /bridge?compare=prior|base
router.use(materialityRoutes); // IN-7: GET /materiality

export default router;
