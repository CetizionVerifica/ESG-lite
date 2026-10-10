import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { UserRole } from "../types/type";
import {
    saveCompanyLogo,
    saveCompanyGuideline,
    isSupportedGuidelineMime,
    SUPPORTED_GUIDELINE_MIMES,
    isSupportedLogoMime,
    isAssetStorageConfigured,
    SUPPORTED_LOGO_MIMES,
} from "../services/brandLogo.service";

const userRepo = AppDataSource.getRepository(User);
const companyRepo = AppDataSource.getRepository(Company);
const siteRepo = AppDataSource.getRepository(Site);

const BCRYPT_ROUNDS = 10;
const DEFAULT_ADDRESS = "Not Provided";

// The form posts multipart/form-data, so every scalar arrives as a string —
// checkboxes included.
const isTruthyFlag = (value: unknown): boolean =>
    value === true || value === "true" || value === "on" || value === "1";

const trimmed = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

const uploadedFile = (req: Request, field: string): Express.Multer.File | undefined => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    return files?.[field]?.[0];
};

export const onboardCompany = async (req: Request, res: Response) => {
    try {
        // Guard against a body parser not matching the request content type,
        // which leaves req.body undefined on Express 5.
        const body = req.body ?? {};

        const companyName = trimmed(body.companyName);
        const contactPerson = trimmed(body.contactPerson);
        const email = trimmed(body.email);
        const password = typeof body.password === "string" ? body.password : "";
        const phoneNumber = trimmed(body.phoneNumber);
        const industry = trimmed(body.industry);
        const region = trimmed(body.region);
        const employeeRange = trimmed(body.employeeRange);
        const cinNumber = trimmed(body.cinNumber);
        const address = trimmed(body.address);
        const esgMitraAccess = isTruthyFlag(body.esgMitraAccess);

        // 1. Validate required input
        const missing = Object.entries({ companyName, contactPerson, email, password })
            .filter(([, value]) => !value)
            .map(([field]) => field);
        if (missing.length) {
            return res.status(400).json({
                message: `Missing required field(s): ${missing.join(", ")}`,
            });
        }

        // 2. Check if user already exists
        const existingUser = await userRepo.findOne({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ message: "User with this email already exists" });
        }

        // 3. Create Company
        const company = companyRepo.create({
            name: companyName,
            contact_person: contactPerson,
            address: address || DEFAULT_ADDRESS, // Default if not provided
            email,
            phone_number: phoneNumber,
            industry,
            region,
            employee_range: employeeRange,
            cin_number: cinNumber,
            esgMitraAccess,
            status: true,
            isEmailVerified: true, // Assuming onboarded companies are verified
        });
        const savedCompany = await companyRepo.save(company);

        // 4. Create Default Site for the Company
        const site = siteRepo.create({
            name: `${companyName} - Main Site`,
            address: address || DEFAULT_ADDRESS,
            contact_person: contactPerson,
            // country: undefined, // Optional
            company: savedCompany,
        });
        const savedSite = await siteRepo.save(site);

        // 5. Create Company Admin User
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const user = userRepo.create({
            name: contactPerson,
            email,
            password: hashedPassword,
            phone_number: phoneNumber,
            role: UserRole.ADMIN, // Company Admin
            site: savedSite, // Link to the main site
        });
        await userRepo.save(user);

        // 6. Store the brand logo and colour guideline, if they came with the
        // form. The company is already onboarded at this point, so a failure is
        // reported as a warning rather than failing the whole request. One
        // after the other: both upsert the same brand row.
        const warnings = [...(await storeLogo(req, savedCompany)), ...(await storeGuideline(req, savedCompany))];

        return res.status(201).json({
            message: "Company onboarded successfully",
            company: savedCompany,
            site: savedSite,
            admin: {
                id: user.user_id,
                email: user.email,
                role: user.role,
            },
            warnings,
        });

    } catch (error) {
        console.error("Onboarding error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

const storeLogo = async (req: Request, company: Company): Promise<string[]> => {
    const logo = uploadedFile(req, "logo");
    if (!logo) return [];

    if (!isSupportedLogoMime(logo.mimetype)) {
        return [`Logo was not saved: unsupported file type (allowed: ${SUPPORTED_LOGO_MIMES.join(", ")})`];
    }
    if (!isAssetStorageConfigured()) {
        return ["Logo was not saved: asset storage (R2) is not configured on the server"];
    }

    try {
        await saveCompanyLogo(company.company_id, company.name, logo);
        return [];
    } catch (error) {
        console.error("Onboarding logo upload error:", error);
        return ["Logo was not saved: upload failed"];
    }
};

const storeGuideline = async (req: Request, company: Company): Promise<string[]> => {
    const file = uploadedFile(req, "colorGuideline");
    if (!file) return [];

    if (!isSupportedGuidelineMime(file.mimetype)) {
        return [`Colour guideline was not saved: unsupported file type (allowed: ${SUPPORTED_GUIDELINE_MIMES.join(", ")})`];
    }
    if (!isAssetStorageConfigured()) {
        return ["Colour guideline was not saved: asset storage (R2) is not configured on the server. Upload it in the client's Brand tab."];
    }

    try {
        await saveCompanyGuideline(company.company_id, company.name, file);
        return [];
    } catch (error) {
        console.error("Onboarding colour guideline upload error:", error);
        return ["Colour guideline was not saved: upload failed. Upload it in the client's Brand tab."];
    }
};
