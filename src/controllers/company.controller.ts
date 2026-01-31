import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";

const repo = AppDataSource.getRepository(Company);

export const createCompany = async (req: Request, res: Response) => {
  const company = repo.create(req.body);
  await repo.save(company);
  res.status(201).json(company);
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
