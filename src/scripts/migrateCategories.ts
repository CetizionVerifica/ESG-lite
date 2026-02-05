
import { Client } from 'pg';
import { AppDataSource } from '../config/data-source';
import { Category } from '../entities/Category';
import { ILike } from 'typeorm';
import * as dotenv from 'dotenv';
import { Site } from '../entities/Site';

dotenv.config();

/**
 * Mappings based on standard ESG scopes and screenshot data:
 * A1, A -> Scope 1 (Direct Emissions)
 * B1 -> Scope 2 (Indirect Energy Emissions)
 * C1 -> Scope 3 (Other Indirect Emissions)
 */
function mapGroupToScope(group: string): string {
    const g = group.toUpperCase().trim();
    if (g === 'A1' || g === 'A' || g.startsWith('SCOP-1')) return 'Scope 1';
    if (g === 'B1' || g === 'B' || g.startsWith('SCOP-2')) return 'Scope 2';
    if (g === 'C1' || g === 'C' || g === 'C2' || g.startsWith('SCOP-3')) return 'Scope 3';

    // 305-Series Mappings based on user request & dump
    if (g === 'J') return '305-4'; // Intensity
    if (g === 'E' || g.startsWith('REDUCTION')) return '305-5'; // Reductions
    if (g === 'F1' || g === 'F') return '305-6'; // ODS
    if (g === 'G') return '305-7'; // NOx/SOx

    return 'Other';
}

async function migrateCategories() {
    console.log('🚀 Starting Category (KPI) Migration...');

    // 1. Connect to ESG-lite (Target)
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }
    console.log('✅ Connected to ESG-lite DB');

    // 2. Connect to ESG-Mitra (Source)
    const oldClient = new Client({
        host: process.env.OLD_DB_HOST || '13.202.10.42',
        port: parseInt(process.env.OLD_DB_PORT || '5432'),
        user: process.env.OLD_DB_USER || 'postgres',
        password: process.env.OLD_DB_PASSWORD || 'toor',
        database: process.env.OLD_DB_NAME || 'root_db',
        ssl: false
    });

    try {
        await oldClient.connect();
        console.log('✅ Connected to ESG-Mitra DB');

        const categoryRepo = AppDataSource.getRepository(Category);

        // Query based on the screenshot provided by the user
        // cat_id = 2 AND sub_cat_id = 6 seems to correspond to Emission KPIs
        const query = `
            SELECT id, name, "group"
            FROM public.fields_master
            WHERE cat_id = 2 
            AND sub_cat_id = 6
            AND is_delete = false 
            AND status = true
            ORDER BY id ASC;
        `;

        const res = await oldClient.query(query);
        console.log(`📦 Found ${res.rows.length} KPI Categories to migrate.`);

        let newCount = 0;
        let updateCount = 0;

        for (const row of res.rows) {
            const oldName = row.name.trim();
            const oldGroup = row.group ? row.group.trim().toUpperCase() : '';

            // Skip summary/header groups based on analysis
            if (['D', 'H', 'I'].includes(oldGroup)) {
                console.log(`   - Skipped (Summary/Header): ${oldName} [Group ${oldGroup}]`);
                continue;
            }

            const scope = mapGroupToScope(oldGroup);

            // Check if exists by name (Case Insensitive to prevent duplicates)
            let category = await categoryRepo.findOne({
                where: { category_name: ILike(oldName) }
            });

            if (category) {
                console.log(`   - Skipped (Duplicate Found): ${oldName}`);
                if (category.scope !== scope) {
                    category.scope = scope;
                    await categoryRepo.save(category);
                    console.log(`     ~ Scope updated to ${scope}`);
                }
                continue;
            }

            if (!category) {
                category = new Category();
                category.category_name = oldName;
                category.scope = scope;
                await categoryRepo.save(category);
                console.log(`   + Created: [${scope}] ${oldName}`);
                newCount++;
            }
        }

        // --- Explicit Creation of 305-Series Categories ---
        console.log('\n✨ Ensuring 305-Series Categories exist...');
        const extraCategories = [
            { name: "GHG Emission Intensity", scope: "305-4" },
            { name: "Reductions of GHG Emissions", scope: "305-5" },
            { name: "Emissions of Ozone depleting substances", scope: "305-6" },
            { name: "Nitrogen oxides (NOx), sulphur oxides (SOx), and other significant air emissions", scope: "305-7" },
            { name: "Renewable Electricity", scope: "Scope 2" }
        ];

        for (const extra of extraCategories) {
            let cat = await categoryRepo.findOne({ where: { category_name: extra.name } });
            if (!cat) {
                cat = new Category();
                cat.category_name = extra.name;
                cat.scope = extra.scope;
                await categoryRepo.save(cat);
                console.log(`   + Created 305-Category: ${extra.name}`);
                newCount++;
            } else {
                console.log(`   - Skipped 305-Category (Exists): ${extra.name}`);
            }
        }

        console.log(`\n🎉 Migration Summary:`);
        console.log(`   Expected (DB + Extras): ${res.rows.length + extraCategories.length}`);
        console.log(`   Created: ${newCount}`);
        console.log(`   Updated: ${updateCount}`);
        console.log(`   Skipped: ${res.rows.length + extraCategories.length - newCount - updateCount}`);

    } catch (err) {
        console.error('❌ Error during migration:', err);
    } finally {
        await oldClient.end();
        if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
}

migrateCategories().catch(console.error);
