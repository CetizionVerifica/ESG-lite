import "reflect-metadata";
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

// Default password for seeded users (they should change this on first login)
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

// Month name to number mapping
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

async function seedEmissionsFromExcel() {
  // Get command line arguments
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log("Usage: npx ts-node src/seeds/seedEmissionsFromExcel.ts <excel-file-path> <site-name> <category-name>");
    console.log("Example: npx ts-node src/seeds/seedEmissionsFromExcel.ts ./data/bahrain-emissions.xlsx \"Bahrain Site\" \"Stationary Combustion\"");
    process.exit(1);
  }

  const [filePath, siteName, categoryName] = args;

  console.log(`\n📂 Reading Excel file: ${filePath}`);
  console.log(`🏭 Site: ${siteName}`);
  console.log(`📊 Category: ${categoryName}\n`);

  // Read Excel file
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath);
  } catch (error) {
    console.error(`❌ Failed to read Excel file: ${filePath}`);
    console.error(error);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet);

  console.log(`📋 Found ${rows.length} rows in sheet "${sheetName}"\n`);

  if (rows.length === 0) {
    console.log("⚠️ No data rows found in Excel file");
    process.exit(0);
  }

  // Initialize database connection
  await AppDataSource.initialize();
  console.log("✅ Database connected\n");

  const emissionRepo = AppDataSource.getRepository(Emission);
  const siteRepo = AppDataSource.getRepository(Site);
  const categoryRepo = AppDataSource.getRepository(Category);
  const companyRepo = AppDataSource.getRepository(Company);
  const countryRepo = AppDataSource.getRepository(Country);
  const userRepo = AppDataSource.getRepository(User);

  // Find or create site
  let site = await siteRepo.findOne({
    where: { name: siteName },
    relations: ["categories"]
  });

  if (!site) {
    console.log(`🏗️ Creating new site: ${siteName}`);

    // Find or create a default company and country for the site
    let company = await companyRepo.findOne({ where: { name: "Default Company" } });
    if (!company) {
      company = companyRepo.create({ name: "Default Company", address: "N/A", contact_person: "Admin" });
      await companyRepo.save(company);
    }

    let country = await countryRepo.findOne({ where: { name: "Bahrain" } });
    if (!country) {
      country = countryRepo.create({ name: "Bahrain", code: "BH" });
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
    console.log(`🏗️ Creating new category: ${categoryName}`);
    category = categoryRepo.create({
      category_name: categoryName,
      scope: "Scope 1", // Stationary Combustion is typically Scope 1
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
    console.log(`🔗 Linked category "${categoryName}" to site "${siteName}"`);
  }

  // Extract unique users from Excel data and create them
  console.log("\n👥 Processing users from Excel data...");
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
  let usersSkipped = 0;
  const createdUsers: Array<{ email: string; name: string }> = [];

  for (const [email, userData] of uniqueUsers) {
    try {
      // Check if user already exists
      const existingUser = await userRepo.findOne({ where: { email } });

      if (existingUser) {
        console.log(`⚠️ User ${email} already exists, skipping...`);
        usersSkipped++;
        continue;
      }

      // Hash the default password
      const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

      // Create user with role "User" and assign to this site
      const user = userRepo.create({
        email: userData.email,
        name: userData.name,
        password: hashedPassword,
        role: UserRole.USER,
        site: site,
      });

      await userRepo.save(user);
      console.log(`✅ Created user: ${userData.name} (${userData.email})`);
      createdUsers.push({ email: userData.email, name: userData.name });
      usersCreated++;
    } catch (error) {
      console.error(`❌ Error creating user ${email}:`, error);
      usersSkipped++;
    }
  }

  console.log(`\n👥 Users Summary:`);
  console.log(`   ✅ Created: ${usersCreated} users`);
  console.log(`   ⚠️ Skipped: ${usersSkipped} users`);
  if (createdUsers.length > 0) {
    console.log(`   🔑 Default password: ${DEFAULT_PASSWORD}`);
    console.log(`   ⚠️ Users should change their password on first login!\n`);
  }

  // Process each row and create emissions
  let successCount = 0;
  let skipCount = 0;

  for (const row of rows) {
    try {
      // Construct date from year and month
      const year = parseInt(row.year);
      const monthNum = monthToNumber[row.month];

      if (isNaN(year) || monthNum === undefined) {
        console.log(`⚠️ Skipping row with invalid date: year=${row.year}, month=${row.month}`);
        skipCount++;
        continue;
      }

      // Use the 15th of the month as the reporting date
      const dateOfReporting = new Date(year, monthNum, 15);

      // Build activity_data JSON
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

      // Use calculatedEmission directly (already in tCO2e)
      const totalEmission = row.calculatedEmission;

      // Always set status to PENDING for seeded data (requires manual approval)
      const status = EmissionStatus.PENDING;

      // Check if this emission already exists (based on site, category, date, and equipment)
      const existingEmission = await emissionRepo.findOne({
        where: {
          site: { site_id: site.site_id },
          category: { category_id: category.category_id },
          date_of_reporting: dateOfReporting,
        },
      });

      if (existingEmission) {
        console.log(`⚠️ Emission for ${row.month} ${row.year} already exists, skipping...`);
        skipCount++;
        continue;
      }

      // Find the user who created this emission (if email exists in the row)
      let createdByUser: User | null = null;
      if (row.email && row.email.trim()) {
        const email = row.email.trim().toLowerCase();
        createdByUser = await userRepo.findOne({ where: { email } });
      }

      // Create emission
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
        created_by: createdByUser || undefined,
      });

      await emissionRepo.save(emission);
      const creatorInfo = createdByUser ? ` (by ${createdByUser.name})` : "";
      console.log(`✅ Created emission for ${row.month} ${row.year}: ${totalEmission.toFixed(4)} tCO2e${creatorInfo}`);
      successCount++;
    } catch (error) {
      console.error(`❌ Error processing row:`, error);
      skipCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successfully created: ${successCount} emissions`);
  console.log(`   ⚠️ Skipped: ${skipCount} rows`);
  console.log(`   🏭 Site: ${siteName} (ID: ${site.site_id})`);
  console.log(`   📊 Category: ${categoryName} (ID: ${category.category_id})`);

  await AppDataSource.destroy();
  console.log("\n✅ Database connection closed");
  process.exit(0);
}

seedEmissionsFromExcel().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
