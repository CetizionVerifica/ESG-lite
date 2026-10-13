// Supplier upload link (PCF phase 3, C06): no account, the token is the key.
// Rate-limited per IP so the token space can't be probed.
import { Router } from "express";
import multer from "multer";
import { authRateLimit } from "../middlewares/rateLimit.middleware";
import { withUploadErrors } from "../middlewares/upload.middleware";
import { MAX_FILE_BYTES, openPublicRequest, submitPublicRequest } from "../controllers/supplierRequest.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
const limit = authRateLimit("supplier-link", "all", { keyOf: (req) => String(req.params.token ?? ""), max: 30 });

const router = Router();
router.get("/:token", limit, openPublicRequest);
router.post("/:token/submit", limit, withUploadErrors(upload.single("file")), submitPublicRequest);

export default router;
