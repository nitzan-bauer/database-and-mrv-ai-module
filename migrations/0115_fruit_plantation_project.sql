-- migrate:up
-- =====================================================================
-- 0115 — Second real, live project confirmed by Nitzan: "CarboNature
-- Fruit-Plantation Project – E.Africa" (tree-crop farms, incl. an
-- avocado farm he named "Credible Bloom Avocado" — that farm does not
-- exist under any name in mrv.farms yet, so it is deliberately NOT
-- created here; only the project shell is, so real farms can be added
-- once their actual names/data are confirmed rather than guessed).
--
-- project_id is an internal MRV code only (confirmed with Nitzan this
-- is never the Verra VCS registry id — verra_registry_id stays NULL,
-- exactly like CARBO-3988's, until the project is actually registered).
-- country is left NULL rather than assumed — CARBO-3988 is Kenya, but
-- nothing confirms this second project is the same country.
-- =====================================================================

INSERT INTO mrv.projects (
  project_id, org_id, name, methodology, is_grouped, verra_registry_id,
  country, status, is_demo
) VALUES (
  'CARBO-FRUIT-1',
  '11111111-1111-1111-1111-111111111111',
  'CarboNature Fruit-Plantation Project – E.Africa',
  'VM0042 v2.2',
  true,
  NULL,
  NULL,
  'registered',
  false
);

-- migrate:down
DELETE FROM mrv.projects WHERE project_id = 'CARBO-FRUIT-1';
