/** IN-8 routes: GET /stripes and GET /snapshot.pdf (one router.use line in src/insights/router.ts). */
import { Router } from "express";
import { snapshotPdf } from "./snapshot";
import { stripesPanel } from "./stripes";

const router = Router();
router.get("/stripes", stripesPanel);
router.get("/snapshot.pdf", snapshotPdf);
export default router;
