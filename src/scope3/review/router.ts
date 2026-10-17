// S3-15 part 2 routes. The month lock is mounted at /periods (src/index.ts,
// behind authenticate, as 01-contracts.md §5 names it); the contributor
// endpoints are added to /user in src/routes/user.routes.ts.
import { Router } from "express";
import { getPeriodLock, postPeriodLock, postPeriodUnlock } from "./controller";

export const periodsRouter = Router();

periodsRouter.get("/lock", getPeriodLock);
periodsRouter.post("/lock", postPeriodLock);
periodsRouter.post("/unlock", postPeriodUnlock);

export default periodsRouter;
