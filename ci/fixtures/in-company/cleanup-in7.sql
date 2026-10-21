-- IN-7 · KPI and materiality rows the materiality golden writes for company 901, by company id.
DELETE FROM kpi_target WHERE company_id IN (901, 902);
DELETE FROM kpi_value WHERE company_id IN (901, 902);
DELETE FROM kpi_topic_assignment WHERE company_id IN (901, 902);
DELETE FROM kpi_assignment WHERE company_id IN (901, 902);
DELETE FROM company_kpi WHERE company_id IN (901, 902);
DELETE FROM company_material_topic WHERE company_id IN (901, 902);
DELETE FROM company_framework WHERE company_id IN (901, 902);
DELETE FROM company_kpi_settings WHERE company_id IN (901, 902);
