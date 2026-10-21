-- IN-6 · KPI rows the flow golden writes for the fixture companies (runs before cleanup.sql).
DELETE FROM kpi_value WHERE company_id IN (901, 902);
DELETE FROM company_kpi WHERE company_id IN (901, 902);
DELETE FROM company_framework WHERE company_id IN (901, 902);
DELETE FROM company_kpi_settings WHERE company_id IN (901, 902);
UPDATE company SET kpi_tracking_enabled = false WHERE company_id IN (901, 902);
