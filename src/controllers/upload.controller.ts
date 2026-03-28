import { Request, Response } from "express";
import * as XLSX from "xlsx";
import bcrypt from "bcrypt";
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { Company } from "../entities/Company";
import { Country } from "../entities/Country";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import { log } from "../utils/logger";

const DEFAULT_PASSWORD = "Welcome@123";

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

const monthToNumber: Record<string, number> = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

export const uploadEmissionsExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

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

    const emissionRepo = AppDataSource.getRepository(Emission);
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

    // Find or create category
    let category = await categoryRepo.findOne({ where: { category_name: categoryName } });

    if (!category) {
      category = categoryRepo.create({
        category_name: categoryName,
        scope: "Scope 1",
      });
      await categoryRepo.save(category);
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
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
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

    // Process emissions
    let emissionsCreated = 0;
    let emissionsSkipped = 0;

    for (const row of rows) {
      try {
        const year = parseInt(row.year);
        const monthNum = monthToNumber[row.month];

        if (isNaN(year) || monthNum === undefined) {
          emissionsSkipped++;
          continue;
        }

        const dateOfReporting = new Date(year, monthNum, 15);

        // Include emission_category for frontend display (using fuelType as the category name)
        const activityData = {
          emission_category: row.fuelType, // Maps to Emission Category column in frontend
          "Activity Data": row.activity,   // Maps to "Activity Data" column in ColumnConfig
          activity_value: row.activity,    // Alternative field name
          equipment: row.equipment,
          fuelState: row.fuelState,
          fuelType: row.fuelType,
          activity: row.activity,
          emissionFactor: row.emissionFactor,
          emissionFactorUnit: row.emissionFactorUnit,
          source: row.source || "Unknown",
          frequency: row.frequency || "monthly",
          currency: row.currency,
          spend: row.spend,
        };

        const totalEmission = row.calculatedEmission;
        // Always set status to PENDING for uploaded data (requires manual approval)
        const status = EmissionStatus.PENDING;

        // Check for existing emission
        const existingEmission = await emissionRepo.findOne({
          where: {
            site: { site_id: site.site_id },
            category: { category_id: category.category_id },
            date_of_reporting: dateOfReporting,
          },
        });

        if (existingEmission) {
          emissionsSkipped++;
          continue;
        }

        const emission = emissionRepo.create({
          activity_data: activityData,
          total_emission: totalEmission,
          unit: "tCO2e",
          activity_data_unit: row.unit,
          date_of_reporting: dateOfReporting,
          status,
          site,
          category,
          review_comment: row.notes || undefined,
        });

        await emissionRepo.save(emission);
        emissionsCreated++;
      } catch (error) {
        console.error("Error processing row:", error);
        emissionsSkipped++;
      }
    }

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
        defaultPassword: usersCreated > 0 ? DEFAULT_PASSWORD : undefined,
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
