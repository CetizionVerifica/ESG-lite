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

    // Sites per country in one grouped query.
    const rows: { country_id: number; site_count: number }[] = await AppDataSource.query(
      `SELECT country_id, COUNT(*)::int AS site_count FROM site WHERE country_id IS NOT NULL GROUP BY country_id`
    );
    const counts = new Map(rows.map((r) => [Number(r.country_id), r.site_count]));

    return res
      .status(200)
      .json(countries.map((c) => ({ ...c, site_count: counts.get(c.country_id) ?? 0 })));
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

    // 1b. Sites reference the country without a cascade; refuse instead of
    // failing on the foreign key. Counted under a row lock in the same
    // transaction as the delete.
    const n = await AppDataSource.transaction(async (manager) => {
      await manager.query(`SELECT country_id FROM country WHERE country_id = $1 FOR UPDATE`, [country.country_id]);
      const [{ n: used }] = await manager.query(`SELECT COUNT(*)::int AS n FROM site WHERE country_id = $1`, [country.country_id]);
      if (used > 0) return used as number;
      // 2️⃣ Delete country
      // data-loss-reviewed: removes one country that no site uses.
      await manager.delete(Country, { country_id: country.country_id });
      return 0;
    });
    if (n > 0) {
      return res.status(409).json({
        message: `${n} site(s) use this country. Move them to another country first.`,
      });
    }

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