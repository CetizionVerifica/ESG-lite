import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Country } from "../entities/Country";

export const createCountry = async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    // 1️⃣ Validate input
    if (!name || !code) {
      return res.status(400).json({
        message: "Country name and code are required",
      });
    }

    const countryRepo = AppDataSource.getRepository(Country);

    // 2️⃣ Prevent duplicates (case-insensitive)
    const existing = await countryRepo.findOne({
      where: [
        { name: name.trim() },
        { code: code.trim().toUpperCase() },
      ],
    });

    if (existing) {
      return res.status(409).json({
        message: "Country already exists",
      });
    }

    // 3️⃣ Create country
    const country = countryRepo.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
    });

    await countryRepo.save(country);

    // 4️⃣ Respond
    return res.status(201).json({
      message: "Country created successfully",
      country,
    });
  } catch (error) {
    console.error("Create country error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const getAllCountries = async (_req: Request, res: Response) => {
  try {
    const countryRepo = AppDataSource.getRepository(Country);

    const countries = await countryRepo.find({
      order: { name: "ASC" },
    });

    return res.status(200).json(countries);
  } catch (error) {
    console.error("Fetch countries error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateCountry = async (req: Request, res: Response) => {
  try {
    const { id }:any = req.params;
    const { name, code } = req.body;

    // 1️⃣ Validate input
    if (!name && !code) {
      return res.status(400).json({
        message: "At least one field (name or code) is required",
      });
    }

    const countryRepo = AppDataSource.getRepository(Country);

    // 2️⃣ Check if country exists
    const country = await countryRepo.findOne({
      where: { country_id: parseInt(id) },
    });

    if (!country) {
      return res.status(404).json({
        message: "Country not found",
      });
    }

    // 3️⃣ Check for duplicates (exclude current country)
    if (name || code) {
      const existing = await countryRepo.findOne({
        where: [
          { name: name?.trim(), country_id: -parseInt(id) },
          { code: code?.trim().toUpperCase(), country_id: -parseInt(id) },
        ],
      });

      if (existing && existing.country_id !== parseInt(id)) {
        return res.status(409).json({
          message: "Country name or code already exists",
        });
      }
    }

    // 4️⃣ Update country
    if (name) country.name = name.trim();
    if (code) country.code = code.trim().toUpperCase();

    await countryRepo.save(country);

    return res.status(200).json({
      message: "Country updated successfully",
      country,
    });
  } catch (error) {
    console.error("Update country error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteCountry = async (req: Request, res: Response) => {
  try {
    const { id }:any = req.params;

    const countryRepo = AppDataSource.getRepository(Country);

    // 1️⃣ Check if country exists
    const country = await countryRepo.findOne({
      where: { country_id: parseInt(id) },
    });

    if (!country) {
      return res.status(404).json({
        message: "Country not found",
      });
    }

    // 2️⃣ Delete country
    await countryRepo.delete({ country_id: parseInt(id) });

    return res.status(200).json({
      message: "Country deleted successfully",
    });
  } catch (error) {
    console.error("Delete country error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};