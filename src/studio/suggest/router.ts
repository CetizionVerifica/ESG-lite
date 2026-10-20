/**
 * AT-1 · template suggestions for a new report (docs/design-studio/pro/
 * 01-pro-editing-and-ai-templates.md §2A). PRO-0 stub: 501 DS_NOT_BUILT.
 *
 *   POST /studio/templates/suggest   R  TemplateSuggestBody → TemplateSuggestResponse
 *
 * AT-1 replaces this file: rule shortlist (kind, frameworks, format) → data
 * readiness from approved data (counts only) → the AI re-orders and explains
 * (fenced brief, DS-9 guard, one retry) → rule order with aiUsed=false.
 */
import { Router } from "express";
import { notBuilt } from "../notBuilt";

const router = Router();

router.post("/templates/suggest", notBuilt("AT-1"));

export default router;
