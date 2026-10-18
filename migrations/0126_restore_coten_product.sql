-- migrate:up
-- =====================================================================
-- 0126 — restore CoteN to the product catalogue.
--
-- Nitzan's own request (2026-10-18): bring Haifa Group's CoteN back to the
-- platform exactly as it was before migration 0096 removed it — same
-- information, same links — on the project pages, the farmer dashboards,
-- the SaaS and the Marketplace. This is the MRV-side half: the row below
-- is exactly the one 0096's own `migrate:down` re-inserts.
--
-- Multicote Agri Junior / 'Multicote Products' stay removed — the request
-- names CoteN only.
-- =====================================================================

INSERT INTO mrv.products (name, activity_type, activity_label, cost_per_ha_usd, credit_per_ha) VALUES
  ('CoteN', 'crf', 'Improve fertilizer management', 13968.00, 400.0000)
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM mrv.products WHERE name = 'CoteN';
