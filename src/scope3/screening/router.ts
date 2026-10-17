// S3-12 routes, mounted through src/scope3/router.ts (behind authenticate).
import { Router } from "express";
import { getScreeningHandler, postExtrapolateHandler, postSectorSuggestionsHandler, putInputsHandler } from "./controller";

const router = Router();

router.get("/screening", getScreeningHandler);
router.put("/screening/inputs", putInputsHandler);
router.post("/screening/sector-suggestions", postSectorSuggestionsHandler);
router.post("/extrapolate", postExtrapolateHandler);

export default router;
