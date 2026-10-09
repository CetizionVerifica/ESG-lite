import cron from "node-cron";
import { MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Notification } from "../entities/Notification";
import { UserRole } from "../types/type";
import { sendToQueue } from "../queues/emailProducer";
import { createNotification } from "../services/notificationService";
import { CONTRIBUTOR_RELATIONS, outstandingForMonth } from "../services/contributorObligations";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Check if it's currently the target hour in a given timezone */
const isLocalHour = (timezone: string | null, targetHour: number): boolean => {
  try {
    const tz = timezone || "UTC";
    const localHour = parseInt(
      new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false })
    );
    return localHour === targetHour;
  } catch {
    // Invalid timezone — fallback to UTC
    return new Date().getUTCHours() === targetHour;
  }
};


/**
 * Users (role USER) who still owe data for the given month, one entry per
 * site where they owe something. A user owes a site when at least one of their
 * categories there (the site's categories narrowed by their grants, without
 * FERA) has nothing filed for the month: no monthly entry dated in it and no
 * yearly batch covering it. Entries count whoever filed them, so a colleague's
 * entry for the same site and category clears it. This matches the "todo"
 * status of GET /user/my-month (services/contributorObligations).
 */
export const getUsersWithNoSubmissions = async (year: number, month: number) => {
  const userRepo = AppDataSource.getRepository(User);

  const users = await userRepo.find({
    where: { role: UserRole.USER },
    relations: CONTRIBUTOR_RELATIONS,
  });

  console.log(`Found ${users.length} user(s) with role USER`);

  const pendingUsers: { user_id: number; name: string; email: string; role: string; siteName: string; siteId: number; timezone: string | null; categories: string[] }[] = [];

  for (const user of users) {
    if (!user.email) continue;
    if (!user.site && !(user.sites && user.sites.length)) {
      console.log(`User ${user.email} has no site assigned, skipping`);
      continue;
    }

    const outstanding = await outstandingForMonth(user, year, month);

    console.log(`User ${user.email} (id: ${user.user_id}) — sites with categories still to file: ${outstanding.map((o) => `${o.site.name} (${o.categories.length})`).join(", ") || "none"}`);

    for (const { site, categories } of outstanding) {
      pendingUsers.push({
        user_id: user.user_id,
        name: `${user.name || ""} ${user.last_name || ""}`.trim() || "User",
        email: user.email,
        role: user.role || "User",
        siteName: site.name || "N/A",
        siteId: site.site_id,
        timezone: user.timezone || null,
        categories: categories.map((c) => c.category_name),
      });
    }
  }

  console.log(`Found ${pendingUsers.length} pending user-site entries`);
  return pendingUsers;
};

/**
 * Gets managers for a given site ID.
 * Managers have a many-to-many relation with sites.
 */
const getManagersForSite = async (siteId: number) => {
  const userRepo = AppDataSource.getRepository(User);

  const managers = await userRepo
    .createQueryBuilder("user")
    .innerJoin("user.sites", "site", "site.site_id = :siteId", { siteId })
    .where("user.role = :role", { role: UserRole.MANAGER })
    .getMany();

  return managers;
};

/**
 * Runs on the 10th of every month at 8:00 AM.
 * Sends reminder emails to users who haven't submitted data.
 */
export const sendDeadlineReminders = async () => {
  try {
    const now = new Date();
    // Remind for PREVIOUS month (e.g., on March 10th, remind for February)
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prevDate.getFullYear();
    const month = prevDate.getMonth() + 1;
    const monthName = MONTHS[month - 1];

    console.log(`Running deadline reminder check for ${monthName} ${year}...`);

    const pendingUsers = await getUsersWithNoSubmissions(year, month);

    if (pendingUsers.length === 0) {
      console.log("All users have submitted data. No reminders needed.");
      return;
    }

    // Deduplicate: send one email per unique user (not per user-site combo)
    const sentEmails = new Set<string>();
    let sentCount = 0;

    // Track sent reminders to prevent duplicates across hourly runs
    const notificationRepo = AppDataSource.getRepository(Notification);

    for (const user of pendingUsers) {
      if (sentEmails.has(user.email)) continue;

      // Check if it's 8 AM in the user's timezone (uses timezone from initial query — no N+1)
      if (!isLocalHour(user.timezone, 8)) continue;

      // Idempotency: skip if reminder already sent this month
      const alreadySent = await notificationRepo.count({
        where: {
          user: { user_id: user.user_id },
          type: "DEADLINE_REMINDER",
          created_at: MoreThanOrEqual(new Date(now.getFullYear(), now.getMonth(), 1)),
        },
      });
      if (alreadySent > 0) continue;

      sentEmails.add(user.email);

      console.log(`Queuing deadline reminder for: ${user.email} (${user.name}, site: ${user.siteName})`);

      await sendToQueue({
        type: "DEADLINE_REMINDER",
        email: user.email,
        name: user.name,
        retryCount: 0,
        month: monthName,
        year,
        siteName: user.siteName,
      });

      // In-app notification
      await createNotification(
        user.user_id,
        "DEADLINE_REMINDER",
        "Submission Reminder",
        `You haven't submitted data for ${monthName} ${year} (${user.siteName})`,
        `/data-entry`
      );

      sentCount++;
    }

    console.log(`Deadline reminders queued for ${sentCount} user(s).`);
  } catch (error) {
    console.error("Error sending deadline reminders:", error);
  }
};

/**
 * Runs on the 15th of every month at 8:00 AM.
 * Sends escalation emails to managers for users who still haven't submitted.
 */
export const sendEscalationEmails = async () => {
  try {
    const now = new Date();
    // Escalate for PREVIOUS month (e.g., on March 15th, escalate for February)
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prevDate.getFullYear();
    const month = prevDate.getMonth() + 1;
    const monthName = MONTHS[month - 1];

    console.log(`Running escalation check for ${monthName} ${year}...`);

    const pendingUsers = await getUsersWithNoSubmissions(year, month);
    const notificationRepo = AppDataSource.getRepository(Notification);

    if (pendingUsers.length === 0) {
      console.log("All users have submitted data. No escalation needed.");
      return;
    }

    // Group pending users by site
    const usersBySite: Record<number, typeof pendingUsers> = {};
    for (const user of pendingUsers) {
      if (!usersBySite[user.siteId]) {
        usersBySite[user.siteId] = [];
      }
      usersBySite[user.siteId].push(user);
    }

    // For each site, find managers and send escalation
    for (const [siteIdStr, siteUsers] of Object.entries(usersBySite)) {
      const siteId = parseInt(siteIdStr);
      const managers = await getManagersForSite(siteId);

      if (managers.length === 0) {
        console.log(`No manager found for site ${siteId}. Skipping escalation.`);
        continue;
      }

      for (const manager of managers) {
        if (!manager.email) continue;

        // Check if it's 8 AM in the manager's timezone
        if (!isLocalHour(manager.timezone || null, 8)) continue;

        // Idempotency: skip if escalation already sent this month
        const alreadySent = await notificationRepo.count({
          where: {
            user: { user_id: manager.user_id },
            type: "DEADLINE_ESCALATION",
            created_at: MoreThanOrEqual(new Date(now.getFullYear(), now.getMonth(), 1)),
          },
        });
        if (alreadySent > 0) continue;

        console.log(`Queuing escalation for manager: ${manager.email}`);

        await sendToQueue({
          type: "DEADLINE_ESCALATION",
          email: manager.email,
          name: `${manager.name || ""} ${manager.last_name || ""}`.trim() || "Manager",
          retryCount: 0,
          month: monthName,
          year,
          pendingUsers: siteUsers.map((u) => ({
            name: u.name,
            email: u.email,
            role: u.role,
            siteName: u.siteName,
          })),
        });

        // In-app notification for manager
        await createNotification(
          manager.user_id,
          "DEADLINE_ESCALATION",
          "Pending Submissions",
          `${siteUsers.length} user(s) haven't submitted data for ${monthName} ${year}`,
          `/data-manage`
        );
      }
    }

    console.log(`Escalation emails queued for ${pendingUsers.length} pending user(s).`);
  } catch (error) {
    console.error("Error sending escalation emails:", error);
  }
};

/**
 * Starts the deadline scheduler with two cron jobs:
 * - 10th of every month at 8:00 AM: reminder to users
 * - 15th of every month at 8:00 AM: escalation to managers
 */
export const startDeadlineScheduler = () => {
  // Run every hour on the 10th — sends only when it's 8 AM in each user's timezone
  cron.schedule("0 * 10 * *", () => {
    sendDeadlineReminders();
  });

  // Run every hour on the 15th — sends only when it's 8 AM in each manager's timezone
  cron.schedule("0 * 15 * *", () => {
    sendEscalationEmails();
  });

  console.log("Deadline scheduler started (10th reminder, 15th escalation — timezone-aware).");
};
