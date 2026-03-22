import cron from "node-cron";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Emission } from "../entities/Emission";
import { UserRole } from "../types/type";
import { sendToQueue } from "../queues/emailProducer";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];


/**
 * Gets users who have NOT submitted any emission data for the given month/year.
 * Considers users with role USER who have an assigned site (single or multiple).
 */
const getUsersWithNoSubmissions = async (year: number, month: number) => {
  const userRepo = AppDataSource.getRepository(User);
  const emissionRepo = AppDataSource.getRepository(Emission);

  // Get all active users with role USER — load both single site and multiple sites
  const users = await userRepo.find({
    where: { role: UserRole.USER },
    relations: ["site", "sites"],
  });

  console.log(`Found ${users.length} user(s) with role USER`);

  const pendingUsers: { user_id: number; name: string; email: string; role: string; siteName: string; siteId: number }[] = [];

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Last day of month

  for (const user of users) {
    if (!user.email) continue;

    // Determine which sites the user belongs to (single site OR multiple sites)
    const userSites: { site_id: number; name: string }[] = [];

    if (user.site) {
      userSites.push({
        site_id: (user.site as any).site_id,
        name: (user.site as any).name || "N/A",
      });
    }

    if (user.sites && user.sites.length > 0) {
      for (const s of user.sites) {
        const sid = (s as any).site_id;
        if (!userSites.some((us) => us.site_id === sid)) {
          userSites.push({ site_id: sid, name: (s as any).name || "N/A" });
        }
      }
    }

    if (userSites.length === 0) {
      console.log(`User ${user.email} has no site assigned, skipping`);
      continue;
    }

    // Check if this user has submitted any emission for the current month
    const count = await emissionRepo
      .createQueryBuilder("emission")
      .where("emission.created_by = :userId", { userId: user.user_id })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate: startDate.toISOString().split("T")[0] })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate: endDate.toISOString().split("T")[0] })
      .getCount();

    console.log(`User ${user.email} (id: ${user.user_id}) — emissions this month: ${count}, sites: ${userSites.map(s => s.name).join(", ")}`);

    if (count === 0) {
      // Add an entry for each site the user belongs to
      for (const site of userSites) {
        pendingUsers.push({
          user_id: user.user_id,
          name: `${user.name || ""} ${user.last_name || ""}`.trim() || "User",
          email: user.email,
          role: user.role || "User",
          siteName: site.name,
          siteId: site.site_id,
        });
      }
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
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
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

    for (const user of pendingUsers) {
      if (sentEmails.has(user.email)) continue;
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
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthName = MONTHS[month - 1];

    console.log(`Running escalation check for ${monthName} ${year}...`);

    const pendingUsers = await getUsersWithNoSubmissions(year, month);

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
  // Run at 8:00 AM on the 10th of every month
  cron.schedule("0 8 10 * *", () => {
    sendDeadlineReminders();
  });

  // Run at 8:00 AM on the 15th of every month
  cron.schedule("0 8 15 * *", () => {
    sendEscalationEmails();
  });

  console.log("Deadline scheduler started (10th reminder, 15th escalation).");
};
