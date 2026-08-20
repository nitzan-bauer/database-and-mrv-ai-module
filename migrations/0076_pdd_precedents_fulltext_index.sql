-- migrate:up
-- =====================================================================
-- 0076 — GIN index for mrv.pdd_precedents' full-text search.
--
-- Confirmed live this session: draftPddChapterContent.ts's own excerpt
-- search (`to_tsvector('english', extracted_text) @@ plainto_tsquery(...)`,
-- computed on the fly, no index) took 13.3 SECONDS for one call against
-- the real corpus (199 rows, 32.5M characters) — and it runs once per
-- section drafted. That, not the model call, is what was actually
-- burning a scheduled task's entire time budget (confirmed by direct
-- timing: the model call itself has its own 15s cap and never got
-- reached before the timeout). researchPddPrecedents.ts's own search
-- uses the identical expression and gets the same benefit.
--
-- Superseded by 0077 (a stored column beats a plain expression index
-- here — this alone still left the query at 6.3s), which drops this
-- index once it lands. Left as its own migration rather than folded
-- into 0077 because this is what was actually applied first, live.
-- =====================================================================

CREATE INDEX idx_pdd_precedents_fulltext ON mrv.pdd_precedents
  USING gin (to_tsvector('english', extracted_text));

-- migrate:down
DROP INDEX IF EXISTS mrv.idx_pdd_precedents_fulltext;
