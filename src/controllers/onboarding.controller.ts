import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { UserRole } from "../types/type";

const userRepo = AppDataSource.getRepository(User);
const companyRepo = AppDataSource.getRepository(Company);
const siteRepo = AppDataSource.getRepository(Site);

export const onboardCompany = async (req: Request, res: Response) => {
    try {
        const {
            companyName,
            contactPerson,
            email,
            password,
            phoneNumber,
            industry,
            region,
            employeeRange,
            cinNumber,
            esgMitraAccess,
            address,
        } = req.body;

        // 1. Check if user already exists
        const existingUser = await userRepo.findOne({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ message: "User with this email already exists" });
        }

        // 2. Create Company
        const company = companyRepo.create({
            name: companyName,
            contact_person: contactPerson,
            address: address || "Not Provided", // Default if not provided
            email,
            phone_number: phoneNumber,
            industry,
            region,
            employee_range: employeeRange,
            cin_number: cinNumber,
            esgMitraAccess: esgMitraAccess || false,
            status: true,
            isEmailVerified: true, // Assuming onboarded companies are verified
        });
        const savedCompany = await companyRepo.save(company);

        // 3. Create Default Site for the Company
        const site = siteRepo.create({
            name: `${companyName} - Main Site`,
            address: address || "Not Provided",
            contact_person: contactPerson,
            // country: undefined, // Optional
            company: savedCompany,
        });
        const savedSite = await siteRepo.save(site);

        // 4. Create Company Admin User
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = userRepo.create({
            name: contactPerson,
            email,
            password: hashedPassword,
            phone_number: phoneNumber,
            role: UserRole.ADMIN, // Company Admin
            site: savedSite, // Link to the main site
        });
        await userRepo.save(user);

        return res.status(201).json({
            message: "Company onboarded successfully",
            company: savedCompany,
            site: savedSite,
            admin: {
                id: user.user_id,
                email: user.email,
                role: user.role,
            },
        });

    } catch (error) {
        console.error("Onboarding error:", error);
        return res.status(500).json({ message: "Internal server error", error });
    }
};
