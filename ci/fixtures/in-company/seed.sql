-- IN-10 · the Insights fixture company (docs/insights/modules/IN-10-verification/CLAUDE.md).
-- Loaded by ci/api/tests/in-10-golden.test.cjs on top of ci/api/fixture.sql; ids 901+ / 90001+ so
-- nothing collides with the API fixture. Every expected figure in ci/golden/in/ is worked by hand
-- from the table below, never read back from the engine.
--
--   company 901 "IN Fixture Co" (Insights on, KPI off); company 902 "IN Other Co" (tenant isolation)
--   sites   901 Plant North (t), 902 Plant South (t), 903 Plant East (MWh: the other production unit);
--           904 Other Plant (company 902)
--   users   901 Admin (company 901), 902 Manager of 901 + 902, 903 User of 901, 904 Manager of 904
--   tCO2e, approved, one monthly row per scope dated 30 June, 2021–2025 (CY):
--     site 901  S1 1000 980 950 930 900   S2 600 540 480 420 360   S3 400 400 420 410 400
--     site 902  S1  500 490 480 470 460   S2 300 280 260 240 220
--     site 903  S1  200 200 210 220 230   S2 100 100 100 100 100
--   Scope 2 kWh = tCO2e × 1,250 (0.8 kg/kWh); renewable electricity (no scope, 0 t) on site 901:
--     0, 100,000, 200,000, 400,000, 600,000 kWh
--   pending: 50 t Scope 1 on site 901, July 2025
--   production (approved, whole years): 901 10000 10500 11000 11500 12000 t; 902 5000 t each year;
--     903 2000 2100 2200 2300 2400 MWh
--   base year 2021 (company_base_year, Scope 3) → SBTi near-term 2021 → 2030 at 4.2 %/yr
INSERT INTO company (company_id, name, address, contact_person, insights_enabled, kpi_tracking_enabled) VALUES
  (901, 'IN Fixture Co', '901 Test Road', 'CI', true, false),
  (902, 'IN Other Co', '902 Test Road', 'CI', true, false);
INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES
  (901, 'Plant North', 'N', 'CI', 901),
  (902, 'Plant South', 'S', 'CI', 901),
  (903, 'Plant East', 'E', 'CI', 901),
  (904, 'Other Plant', 'O', 'CI', 902);
INSERT INTO "user" (user_id, name, email, password, role, site_id, company_id) VALUES
  (901, 'IN Admin', 'in-admin@example.invalid', 'x', 'Admin', NULL, 901),
  (902, 'IN Manager', 'in-manager@example.invalid', 'x', 'Manager', NULL, NULL),
  (903, 'IN User', 'in-user@example.invalid', 'x', 'User', 901, NULL),
  (904, 'IN Other Manager', 'in-other-manager@example.invalid', 'x', 'Manager', NULL, NULL);
INSERT INTO user_sites (user_id, site_id) VALUES (902, 901), (902, 902), (904, 904);
INSERT INTO site_categories (site_id, category_id) VALUES
  (901, 1), (901, 2), (901, 3), (901, 4), (902, 1), (902, 2), (903, 1), (903, 2), (904, 1);
INSERT INTO product (product_id, name, unit, site_id) VALUES
  (90001, 'North steel', 't', 901), (90002, 'South steel', 't', 902), (90003, 'East power', 'MWh', 903);
INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, activity_data_unit, created_at) VALUES
  (90001, '{"activity_value": 10000}', 1000, 'tCO2e', '2021-06-30', 'approved', 901, 1, 901, 'monthly', NULL, '2021-06-30 12:00'),
  (90002, '{"activity_value": 750000}', 600, 'tCO2e', '2021-06-30', 'approved', 901, 2, 901, 'monthly', 'kWh', '2021-06-30 12:00'),
  (90003, '{"activity_value": 1}', 400, 'tCO2e', '2021-06-30', 'approved', 901, 3, 901, 'monthly', NULL, '2021-06-30 12:00'),
  (90004, '{"activity_value": 9800}', 980, 'tCO2e', '2022-06-30', 'approved', 901, 1, 901, 'monthly', NULL, '2022-06-30 12:00'),
  (90005, '{"activity_value": 675000}', 540, 'tCO2e', '2022-06-30', 'approved', 901, 2, 901, 'monthly', 'kWh', '2022-06-30 12:00'),
  (90006, '{"activity_value": 1}', 400, 'tCO2e', '2022-06-30', 'approved', 901, 3, 901, 'monthly', NULL, '2022-06-30 12:00'),
  (90007, '{"activity_value": 100000}', 0, 'tCO2e', '2022-06-30', 'approved', 901, 4, 901, 'monthly', 'kWh', '2022-06-30 12:00'),
  (90008, '{"activity_value": 9500}', 950, 'tCO2e', '2023-06-30', 'approved', 901, 1, 901, 'monthly', NULL, '2023-06-30 12:00'),
  (90009, '{"activity_value": 600000}', 480, 'tCO2e', '2023-06-30', 'approved', 901, 2, 901, 'monthly', 'kWh', '2023-06-30 12:00'),
  (90010, '{"activity_value": 1}', 420, 'tCO2e', '2023-06-30', 'approved', 901, 3, 901, 'monthly', NULL, '2023-06-30 12:00'),
  (90011, '{"activity_value": 200000}', 0, 'tCO2e', '2023-06-30', 'approved', 901, 4, 901, 'monthly', 'kWh', '2023-06-30 12:00'),
  (90012, '{"activity_value": 9300}', 930, 'tCO2e', '2024-06-30', 'approved', 901, 1, 901, 'monthly', NULL, '2024-06-30 12:00'),
  (90013, '{"activity_value": 525000}', 420, 'tCO2e', '2024-06-30', 'approved', 901, 2, 901, 'monthly', 'kWh', '2024-06-30 12:00'),
  (90014, '{"activity_value": 1}', 410, 'tCO2e', '2024-06-30', 'approved', 901, 3, 901, 'monthly', NULL, '2024-06-30 12:00'),
  (90015, '{"activity_value": 400000}', 0, 'tCO2e', '2024-06-30', 'approved', 901, 4, 901, 'monthly', 'kWh', '2024-06-30 12:00'),
  (90016, '{"activity_value": 9000}', 900, 'tCO2e', '2025-06-30', 'approved', 901, 1, 901, 'monthly', NULL, '2025-06-30 12:00'),
  (90017, '{"activity_value": 450000}', 360, 'tCO2e', '2025-06-30', 'approved', 901, 2, 901, 'monthly', 'kWh', '2025-06-30 12:00'),
  (90018, '{"activity_value": 1}', 400, 'tCO2e', '2025-06-30', 'approved', 901, 3, 901, 'monthly', NULL, '2025-06-30 12:00'),
  (90019, '{"activity_value": 600000}', 0, 'tCO2e', '2025-06-30', 'approved', 901, 4, 901, 'monthly', 'kWh', '2025-06-30 12:00'),
  (90020, '{"activity_value": 5000}', 500, 'tCO2e', '2021-06-30', 'approved', 901, 1, 902, 'monthly', NULL, '2021-06-30 12:00'),
  (90021, '{"activity_value": 375000}', 300, 'tCO2e', '2021-06-30', 'approved', 901, 2, 902, 'monthly', 'kWh', '2021-06-30 12:00'),
  (90022, '{"activity_value": 4900}', 490, 'tCO2e', '2022-06-30', 'approved', 901, 1, 902, 'monthly', NULL, '2022-06-30 12:00'),
  (90023, '{"activity_value": 350000}', 280, 'tCO2e', '2022-06-30', 'approved', 901, 2, 902, 'monthly', 'kWh', '2022-06-30 12:00'),
  (90024, '{"activity_value": 4800}', 480, 'tCO2e', '2023-06-30', 'approved', 901, 1, 902, 'monthly', NULL, '2023-06-30 12:00'),
  (90025, '{"activity_value": 325000}', 260, 'tCO2e', '2023-06-30', 'approved', 901, 2, 902, 'monthly', 'kWh', '2023-06-30 12:00'),
  (90026, '{"activity_value": 4700}', 470, 'tCO2e', '2024-06-30', 'approved', 901, 1, 902, 'monthly', NULL, '2024-06-30 12:00'),
  (90027, '{"activity_value": 300000}', 240, 'tCO2e', '2024-06-30', 'approved', 901, 2, 902, 'monthly', 'kWh', '2024-06-30 12:00'),
  (90028, '{"activity_value": 4600}', 460, 'tCO2e', '2025-06-30', 'approved', 901, 1, 902, 'monthly', NULL, '2025-06-30 12:00'),
  (90029, '{"activity_value": 275000}', 220, 'tCO2e', '2025-06-30', 'approved', 901, 2, 902, 'monthly', 'kWh', '2025-06-30 12:00'),
  (90030, '{"activity_value": 2000}', 200, 'tCO2e', '2021-06-30', 'approved', 901, 1, 903, 'monthly', NULL, '2021-06-30 12:00'),
  (90031, '{"activity_value": 125000}', 100, 'tCO2e', '2021-06-30', 'approved', 901, 2, 903, 'monthly', 'kWh', '2021-06-30 12:00'),
  (90032, '{"activity_value": 2000}', 200, 'tCO2e', '2022-06-30', 'approved', 901, 1, 903, 'monthly', NULL, '2022-06-30 12:00'),
  (90033, '{"activity_value": 125000}', 100, 'tCO2e', '2022-06-30', 'approved', 901, 2, 903, 'monthly', 'kWh', '2022-06-30 12:00'),
  (90034, '{"activity_value": 2100}', 210, 'tCO2e', '2023-06-30', 'approved', 901, 1, 903, 'monthly', NULL, '2023-06-30 12:00'),
  (90035, '{"activity_value": 125000}', 100, 'tCO2e', '2023-06-30', 'approved', 901, 2, 903, 'monthly', 'kWh', '2023-06-30 12:00'),
  (90036, '{"activity_value": 2200}', 220, 'tCO2e', '2024-06-30', 'approved', 901, 1, 903, 'monthly', NULL, '2024-06-30 12:00'),
  (90037, '{"activity_value": 125000}', 100, 'tCO2e', '2024-06-30', 'approved', 901, 2, 903, 'monthly', 'kWh', '2024-06-30 12:00'),
  (90038, '{"activity_value": 2300}', 230, 'tCO2e', '2025-06-30', 'approved', 901, 1, 903, 'monthly', NULL, '2025-06-30 12:00'),
  (90039, '{"activity_value": 125000}', 100, 'tCO2e', '2025-06-30', 'approved', 901, 2, 903, 'monthly', 'kWh', '2025-06-30 12:00'),
  (90040, '{"activity_value": 500}', 50, 'tCO2e', '2025-07-31', 'pending', 901, 1, 901, 'monthly', NULL, '2025-07-31 12:00');
INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, created_at) VALUES
  (90041, '{"activity_value": 9}', 777, 'tCO2e', '2025-06-30', 'approved', 904, 1, 904, 'monthly', '2025-06-30 12:00');
INSERT INTO production_data (production_id, product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
  (90001, 90000 + 1, 901, 10000, 't', '2021-01-01', '2021-12-31', 'approved', 901),
  (90002, 90000 + 1, 901, 10500, 't', '2022-01-01', '2022-12-31', 'approved', 901),
  (90003, 90000 + 1, 901, 11000, 't', '2023-01-01', '2023-12-31', 'approved', 901),
  (90004, 90000 + 1, 901, 11500, 't', '2024-01-01', '2024-12-31', 'approved', 901),
  (90005, 90000 + 1, 901, 12000, 't', '2025-01-01', '2025-12-31', 'approved', 901),
  (90006, 90000 + 2, 902, 5000, 't', '2021-01-01', '2021-12-31', 'approved', 901),
  (90007, 90000 + 2, 902, 5000, 't', '2022-01-01', '2022-12-31', 'approved', 901),
  (90008, 90000 + 2, 902, 5000, 't', '2023-01-01', '2023-12-31', 'approved', 901),
  (90009, 90000 + 2, 902, 5000, 't', '2024-01-01', '2024-12-31', 'approved', 901),
  (90010, 90000 + 2, 902, 5000, 't', '2025-01-01', '2025-12-31', 'approved', 901),
  (90011, 90000 + 3, 903, 2000, 'MWh', '2021-01-01', '2021-12-31', 'approved', 901),
  (90012, 90000 + 3, 903, 2100, 'MWh', '2022-01-01', '2022-12-31', 'approved', 901),
  (90013, 90000 + 3, 903, 2200, 'MWh', '2023-01-01', '2023-12-31', 'approved', 901),
  (90014, 90000 + 3, 903, 2300, 'MWh', '2024-01-01', '2024-12-31', 'approved', 901),
  (90015, 90000 + 3, 903, 2400, 'MWh', '2025-01-01', '2025-12-31', 'approved', 901);
INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (901, 'Scope 3', 2021, 'CY');
