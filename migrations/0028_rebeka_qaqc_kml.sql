-- migrate:up
-- =====================================================================
-- 0028 — Rebeka's second and third tools: plot QA/QC and KML export.
--
-- Both are her own words in the specification: "run QA/QC on boundaries,
-- areas and soil inputs before every submission" and "prepare the
-- KMZ/KML for every farmer's plots". Neither needs a model — geometry
-- validity, an area comparison, and a KML serialisation are all things
-- PostGIS already computes exactly, so both are deterministic tools
-- rather than anything deferred to the agent runtime.
--
-- Both are 'auto': a QA/QC pass is read-only reporting, and a KML export
-- produces a document but commits nothing externally by itself — the
-- same standing register_pdd_template already has. Neither writes a
-- table of its own; the finding is the audit_log entry, the same way a
-- compliance run's evidence is its own audit trail rather than a second
-- ledger.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('run_plot_qa_qc',   'auto', 'Read-only geometry and area check; commits nothing externally.'),
  ('export_plots_kml', 'auto', 'Produces a document; commits nothing externally by itself.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['run_plot_qa_qc', 'export_plots_kml']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('run_plot_qa_qc' = ANY (tools))
   AND NOT ('export_plots_kml' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'run_plot_qa_qc'), 'export_plots_kml')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name IN ('run_plot_qa_qc', 'export_plots_kml');
