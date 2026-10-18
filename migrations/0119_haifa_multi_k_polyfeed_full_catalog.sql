-- migrate:up
-- =====================================================================
-- 0119 — Nitzan (chat, 2026-09-12): the Multi-K, Poly-Feed Drip and
-- Poly-Feed Stim entries added in 0117 were single representative
-- grades per family. Nitzan pointed out each is a real product GROUP
-- with many distinct N-P-K grades, gave 6 real haifa-group.com URLs
-- for the Multi-K group, and asked for the same treatment on
-- Poly-Feed Drip and Poly-Feed Stim. haifa-group.com is Cloudflare-
-- blocked to a server-side fetch (confirmed again this session) but
-- loads fine in the user's own logged-in Chrome — every grade below
-- was read directly off real haifa-group.com product pages or the
-- site's own embedded Google-powered product search results in that
-- browser session, not guessed or fetched blind.
--
-- Per Nitzan's own merge rule: where the real N-P-K triple is IDENTICAL
-- across grades and only the micronutrient/secondary-element add-on
-- differs (or only the physical form — crystalline vs prills — differs),
-- they are unified into one catalog row here, noting every folded trade
-- name. Where the N-P-K triple itself differs, each stays a separate
-- row, even when the family/sub-line name is shared.
--
-- The pre-existing "Haifa Multi-K 13-0-46" seeded in 0004_reference_data
-- as generic "Potassium nitrate 13-0-46" already covers this exact
-- grade — folded into it rather than duplicated (see the UPDATE below).
-- =====================================================================

-- The single Multi-K grade already added in 0117 is superseded by the
-- fuller catalog below (it becomes one grade among many, so this row
-- is replaced by the equivalent merged row inserted further down).
DELETE FROM mrv.fertilizers WHERE name = 'Haifa Multi-K 13-0-46';

-- ---- Multi-K family (14 real, distinct N-P-K groups) -------------------
INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa Multi-K Classic/Prills 13-0-46', 0.13, 'synthetic-other',
   'Straight potassium nitrate (KNO3), 13-0-46. Merges Multi-K Classic (crystalline) and Multi-K Prills (granular) — identical N-P-K, physical form only differs.'),
  ('Haifa Multi-K GG/pHast/Reci 13.5-0-46', 0.135, 'synthetic-other',
   'Straight KNO3, ~13.5-0-46. Merges Multi-K GG (13.5-0-46.2, greenhouse grade, pH~9), Multi-K pHast (13.5-0-46.2, low-pH~4), Multi-K Reci (13.5-0-46.5, near-zero sodium for recirculated systems) — same core N-P-K, differ in pH/sodium spec only.'),
  ('Haifa Multi-K pHorte 13.3-0.9-45.5', 0.133, 'synthetic-other',
   'Adds real P2O5 (0.9%) plus bicarbonate-neutralizing/pH-buffering formulation — a distinct macronutrient profile, not merged with the other straight grades.'),
  ('Haifa Multi-npK 13-3-43', 0.13, 'synthetic-other', 'Potassium nitrate enriched with phosphate.'),
  ('Haifa Multi-npK/Prills 13-2-44', 0.13, 'synthetic-other',
   'Merges Multi-npK (soluble) and Multi-npK Prills — identical N-P-K (13-2-44), physical form only differs.'),
  ('Haifa Multi-npK 12-2-44', 0.12, 'synthetic-other', 'Potassium nitrate enriched with phosphate.'),
  ('Haifa Multi-npK 13-5-42', 0.13, 'synthetic-other', 'Potassium nitrate enriched with phosphate.'),
  ('Haifa Multi-npK Prills 12-3-43', 0.12, 'synthetic-other', 'Granular; distinct N-P-K from the 13-2-44/13-3-43 soluble grades.'),
  ('Haifa Multi-K Mg/Prills 12-0-44+1MgO', 0.12, 'synthetic-other',
   'Merges Multi-K Mg (soluble) and Multi-Mg Prills — identical N-P-K-MgO (12-0-44+1MgO), physical form only differs.'),
  ('Haifa Multi-K 12-0-43 (Mg/Zn)', 0.12, 'synthetic-other',
   'Merges 3 real grades sharing the same 12-0-43 base: Multi-K Mg +2MgO, Multi-K Mg +1MgO+ME, Multi-K Zn +2Zn — same N-P-K, only the secondary/micronutrient add-on differs.'),
  ('Haifa Multi-K 11-0-40 (Mg/Zn)', 0.11, 'synthetic-other',
   'Merges 3 real grades on the same ~11-0-40 base: Multi-K Mg +4MgO (soluble, 11-0-40), Multi-Mg Prills +4MgO (11-0-39, granular rounding), Multi-K Zn +4Zn (11-0-40) — same N-P-K, secondary element (Mg vs Zn) and physical form differ.'),
  ('Haifa Multi-K Mg 12-2-43+1MgO', 0.12, 'synthetic-other', 'Adds real P2O5 (2%) — distinct macronutrient profile, not merged with the 12-0-43 group.'),
  ('Haifa Multi-K Zn 13-0-44+1Zn', 0.13, 'synthetic-other', 'Distinct K2O (44) from the other 13% grades — standalone.'),
  ('Haifa Multi-K S 12-0-46+4SO3', 0.12, 'synthetic-other', 'Potassium nitrate enriched with sulfate.'),
  ('Haifa Multi-K B 12-0-42+1B', 0.12, 'synthetic-other', 'Potassium nitrate enriched with boron.'),
  ('Haifa Multi-K ME 13-0-45+ME', 0.13, 'synthetic-other', 'Distinct K2O (45) from Classic''s 13-0-46 — standalone enriched-micronutrient grade.')
ON CONFLICT (name) DO NOTHING;

-- ---- Poly-Feed Drip family (8 real, distinct N-P-K grades; none share
--      an identical triple, so none merge) -----------------------------
DELETE FROM mrv.fertilizers WHERE name = 'Haifa Poly-Feed Drip 13-40-13';

INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa Poly-Feed Drip 19-19-19+1MgO', 0.19, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 11-44-11', 0.11, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 26-12-12+2MgO', 0.26, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 23-7-23', 0.23, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 14-7-21+2MgO+ME', 0.14, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 15-30-15', 0.15, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 12-5-40+2MgO+ME', 0.12, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.'),
  ('Haifa Poly-Feed Drip 16-8-32+2MgO', 0.16, 'synthetic-other', 'Water-soluble NPK for open-field Nutrigation/fertigation, with micronutrients.')
ON CONFLICT (name) DO NOTHING;

-- ---- Poly-Feed Stim family (9 real, distinct N-P-K groups across the
--      Enduro/Spark/Armor/Impact sub-lines; one real merge — Enduro and
--      Armor both sell an identical 19-19-19+1MgO base grade) ----------
DELETE FROM mrv.fertilizers WHERE name = 'Haifa Poly-Feed Stim Impact 16-8-34';

INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa Poly-Feed Stim Enduro/Armor 19-19-19+1MgO', 0.19, 'synthetic-other',
   'Merges Poly-Feed Stim Enduro 19-19-19+ME and Poly-Feed Stim Armor 19-19-19+1MgO+ME+0.4Si — identical N-P-K-MgO base; the two sub-lines differ in their added biostimulant/silicon technology, not in the fertilizer macronutrients we track here.'),
  ('Haifa Poly-Feed Stim Enduro 12-5-40+1.6MgO', 0.12, 'synthetic-other', 'Biostimulant (seaweed-extract) NPK line, with micronutrients.'),
  ('Haifa Poly-Feed Stim Spark 12-42-12', 0.12, 'synthetic-other', 'Biostimulant (humate-complex) NPK line, with micronutrients.'),
  ('Haifa Poly-Feed Stim Spark 12-17-27+2MgO', 0.12, 'synthetic-other', 'Biostimulant (humate-complex) NPK line, with micronutrients. Distinct P-K from the 12-42-12 Spark grade.'),
  ('Haifa Poly-Feed Stim Armor 13-5-41+0.4Si', 0.13, 'synthetic-other', 'Silicon-fortified NPK line, foliar application.'),
  ('Haifa Poly-Feed Stim Armor 15-15-30+0.2Si', 0.15, 'synthetic-other', 'Silicon-fortified NPK line, with micronutrients.'),
  ('Haifa Poly-Feed Stim Impact 16-8-34+ME', 0.16, 'synthetic-other', 'Fulvic-complex NPK line, with micronutrients.'),
  ('Haifa Poly-Feed Stim Impact 20-20-20+ME', 0.20, 'synthetic-other', 'Fulvic-complex NPK line, with micronutrients.'),
  ('Haifa Poly-Feed Stim Impact 7-51-17+ME', 0.07, 'synthetic-other', 'Fulvic-complex NPK line, with micronutrients.')
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM mrv.fertilizers WHERE name IN (
  'Haifa Multi-K Classic/Prills 13-0-46', 'Haifa Multi-K GG/pHast/Reci 13.5-0-46', 'Haifa Multi-K pHorte 13.3-0.9-45.5',
  'Haifa Multi-npK 13-3-43', 'Haifa Multi-npK/Prills 13-2-44', 'Haifa Multi-npK 12-2-44', 'Haifa Multi-npK 13-5-42',
  'Haifa Multi-npK Prills 12-3-43', 'Haifa Multi-K Mg/Prills 12-0-44+1MgO', 'Haifa Multi-K 12-0-43 (Mg/Zn)',
  'Haifa Multi-K 11-0-40 (Mg/Zn)', 'Haifa Multi-K Mg 12-2-43+1MgO', 'Haifa Multi-K Zn 13-0-44+1Zn',
  'Haifa Multi-K S 12-0-46+4SO3', 'Haifa Multi-K B 12-0-42+1B', 'Haifa Multi-K ME 13-0-45+ME',
  'Haifa Poly-Feed Drip 19-19-19+1MgO', 'Haifa Poly-Feed Drip 11-44-11', 'Haifa Poly-Feed Drip 26-12-12+2MgO',
  'Haifa Poly-Feed Drip 23-7-23', 'Haifa Poly-Feed Drip 14-7-21+2MgO+ME', 'Haifa Poly-Feed Drip 15-30-15',
  'Haifa Poly-Feed Drip 12-5-40+2MgO+ME', 'Haifa Poly-Feed Drip 16-8-32+2MgO',
  'Haifa Poly-Feed Stim Enduro/Armor 19-19-19+1MgO', 'Haifa Poly-Feed Stim Enduro 12-5-40+1.6MgO',
  'Haifa Poly-Feed Stim Spark 12-42-12', 'Haifa Poly-Feed Stim Spark 12-17-27+2MgO',
  'Haifa Poly-Feed Stim Armor 13-5-41+0.4Si', 'Haifa Poly-Feed Stim Armor 15-15-30+0.2Si',
  'Haifa Poly-Feed Stim Impact 16-8-34+ME', 'Haifa Poly-Feed Stim Impact 20-20-20+ME', 'Haifa Poly-Feed Stim Impact 7-51-17+ME'
);

INSERT INTO mrv.fertilizers (name, n_content, class, note) VALUES
  ('Haifa Multi-K 13-0-46', 0.13, 'synthetic-other', 'Potassium nitrate (KNO3) family. This is the 13-0-46 grade.'),
  ('Haifa Poly-Feed Drip 13-40-13', 0.13, 'synthetic-other', 'Water-soluble NPK for drip/Nutrigation, open-field.'),
  ('Haifa Poly-Feed Stim Impact 16-8-34', 0.16, 'synthetic-other', 'NPK + biostimulant hybrid line.')
ON CONFLICT (name) DO NOTHING;
