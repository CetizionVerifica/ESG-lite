-- DS-14 · the KPI seed company (company 13, DS Seed Foods) for the sustainability Editorial
-- seed doc. Runs after the KPI migrations (migrate:kpi-library, seed, values, setup, targets).
-- Set up on CY, the default frameworks, every library KPI selected and collected annually,
-- and approved values for 2024 and 2025 of the KPIs the Editorial template binds (plus the
-- parts of the GHG_SCOPE1_2 headline), each at its definition's level (site or company).
-- One pending 2025 value must never show.
UPDATE company SET kpi_tracking_enabled = true WHERE company_id = 13;
INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at)
  VALUES (13, 'CY', 2023, 15, '2026-01-05 09:00') ON CONFLICT (company_id) DO NOTHING;
INSERT INTO company_framework (company_id, framework_id, framework_code)
  SELECT 13, f.id, f.code FROM kpi_framework f WHERE f.active AND f.default_for_new ON CONFLICT DO NOTHING;
INSERT INTO company_kpi (company_id, kpi_definition_id, selected)
  SELECT 13, d.id, true FROM kpi_definition d WHERE d.company_id IS NULL AND d.active ON CONFLICT DO NOTHING;
UPDATE company_kpi SET frequency = 'annual' WHERE company_id = 13;
INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type,
                       value_numeric, unit, value_canonical, source, status, reviewed_at)
SELECT 13, v.site_id, d.id, make_date(v.year, 1, 1), make_date(v.year, 12, 31), 'annual', 'CY',
       v.value, NULL, v.value, 'manual', v.status, CASE WHEN v.status = 'approved' THEN '2026-02-10 09:00'::timestamp END
  FROM (VALUES
    ('GHG_SCOPE1', 14, 2024, 820.0, 'approved'), ('GHG_SCOPE1', 15, 2024, 410.0, 'approved'),
    ('GHG_SCOPE1', 14, 2025, 760.0, 'approved'), ('GHG_SCOPE1', 15, 2025, 395.0, 'approved'),
    ('GHG_SCOPE2_LB', 14, 2024, 1350.0, 'approved'), ('GHG_SCOPE2_LB', 15, 2024, 640.0, 'approved'),
    ('GHG_SCOPE2_LB', 14, 2025, 1210.0, 'approved'), ('GHG_SCOPE2_LB', 15, 2025, 615.0, 'approved'),
    ('GHG_SCOPE3', 14, 2024, 9100.0, 'approved'), ('GHG_SCOPE3', 14, 2025, 8650.0, 'approved'),
    ('ENERGY_TOTAL', 14, 2024, 15200.0, 'approved'), ('ENERGY_TOTAL', 15, 2024, 7100.0, 'approved'),
    ('ENERGY_TOTAL', 14, 2025, 14400.0, 'approved'), ('ENERGY_TOTAL', 15, 2025, 6900.0, 'approved'),
    ('ENERGY_RENEWABLE_SHARE', NULL, 2024, 18.0, 'approved'), ('ENERGY_RENEWABLE_SHARE', NULL, 2025, 26.5, 'approved'),
    ('WATER_WITHDRAWAL', 14, 2024, 48000.0, 'approved'), ('WATER_WITHDRAWAL', 15, 2024, 21000.0, 'approved'),
    ('WATER_WITHDRAWAL', 14, 2025, 45500.0, 'approved'), ('WATER_WITHDRAWAL', 15, 2025, 99999.0, 'pending'),
    ('WATER_CONSUMPTION', 14, 2024, 31000.0, 'approved'), ('WATER_CONSUMPTION', 14, 2025, 29800.0, 'approved'),
    ('WASTE_GENERATED', 14, 2024, 640.0, 'approved'), ('WASTE_GENERATED', 15, 2024, 210.0, 'approved'),
    ('WASTE_GENERATED', 14, 2025, 598.0, 'approved'), ('WASTE_GENERATED', 15, 2025, 205.0, 'approved'),
    ('WASTE_HAZARDOUS', 14, 2024, 12.5, 'approved'), ('WASTE_HAZARDOUS', 14, 2025, 10.8, 'approved'),
    ('EMPLOYEES_TOTAL', NULL, 2024, 1130.0, 'approved'), ('EMPLOYEES_TOTAL', NULL, 2025, 1167.0, 'approved'),
    ('EMPLOYEE_TURNOVER_RATE', NULL, 2024, 14.2, 'approved'), ('EMPLOYEE_TURNOVER_RATE', NULL, 2025, 12.9, 'approved'),
    ('LTIFR', 14, 2024, 0.62, 'approved'), ('LTIFR', 14, 2025, 0.48, 'approved'),
    ('BOARD_INDEPENDENCE', NULL, 2024, 50.0, 'approved'), ('BOARD_INDEPENDENCE', NULL, 2025, 55.6, 'approved')
  ) AS v(code, site_id, year, value, status)
  JOIN kpi_definition d ON d.code = v.code AND d.company_id IS NULL
ON CONFLICT DO NOTHING;
