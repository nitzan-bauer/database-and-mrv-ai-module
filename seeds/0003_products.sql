-- =====================================================================
-- Seed 0003 · Products — the agri-input catalogue
--
-- Extracted from the live marketplace API on 2026-07-22:
--   app.carbonature.io/api/public/farm-plots  (agri_inputs on each plot)
-- credit_per_ha is the ex-ante rate shown on the marketplace.
-- Idempotent.
-- =====================================================================

-- Multicote Products ('crf') was permanently removed from the platform
-- (Nitzan's own request, migrations/0096) — dropped from this seed so a
-- fresh environment never re-introduces it. CoteN was removed with it and
-- restored on 2026-10-18 (migrations/0126), so it is seeded again.
INSERT INTO mrv.products (name, activity_type, activity_label, cost_per_ha_usd, credit_per_ha) VALUES
  ('CoteN',             'crf',           'Improve fertilizer management', 13968.00,  400.0000),
  ('DYNOMYCO Spark WP', 'biofertilizer', 'Apply DYNOMYCO Spark WP',        863.45,    25.0000),
  ('Rootella-F',        'biofertilizer', 'Apply Rootella-F',              1298.52,    38.0000),
  ('Rootella-G',        'biofertilizer', 'Apply Rootella-G',              1262.45,    37.0000),
  ('Rootella products', 'biofertilizer', 'Apply Mycorrhiza',                84.96,     3.0000)
ON CONFLICT (name) DO NOTHING;
