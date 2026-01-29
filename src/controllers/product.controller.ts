import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Product } from "../entities/Product";
import { Site } from "../entities/Site";

const repo = AppDataSource.getRepository(Product);
const siteRepo = AppDataSource.getRepository(Site);

// Admin: Create product (Superadmin only)
export const createProduct = async (req: Request, res: Response) => {
  try {
    const { name, description, unit, site_id } = req.body;

    if (!name || !unit || !site_id) {
      return res.status(400).json({
        message: "name, unit, and site_id are required",
      });
    }

    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }

    const product = repo.create({
      name: name.trim(),
      description: description?.trim() || null,
      unit: unit.trim(),
      site: { site_id },
    });

    await repo.save(product);

    const savedProduct = await repo.findOne({
      where: { product_id: product.product_id },
      relations: ["site"],
    });

    return res.status(201).json({
      message: "Product created successfully",
      product: savedProduct,
    });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Get all products
export const getProducts = async (_req: Request, res: Response) => {
  try {
    const products = await repo.find({
      relations: ["site"],
      order: { name: "ASC" },
    });
    return res.status(200).json(products);
  } catch (error) {
    console.error("Fetch products error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Get product by ID
export const getProductById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const product = await repo.findOne({
      where: { product_id: parseInt(id) },
      relations: ["site"],
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json(product);
  } catch (error) {
    console.error("Fetch product by ID error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Update product
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, description, unit, site_id } = req.body;

    const product = await repo.findOne({
      where: { product_id: parseInt(id) },
      relations: ["site"],
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (name) product.name = name.trim();
    if (description !== undefined) product.description = description?.trim() || null;
    if (unit) product.unit = unit.trim();
    if (site_id) product.site = { site_id } as Site;

    await repo.save(product);

    const updatedProduct = await repo.findOne({
      where: { product_id: product.product_id },
      relations: ["site"],
    });

    return res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Delete product
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const product = await repo.findOne({
      where: { product_id: parseInt(id) },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await repo.delete({ product_id: parseInt(id) });

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// User: Get products by site
export const getProductsBySite = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;

    const products = await repo.find({
      where: { site: { site_id: parseInt(siteId) } },
      relations: ["site"],
      order: { name: "ASC" },
    });

    return res.status(200).json(products);
  } catch (error) {
    console.error("Fetch products by site error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
