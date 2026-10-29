/**
 * AS-1 · /assistant routes (mounted behind `authenticate` in src/index.ts).
 *
 *   GET  /assistant/status   {enabled, configured}: any role; the FE shows the
 *                            "Ask ESGLite" button only when both are true
 *   POST /assistant/chat     one help question (src/assistant/chat.ts)
 */
import { Router } from "express";
import { answerQuestion, assistantStatus } from "./chat";
import { handle } from "./http";

const router = Router();

router.get(
  "/status",
  handle("status", async (req, res) => res.json(await assistantStatus(req))),
);
router.post(
  "/chat",
  handle("chat", async (req, res) => res.json(await answerQuestion(req))),
);

export default router;
