import "reflect-metadata";
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
import { filedMonths, planHistoricalRows, type FiledEntry, type HistoricalRow } from "../services/historicalImport";
import { engineResults, insertHistoricalRows } from "../services/historicalEngine";

// Default password for seeded users (they should change this on first login)
// Seeded users get a random password; they set their own with "Forgot password".
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

// Month name to number mapping
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

  // An unknown category is refused, never created with a guessed scope (S3-4).
  const category = await categoryRepo.findOne({ where: { category_name: categoryName } });
  if (!category) {
    console.error(`❌ SCOPE_INVALID: no category named "${categoryName}". Add it with its scope (Scope 1, 2, 3 or none) first.`);
    await AppDataSource.destroy();
    process.exit(1);
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
      const hashedPassword = await bcrypt.hash(randomPassword(), 10);

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
    console.log(`   🔑 New users set their password with "Forgot password" on the sign-in page.`);
  }

  // Every total comes from the emission write service (S3-4): the site's
  // factor for the year, the unit check and the FERA twin, as a typed entry.
  // Months already filed, repeated months and rows the engine refuses are
  // skipped with the reason; the sheet's calculatedEmission is never stored.
  const historical = rows as unknown as HistoricalRow[];
  const usersByEmail = new Map<string, number>();
  for (const r of historical) {
    const email = String(r.email ?? "").trim().toLowerCase();
    if (email && !usersByEmail.has(email)) {
      const u = await userRepo.findOne({ where: { email } });
      if (u) usersByEmail.set(email, u.user_id);
    }
  }
  const { plan, successCount } = await AppDataSource.transaction(async (m) => {
    const existing: FiledEntry[] = await m.query(
      `SELECT date_of_reporting, reporting_period, year_type FROM emission WHERE site_id = $1 AND category_id = $2`,
      [site.site_id, category.category_id],
    );
    const { results, entries } = await engineResults(m, historical, site.site_id, category.category_id);
    const plan = planHistoricalRows(historical, filedMonths(existing), new Set(usersByEmail.keys()), results);
    const successCount = await insertHistoricalRows(m, plan, entries, historical, null, (r) => usersByEmail.get(String(r.email ?? "").trim().toLowerCase()) ?? null);
    return { plan, successCount };
  });
  for (const p of plan.rows) {
    if (p.status === "import") console.log(`✅ ${p.period}: ${p.total!.toFixed(2)} tCO2e${p.warnings?.length ? ` (${p.warnings.join(" ")})` : ""}`);
    else console.log(`⚠️ Row ${p.row} skipped: ${p.reason}`);
  }
  const skipCount = plan.toSkip;

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
