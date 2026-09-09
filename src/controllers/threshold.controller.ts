import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { EmissionThreshold } from "../entities/Threshold";

const MIN_THRESHOLD = 2;
const MAX_THRESHOLD = 5;

// GET /thresholds — list all threshold values (with company info) for the table
export const getThresholds = async (_req: Request, res: Response) => {
  try {
    const thresholds = await AppDataSource.getRepository(EmissionThreshold)
      .createQueryBuilder("threshold")
      .leftJoinAndSelect("threshold.company", "company")
      .orderBy("company.name", "ASC")
      .getMany();

    return res.json(thresholds);
  } catch (error) {
    console.error("Fetch thresholds error:", error);
    return res.status(500).json({ message: "Failed to fetch thresholds" });
  }
};

// POST /thresholds — create a new threshold value for a company
export const createThreshold = async (req: Request, res: Response) => {
  try {
    const { company_id, threshold_percentage } = req.body;

    if (!company_id || threshold_percentage === undefined) {
      return res.status(400).json({ message: "company_id and threshold_percentage are required" });
    }

    const value = Number(threshold_percentage);
    if (isNaN(value) || value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
      return res.status(400).json({
        message: `threshold_percentage must be a number between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`,
      });
    }

    const repo = AppDataSource.getRepository(EmissionThreshold);

    const existing = await repo
      .createQueryBuilder("threshold")
      .leftJoin("threshold.company", "company")
      .where("company.company_id = :companyId", { companyId: Number(company_id) })
      .getOne();

    if (existing) {
      return res.status(409).json({ message: "A threshold already exists for this company" });
    }

    const threshold = repo.create({
      company: { company_id: Number(company_id) } as any,
      threshold_percentage: value,
    });
    await repo.save(threshold);

    const saved = await repo
      .createQueryBuilder("threshold")
      .leftJoinAndSelect("threshold.company", "company")
      .where("threshold.threshold_id = :id", { id: threshold.threshold_id })
      .getOne();

    return res.status(201).json(saved);
  } catch (error) {
    console.error("Create threshold error:", error);
    return res.status(500).json({ message: "Failed to create threshold" });
  }
};

// PUT /thresholds/:id — update an existing threshold's percentage
export const updateThreshold = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { threshold_percentage } = req.body;

    if (threshold_percentage === undefined) {
      return res.status(400).json({ message: "threshold_percentage is required" });
    }

    const value = Number(threshold_percentage);
    if (isNaN(value) || value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
      return res.status(400).json({
        message: `threshold_percentage must be a number between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`,
      });
    }

    const repo = AppDataSource.getRepository(EmissionThreshold);
    const threshold = await repo.findOne({ where: { threshold_id: Number(id) } });

    if (!threshold) {
      return res.status(404).json({ message: "Threshold not found" });
    }

    threshold.threshold_percentage = value;
    await repo.save(threshold);

    const saved = await repo
      .createQueryBuilder("threshold")
      .leftJoinAndSelect("threshold.company", "company")
      .where("threshold.threshold_id = :id", { id: threshold.threshold_id })
      .getOne();

    return res.json(saved);
  } catch (error) {
    console.error("Update threshold error:", error);
    return res.status(500).json({ message: "Failed to update threshold" });
  }
};

// DELETE /thresholds/:id
export const deleteThreshold = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const repo = AppDataSource.getRepository(EmissionThreshold);

    const threshold = await repo.findOne({ where: { threshold_id: Number(id) } });
    if (!threshold) {
      return res.status(404).json({ message: "Threshold not found" });
    }

    await repo.remove(threshold);
    return res.json({ message: "Threshold deleted successfully" });
  } catch (error) {
    console.error("Delete threshold error:", error);
    return res.status(500).json({ message: "Failed to delete threshold" });
  }
};

export const getThresholdByCompany = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    const threshold = await AppDataSource.getRepository(EmissionThreshold)
      .createQueryBuilder("threshold")
      .leftJoin("threshold.company", "company")
      .where("company.company_id = :companyId", { companyId: Number(companyId) })
      .getOne();

    if (!threshold) {
      // No threshold configured yet — return the same default used elsewhere
      return res.json({ threshold_percentage: 5.0 });
    }

    return res.json({ threshold_percentage: Number(threshold.threshold_percentage) });
  } catch (error) {
    console.error("Fetch threshold by company error:", error);
    return res.status(500).json({ message: "Failed to fetch threshold" });
  }
};