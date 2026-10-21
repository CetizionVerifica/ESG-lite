-- IN-4 · fixture rows for the pathway and completeness goldens (loaded after seed.sql).
--   site 902 also files Business Travel (category 3) as one approved CY 2025 yearly batch of 0 t,
--   so its 2025 net, pathway and intensity are unchanged and the batch covers every 2025 month;
--   two events of company 901: 2023-03-15 "Solar PPA signed" (initiative, company level) and
--   2024-07-01 "South line 2 bought" (acquisition, site 902).
INSERT INTO site_categories (site_id, category_id) VALUES (902, 3);
INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type, created_at) VALUES
  (94001, '{"activity_value": 1}', 0, 'tCO2e', '2025-12-31', 'approved', 901, 3, 902, 'yearly', 'CY', '2026-01-10 12:00');
INSERT INTO insight_event (id, company_id, site_id, date, label, kind, created_by) VALUES
  (94001, 901, NULL, '2023-03-15', 'Solar PPA signed', 'initiative', 901),
  (94002, 901, 902, '2024-07-01', 'South line 2 bought', 'acquisition', 901);
