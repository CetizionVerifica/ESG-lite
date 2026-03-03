import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { AllDataEntry, EntryStatus } from "../entities/AllDataEntry";
import { Site } from "../entities/Site";
import { MasterData } from "../entities/MasterData";
import { User } from "../entities/User";
import { MasterDataService } from "../services/masterData.service";
import * as xlsx from "xlsx";

const repo = AppDataSource.getRepository(AllDataEntry);

export const createEntry = async (req: Request, res: Response) => {
    try {
        const { site_id, master_data_id, value, text_value, unit, reporting_date, notes, status } = req.body;
        // @ts-ignore
        const { userId, role } = req.user;

        // Ensure user can only create Draft or Ready for Review
        let initialStatus = status || EntryStatus.DRAFT;
        if (role === 'User' && ![EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW].includes(initialStatus)) {
            return res.status(403).json({ message: "Users can only create entries as Draft or Ready for Review." });
        }

        if (!site_id || !master_data_id || (value === undefined && text_value === undefined) || !reporting_date) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // Check for duplicate for the same month and year
        const checkDate = new Date(reporting_date);
        const month = checkDate.getMonth() + 1;
        const year = checkDate.getFullYear();

        const existing = await repo.createQueryBuilder("entry")
            .leftJoin("entry.site", "site")
            .leftJoin("entry.masterData", "masterData")
            .where("site.site_id = :site_id", { site_id })
            .andWhere("masterData.id = :master_data_id", { master_data_id })
            .andWhere("EXTRACT(MONTH FROM entry.reporting_date) = :month", { month })
            .andWhere("EXTRACT(YEAR FROM entry.reporting_date) = :year", { year })
            .getOne();

        if (existing) {
            return res.status(409).json({ message: "Entry already exists for this KPI on the selected month and year." });
        }

        const entry = repo.create({
            site: { site_id },
            masterData: { id: master_data_id },
            value: value !== undefined ? value : null,
            text_value: text_value !== undefined ? text_value : null,
            unit: unit || "NA",
            reporting_date,
            notes,
            status: initialStatus,
            created_by: { user_id: userId } as User
        });

        await repo.save(entry);
        return res.status(201).json(entry);
    } catch (error) {
        console.error("Create Entry error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getEntries = async (req: Request, res: Response) => {
    try {
        const { site_id, month, year, status, category_id, subcategory_id } = req.query;

        const query = repo.createQueryBuilder("entry")
            .leftJoinAndSelect("entry.site", "site")
            .leftJoinAndSelect("entry.masterData", "masterData")
            .leftJoinAndSelect("masterData.parent", "dataHeader")
            .leftJoinAndSelect("dataHeader.parent", "subHeader")
            .leftJoinAndSelect("subHeader.parent", "subcategory")
            .leftJoinAndSelect("subcategory.parent", "category")
            .leftJoinAndSelect("entry.created_by", "creator")
            .leftJoinAndSelect("entry.reviewed_by", "reviewer")
            .orderBy("entry.reporting_date", "DESC");

        if (site_id) {
            query.andWhere("entry.site.site_id = :site_id", { site_id });
        }

        if (status) {
            query.andWhere("entry.status = :status", { status });
        }

        if (year) {
            query.andWhere("EXTRACT(YEAR FROM entry.reporting_date) = :year", { year });
        }

        if (month) {
            query.andWhere("EXTRACT(MONTH FROM entry.reporting_date) = :month", { month });
        }

        if (category_id) {
            query.andWhere("category.id = :category_id", { category_id });
        }

        if (subcategory_id) {
            query.andWhere("subcategory.id = :subcategory_id", { subcategory_id });
        }

        const entries = await query.getMany();
        return res.json(entries);
    } catch (error) {
        console.error("Get Entries error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const updateEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { value, text_value, unit, notes, status, evidence_path } = req.body;
        // @ts-ignore
        const { userId, role } = req.user;

        const entry = await repo.findOne({ where: { id: parseInt(id as string) } });
        if (!entry) return res.status(404).json({ message: "Entry not found" });

        // Global lock: Verified data cannot be edited by anyone
        if (entry.status === EntryStatus.VERIFIED) {
            return res.status(403).json({ message: "Data is locked. Verified entries cannot be edited." });
        }

        // Permission Logic for Editing
        if (role === 'User') {
            if (entry.status !== EntryStatus.DRAFT && entry.status !== EntryStatus.REJECTED && entry.status !== EntryStatus.READY_FOR_REVIEW) {
                return res.status(403).json({ message: "Users can only edit Draft or Rejected entries." });
            }
        } else if (role === 'Manager') {
            // Manager can edit anything except Verified
        } else if (role === 'Admin' || role === 'Superadmin') {
            // Admin can edit anything except Verified
        }

        if (value !== undefined) entry.value = value;
        if (text_value !== undefined) entry.text_value = text_value;
        if (unit) entry.unit = unit;
        if (notes !== undefined) entry.notes = notes;
        if (evidence_path !== undefined) entry.evidence_path = evidence_path;

        if (status) {
            if (role === 'User') {
                if ([EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW].includes(status)) {
                    entry.status = status;
                } else {
                    return res.status(403).json({ message: "Users can only set status to Draft or Ready for Review." });
                }
            } else if (role === 'Manager') {
                if ([EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW, EntryStatus.SUBMITTED, EntryStatus.VERIFIED, EntryStatus.REJECTED].includes(status)) {
                    entry.status = status;
                } else {
                    return res.status(400).json({ message: "Invalid status for Manager." });
                }
            } else if (role === 'Admin' || role === 'Superadmin') {
                if ([EntryStatus.DRAFT, EntryStatus.SUBMITTED, EntryStatus.READY_FOR_REVIEW, EntryStatus.VERIFIED, EntryStatus.REJECTED].includes(status)) {
                    entry.status = status;
                } else {
                    return res.status(400).json({ message: "Invalid status for Admin/Superadmin." });
                }
            }
        }

        await repo.save(entry);
        return res.json(entry);
    } catch (error) {
        console.error("Update Entry error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const deleteEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // @ts-ignore
        const { role } = req.user;

        const entry = await repo.findOne({ where: { id: parseInt(id as string) } });
        if (!entry) return res.status(404).json({ message: "Entry not found" });

        // Permission Check
        if (entry.status === EntryStatus.VERIFIED) {
            return res.status(403).json({ message: "Data is locked. Verified entries cannot be deleted." });
        }

        if (role === 'User' && entry.status !== EntryStatus.DRAFT && entry.status !== EntryStatus.REJECTED) {
            return res.status(403).json({ message: "Users can only delete Draft or Rejected entries." });
        }
        // Managers/Admins can delete any non-verified entry

        await repo.remove(entry); // Permanent delete
        return res.json({ message: "Deleted successfully" });
    } catch (error) {
        console.error("Delete Entry error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const reviewEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, review_comment } = req.body;
        // @ts-ignore
        const { userId, role } = req.user;

        const entry = await repo.findOne({ where: { id: parseInt(id as string) } });
        if (!entry) return res.status(404).json({ message: "Entry not found" });

        // Role-based Approval Logic
        if (role === 'Manager') {
            // Manager can Verify or Reject entries that are Ready for Review or Submitted
            if (entry.status !== EntryStatus.READY_FOR_REVIEW && entry.status !== EntryStatus.SUBMITTED) {
                return res.status(400).json({ message: "Manager can only review entries that are Ready for Review or Submitted." });
            }

            if (status === EntryStatus.VERIFIED) {
                entry.status = EntryStatus.VERIFIED;
            } else if (status === EntryStatus.REJECTED) {
                entry.status = EntryStatus.REJECTED;
            } else if (status === EntryStatus.SUBMITTED) {
                // Allow Manager to mark Ready -> Submitted (Approve for next level if granular, or just standard flow)
                entry.status = EntryStatus.SUBMITTED;
            } else {
                return res.status(400).json({ message: "Invalid status for Manager review. Options: Verified, Rejected, Submitted." });
            }
        }
        else if (role === 'Admin' || role === 'Superadmin') {
            // Admin can Verify/Reject/Submit
            if (status === EntryStatus.VERIFIED) {
                entry.status = EntryStatus.VERIFIED;
            } else if (status === EntryStatus.REJECTED) {
                entry.status = EntryStatus.REJECTED;
            } else if (status === EntryStatus.SUBMITTED) {
                entry.status = EntryStatus.SUBMITTED;
            } else {
                // Allow Reverting? For now let's stick to forward flow or reject
                // return res.status(400).json({ message: "Invalid status for Admin review." });
                // Let's allow admins to set whatever status they pass if valid enum
                if (Object.values(EntryStatus).includes(status as EntryStatus)) {
                    entry.status = status as EntryStatus;
                } else {
                    return res.status(400).json({ message: "Invalid status." });
                }
            }
        } else {
            return res.status(403).json({ message: "Access denied" });
        }

        entry.review_comment = review_comment;
        entry.reviewed_by = { user_id: userId } as User;
        entry.reviewed_at = new Date();

        await repo.save(entry);
        return res.json(entry);
    } catch (error) {
        console.error("Review Entry error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const bulkUpdateStatus = async (req: Request, res: Response) => {
    try {
        const { ids, status, review_comment } = req.body;
        // @ts-ignore
        const { userId, role } = req.user;

        if (!ids || !Array.isArray(ids) || ids.length === 0 || !status) {
            return res.status(400).json({ message: "Missing required fields: ids and status" });
        }

        const entries = await repo.createQueryBuilder("entry")
            .where("entry.id IN (:...ids)", { ids })
            .getMany();

        if (entries.length === 0) {
            return res.status(404).json({ message: "No entries found" });
        }

        const updatedEntries = [];
        const errors = [];

        for (const entry of entries) {
            if (entry.status === EntryStatus.VERIFIED) {
                errors.push(`Entry ${entry.id} is locked.`);
                continue;
            }

            if (role === 'User') {
                if (entry.status !== EntryStatus.DRAFT && entry.status !== EntryStatus.REJECTED) {
                    errors.push(`Entry ${entry.id} cannot be submitted by User as it's not Draft or Rejected.`);
                    continue;
                }
                if (![EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW].includes(status)) {
                    errors.push(`Invalid status ${status} for User.`);
                    continue;
                }
            } else if (role === 'Manager') {
                if (![EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW, EntryStatus.SUBMITTED, EntryStatus.VERIFIED, EntryStatus.REJECTED].includes(status)) {
                    errors.push(`Invalid status ${status} for Manager.`);
                    continue;
                }
            } else if (role === 'Admin' || role === 'Superadmin') {
                if (![EntryStatus.DRAFT, EntryStatus.READY_FOR_REVIEW, EntryStatus.SUBMITTED, EntryStatus.SUBMITTED, EntryStatus.VERIFIED, EntryStatus.REJECTED].includes(status)) {
                    errors.push(`Invalid status ${status} for Admin/Superadmin.`);
                    continue;
                }
            }

            entry.status = status;
            if (review_comment) {
                entry.review_comment = review_comment;
                entry.reviewed_by = { user_id: userId } as User;
                entry.reviewed_at = new Date();
            }
            updatedEntries.push(entry);
        }

        if (updatedEntries.length > 0) {
            await repo.save(updatedEntries);
        }

        return res.json({
            message: "Bulk update completed",
            updatedCount: updatedEntries.length,
            errors
        });
    } catch (error) {
        console.error("Bulk Update Status error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const parseBulkExcel = async (req: Request, res: Response) => {
    try {
        let { site_id, month, year, category_id, subcategory_id } = req.body;
        // @ts-ignore
        const { userId } = req.user;

        if (!site_id) {
            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOne({ where: { user_id: userId }, relations: ["site"] });
            if (user && user.site) {
                site_id = user.site.site_id;
            } else {
                return res.status(400).json({ message: "Missing required field: site_id" });
            }
        }

        if (!req.file) {
            return res.status(400).json({ message: "No Excel file uploaded" });
        }

        // Parse the Excel file
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Get 2D array of the sheet
        const dataMatrix: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        // Fetch active KPIs assigned to the site
        const allAssignedData = await MasterDataService.getAssignedSiteMasterData(Number(site_id));
        let activeKpis = allAssignedData.filter((md: any) => md.type === "KPI Field" && md.is_active);

        if (category_id) {
            const catId = Number(category_id);
            activeKpis = activeKpis.filter((node: any) =>
                node.id === catId ||
                node.parent?.id === catId ||
                node.parent?.parent?.id === catId ||
                node.parent?.parent?.parent?.id === catId ||
                node.parent?.parent?.parent?.parent?.id === catId
            );
        }

        if (subcategory_id) {
            const subId = Number(subcategory_id);
            activeKpis = activeKpis.filter((node: any) =>
                node.id === subId ||
                node.parent?.id === subId ||
                node.parent?.parent?.id === subId ||
                node.parent?.parent?.parent?.id === subId ||
                node.parent?.parent?.parent?.parent?.id === subId
            );
        }

        let parsedEntries: any[] = [];
        let errors: string[] = [];
        let processedSet = new Set<string>();

        // Try to identify column indices from the first few rows
        let headerRowIndex = -1;
        let colCode = -1, colTitle = -1, colValue = -1, colUnit = -1, colMonth = -1, colYear = -1;
        let colNotes = -1, colEvidencePath = -1;

        for (let r = 0; r < Math.min(10, dataMatrix.length); r++) {
            const row = dataMatrix[r];
            if (!row) continue;
            const mappedRow = row.map(c => String(c).toLowerCase().trim());

            if (mappedRow.includes("value") || mappedRow.includes("kpi code")) {
                headerRowIndex = r;
                colCode = mappedRow.findIndex(c => c.includes("code"));
                colTitle = mappedRow.findIndex(c => c.includes("title"));
                colValue = mappedRow.findIndex(c => c === "value" || c.includes("value"));
                colUnit = mappedRow.findIndex(c => c === "unit" || c.includes("unit"));
                colMonth = mappedRow.findIndex(c => c === "month" || c.includes("month"));
                colYear = mappedRow.findIndex(c => c === "year" || c.includes("year"));
                colNotes = mappedRow.findIndex(c => c === "notes" || c.includes("notes"));
                colEvidencePath = mappedRow.findIndex(c => c === "evidence path" || c.includes("evidence") || c.includes("path"));
                break;
            }
        }

        for (const kpi of activeKpis) {
            let foundAnyValue = false;

            // Search row by row starting after header
            let startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;

            for (let r = startRow; r < dataMatrix.length; r++) {
                const row = dataMatrix[r];
                if (!row) continue;

                // Did we find this KPI in this row?
                let matchFound = false;
                if (colCode !== -1 && row[colCode]) {
                    if (String(row[colCode]).trim().toLowerCase() === kpi.code.toLowerCase()) matchFound = true;
                }
                if (!matchFound && colTitle !== -1 && row[colTitle]) {
                    if (String(row[colTitle]).trim().toLowerCase() === kpi.title.toLowerCase()) matchFound = true;
                }
                // Fallback: search whole row if headers not explicitly identified
                if (!matchFound && headerRowIndex === -1) {
                    matchFound = row.some(cell => typeof cell === 'string' && (cell.trim().toLowerCase() === kpi.title.toLowerCase() || cell.trim().toLowerCase() === kpi.code.toLowerCase()));
                }

                if (matchFound) {
                    let foundValue: number | null = null;
                    let foundTextValue: string | null = null;
                    let foundUnit = (kpi as any).assigned_unit || "NA";
                    let foundMonth = Number(month) || null;
                    let foundYear = Number(year) || null;
                    let foundNotes: string | null = null;
                    let foundEvidencePath: string | null = null;

                    if ((kpi as any).response_type === 'Text') {
                        if (colValue !== -1 && row[colValue] !== undefined && row[colValue] !== '') {
                            foundTextValue = String(row[colValue]);
                            foundAnyValue = true;
                        } else if (headerRowIndex === -1) {
                            for (let c = 0; c < row.length; c++) {
                                if (row[c] !== '' && isNaN(Number(row[c]))) {
                                    foundTextValue = String(row[c]);
                                    foundAnyValue = true;
                                    break;
                                }
                            }
                        }
                    } else {
                        if (colValue !== -1 && row[colValue] !== undefined && row[colValue] !== '') {
                            const val = parseFloat(row[colValue]);
                            if (!isNaN(val)) foundValue = val;
                        } else if (headerRowIndex === -1) {
                            for (let c = 0; c < row.length; c++) {
                                const val = parseFloat(row[c]);
                                if (!isNaN(val) && row[c] !== '') {
                                    foundValue = val;
                                    break;
                                }
                            }
                        }
                        if (foundValue !== null) foundAnyValue = true;
                    }

                    if (colUnit !== -1 && row[colUnit]) foundUnit = String(row[colUnit]);
                    if (colMonth !== -1 && row[colMonth]) foundMonth = Number(row[colMonth]);
                    if (colYear !== -1 && row[colYear]) foundYear = Number(row[colYear]);
                    if (colNotes !== -1 && row[colNotes]) foundNotes = String(row[colNotes]);
                    if (colEvidencePath !== -1 && row[colEvidencePath]) foundEvidencePath = String(row[colEvidencePath]);

                    if (foundAnyValue) {
                        if (!foundMonth || !foundYear || isNaN(foundMonth) || isNaN(foundYear)) {
                            // Don't spam errors for every empty row
                        } else {
                            const uniqueKey = `${kpi.id}-${foundMonth}-${foundYear}`;
                            if (!processedSet.has(uniqueKey)) {
                                processedSet.add(uniqueKey);
                                parsedEntries.push({
                                    kpi_id: kpi.id,
                                    kpi_code: kpi.code,
                                    kpi_title: kpi.title,
                                    value: foundValue,
                                    text_value: foundTextValue,
                                    unit: foundUnit,
                                    month: foundMonth,
                                    year: foundYear,
                                    notes: foundNotes,
                                    evidence_path: foundEvidencePath
                                });
                            }
                        }
                    }
                }
            }
        }

        return res.json({
            message: "Excel parsing completed",
            parsedEntries,
            errors
        });

    } catch (error) {
        console.error("Parse Bulk Excel error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const storeBulkExcel = async (req: Request, res: Response) => {
    try {
        let { site_id, entries, status } = req.body;
        // @ts-ignore
        const { userId } = req.user;

        if (!site_id) {
            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOne({ where: { user_id: userId }, relations: ["site"] });
            if (user && user.site) {
                site_id = user.site.site_id;
            }
        }

        if (!site_id || !entries || !Array.isArray(entries)) {
            return res.status(400).json({ message: "Missing required fields: site_id, entries" });
        }

        let createdCount = 0;
        let skippedCount = 0;
        let errors: string[] = [];

        for (const entry of entries) {
            const reportingDate = new Date(`${entry.year}-${entry.month}-01`);

            // Check for valid date
            if (isNaN(reportingDate.getTime())) {
                skippedCount++;
                errors.push(`KPI ${entry.kpi_code} skipped: Invalid date format.`);
                continue;
            }

            // Check duplicate
            const existing = await repo.createQueryBuilder("e")
                .leftJoin("e.site", "site")
                .leftJoin("e.masterData", "masterData")
                .where("site.site_id = :site_id", { site_id })
                .andWhere("masterData.id = :master_data_id", { master_data_id: entry.kpi_id })
                .andWhere("EXTRACT(MONTH FROM e.reporting_date) = :month", { month: entry.month })
                .andWhere("EXTRACT(YEAR FROM e.reporting_date) = :year", { year: entry.year })
                .getOne();

            if (!existing) {
                const newEntry = repo.create({
                    site: { site_id: Number(site_id) },
                    masterData: { id: entry.kpi_id },
                    value: entry.value !== undefined ? entry.value : null,
                    text_value: entry.text_value !== undefined ? entry.text_value : null,
                    unit: entry.unit || "NA",
                    reporting_date: reportingDate,
                    notes: entry.notes || "Bulk Uploaded via Excel Preview",
                    evidence_path: entry.evidence_path || null,
                    status: status || EntryStatus.DRAFT,
                    created_by: { user_id: userId } as User
                });
                await repo.save(newEntry);
                createdCount++;
            } else {
                skippedCount++;
                errors.push(`KPI ${entry.kpi_code} skipped: Entry already exists for ${entry.month}/${entry.year}`);
            }
        }

        return res.json({
            message: "Bulk store completed",
            createdCount,
            skippedCount,
            errors
        });

    } catch (error) {
        console.error("Store Bulk Excel error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const downloadDemoExcel = async (req: Request, res: Response) => {
    try {
        const { site_id, category_id, subcategory_id, month, year } = req.query;

        if (!site_id) {
            return res.status(400).json({ message: "site_id query parameter is required" });
        }

        // Fetch active KPIs assigned to the site
        const allAssignedData = await MasterDataService.getAssignedSiteMasterData(Number(site_id));
        let activeKpis = allAssignedData.filter((md: any) => md.type === "KPI Field" && md.is_active);

        if (category_id && category_id !== 'null') {
            const catId = Number(category_id);
            activeKpis = activeKpis.filter((node: any) =>
                node.id === catId ||
                node.parent?.id === catId ||
                node.parent?.parent?.id === catId ||
                node.parent?.parent?.parent?.id === catId ||
                node.parent?.parent?.parent?.parent?.id === catId
            );
        }

        if (subcategory_id && subcategory_id !== 'null') {
            const subId = Number(subcategory_id);
            activeKpis = activeKpis.filter((node: any) =>
                node.id === subId ||
                node.parent?.id === subId ||
                node.parent?.parent?.id === subId ||
                node.parent?.parent?.parent?.id === subId ||
                node.parent?.parent?.parent?.parent?.id === subId
            );
        }

        // Create Excel data matrix
        const dataMatrix: any[][] = [];

        // Headers
        dataMatrix.push(["KPI Code", "KPI Title", "Input Type", "Value", "Unit", "Month", "Year", "Notes", "Evidence Path", "Category (Reference only)"]);

        const targetYear = year ? String(year) : "";

        if (month === 'all') {
            // Generate 12 months grouped by month first
            for (let m = 1; m <= 12; m++) {
                activeKpis.forEach((kpi: any) => {
                    let categoryName = "NA";
                    let curr = kpi.parent;
                    while (curr) {
                        if (curr.type === "Category") {
                            categoryName = curr.title;
                            break;
                        }
                        curr = curr.parent;
                    }
                    dataMatrix.push([
                        kpi.code,
                        kpi.title,
                        kpi.response_type || "Numeric", // Input Type
                        "", // Value
                        kpi.assigned_unit || "NA",
                        m, // Month
                        targetYear, // Year
                        "", // Notes
                        "", // Evidence Path
                        categoryName
                    ]);
                });
            }
        } else {
            // Single month specified
            activeKpis.forEach((kpi: any) => {
                let categoryName = "NA";
                let curr = kpi.parent;
                while (curr) {
                    if (curr.type === "Category") {
                        categoryName = curr.title;
                        break;
                    }
                    curr = curr.parent;
                }
                dataMatrix.push([
                    kpi.code,
                    kpi.title,
                    kpi.response_type || "Numeric", // Input Type
                    "", // Value
                    kpi.assigned_unit || "NA",
                    month ? String(month) : "", // Month
                    targetYear, // Year
                    "", // Notes
                    "", // Evidence Path
                    categoryName
                ]);
            });
        }



        const worksheet = xlsx.utils.aoa_to_sheet(dataMatrix);

        // Auto-size columns roughly
        const wscols = [
            { wch: 20 }, // KPI Code
            { wch: 50 }, // KPI Title
            { wch: 15 }, // Input Type
            { wch: 15 }, // Value
            { wch: 15 }, // Unit
            { wch: 15 }, // Month
            { wch: 15 }, // Year
            { wch: 30 }, // Notes
            { wch: 30 }, // Evidence Path
            { wch: 30 }  // Category
        ];
        worksheet['!cols'] = wscols;

        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Data Entry Template");

        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="ESG_Data_Upload_Template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        return res.send(excelBuffer);

    } catch (error) {
        console.error("Download Demo Excel error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
