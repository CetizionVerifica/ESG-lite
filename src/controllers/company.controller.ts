import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { FY_START_MONTH, FISCAL_YEAR_RULE } from "../reporting/ghg-data";

const repo = AppDataSource.getRepository(Company);

export const createCompany = async (req: Request, res: Response) => {
  const company = repo.create(req.body);
  await repo.save(company);
  res.status(201).json(company);
};

export const getCompanies = async (_: Request, res: Response) => {
  const companies = await repo.find();
  res.json(companies);
};

export const updateCompany = async (req: Request, res: Response) => {
  await repo.update(req.params.id, req.body);
  res.json({ message: "Company updated" });
};

export const deleteCompany = async (req: Request, res: Response) => {
  await repo.delete(req.params.id);
  res.json({ message: "Company deleted" });
};

/**
 * The reporting calendar (where the financial year starts). Deliberately does
 * NOT depend on resolving a company: it is a system-wide rule, and sites without
 * a company would otherwise 404 and leave the UI unable to build FY periods.
 */
export const getReportingCalendar = async (_req: Request, res: Response) => {
  return res.status(200).json({
    fiscalYearStartMonth: FY_START_MONTH,
    fiscalYearRule: FISCAL_YEAR_RULE,
  });
};

export const getCompanyNameBySites = async (req: Request, res: Response) => {
  try {
    const { siteIds } = req.body;

    if (!siteIds || !Array.isArray(siteIds) || siteIds.length === 0) {
      return res.status(400).json({ message: "Site IDs are required" });
    }

    const siteRepository = AppDataSource.getRepository(Site);

    const site = await siteRepository.findOne({
      where: { site_id: siteIds[0] },
      relations: ["company"],
    });

    if (!site || !site.company) {
      return res.status(404).json({ message: "Company not found for the provided sites" });
    }

    // fiscalYearStartMonth lets the UI build FY month/quarter options from the
    // backend's single definition instead of hardcoding its own copy.
    return res.status(200).json({
      companyName: site.company.name,
      fiscalYearStartMonth: FY_START_MONTH,
      fiscalYearRule: FISCAL_YEAR_RULE,
    });
  } catch (error) {
    console.error("Error fetching company name:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};