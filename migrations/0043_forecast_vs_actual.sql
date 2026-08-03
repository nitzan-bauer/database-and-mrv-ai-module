-- migrate:up
-- =====================================================================
-- 0042 — forecast_vs_actual: record_pdd_forecast (Rebeka) and
-- get_forecast_vs_actual (John).
--
-- The VCS PDD Template v5.0A's own "Project Design" section asks for a
-- table of "estimated net reductions and removals" per vintage period
-- (calendar year) of the crediting period — real, required content,
-- but never captured anywhere before this: it existed only as text in
-- the template, not as data. mrv.pdd_forecast_vintages is that table,
-- one row per vintage period, and record_pdd_forecast is Rebeka's tool
-- for it — she already owns PDD content (pdd_generator, generate_pdd_draft).
--
-- get_forecast_vs_actual is John's own stated QA role ("reconcile
-- forecast-vs-actual"): for each recorded vintage, it sums the
-- project's real mrv.credits (issued/retired/sold — the same "actual"
-- standing credit_allocation_qa already uses) for that vintage year and
-- compares it to the forecast. No model, no invented "on track" —
-- arithmetic over what was recorded and what the ledger actually shows.
--
-- Both 'auto': record_pdd_forecast writes a working, revisable row (an
-- ON CONFLICT upsert, the same standing as record_mvr_signoff), and
-- get_forecast_vs_actual is read-only.
-- =====================================================================

CREATE TABLE mrv.pdd_forecast_vintages (
  forecast_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  vintage_start         date NOT NULL,
  vintage_end           date NOT NULL,
  estimated_net_tco2e   numeric(14,4) NOT NULL,
  recorded_by           text NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (vintage_end >= vintage_start),
  UNIQUE (project_id, vintage_start, vintage_end)
);

CREATE INDEX idx_pdd_forecast_project ON mrv.pdd_forecast_vintages (project_id, vintage_start);

COMMENT ON TABLE mrv.pdd_forecast_vintages IS
  'VCS PDD Template v5.0A''s own "estimated net reductions and removals" table, per vintage period (calendar year) of the crediting period — the PDD''s declared forecast, captured as data for the first time.';

CREATE TRIGGER trg_pdd_forecast_upd BEFORE UPDATE ON mrv.pdd_forecast_vintages
  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_audit_pdd_forecast AFTER INSERT OR UPDATE ON mrv.pdd_forecast_vintages
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('forecast_id');

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_pdd_forecast',    'auto', 'Writes a working, revisable row; commits nothing externally.'),
  ('get_forecast_vs_actual', 'auto', 'Read-only reconciliation; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_pdd_forecast']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('record_pdd_forecast' = ANY (tools));

UPDATE mrv.agents
   SET tools = tools || ARRAY['get_forecast_vs_actual']::text[],
       skills = skills || ARRAY['forecast_vs_actual']::text[],
       planned_skills = array_remove(planned_skills, 'forecast_vs_actual')
 WHERE agent_id = 'john'
   AND NOT ('get_forecast_vs_actual' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'get_forecast_vs_actual'),
       skills = array_remove(skills, 'forecast_vs_actual'),
       planned_skills = planned_skills || ARRAY['forecast_vs_actual']::text[]
 WHERE agent_id = 'john';

UPDATE mrv.agents
   SET tools = array_remove(tools, 'record_pdd_forecast')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('record_pdd_forecast', 'get_forecast_vs_actual');

DROP TRIGGER IF EXISTS trg_audit_pdd_forecast ON mrv.pdd_forecast_vintages;
DROP TRIGGER IF EXISTS trg_pdd_forecast_upd ON mrv.pdd_forecast_vintages;
DROP TABLE IF EXISTS mrv.pdd_forecast_vintages;
