-- migrate:up
-- =====================================================================
-- 0123 — 4 real fertilizer products from Nitzan-Veg-Tech Farm's real
-- baseline nutrition program (email from bauernitzan@gmail.com,
-- 2026-09-12), not previously in the catalog — standard, well-known
-- NPK compositions (not sourced from the blocked haifa-group.com):
--   TSP (Triple Superphosphate) = 0-46-0, no nitrogen.
--   CAN (Calcium Ammonium Nitrate) = commonly sold at 27% N.
--   MOP (Muriate of Potash) = 0-0-60, no nitrogen.
--   Calcitic lime (agricultural lime, CaCO3) = a pH amendment, no
--     nitrogen — VM0042/this engine has no liming-CO2 term, so it
--     contributes nothing to the emissions math, but is still real
--     activity data worth recording for a complete input record.
-- =====================================================================

INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('TSP 0-46-0', 0, 'synthetic-other', 'Triple Superphosphate — phosphate fertilizer, no nitrogen.'),
  ('CAN 27-0-0', 0.27, 'synthetic-other', 'Calcium Ammonium Nitrate, commonly sold at 27% N.'),
  ('MOP 0-0-60', 0, 'synthetic-other', 'Muriate of Potash — potassium fertilizer, no nitrogen.'),
  ('Calcitic lime', 0, 'synthetic-other', 'Agricultural lime (CaCO3), pH amendment — no nitrogen, no liming-CO2 term in this engine.')
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM mrv.fertilizers WHERE name IN ('TSP 0-46-0', 'CAN 27-0-0', 'MOP 0-0-60', 'Calcitic lime');
