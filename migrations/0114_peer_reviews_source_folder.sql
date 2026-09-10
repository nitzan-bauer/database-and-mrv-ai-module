-- migrate:up
-- =====================================================================
-- 0114 — Nitzan's own curated "Peer reviews" Drive folder (real
-- meta-analysis papers + John's own research-note summaries) becomes a
-- 4th scanned source, alongside claude/carbonature/downloads (0107).
-- Unlike those three, where an LLM classifies which agent(s) each file
-- belongs to, Nitzan has already told us exactly who reviews this
-- folder — John, Rebeka, Dave — so johnDriveSortingRound.ts routes every
-- file here unconditionally, no classification call needed for a case
-- that's already fully known.
-- =====================================================================

ALTER TABLE mrv.drive_source_folders DROP CONSTRAINT drive_source_folders_source_key_check;
ALTER TABLE mrv.drive_source_folders ADD CONSTRAINT drive_source_folders_source_key_check
  CHECK (source_key IN ('claude', 'carbonature', 'downloads', 'peer_reviews'));

-- migrate:down
DELETE FROM mrv.drive_source_folders WHERE source_key = 'peer_reviews';
ALTER TABLE mrv.drive_source_folders DROP CONSTRAINT drive_source_folders_source_key_check;
ALTER TABLE mrv.drive_source_folders ADD CONSTRAINT drive_source_folders_source_key_check
  CHECK (source_key IN ('claude', 'carbonature', 'downloads'));
