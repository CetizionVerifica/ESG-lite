import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { EmissionDocument, DocumentType } from "../entities/EmissionDocument";
import { Emission } from "../entities/Emission";
import { AuthRequest } from "../middlewares/auth.middleware";
import cloudinary from "../config/cloudinary";
import { Readable } from "stream";

const documentRepo = AppDataSource.getRepository(EmissionDocument);
const emissionRepo = AppDataSource.getRepository(Emission);

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (
  buffer: Buffer,
  options: {
    folder: string;
    resource_type: "auto" | "image" | "video" | "raw";
    public_id?: string;
  }
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: options.resource_type,
        public_id: options.public_id,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

// Upload a document
export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { emission_id, document_type, description } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        message: "No file uploaded",
      });
    }

    // Validate document_type if provided
    if (document_type && !Object.values(DocumentType).includes(document_type)) {
      return res.status(400).json({
        message: `Invalid document_type. Must be one of: ${Object.values(DocumentType).join(", ")}`,
      });
    }

    // Validate emission exists if emission_id is provided
    if (emission_id) {
      const emission = await emissionRepo.findOne({
        where: { pk_id: parseInt(emission_id) },
      });

      if (!emission) {
        return res.status(404).json({
          message: "Emission not found",
        });
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const publicId = `emission_docs/${timestamp}_${sanitizedName}`;

    // Upload to Cloudinary with auto resource type to support all file types
    const result = await uploadToCloudinary(file.buffer, {
      folder: "emission_documents",
      resource_type: "auto",
      public_id: publicId,
    });

    // Create document record
    const document = documentRepo.create({
      file_name: `${timestamp}_${sanitizedName}`,
      original_name: file.originalname,
      cloudinary_public_id: result.public_id,
      cloudinary_url: result.url,
      secure_url: result.secure_url,
      file_type: file.mimetype,
      file_size: file.size,
      document_type: document_type || DocumentType.OTHER,
      description: description || null,
      emission: emission_id ? { pk_id: parseInt(emission_id) } as any : null,
      uploaded_by: userId ? { user_id: userId } as any : null,
    });

    await documentRepo.save(document);

    const savedDocument = await documentRepo.findOne({
      where: { document_id: document.document_id },
      relations: ["emission", "uploaded_by"],
    });

    return res.status(201).json({
      message: "Document uploaded successfully",
      document: savedDocument,
    });
  } catch (error) {
    console.error("Upload document error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Upload multiple documents
export const uploadMultipleDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { emission_id, document_type, description } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        message: "No files uploaded",
      });
    }

    // Validate emission exists if emission_id is provided
    if (emission_id) {
      const emission = await emissionRepo.findOne({
        where: { pk_id: parseInt(emission_id) },
      });

      if (!emission) {
        return res.status(404).json({
          message: "Emission not found",
        });
      }
    }

    const uploadedDocuments = [];

    for (const file of files) {
      const timestamp = Date.now();
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const publicId = `emission_docs/${timestamp}_${sanitizedName}`;

      const result = await uploadToCloudinary(file.buffer, {
        folder: "emission_documents",
        resource_type: "auto",
        public_id: publicId,
      });

      const document = documentRepo.create({
        file_name: `${timestamp}_${sanitizedName}`,
        original_name: file.originalname,
        cloudinary_public_id: result.public_id,
        cloudinary_url: result.url,
        secure_url: result.secure_url,
        file_type: file.mimetype,
        file_size: file.size,
        document_type: document_type || DocumentType.OTHER,
        description: description || null,
        emission: emission_id ? { pk_id: parseInt(emission_id) } as any : null,
        uploaded_by: userId ? { user_id: userId } as any : null,
      });

      await documentRepo.save(document);
      uploadedDocuments.push(document);
    }

    const savedDocuments = await documentRepo.find({
      where: uploadedDocuments.map((d) => ({ document_id: d.document_id })),
      relations: ["emission", "uploaded_by"],
    });

    return res.status(201).json({
      message: `${savedDocuments.length} document(s) uploaded successfully`,
      documents: savedDocuments,
    });
  } catch (error) {
    console.error("Upload multiple documents error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get all documents
export const getDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const { emission_id, document_type } = req.query;

    const whereClause: any = {};

    if (emission_id) {
      whereClause.emission = { pk_id: parseInt(emission_id as string) };
    }

    if (document_type) {
      whereClause.document_type = document_type;
    }

    const documents = await documentRepo.find({
      where: whereClause,
      relations: ["emission", "uploaded_by"],
      order: { created_at: "DESC" },
    });

    return res.status(200).json(documents);
  } catch (error) {
    console.error("Get documents error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get document by ID
export const getDocumentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;

    const document = await documentRepo.findOne({
      where: { document_id: parseInt(id) },
      relations: ["emission", "uploaded_by"],
    });

    if (!document) {
      return res.status(404).json({
        message: "Document not found",
      });
    }

    return res.status(200).json(document);
  } catch (error) {
    console.error("Get document by ID error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get documents by emission ID
export const getDocumentsByEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { emissionId }: any = req.params;

    const documents = await documentRepo.find({
      where: { emission: { pk_id: parseInt(emissionId) } },
      relations: ["emission", "uploaded_by"],
      order: { created_at: "DESC" },
    });

    return res.status(200).json(documents);
  } catch (error) {
    console.error("Get documents by emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Update document metadata
export const updateDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { document_type, description, emission_id } = req.body;

    const document = await documentRepo.findOne({
      where: { document_id: parseInt(id) },
    });

    if (!document) {
      return res.status(404).json({
        message: "Document not found",
      });
    }

    if (document_type !== undefined) {
      if (!Object.values(DocumentType).includes(document_type)) {
        return res.status(400).json({
          message: `Invalid document_type. Must be one of: ${Object.values(DocumentType).join(", ")}`,
        });
      }
      document.document_type = document_type;
    }

    if (description !== undefined) {
      document.description = description;
    }

    if (emission_id !== undefined) {
      if (emission_id === null) {
        document.emission = null as any;
      } else {
        const emission = await emissionRepo.findOne({
          where: { pk_id: parseInt(emission_id) },
        });

        if (!emission) {
          return res.status(404).json({
            message: "Emission not found",
          });
        }
        document.emission = { pk_id: parseInt(emission_id) } as any;
      }
    }

    await documentRepo.save(document);

    const updatedDocument = await documentRepo.findOne({
      where: { document_id: document.document_id },
      relations: ["emission", "uploaded_by"],
    });

    return res.status(200).json({
      message: "Document updated successfully",
      document: updatedDocument,
    });
  } catch (error) {
    console.error("Update document error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Delete document
export const deleteDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;

    const document = await documentRepo.findOne({
      where: { document_id: parseInt(id) },
    });

    if (!document) {
      return res.status(404).json({
        message: "Document not found",
      });
    }

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(document.cloudinary_public_id, {
        resource_type: "raw",
      });
    } catch (cloudinaryError) {
      console.error("Cloudinary delete error:", cloudinaryError);
      // Continue with database deletion even if Cloudinary delete fails
    }

    await documentRepo.delete({ document_id: parseInt(id) });

    return res.status(200).json({
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("Delete document error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk delete documents
export const bulkDeleteDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    // Find all documents to get their Cloudinary public IDs
    const documents = await documentRepo.find({
      where: ids.map((id: number) => ({ document_id: id })),
    });

    // Delete from Cloudinary
    for (const doc of documents) {
      try {
        await cloudinary.uploader.destroy(doc.cloudinary_public_id, {
          resource_type: "raw",
        });
      } catch (cloudinaryError) {
        console.error("Cloudinary delete error:", cloudinaryError);
      }
    }

    const result = await documentRepo.delete(ids);

    return res.status(200).json({
      message: `Successfully deleted ${result.affected} document(s)`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Bulk delete documents error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
