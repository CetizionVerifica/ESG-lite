-- IN-10 · removes the fixture company rows (ci/fixtures/in-company/seed.sql), every statement by id.
DELETE FROM emission WHERE site_id IN (901, 902, 903, 904);
DELETE FROM production_data WHERE site_id IN (901, 902, 903, 904);
DELETE FROM product WHERE product_id IN (90001, 90002, 90003);
DELETE FROM company_base_year WHERE company_id IN (901, 902);
DELETE FROM site_categories WHERE site_id IN (901, 902, 903, 904);
DELETE FROM user_sites WHERE user_id IN (901, 902, 903, 904);
DELETE FROM audit_log WHERE changed_by IN (901, 902, 903, 904);
DELETE FROM "user" WHERE user_id IN (901, 902, 903, 904);
DELETE FROM site WHERE site_id IN (901, 902, 903, 904);
DELETE FROM company WHERE company_id IN (901, 902);
