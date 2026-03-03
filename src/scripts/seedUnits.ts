import { AppDataSource } from "../config/data-source";
import { UnitMaster } from "../entities/UnitMaster";

const seedUnits = async () => {
    try {
        await AppDataSource.initialize();
        console.log("Database connected for seeding units...");

        const repo = AppDataSource.getRepository(UnitMaster);

        const units = [
            { name: "Kilogram", shortName: "kg" },
            { name: "Liter", shortName: "Ltr" },
            { name: "Metric Ton", shortName: "MT" },
            { name: "Kilowatt Hour", shortName: "kWh" },
            { name: "Megawatt Hour", shortName: "MWh" },
            { name: "Gigajoule", shortName: "GJ" },
            { name: "Cubic Meter", shortName: "m3" },
            { name: "Number", shortName: "Nr" },
        ];

        for (const u of units) {
            const existing = await repo.findOne({ where: [{ name: u.name }, { shortName: u.shortName }] });
            if (!existing) {
                await repo.save(repo.create(u));
                console.log(`Created unit: ${u.name} (${u.shortName})`);
            } else {
                console.log(`Unit already exists: ${u.name} (${u.shortName})`);
            }
        }

        console.log("Unit seeding completed.");
        process.exit(0);
    } catch (error) {
        console.error("Error seeding units:", error);
        process.exit(1);
    }
};

seedUnits();
