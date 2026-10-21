/** IN-4's routes in one router, so src/insights/router.ts gets one line: /pathway, /completeness, /events. */
import { Router } from "express";
import events from "../events/crud";
import completeness from "./completeness";
import pathway from "./pathway";

const router = Router();
router.use(pathway);
router.use(completeness);
router.use(events);
export default router;
