// S3-5 routes. `scope3Router` is mounted through src/scope3/router.ts (/scope3);
// `fxRouter` is mounted at /fx-rates in src/index.ts (01-contracts.md §5). Both behind authenticate.
import { Router } from "express";
import { getCurrencies, getDeflators, getFxRate, getLibrary, postDeflators, postLibraryCopy } from "./controller";

export const scope3SpendRouter = Router();
scope3SpendRouter.get("/deflators", getDeflators);
scope3SpendRouter.post("/deflators", postDeflators);
scope3SpendRouter.get("/spend/library", getLibrary);
scope3SpendRouter.post("/spend/library/copy", postLibraryCopy);

export const fxRouter = Router();
fxRouter.get("/currencies", getCurrencies);
fxRouter.get("/", getFxRate);
