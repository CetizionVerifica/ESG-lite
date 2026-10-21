-- IN-4 · removes seed-in4.sql's rows (and any event a test left on the fixture companies), by id.
DELETE FROM insight_event WHERE company_id IN (901, 902);
DELETE FROM emission WHERE pk_id = 94001;
DELETE FROM site_categories WHERE site_id = 902 AND category_id = 3;
