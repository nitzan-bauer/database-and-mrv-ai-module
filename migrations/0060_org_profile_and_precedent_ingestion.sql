-- migrate:up
-- =====================================================================
-- 0060 — org_profile (Project Proponent, once, everywhere) +
--         ingest_related_pdd_precedents (Rebeka).
--
-- Nitzan's own instruction after supplying the real letterhead and his
-- contact details: "this is the last time she'll need the company
-- details and contact-person details". That only holds if it's stored
-- at the org level, not re-typed per project — a single-row profile
-- table, not another column on mrv.projects.
--
-- Real details, from CarboNature_Document_FIXED.docx's own letterhead
-- footer and Nitzan's email signature — not invented:
--   CarboNature Strategies Ltd, V119 Five Star Paradise, Off Kiambu
--   Road, Kiambu | P.O. Box 67-00606, Nairobi, Kenya. KRA PIN
--   P052557804K. Contact: Nitzan Bauer, Co-Founder & Director,
--   nitzan@carbonature.io, +972-559106880.
--
-- ingest_related_pdd_precedents closes the gap download_related_pdds
-- (0059) left open: real files land in Drive, but mrv.pdd_precedents
-- (0048) — what the drafting pipeline's own precedent search reads —
-- never heard about them until this tool extracts their text.
-- =====================================================================

CREATE TABLE mrv.org_profile (
  org_id           uuid PRIMARY KEY REFERENCES mrv.organizations (org_id),
  legal_name       text NOT NULL,
  address          text NOT NULL,
  tax_id           text,
  contact_name     text NOT NULL,
  contact_title    text NOT NULL,
  contact_email    text NOT NULL,
  contact_phone    text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text
);

COMMENT ON TABLE mrv.org_profile IS
  'Project Proponent / letterhead facts for the org, set once and reused across every project''s PDD — not re-asked per project.';

INSERT INTO mrv.org_profile (org_id, legal_name, address, tax_id, contact_name, contact_title, contact_email, contact_phone, updated_by)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'CarboNature Strategies Ltd',
  'V119 Five Star Paradise, Off Kiambu Road, Kiambu | P.O. Box 67-00606, Nairobi, Kenya',
  'P052557804K',
  'Nitzan Bauer',
  'Co-Founder & Director',
  'nitzan@carbonature.io',
  '+972-559106880',
  'human:nitzan@carbonature.io'
)
ON CONFLICT (org_id) DO UPDATE SET
  legal_name = excluded.legal_name,
  address = excluded.address,
  tax_id = excluded.tax_id,
  contact_name = excluded.contact_name,
  contact_title = excluded.contact_title,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  updated_at = clock_timestamp(),
  updated_by = excluded.updated_by;

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('ingest_related_pdd_precedents', 'auto',
        'Extracts text from files already in this project''s own Drive folder into the precedent search index. No external write.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'ingest_related_pdd_precedents')
 WHERE agent_id = 'rebeka' AND NOT ('ingest_related_pdd_precedents' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'ingest_related_pdd_precedents')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'ingest_related_pdd_precedents';
DROP TABLE IF EXISTS mrv.org_profile;
