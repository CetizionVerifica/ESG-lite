import { AppDataSource } from "../config/data-source";
import { Notification } from "../entities/Notification";
import { User } from "../entities/User";
import { pushToUser } from "./sseManager";

const notificationRepo = AppDataSource.getRepository(Notification);
const userRepo = AppDataSource.getRepository(User);

/**
 * Create an in-app notification for a user.
 * Call this alongside sendToQueue — never instead of it.
 * Automatically pushes to the user's SSE connection if active.
 */
export const createNotification = async (
  userId: number,
  type: string,
  title: string,
  message: string,
  link?: string | null
): Promise<Notification> => {
  const notification = notificationRepo.create({
    user: { user_id: userId } as any,
    type,
    title,
    message,
    link: link || null,
    read: false,
  });
  const saved = await notificationRepo.save(notification);

  // Push real-time to connected clients (non-blocking, fail-safe)
  try {
    pushToUser(userId, "notification", {
      id: saved.id,
      type,
      title,
      message,
      link: link || null,
      read: false,
      created_at: saved.created_at,
    });

    const unreadCount = await notificationRepo.count({
      where: { user: { user_id: userId }, read: false },
    });
    pushToUser(userId, "unread", { count: unreadCount });
  } catch {
    // SSE push is best-effort — notification is already saved to DB
  }

  return saved;
};

/**
 * Get paginated notifications for a user (newest first).
 * Pass unreadOnly=true to get only unread notifications.
 */
export const getNotifications = async (
  userId: number,
  page = 1,
  limit = 20,
  unreadOnly = false
): Promise<{ notifications: Notification[]; total: number }> => {
  const where: any = { user: { user_id: userId } };
  if (unreadOnly) where.read = false;
  const [notifications, total] = await notificationRepo.findAndCount({
    where,
    order: { created_at: "DESC" },
    skip: (page - 1) * limit,
    take: limit,
  });
  return { notifications, total };
};

/**
 * Get unread notification count for a user.
 */
export const getUnreadCount = async (userId: number): Promise<number> => {
  return await notificationRepo.count({
    where: { user: { user_id: userId }, read: false },
  });
};

/**
 * Mark a single notification as read (only if it belongs to the user).
 */
export const markAsRead = async (
  notificationId: number,
  userId: number
): Promise<boolean> => {
  const result = await notificationRepo.update(
    { id: notificationId, user: { user_id: userId } },
    { read: true }
  );
  return (result.affected || 0) > 0;
};

/**
 * Mark all notifications as read for a user.
 */
export const markAllAsRead = async (userId: number): Promise<number> => {
  const result = await notificationRepo.update(
    { user: { user_id: userId }, read: false },
    { read: true }
  );
  return result.affected || 0;
};

/**
 * Get user notification preferences.
 */
export const getPreferences = async (
  userId: number
): Promise<{ notification_preferences: Record<string, boolean>; timezone: string | null }> => {
  const user = await userRepo.findOne({ where: { user_id: userId } });
  return {
    notification_preferences: user?.notification_preferences || {},
    timezone: user?.timezone || null,
  };
};

/**
 * Update user notification preferences and/or timezone.
 */
export const updatePreferences = async (
  userId: number,
  data: { notification_preferences?: Record<string, boolean>; timezone?: string }
): Promise<void> => {
  const updates: any = {};
  if (data.notification_preferences !== undefined) {
    updates.notification_preferences = data.notification_preferences;
  }
  if (data.timezone !== undefined) {
    updates.timezone = data.timezone;
  }
  if (Object.keys(updates).length > 0) {
    await userRepo.update(userId, updates);
  }
};
