import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    createEntry,
    getEntries,
    updateEntry,
    deleteEntry,
    reviewEntry,
    bulkUpdateStatus,
    parseBulkExcel,
    storeBulkExcel,
    downloadDemoExcel
} from "../controllers/allDataEntry.controller";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post("/", authenticate, createEntry);
router.post("/bulk-status", authenticate, bulkUpdateStatus);
router.post("/bulk-upload/parse", authenticate, upload.single("file"), parseBulkExcel);
router.post("/bulk-upload/store", authenticate, storeBulkExcel);
router.get("/bulk-upload/demo", authenticate, downloadDemoExcel);
router.get("/", authenticate, getEntries);
router.put("/:id", authenticate, updateEntry);
router.delete("/:id", authenticate, deleteEntry);
router.patch("/:id/review", authenticate, reviewEntry);

export default router;
