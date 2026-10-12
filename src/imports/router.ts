/**
 * /imports router (IM0). Mounted in src/index.ts behind `authenticate`.
 * Empty on purpose: IM2 (plans) and IM3 (context) each add one line here.
 * With no routes, every path under /imports falls through to Express's 404
 * for an authenticated caller and 401 for anyone else.
 */
import { Router } from "express";
import contextRouter from "./context/router";

const importsRouter = Router();

// IM2: importsRouter.use(plansRouter);
importsRouter.use(contextRouter); // IM3

export default importsRouter;
