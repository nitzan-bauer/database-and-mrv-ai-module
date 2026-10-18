-- migrate:up
-- =====================================================================
-- 0117 — Haifa Group fertilizer catalog additions, approved by Nitzan
-- (chat, 2026-09-11) after web research (haifa-group.com itself is
-- Cloudflare-blocked to a server-side fetch, so these specs come from
-- product pages/search results, not the blocked site directly).
--
-- Each brand is a family with several N-P-K grades; only the one grade
-- actually verified this session is seeded per family, named with its
-- exact grade so it is never confused with a different member of the
-- same family. All four are synthetic (no organic amendment / no
-- carbon_content relevance).
--
-- Haifa UP is Urea Phosphate (CO(NH2)2.H3PO4), not plain urea. Whether
-- IPCC's higher urea volatilisation fraction (Frac_GASF) should apply
-- to it specifically is genuinely unclear from public sources reviewed
-- — classified conservatively as 'synthetic-other' rather than guessed
-- as 'synthetic-urea'; flagged in the note for expert review.
-- =====================================================================

INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa Multi-K 13-0-46', 0.13, 'synthetic-other',
   'Potassium nitrate (KNO3) family. This is the 13-0-46 grade; family also includes Multi-npK, Multi-K Mg, Multi-K Zn variants not yet catalogued.'),
  ('Haifa Poly-Feed Drip 13-40-13', 0.13, 'synthetic-other',
   'Water-soluble NPK for drip/Nutrigation, open-field. This is the 13-40-13 grade; family has other N-P-K ratios not yet catalogued.'),
  ('Haifa UP 17.5-44-0', 0.175, 'synthetic-other',
   'Urea Phosphate (CO(NH2)2.H3PO4) — not plain urea. Classified as synthetic-other (not synthetic-urea) conservatively; the correct Frac_GASF treatment for urea phosphate specifically was not confirmed from public sources — flag for expert review before relying on this for a real submission.'),
  ('Haifa Poly-Feed Stim Impact 16-8-34', 0.16, 'synthetic-other',
   'NPK + biostimulant hybrid line, distinct from plain Poly-Feed. This is the Stim Impact 16-8-34 grade; family has other grades not yet catalogued.')
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM mrv.fertilizers WHERE name IN (
  'Haifa Multi-K 13-0-46',
  'Haifa Poly-Feed Drip 13-40-13',
  'Haifa UP 17.5-44-0',
  'Haifa Poly-Feed Stim Impact 16-8-34'
);
