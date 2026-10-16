// S3-14 routes, mounted through src/scope3/router.ts (behind authenticate).
import { Router } from "express";
import {
  approveRecalculationHandler,
  dismissRecalculationHandler,
  getBaseYearHandler,
  listRecalculationsHandler,
  putBaseYearHandler,
} from "./controller";

const router = Router();

router.get("/base-year", getBaseYearHandler);
router.put("/base-year", putBaseYearHandler);
router.get("/recalculations", listRecalculationsHandler);
router.post("/recalculations", approveRecalculationHandler);
router.post("/recalculations/:id/dismiss", dismissRecalculationHandler);

export default router;
