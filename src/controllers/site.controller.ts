import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { MasterDataService } from "../services/masterData.service";

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

    const savedSite = await siteRepo.save(site);

    // 4️⃣ Assign Master Data (New Flow) if requested
    if (req.body.assign_master_data) {
      await MasterDataService.assignMasterDataToSite(savedSite.site_id);
    }

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
    if (category_ids && Array.isArray(category_ids)) {
      const categories = await categoryRepo.findByIds(category_ids);
      if (categories.length !== category_ids.length) {
        return res.status(400).json({
          message: "One or more categories not found",
        });
      }
      site.categories = categories;
    }

    await siteRepo.save(site);

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

export const getSiteMasterData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { categoryId, subcategoryIds } = req.query;

    let subIds: number[] | undefined;
    if (subcategoryIds) {
      if (Array.isArray(subcategoryIds)) {
        subIds = subcategoryIds.map(s => parseInt(s as string)).filter(n => !isNaN(n));
      } else {
        const parsed = parseInt(subcategoryIds as string);
        if (!isNaN(parsed)) subIds = [parsed];
      }
    }

    const data = await MasterDataService.getSiteMasterData(
      parseInt(id as string),
      categoryId ? parseInt(categoryId as string) : undefined,
      subIds
    );
    return res.json(data);
  } catch (error) {
    console.error("Get Site MasterData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAssignedSiteMasterData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await MasterDataService.getAssignedSiteMasterData(parseInt(id as string));
    return res.json(data);
  } catch (error) {
    console.error("Get Assigned Site MasterData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSiteMasterData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { items } = req.body; // Array of { master_data_id, is_active, unit }

    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "items must be an array" });
    }

    await MasterDataService.syncMasterDataForSite(parseInt(id as string), items);
    return res.json({ message: "Site Master Data updated successfully" });
  } catch (error) {
    console.error("Update Site MasterData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const initializeSiteMasterData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await MasterDataService.assignMasterDataToSite(parseInt(id as string));
    return res.json({ message: "Site Master Data initialized successfully" });
  } catch (error) {
    console.error("Initialize Site MasterData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ... existing deleteSite ...
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

