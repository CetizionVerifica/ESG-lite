import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
  streamNotifications,
} from "../controllers/notification.controller";

const router = Router();

// SSE stream — handles its own auth via query param (EventSource can't send headers)
router.get("/stream", streamNotifications);

// All other routes require header-based authentication
router.use(authenticate);

router.get("/", getNotifications);
router.get("/unread", getUnreadCount);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.get("/preferences", getPreferences);
router.put("/preferences", updatePreferences);

export default router;
