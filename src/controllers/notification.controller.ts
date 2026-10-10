import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import * as notificationService from "../services/notificationService";
import { addConnection, pushToUser } from "../services/sseManager";
import { verifyToken } from "../utils/jwt";

export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const unreadOnly = req.query.unread === "true";
    // Optional tab filter (P13): approvals | rejections | reminders. Anything else is a 400.
    const type = req.query.type;
    if (type !== undefined && type !== "" && !notificationService.isNotificationGroup(type)) {
      return res.status(400).json({ message: "type must be approvals, rejections or reminders" });
    }
    const group = notificationService.isNotificationGroup(type) ? type : null;

    const result = await notificationService.getNotifications(userId, page, limit, unreadOnly, group);
    return res.json(result);
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const count = await notificationService.getUnreadCount(userId);
    return res.json({ count });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const notificationId = parseInt(req.params.id as string);
    if (!notificationId) return res.status(400).json({ message: "Invalid notification ID" });

    const updated = await notificationService.markAsRead(notificationId, userId);
    if (!updated) return res.status(404).json({ message: "Notification not found" });

    // Push updated unread count via SSE
    const unreadCount = await notificationService.getUnreadCount(userId);
    pushToUser(userId, "unread", { count: unreadCount });

    return res.json({ message: "Marked as read" });
  } catch (error) {
    console.error("Mark as read error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const count = await notificationService.markAllAsRead(userId);

    // Push zero unread via SSE
    pushToUser(userId, "unread", { count: 0 });

    return res.json({ message: `${count} notifications marked as read` });
  } catch (error) {
    console.error("Mark all as read error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getPreferences = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const prefs = await notificationService.getPreferences(userId);
    return res.json(prefs);
  } catch (error) {
    console.error("Get preferences error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updatePreferences = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { notification_preferences, timezone } = req.body;
    await notificationService.updatePreferences(userId, { notification_preferences, timezone });
    return res.json({ message: "Preferences updated" });
  } catch (error) {
    console.error("Update preferences error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * SSE stream — keeps connection open and pushes real-time notifications.
 * Accepts token via query param (EventSource can't send headers).
 */
export const streamNotifications = async (req: Request, res: Response) => {
  // Auth via query param (EventSource limitation)
  const token = req.query.token as string;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  let userId: number;
  try {
    const decoded = verifyToken(token) as any;
    userId = decoded.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // Send initial unread count
  try {
    const count = await notificationService.getUnreadCount(userId);
    res.write(`event: unread\ndata: ${JSON.stringify({ count })}\n\n`);
  } catch {
    res.write(`event: unread\ndata: ${JSON.stringify({ count: 0 })}\n\n`);
  }

  // Register connection
  addConnection(userId, res);
};
