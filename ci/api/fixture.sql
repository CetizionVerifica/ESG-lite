-- Fixed data for the API tests (ci/api/run.cjs). Loaded into the throwaway CI
-- database only; it first empties every table so reruns start clean.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
  END LOOP;
END $$;

INSERT INTO company (company_id, name, address, contact_person) VALUES
  (1, 'CI Steel Co', '1 Test Road', 'CI'),
  (2, 'CI Other Co', '2 Test Road', 'CI');
INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES
  (1, 'CI Plant A', 'Plot 1', 'CI', 1),
  (2, 'CI Plant B', 'Plot 2', 'CI', 1),
  (3, 'CI Other Plant', 'Plot 3', 'CI', 2);
INSERT INTO category (category_id, category_name, scope) VALUES
  (1, 'Stationary Combustion', 'Scope 1'),
  (2, 'Purchased Electricity', 'Scope 2'),
  (3, 'Business Travel', 'Scope 3'),
  (4, 'Renewable Electricity', NULL),
  (5, 'FERA', 'Scope 3');
INSERT INTO site_categories (site_id, category_id) VALUES
  (1, 1), (1, 2), (1, 3), (1, 4), (1, 5),
  (2, 1), (2, 2),
  (3, 1);
INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES
  (1, 'CI User', 'ci-user@example.invalid', 'x', 'User', 1),
  (2, 'CI Manager', 'ci-manager@example.invalid', 'x', 'Manager', NULL),
  (3, 'CI Admin', 'ci-admin@example.invalid', 'x', 'Admin', 1),
  (4, 'CI Other User', 'ci-other-user@example.invalid', 'x', 'User', 3),
  (5, 'CI Superadmin', 'ci-superadmin@example.invalid', 'x', 'Superadmin', NULL),
  (6, 'CI Other Manager', 'ci-other-manager@example.invalid', 'x', 'Manager', NULL),
  (7, 'CI Multi User', 'ci-multi@example.invalid', 'x', 'User', NULL);
INSERT INTO user_sites (user_id, site_id) VALUES (2, 1), (2, 2), (6, 3), (7, 1), (7, 2);
INSERT INTO user_categories (user_id, category_id) VALUES (7, 1), (7, 2);

INSERT INTO brand (company_id, name, "primary", accent, cover_from, cover_to, logo_url, logo_public_id) VALUES
  (1, 'CI Steel', '#123456', '#abcdef', '#000000', '#111111',
   'https://assets.example.invalid/brand-assets/company_1.png', 'brand-assets/company_1.png');

SELECT setval(pg_get_serial_sequence('company', 'company_id'), 100);
SELECT setval(pg_get_serial_sequence('site', 'site_id'), 100);
SELECT setval(pg_get_serial_sequence('category', 'category_id'), 100);
SELECT setval(pg_get_serial_sequence('"user"', 'user_id'), 100);

-- Emissions used by the B4–B8 tests. Totals are in tCO2e.
--   2025-09: site 1 has one category per status, site 2 is partly filed,
--            site 2 / Purchased Electricity is covered by an FY 2025-26 batch.
--   2024:    a small year for the overview comparisons.
--   site 3 belongs to company 2 and must never show up for company 1 users.
INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, review_comment,
                      reviewed_by, created_by, category_id, site_id, reporting_period, year_type, fera_linked_id, created_at) VALUES
  (1,  '{"activity_value": 1600, "Fuel": "Diesel"}',   4.29,  'tCO2e', '2025-09-30', 'approved', NULL,        2, 1, 1, 1, 'monthly', NULL, NULL, '2025-10-02 09:00'),
  (2,  '{"activity_value": 441242, "Meter": "Main"}',  312.4, 'tCO2e', '2025-09-30', 'pending',  NULL,     NULL, 1, 2, 1, 'monthly', NULL, NULL, '2025-10-03 09:00'),
  (3,  '{"activity_value": 10, "Trip": "Mumbai"}',     1.0,   'tCO2e', '2025-09-15', 'approved', NULL,        2, 1, 3, 1, 'monthly', NULL, NULL, '2025-10-04 09:00'),
  (4,  '{"activity_value": 20, "Trip": "Delhi"}',      2.0,   'tCO2e', '2025-09-20', 'rejected', 'Wrong unit, should be km', 2, 1, 3, 1, 'monthly', NULL, NULL, '2025-10-05 09:00'),
  (5,  '{"activity_value": 1}',                        0.5,   'tCO2e', '2025-09-30', 'pending',  NULL,     NULL, 1, 5, 1, 'monthly', NULL, 1,    '2025-10-02 09:05'),
  (6,  '{"activity_value": 120}',                      10.0,  'tCO2e', '2025-08-31', 'approved', NULL,        2, 7, 1, 2, 'monthly', NULL, NULL, '2025-09-05 09:00'),
  (7,  '{"activity_value": 170000}',                   120.0, 'tCO2e', '2026-03-31', 'approved', NULL,        2, 7, 2, 2, 'yearly',  'FY', NULL, '2025-06-01 09:00'),
  (8,  '{"activity_value": 9}',                        999.0, 'tCO2e', '2025-09-30', 'approved', NULL,        6, 4, 1, 3, 'monthly', NULL, NULL, '2025-10-02 09:00'),
  (9,  '{"activity_value": 18}',                       50.0,  'tCO2e', '2024-05-31', 'approved', NULL,        2, 1, 1, 1, 'monthly', NULL, NULL, '2024-06-02 09:00'),
  (10, '{"activity_value": 7000}',                     5.0,   'tCO2e', '2024-05-31', 'approved', NULL,        2, 1, 4, 1, 'monthly', NULL, NULL, '2024-06-02 09:00'),
  (11, '{"activity_value": 9900}',                     7.0,   'tCO2e', '2024-11-30', 'pending',  NULL,     NULL, 7, 2, 2, 'monthly', NULL, NULL, '2024-12-02 09:00'),
  (12, '{"activity_value": 1}',                        3.0,   'tCO2e', '2024-12-31', 'rejected', 'Duplicate', 2, 7, 1, 2, 'monthly', NULL, NULL, '2025-01-02 09:00'),
  (13, '{"activity_value": 30}',                       80.0,  'tCO2e', '2024-12-31', 'approved', NULL,        2, 1, 2, 1, 'yearly',  'CY', NULL, '2025-01-10 09:00'),
  (14, '{"activity_value": 4}',                        11.0,  'tCO2e', '2025-02-28', 'approved', NULL,        2, 1, 3, 1, 'monthly', NULL, NULL, '2025-03-02 09:00');
SELECT setval(pg_get_serial_sequence('emission', 'pk_id'), 100);

-- The AI service's invoice table (owned by python_AI_service, not an entity
-- here), with the columns its insert_invoice writes.
CREATE TABLE IF NOT EXISTS invoice (
  invoice_id serial PRIMARY KEY,
  file_name varchar NOT NULL,
  cloudinary_url varchar NOT NULL,
  cloudinary_public_id varchar NOT NULL,
  file_type varchar,
  file_size integer,
  uploaded_by integer,
  site_id integer,
  category_id integer,
  ocr_text jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
TRUNCATE invoice RESTART IDENTITY;
INSERT INTO invoice (invoice_id, file_name, cloudinary_url, cloudinary_public_id, file_type, file_size, uploaded_by, site_id, category_id) VALUES
  (1, 'sept-electricity.pdf', 'https://res.cloudinary.example.invalid/raw/upload/invoices/sept.pdf', 'invoices/sept', 'application/pdf', 52000, 1, 1, 2),
  (2, 'unknown-site.png', 'https://res.cloudinary.example.invalid/image/upload/invoices/x.png', 'invoices/x', 'image/png', 1200, 1, NULL, NULL);
