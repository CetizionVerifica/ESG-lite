/** IN-2 routes: the three story panels (A ring, B decoupling, H target wall). */
import { Router } from "express";
import { decouplingPanel } from "./decoupling";
import { esgRingPanel } from "./esgRing";
import { targetWallPanel } from "./targetWall";

const router = Router();
router.get("/esg-ring", esgRingPanel);
router.get("/decoupling", decouplingPanel);
router.get("/target-wall", targetWallPanel);
export default router;
