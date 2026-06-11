import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { grantCategoriesToSiteUsers } from "../utils/siteCategorySync";

const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

export const createSite = async (req: Request, res: Response) => {
  try {
    const { name, address, contact_person, company_id, country_id, category_ids } = req.body;

    // 1️⃣ Validate input
    if (!name || !address || !contact_person || !company_id || !country_id) {
      return res.status(400).json({
        message: "All fields (name, address, contact_person, company_id, country_id) are required",
      });
    }

    // 2️⃣ Fetch categories if provided
    let categories: Category[] = [];
    if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
      categories = await categoryRepo.findByIds(category_ids);
      if (categories.length !== category_ids.length) {
        return res.status(400).json({
          message: "One or more categories not found",
        });
      }
    }

    // 3️⃣ Create site
    const site = siteRepo.create({
      name: name.trim(),
      address: address.trim(),
      contact_person: contact_person.trim(),
      company: { company_id },
      country: { country_id },
      categories, // Associate categories
    });

    await siteRepo.save(site);

    // 4️⃣ Respond
    return res.status(201).json({
      message: "Site created successfully",
      site,
    });
  } catch (error) {
    console.error("Create site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getSites = async (_: Request, res: Response) => {
  try {
    const sites = await siteRepo.find({
      relations: ["company", "country", "categories"], // Added categories
      order: { name: "ASC" },
    });
    return res.status(200).json(sites);
  } catch (error) {
    console.error("Fetch sites error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getSiteById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const site = await siteRepo.findOne({
      where: { site_id: parseInt(id) },
      relations: ["company", "country", "categories"],
    });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    return res.status(200).json(site);
  } catch (error) {
    console.error("Fetch site by ID error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateSite = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { name, address, contact_person, company_id, country_id, category_ids } = req.body;

    // 1️⃣ Validate input
    if (!name && !address && !contact_person && !company_id && !country_id && !category_ids) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    // 2️⃣ Check if site exists
    const site = await siteRepo.findOne({
      where: { site_id: parseInt(id) },
      relations: ["company", "country", "categories"], // Added categories
    });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // 3️⃣ Update basic fields
    if (name) site.name = name.trim();
    if (address) site.address = address.trim();
    if (contact_person) site.contact_person = contact_person.trim();
    if (company_id) site.company = { company_id } as any;
    if (country_id) site.country = { country_id } as any;

    // 4️⃣ Update categories if provided
    let newlyAddedCategories: Category[] = [];
    if (category_ids && Array.isArray(category_ids)) {
      const categories = await categoryRepo.findByIds(category_ids);
      if (categories.length !== category_ids.length) {
        return res.status(400).json({
          message: "One or more categories not found",
        });
      }
      // Categories present in the new set but not previously on the site.
      const oldCategoryIds = new Set((site.categories || []).map((c) => c.category_id));
      newlyAddedCategories = categories.filter((c) => !oldCategoryIds.has(c.category_id));
      site.categories = categories;
    }

    await siteRepo.save(site);

    // Make newly assigned categories visible to existing users on this site,
    // otherwise login filtering hides them from the data-entry tab.
    await grantCategoriesToSiteUsers(parseInt(id), newlyAddedCategories);

    return res.status(200).json({
      message: "Site updated successfully",
      site,
    });
  } catch (error) {
    console.error("Update site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteSite = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    // 1️⃣ Check if site exists
    const site = await siteRepo.findOne({
      where: { site_id: parseInt(id) },
    });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // 2️⃣ Delete site (categories will be unlinked due to many-to-many)
    await siteRepo.delete({ site_id: parseInt(id) });

    return res.status(200).json({
      message: "Site deleted successfully",
    });
  } catch (error) {
    console.error("Delete site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

