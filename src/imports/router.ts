/**
 * /imports router (IM0). Mounted in src/index.ts behind `authenticate`.
 * IM2 (plans) and IM3 (context) each add one line here. Every other path
 * under /imports falls through to Express's 404 for an authenticated caller
 * and 401 for anyone else.
 */
import { Router } from "express";
import plansRouter from "./plans/router";
import contextRouter from "./context/router";

const importsRouter = Router();

importsRouter.use(plansRouter); // IM2
importsRouter.use(contextRouter); // IM3

export default importsRouter;
