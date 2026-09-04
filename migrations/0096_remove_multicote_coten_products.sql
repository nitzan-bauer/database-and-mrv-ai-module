-- migrate:up
-- =====================================================================
-- 0096 — permanently remove Multicote Agri Junior and CoteN.
--
-- Nitzan's own request, live this session (attached docx spec): the two
-- Haifa Group CRF products, seeded in seeds/0003_products.sql, are
-- removed from the whole platform — the SaaS's own AGRI_INPUTS/catalogue
-- (carbonature-saas repo, separate change), the live carbonature.io
-- project page (CMS content, not code), and every backend record here.
--
-- Confirmed live before writing this migration: zero rows in
-- mrv.alm_activities reference either product_id (both were '0'), so this
-- delete loses no real activity/allocation history. The FK is
-- product_id ... ON DELETE SET NULL regardless (migrations/0012), so even
-- a real reference would have its product_id cleared, not its own row
-- deleted — nothing else is destroyed by this migration either way.
-- =====================================================================

DELETE FROM mrv.products WHERE name IN ('CoteN', 'Multicote Products');

-- migrate:down
INSERT INTO mrv.products (name, activity_type, activity_label, cost_per_ha_usd, credit_per_ha) VALUES
  ('CoteN',              'crf', 'Improve fertilizer management', 13968.00,  400.0000),
  ('Multicote Products', 'crf', 'Control Release Fertilizers',   53237.50, 1522.0000)
ON CONFLICT (name) DO NOTHING;
