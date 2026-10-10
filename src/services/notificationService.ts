import { AppDataSource } from "../config/data-source";
import { Notification, NotificationMeta } from "../entities/Notification";
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
  link?: string | null,
  meta?: NotificationMeta | null
): Promise<Notification> => {
  const notification = notificationRepo.create({
    user: { user_id: userId } as any,
    type,
    title,
    message,
    link: link || null,
    meta: meta ?? null,
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
      meta: meta ?? null,
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
 * Type groups for the Notifications tabs (P13). "reminders" covers
 * REMINDER, DEADLINE and ESCALATION types alike.
 */
export const NOTIFICATION_GROUPS = {
  approvals: ["APPROVED"],
  rejections: ["REJECTED"],
  reminders: ["REMINDER", "DEADLINE", "ESCALATION"],
} as const;
export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS;

export const isNotificationGroup = (v: unknown): v is NotificationGroup =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_GROUPS, v);

/**
 * Get paginated notifications for a user (newest first).
 * Pass unreadOnly=true to get only unread notifications, and a group to
 * filter by type across every page.
 */
export const getNotifications = async (
  userId: number,
  page = 1,
  limit = 20,
  unreadOnly = false,
  group: NotificationGroup | null = null
): Promise<{ notifications: Notification[]; total: number }> => {
  const qb = notificationRepo
    .createQueryBuilder("n")
    .where("n.user_id = :userId", { userId })
    .orderBy("n.created_at", "DESC")
    .addOrderBy("n.id", "DESC")
    .skip((page - 1) * limit)
    .take(limit);
  if (unreadOnly) qb.andWhere("n.read = false");
  if (group) {
    const parts = NOTIFICATION_GROUPS[group].map((_, i) => `n.type LIKE :t${i}`);
    const params = Object.fromEntries(NOTIFICATION_GROUPS[group].map((t, i) => [`t${i}`, `%${t}%`]));
    qb.andWhere(`(${parts.join(" OR ")})`, params);
  }
  const [notifications, total] = await qb.getManyAndCount();
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
