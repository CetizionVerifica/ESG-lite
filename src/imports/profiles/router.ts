import { Router } from "express";
import { deleteProfile, listProfiles } from "./controller";

// Mounted by src/imports/router.ts under /imports (already authenticated).
// Client and site scoping happen in the service, through buildWriterContext.
const router = Router();

router.get("/mapping-profiles", listProfiles);
router.delete("/mapping-profiles/:id", deleteProfile);

export default router;
