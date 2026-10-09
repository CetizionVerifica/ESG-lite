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
