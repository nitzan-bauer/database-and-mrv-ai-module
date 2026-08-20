-- migrate:up
-- =====================================================================
-- 0082 — Structured (table-cell / checkbox) answers for PDD sections
-- that are a real Word table + Yes/No content controls, not prose
-- (Nitzan's own request, live this session: "1.4.3 Eligibility of
-- Projects Registered with Other GHG Programs" is the concrete
-- example — a 3-row date table plus 4 Yes/No questions).
--
-- Every existing PDD answer field (input_text, drafted_text,
-- review_comment) is a flat string because every section handled so
-- far is prose. A table/checkbox section needs named, independently
-- saveable values instead of one blob — this table is that, generic
-- across any section (src/lib/pdd/structuredFields.ts holds the
-- per-section field definitions and their real docx targeting: which
-- table row label, or which checkbox w:id pair).
-- =====================================================================

CREATE TABLE mrv.pdd_section_structured_fields (
  field_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id   uuid NOT NULL REFERENCES mrv.pdd_section_status(status_id) ON DELETE CASCADE,
  field_key   text NOT NULL,
  field_value text,
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (status_id, field_key)
);

COMMENT ON TABLE mrv.pdd_section_structured_fields IS
  'Named per-field values (a table-cell date, a yes/no answer) for PDD sections whose real content is a Word table/checkbox, not prose — src/lib/pdd/structuredFields.ts defines which fields exist per section_index and how each maps into the real .docx.';

-- migrate:down
DROP TABLE IF EXISTS mrv.pdd_section_structured_fields;
