-- migrate:up
-- =====================================================================
-- 0118 — Nitzan (chat, 2026-09-12): remove "Haifa UP 17.5-44-0" from
-- the fertilizer catalog (added in 0117). Zero real references — clean
-- delete. Likely driven by the classification uncertainty flagged in
-- 0117's own note (Urea Phosphate's Frac_GASF treatment was never
-- confirmed from public sources) rather than build it on an unverified
-- guess. The other 3 Haifa products from 0117 (Multi-K, Poly-Feed Drip,
-- Poly-Feed Stim) are untouched.
-- =====================================================================

DELETE FROM mrv.fertilizers WHERE name = 'Haifa UP 17.5-44-0';

-- migrate:down
INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa UP 17.5-44-0', 0.175, 'synthetic-other',
   'Urea Phosphate (CO(NH2)2.H3PO4) — not plain urea. Classified as synthetic-other (not synthetic-urea) conservatively; the correct Frac_GASF treatment for urea phosphate specifically was not confirmed from public sources — flag for expert review before relying on this for a real submission.')
ON CONFLICT (name) DO NOTHING;
