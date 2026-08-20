-- migrate:up
-- =====================================================================
-- 0077 — a real, stored, indexed tsvector for mrv.pdd_precedents.
--
-- 0076 (just applied) added a GIN index over the to_tsvector(...)
-- expression, but confirmed directly it still leaves the query at
-- 6.3s against the real corpus (199 rows, 32.5M characters) — the
-- expression index speeds up the WHERE @@ filter, but ORDER BY
-- ts_rank_cd(to_tsvector(...), ...) recomputes the tsvector again,
-- from scratch, for every matching row, just to rank them. A
-- GENERATED ALWAYS ... STORED column computes it once, at write time,
-- so both the filter and the ranking read the same already-tokenized
-- value — this is the actual fix; 0076's expression index becomes
-- redundant once this lands and is dropped here.
-- =====================================================================

DROP INDEX IF EXISTS mrv.idx_pdd_precedents_fulltext;

ALTER TABLE mrv.pdd_precedents
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', extracted_text)) STORED;

CREATE INDEX idx_pdd_precedents_tsv ON mrv.pdd_precedents USING gin (tsv);

COMMENT ON COLUMN mrv.pdd_precedents.tsv IS
  'Precomputed at write time — draftPddChapterContent.ts and researchPddPrecedents.ts both filter/rank against this, never against to_tsvector(extracted_text) inline (13s+ per call on the real corpus, confirmed live).';

-- migrate:down
ALTER TABLE mrv.pdd_precedents DROP COLUMN IF EXISTS tsv;
CREATE INDEX idx_pdd_precedents_fulltext ON mrv.pdd_precedents USING gin (to_tsvector('english', extracted_text));
