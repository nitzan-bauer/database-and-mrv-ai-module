-- migrate:up
-- A farm that sits in a real project but must not appear in that project's PDD (e.g. a demonstration farm that
-- predates the demo-project rule). Only the PDD reads this flag — samples, allocation and credit figures are untouched.
ALTER TABLE mrv.farms ADD COLUMN IF NOT EXISTS exclude_from_pdd boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN mrv.farms.exclude_from_pdd IS
  'true = left out of PDD drafting and the SEED questionnaire facts for its project. Does not affect any other calculation.';

-- migrate:down
ALTER TABLE mrv.farms DROP COLUMN IF EXISTS exclude_from_pdd;
