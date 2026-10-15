import { Request, Response } from "express";
import * as XLSX from "xlsx";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { AppDataSource } from "../config/data-source";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { Company } from "../entities/Company";
import { Country } from "../entities/Country";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import { log } from "../utils/logger";
import { issueInvite, unusablePasswordHash } from "../services/invite";
import { EntityManager } from "typeorm";
import {
  type FiledEntry,
  type HistoricalPlan,
  type HistoricalRow,
  filedMonths,
  planHistoricalRows,
} from "../services/historicalImport";
import { engineResults, insertHistoricalRows } from "../services/historicalEngine";
import { SCOPE_INVALID_MESSAGE } from "../utils/categoryScope";

// Users created by this import get a random password that nobody sees; they
// set their own through "Forgot password". A shared fixed password would let
// anyone who knows it sign in as every imported user.
const randomPassword = () => crypto.randomBytes(24).toString("base64url");

interface ExcelRow {
  _id?: string;
  frequency?: string;
  year: string;
  month: string;
  companyId?: string;
  siteId?: string;
  userId?: string;
  equipment: string;
  fuelState: string;
  fuelType: string;
  unit: string;
  activity: number;
  spend?: number;
  currency?: string;
  emissionFactor: number;
  emissionFactorUnit: string;
  calculatedEmission: number;
  managerId?: string;
  notes?: string;
  fileUrl?: string;
  name?: string;
  approved?: string;
  source?: string;
  createdAt?: number;
  updatedAt?: number;
  __v?: number;
  approvedBy?: string;
  email?: string;
}

const PREVIEW_ROWS = 100;
const positiveInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The plan for this sheet, read through `m` (inside the import's transaction,
 * or the pool for a preview). Totals come from the engine (S3-4), with the
 * prepared entries the import then writes.
 */
const planFor = async (m: EntityManager, rows: HistoricalRow[], siteId: number, categoryId: number) => {
  const existing: FiledEntry[] = await m.query(
    `SELECT date_of_reporting, reporting_period, year_type FROM emission WHERE site_id = $1 AND category_id = $2`,
    [siteId, categoryId],
  );
  const emails = [...new Set(rows.map((r) => String(r.email ?? "").trim().toLowerCase()).filter(Boolean))];
  const existingEmails = new Set<string>(
    emails.length
      ? (await m.query(`SELECT lower(email) AS email FROM "user" WHERE lower(email) = ANY($1)`, [emails])).map(
          (u: { email: string }) => u.email,
        )
      : [],
  );
  const { results, entries } = await engineResults(m, rows, siteId, categoryId);
  return { plan: planHistoricalRows(rows, filedMonths(existing), existingEmails, results), entries };
};

/** The audit line for a historical import's rows. */
const auditFor = async (m: EntityManager, req: Request, source: string) => {
  const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId) || null;
  if (!userId) return null;
  const user = await m.getRepository(User).findOne({ where: { user_id: userId } });
  const who = user ? [user.name, user.last_name].filter(Boolean).join(" ") : `user ${userId}`;
  return { changed_by: userId, reason: `Imported via Historical import by ${who} (${source})` };
};

/**
 * The redesigned historical import (P27): the request names an existing
 * client, site and category by id, and nothing is created from free text.
 * It previews by default and saves only with `commit=true`. New people get
 * an invite email to choose a password; no password is ever returned.
 */
const uploadHistorical = async (req: Request, res: Response) => {
  const companyId = positiveInt(req.body.companyId);
  const siteId = positiveInt(req.body.siteId);
  const categoryId = positiveInt(req.body.categoryId);
  const commit = req.body.commit;
  if (commit !== undefined && commit !== "true" && commit !== "false") {
    return res.status(400).json({ message: "commit must be true or false." });
  }
  if (!companyId || !siteId || !categoryId) {
    return res.status(400).json({ message: "Choose a client, a site and a category." });
  }

  const site = await AppDataSource.getRepository(Site).findOne({
    where: { site_id: siteId },
    relations: ["company", "categories"],
  });
  if (!site || site.company?.company_id !== companyId) {
    return res.status(400).json({ message: "That site doesn't belong to the chosen client." });
  }
  const category = site.categories?.find((c) => c.category_id === categoryId);
  if (!category) {
    return res.status(400).json({ message: "That category isn't set up for this site. Add it to the site first." });
  }

  let rows: HistoricalRow[];
  try {
    const workbook = XLSX.read(req.file!.buffer, { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  } catch {
    return res.status(400).json({ message: "The file couldn't be read as a spreadsheet." });
  }
  if (rows.length === 0) return res.status(400).json({ message: "The sheet has no rows under the header." });

  const summaryOf = (plan: HistoricalPlan) => ({
    totalRows: rows.length,
    toImport: plan.toImport,
    toSkip: plan.toSkip,
    newPeople: plan.people.filter((p) => !p.exists).length,
    existingPeople: plan.people.filter((p) => p.exists).length,
    site: { id: site.site_id, name: site.name },
    category: { id: category.category_id, name: category.category_name },
  });

  if (commit !== "true") {
    const { plan } = await planFor(AppDataSource.manager, rows, siteId, categoryId);
    return res.json({
      dryRun: true,
      summary: summaryOf(plan),
      rows: plan.rows.slice(0, PREVIEW_ROWS),
      people: plan.people,
      invalidEmails: plan.invalidEmails,
    });
  }

  // Entries and accounts are saved together: a failure saves nothing. The
  // lock makes a second import for the same site and category wait, and the
  // plan is made again inside the transaction, so a double submit skips the
  // months the first one filed instead of saving them twice.
  const { plan, created } = await AppDataSource.transaction(async (m) => {
    await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [siteId, categoryId]);
    const { plan, entries } = await planFor(m, rows, siteId, categoryId);
    const newUsers: User[] = [];
    for (const person of plan.people.filter((p) => !p.exists)) {
      newUsers.push(
        await m.getRepository(User).save(
          m.getRepository(User).create({
            email: person.email,
            name: person.name,
            password: await unusablePasswordHash(),
            role: UserRole.USER,
            site,
          }),
        ),
      );
    }
    // Every total, unit check and FERA twin comes from the engine (S3-4), which
    // also stores the review checks of the rows it inserts (S3-15).
    await insertHistoricalRows(m, plan, entries, rows, await auditFor(m, req, req.file!.originalname || "historical sheet"));
    return { plan, created: newUsers };
  });

  let invitesSent = 0;
  let inviteWarning: string | null = null;
  for (const user of created) {
    const result = await issueInvite(user, site.company?.name);
    if (result.sent) invitesSent++;
    else inviteWarning = result.reason;
  }

  log.info("Upload", "Historical import complete", {
    totalRows: rows.length,
    imported: plan.toImport,
    skipped: plan.toSkip,
    usersCreated: created.length,
    invitesSent,
    siteId,
    categoryId,
  });
  return res.json({
    dryRun: false,
    summary: {
      ...summaryOf(plan),
      emissionsCreated: plan.toImport,
      emissionsSkipped: plan.toSkip,
      usersCreated: created.length,
      createdUsers: created.map((u) => u.email),
      invitesSent,
      inviteWarning,
    },
    skippedRows: plan.rows.filter((r) => r.status === "skip").map(({ row, period, reason }) => ({ row, period, reason })),
  });
};

export const uploadEmissionsExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (req.body.siteId !== undefined) return await uploadHistorical(req, res);

    const { siteName, categoryName } = req.body;

    if (!siteName || !categoryName) {
      return res.status(400).json({
        message: "siteName and categoryName are required",
      });
    }

    // Read Excel from buffer
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ message: "No data rows found in Excel file" });
    }

    const siteRepo = AppDataSource.getRepository(Site);
    const categoryRepo = AppDataSource.getRepository(Category);
    const companyRepo = AppDataSource.getRepository(Company);
    const countryRepo = AppDataSource.getRepository(Country);
    const userRepo = AppDataSource.getRepository(User);

    // Find or create site
    let site = await siteRepo.findOne({
      where: { name: siteName },
      relations: ["categories"],
    });

    if (!site) {
      // Find or create a default company and country
      let company = await companyRepo.findOne({ where: { name: "Default Company" } });
      if (!company) {
        company = companyRepo.create({ name: "Default Company", address: "N/A", contact_person: "Admin" });
        await companyRepo.save(company);
      }

      let country = await countryRepo.findOne({ where: { name: "Default Country" } });
      if (!country) {
        country = countryRepo.create({ name: "Default Country", code: "XX" });
        await countryRepo.save(country);
      }

      site = siteRepo.create({
        name: siteName,
        address: "N/A",
        contact_person: "N/A",
        company,
        country,
        categories: [],
      });
      await siteRepo.save(site);
    }

    // An unknown category is refused, never created with a guessed scope (S3-4):
    // add it on the Categories page with its scope first.
    const category = await categoryRepo.findOne({ where: { category_name: categoryName } });
    if (!category) {
      return res.status(400).json({
        message: `No category named "${categoryName}". Add it with its scope on the Categories page first. ${SCOPE_INVALID_MESSAGE}`,
        code: "SCOPE_INVALID",
      });
    }

    // Link category to site if not already linked
    if (!site.categories) {
      site.categories = [];
    }
    const categoryLinked = site.categories.some((c) => c.category_id === category!.category_id);
    if (!categoryLinked) {
      site.categories.push(category);
      await siteRepo.save(site);
    }

    // Extract and create users
    const uniqueUsers = new Map<string, { email: string; name: string }>();
    for (const row of rows) {
      if (row.email && row.email.trim()) {
        const email = row.email.trim().toLowerCase();
        if (!uniqueUsers.has(email)) {
          uniqueUsers.set(email, {
            email,
            name: row.name?.trim() || email.split("@")[0],
          });
        }
      }
    }

    let usersCreated = 0;
    const createdUsers: string[] = [];

    for (const [email, userData] of uniqueUsers) {
      const existingUser = await userRepo.findOne({ where: { email } });
      if (!existingUser) {
        const hashedPassword = await bcrypt.hash(randomPassword(), 10);
        const user = userRepo.create({
          email: userData.email,
          name: userData.name,
          password: hashedPassword,
          role: UserRole.USER,
          site: site,
        });
        await userRepo.save(user);
        createdUsers.push(userData.email);
        usersCreated++;
      }
    }

    // Process emissions through the engine (S3-4), with the same month rules
    // as the historical import: months already filed and repeated months are
    // skipped, and so is any row the engine refuses (no factor, units that
    // don't convert). The sheet's own factor and total are never used.
    const historical = rows as unknown as HistoricalRow[];
    const { plan, emissionsCreated } = await AppDataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [site!.site_id, category.category_id]);
      const { plan, entries } = await planFor(m, historical, site!.site_id, category.category_id);
      const created = await insertHistoricalRows(m, plan, entries, historical, await auditFor(m, req, req.file!.originalname || "uploaded sheet"));
      return { plan, emissionsCreated: created };
    });
    const emissionsSkipped = plan.toSkip;


    log.info("Upload", "Excel upload complete", {
      totalRows: rows.length,
      emissionsCreated,
      emissionsSkipped,
      usersCreated,
      site: site.name,
      category: category.category_name,
    });

    return res.status(200).json({
      message: "Upload successful",
      summary: {
        totalRows: rows.length,
        emissionsCreated,
        emissionsSkipped,
        usersCreated,
        createdUsers,
        site: { id: site.site_id, name: site.name },
        category: { id: category.category_id, name: category.category_name },
      },
    });
  } catch (error) {
    log.error("Upload", "Excel upload failed", { error: (error as Error).message });
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get available sites for dropdown
export const getSitesForUpload = async (_req: Request, res: Response) => {
  try {
    const siteRepo = AppDataSource.getRepository(Site);
    const sites = await siteRepo.find({ order: { name: "ASC" } });
    return res.status(200).json(sites);
  } catch (error) {
    console.error("Error fetching sites:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get available categories for dropdown
export const getCategoriesForUpload = async (_req: Request, res: Response) => {
  try {
    const categoryRepo = AppDataSource.getRepository(Category);
    const categories = await categoryRepo.find({ order: { category_name: "ASC" } });
    return res.status(200).json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
