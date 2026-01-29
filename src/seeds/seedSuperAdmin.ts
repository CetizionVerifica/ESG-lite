import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import bcrypt from "bcrypt";
import { UserRole } from "../types/type";

async function seedSuperAdmin() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const siteRepo = AppDataSource.getRepository(Site);

  // 🔎 Check if superadmin already exists
  const existing = await userRepo.findOne({
    where: { role: UserRole.SUPERADMIN  },
  });

  if (existing) {
    console.log("⚠️ Superadmin already exists");
    process.exit(0);
  }

  // 🏗 Ensure a site exists (required by FK)
  let site = await siteRepo.findOne({ where: { name: "HQ" } });

  if (!site) {
    site = siteRepo.create({
      name: "HQ",
      address: "Head Office",
      contact_person: "System",
    });
    await siteRepo.save(site);
  }

  // 🔐 Hash password
  const hashedPassword = await bcrypt.hash("piku1234", 10);

  // 👤 Create superadmin
  const superAdmin = userRepo.create({
    email: "shyam.admin@cv.com",
    password: hashedPassword,
    role: UserRole.SUPERADMIN,
    site,
  });

  await userRepo.save(superAdmin);

  console.log("✅ Superadmin user seeded successfully");
  process.exit(0);
}

seedSuperAdmin().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
