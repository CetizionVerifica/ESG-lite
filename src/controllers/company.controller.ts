import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";

const repo = AppDataSource.getRepository(Company);

export const createCompany = async (req: Request, res: Response) => {
  try {
    const company = repo.create(req.body);
    await repo.save(company);
    res.status(201).json(company);
  } catch (err) {
    console.error("Create Company Error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getCompanies = async (_: Request, res: Response) => {
  const companies = await repo.find({
    relations: ["sites", "sites.categories"],
  });
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

    return res.status(200).json({ companyName: site.company.name });
  } catch (error) {
    console.error("Error fetching company name:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};