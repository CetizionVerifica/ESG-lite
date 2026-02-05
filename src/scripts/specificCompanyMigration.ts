
import { getOldDbClient, getNewDbDataSource } from "./migrationConfig";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { Country } from "../entities/Country";
import bcrypt from "bcrypt";

const migrateSpecificCompany = async (email: string) => {
    const oldDb = await getOldDbClient();
    const newDb = await getNewDbDataSource();

    try {
        console.log(`Starting migration for: ${email}`);

        // 1. Fetch from Old DB
        const res = await oldDb.query(`SELECT * FROM companies WHERE email = $1`, [email]);
        if (res.rows.length === 0) {
            console.log(`Company ${email} not found in Old DB.`);
            return;
        }
        const oldCompany = res.rows[0];
        console.log(`Found Old Company: ${oldCompany.company_name}`);

        // 2. Insert into New DB
        const companyRepo = newDb.getRepository(Company);
        let newCompany = await companyRepo.findOne({ where: { email: email } });

        if (!newCompany) {
            console.log("Creating new company...");
            newCompany = companyRepo.create({
                name: oldCompany.company_name,
                email: oldCompany.email,
                phone_number: oldCompany.phone_number,
                address: oldCompany.address || "N/A",
                contact_person: oldCompany.first_name ? `${oldCompany.first_name} ${oldCompany.last_name}` : "Admin",
                cin_number: oldCompany.cin_number,
                employee_range: oldCompany.employee_range,
                industry: oldCompany.industry,
                region: oldCompany.region,
                isEmailVerified: oldCompany.is_email_verified,
                status: true
            });
            await companyRepo.save(newCompany);
            console.log(`Company migrated. ID: ${newCompany.company_id}`);
        } else {
            console.log(`Company already exists. ID: ${newCompany.company_id}`);
            // Update fields if needed?
        }

        // 3. Check for Existing Sites or Create Default
        const siteRepo = newDb.getRepository(Site);
        const categoryRepo = newDb.getRepository(Category);
        const countryRepo = newDb.getRepository(Country);

        let companySites = await siteRepo.find({
            where: { company: { company_id: newCompany.company_id } },
            relations: ["categories"]
        });

        if (companySites.length === 0) {
            console.log("No sites found. Creating default 'Headquarters' site...");

            // Ensure default country
            let country = await countryRepo.findOne({ where: { name: "India" } });
            if (!country) {
                country = countryRepo.create({ name: "India", code: "IN" });
                await countryRepo.save(country);
            }

            const newSite = siteRepo.create({
                name: "Headquarters",
                address: newCompany.address,
                contact_person: newCompany.contact_person,
                company: newCompany,
                country: country,
                categories: []
            });
            await siteRepo.save(newSite);
            companySites.push(newSite);
        } else {
            console.log(`Found ${companySites.length} existing sites. Assigning categories to them.`);
        }

        // Fetch All Active Categories
        const allCategories = await categoryRepo.find();

        if (allCategories.length > 0) {
            console.log(`Assigning ${allCategories.length} categories to ${companySites.length} site(s)...`);

            for (const site of companySites) {
                // Merge existing categories with new ones (avoiding duplicates is handled by TypeORM usually,
                // but explicit check or Set is safer if we want to KEEP existing ones + Add new ones)
                // User said: "assigne ho jaye jo abhi esglite me folw chal rha hai" -> assign all.

                // We will overwrite/ensure all active categories are there.
                // If we want to PRESERVE existing extra categories (if any), we should merge.
                // Assuming we want to assign ALL active categories from Master.

                site.categories = allCategories;
                await siteRepo.save(site);
                console.log(`   -> Categories assigned to site: ${site.name}`);
            }
            console.log("Category assignment completed.");
        } else {
            console.log("No categories found in New DB to assign.");
        }

    } catch (error) {
        console.error("Migration Error:", error);
    } finally {
        await oldDb.end();
        if (newDb.isInitialized) await newDb.destroy();
    }
};

export { migrateSpecificCompany };

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const emailIndex = args.indexOf('--email');
    let email = null;

    if (emailIndex !== -1 && args[emailIndex + 1]) {
        email = args[emailIndex + 1];
    } else if (args.length > 0) {
        email = args[0];
    }

    if (email) {
        migrateSpecificCompany(email);
    } else {
        console.log("Usage: npx ts-node src/scripts/specificCompanyMigration.ts <email>");
        console.log("   OR: npx ts-node src/scripts/specificCompanyMigration.ts --email <email>");
    }
}
