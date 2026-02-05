import { Client } from 'pg';
import { AppDataSource } from '../config/data-source';
import { Company } from '../entities/Company';
import { Site } from '../entities/Site';
import { User } from '../entities/User';
import { UserRole } from '../types/type';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Category } from '../entities/Category';

dotenv.config();

async function migrateCompanies() {
    console.log('🚀 Starting Comprehensive Company & Employee Migration...');
    console.log('Target: ESG-lite (TypeORM)');
    console.log('Source: ESG-Mitra (Raw PG)');

    // 1. Connect to ESG-lite (Target)
    await AppDataSource.initialize();
    console.log('✅ Connected to ESG-lite DB');

    // 2. Connect to ESG-Mitra (Source)
    const oldClient = new Client({
        host: process.env.OLD_DB_HOST || '13.202.10.42',
        port: parseInt(process.env.OLD_DB_PORT || '5432'),
        user: process.env.OLD_DB_USER || 'postgres',
        password: process.env.OLD_DB_PASSWORD || 'toor',
        database: process.env.OLD_DB_NAME || 'root_db',
        ssl: false
    });

    try {
        await oldClient.connect();
        console.log('✅ Connected to ESG-Mitra DB');
    } catch (err) {
        console.error('❌ Could not connect to ESG-Mitra. Check VPN/Credentials.');
        console.error(err);
        process.exit(1);
    }

    const companyRepo = AppDataSource.getRepository(Company);
    const siteRepo = AppDataSource.getRepository(Site);
    const userRepo = AppDataSource.getRepository(User);

    // Map of Old Company ID -> New Company Entity
    const companyMap = new Map<string, Company>();

    try {
        // --- PHASE 1: MIGRATE COMPANIES ---
        console.log("--- PHASE 1: MIGRATING COMPANIES (Role = 'company') ---");
        const resCompanies = await oldClient.query(`
            SELECT * FROM companies 
            WHERE role = 'company' AND is_delete = false AND status = true
        `);
        console.log(`📦 Found ${resCompanies.rows.length} Parent Companies.`);

        for (const oldComp of resCompanies.rows) {
            if (!oldComp.email) continue;

            // 1. Upsert Company
            let company = await companyRepo.findOne({ where: { email: oldComp.email } });
            if (!company) {
                company = new Company();
                company.email = oldComp.email;
            }

            // Map Fields
            company.name = oldComp.company_name || oldComp.first_name || 'Unnamed Company';
            company.address = oldComp.address || 'N/A';
            const fullName = `${oldComp.first_name || ''} ${oldComp.last_name || ''}`.trim();
            company.contact_person = fullName || 'Admin';
            company.phone_number = oldComp.phone_number;
            company.industry = oldComp.industry;
            company.employee_range = oldComp.employee_range;
            company.cin_number = oldComp.cin_number;
            company.status = oldComp.status;
            company.esgMitraAccess = true;
            company.isEmailVerified = oldComp.is_email_verified;

            try {
                company = await companyRepo.save(company); // Update instance with ID
                companyMap.set(oldComp.id, company); // Store for Phase 2
            } catch (e: any) {
                console.error(`   ! Failed to save company ${company.name}:`, e.message);
                continue;
            }

            // 2. Ensure Default Site
            let site = await siteRepo.findOne({ where: { company: { company_id: company.company_id } } });
            if (!site) {
                site = new Site();
                site.name = `${company.name} HQ`;
                site.company = company;
                site.address = company.address;
                site.contact_person = company.contact_person;
                site = await siteRepo.save(site);
            }

            // 3. Create Company Admin User
            // Requirement: "if ESG MITRA compny table role is company then new esg lite role admin"
            let user = await userRepo.findOne({ where: { email: company.email } });
            if (!user) {
                user = new User();
                user.email = company.email;
                user.password = await bcrypt.hash('password', 10);
                user.name = oldComp.first_name || 'Admin';
                user.last_name = oldComp.last_name || 'User';
                user.role = UserRole.ADMIN; // Explicitly ADMIN
                user.site = site;

                await userRepo.save(user);
                console.log(`   + Created Company Admin: ${user.email}`);
            }
        }


        // --- PHASE 2: MIGRATE EMPLOYEES ---
        console.log("--- PHASE 2: MIGRATING EMPLOYEES (Role = 'employee') ---");
        const resEmployees = await oldClient.query(`
            SELECT * FROM companies 
            WHERE role = 'employee' AND is_delete = false AND status = true
        `);
        console.log(`📦 Found ${resEmployees.rows.length} Employees.`);

        for (const oldEmp of resEmployees.rows) {
            if (!oldEmp.email) continue;

            // Check Parent Company
            const parentCompany = companyMap.get(oldEmp.company_id);
            if (!parentCompany) {
                // console.warn(`   ! Skipping Employee ${oldEmp.email}: Parent Company ID ${oldEmp.company_id} not found/active.`);
                continue;
            }

            // Find Site (Use default HQ site for now)
            const site = await siteRepo.findOne({ where: { company: { company_id: parentCompany.company_id } } });
            if (!site) continue;

            // Map Department to Role
            // Requirement: "if ESG mitra role employee... then esg-lite user role according to esgmitra department"
            let targetRole: UserRole = UserRole.USER;
            const dept = oldEmp.department;

            if (dept === 'Admin') targetRole = UserRole.ADMIN;
            else if (dept === 'Manager') targetRole = UserRole.MANAGER;
            else targetRole = UserRole.USER;

            // Create/Update User
            let user = await userRepo.findOne({ where: { email: oldEmp.email } });
            if (!user) {
                user = new User();
                user.email = oldEmp.email;
                user.password = await bcrypt.hash('password', 10);
                user.name = oldEmp.first_name || 'Employee';
                user.last_name = oldEmp.last_name || '';
                user.role = targetRole;
                user.site = site;

                await userRepo.save(user);
                console.log(`   + Created Employee: ${user.email} (Role: ${targetRole}, Parent: ${parentCompany.name})`);
            } else {
                // Should we update role if exists? strict migration says yes.
                user.role = targetRole;
                user.site = site; // Ensure site link
                await userRepo.save(user);
                console.log(`   * Updated Employee: ${user.email} (Role: ${targetRole})`);
            }
        }

    } catch (err) {
        console.error('Error during migration:', err);
    } finally {
        await oldClient.end();
        await AppDataSource.destroy();
        console.log('🏁 Migration process finished.');
    }
}

migrateCompanies();
