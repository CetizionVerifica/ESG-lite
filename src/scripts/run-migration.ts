import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();

  try {
    await AppDataSource.query(`
      CREATE TABLE emission_threshold (
        threshold_id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        threshold_percentage DECIMAL(5,2) NOT NULL DEFAULT 5.00,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT uq_emission_threshold_company UNIQUE (company_id),
        CONSTRAINT fk_emission_threshold_company FOREIGN KEY (company_id)
          REFERENCES company (company_id) ON DELETE CASCADE
      );
    `);
    console.log("Table created successfully.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error("Error creating table:", err);
  process.exit(1);
});
