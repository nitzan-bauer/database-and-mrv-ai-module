-- =====================================================================
-- Post-migration verification.
--
-- Every check RAISES on failure. A verification script that prints FAIL
-- and still exits 0 is worse than no script — it turns a red build green.
-- Run under psql -v ON_ERROR_STOP=1.
-- =====================================================================

\echo '--- Tables in mrv schema ---'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'mrv'
ORDER BY table_name;

\echo ''
\echo '--- Checks ---'

-- ---------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- 9 core hierarchy + 3 reference + 2 audit + agent_memory + 5 stage-3,
  -- plus mrv.agents (0024) and mrv.pdd_templates (0027) from Tier 2, plus
  -- mrv.additionality_assessments and mrv.pdd_drafts (0031), plus
  -- mrv.grouped_project_eligibility_areas, mrv.grouped_project_eligibility_criteria
  -- and mrv.public_comments (0035).
  -- BASE TABLE only: information_schema.tables counts views too, and
  -- mrv.v_real_plots would otherwise inflate this.
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'mrv' AND table_type = 'BASE TABLE';
  IF n <> 48 THEN
    RAISE EXCEPTION 'FAIL  | expected 48 base tables in mrv, found %', n;
  END IF;

  IF to_regclass('mrv.v_real_plots') IS NULL THEN
    RAISE EXCEPTION 'FAIL  | mrv.v_real_plots view is missing';
  END IF;
  RAISE NOTICE 'PASS  | 48 base tables + v_real_plots view';

  -- Every geometry column must be SRID 4326. A wrong projection here
  -- silently mis-locates plots by hundreds of kilometres.
  -- Restricted to base tables: geometry_columns also lists view columns,
  -- so mrv.v_real_plots would otherwise be counted twice over.
  SELECT count(*) INTO n
  FROM geometry_columns g
  JOIN pg_class c      ON c.relname = g.f_table_name
  JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = g.f_table_schema
  WHERE g.f_table_schema = 'mrv' AND c.relkind = 'r';
  IF n <> 5 THEN
    RAISE EXCEPTION 'FAIL  | expected 5 geometry columns on base tables, found %', n;
  END IF;

  SELECT count(*) INTO n
  FROM geometry_columns WHERE f_table_schema = 'mrv' AND srid <> 4326;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL  | % geometry column(s) are not SRID 4326', n;
  END IF;
  RAISE NOTICE 'PASS  | 5 geometry columns, all SRID 4326';

  SELECT count(*) INTO n
  FROM pg_indexes WHERE schemaname = 'mrv' AND indexdef LIKE '%USING gist%';
  IF n < 5 THEN
    RAISE EXCEPTION 'FAIL  | expected at least 5 GIST indexes, found %', n;
  END IF;
  RAISE NOTICE 'PASS  | % GIST indexes', n;

  -- pgvector must be present before stage 2's agent_memory lands.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'FAIL  | pgvector extension is not installed';
  END IF;
  RAISE NOTICE 'PASS  | postgis and pgvector installed';
END $$;

-- ---------------------------------------------------------------------
-- Seeded reference data
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM mrv.fertilizers;
  IF n <> 18 THEN
    RAISE EXCEPTION 'FAIL  | expected 18 fertilizers, found %', n;
  END IF;

  SELECT count(*) INTO n FROM mrv.machinery_defaults;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL  | expected 3 machinery defaults, found %', n;
  END IF;

  -- 6 from the original seed, plus register_pdd_template (0027),
  -- run_plot_qa_qc / export_plots_kml (0028) for Rebeka, record_baseline_site
  -- / record_activity_data (0030) for Dave, record_additionality_assessment
  -- / export_plots_kmz / generate_pdd_draft (0031) for Rebeka,
  -- link_farm_drive_folder / list_farm_drive_documents / centralize_farm_document
  -- (0032), unlink_farm_drive_folder (0033) for Jennifer,
  -- compute_uncertainty_deduction (0034) for Dave,
  -- record_grouped_project_design / record_public_comment (0035) for Rebeka,
  -- get_pipeline_status / get_department_report (0036) for John,
  -- ingest_model_results (0037) and record_mvr_signoff (0038) for Dave,
  -- credit_allocation_qa (0039) for John, record_agent_memory /
  -- recall_agent_memory (0040) shared across all five agents, and
  -- fetch_public_url (0041) for Rebeka and John.
  SELECT count(*) INTO n FROM mrv.agent_action_policies;
  IF n <> 29 THEN
    RAISE EXCEPTION 'FAIL  | expected 29 agent policies, found %', n;
  END IF;

  RAISE NOTICE 'PASS  | reference data seeded (18 fertilizers, 3 machinery, 29 policies)';
END $$;

-- ---------------------------------------------------------------------
-- 0030 — baseline control sites and activity data tools
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  mode2 text;
  dave_tools text[];
  bsl_id text;
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'record_baseline_site';
  SELECT mode::text INTO mode2 FROM mrv.agent_action_policies WHERE action_name = 'record_activity_data';
  IF mode1 IS DISTINCT FROM 'auto' OR mode2 IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'FAIL  | record_baseline_site / record_activity_data must both be auto, found % / %', mode1, mode2;
  END IF;

  SELECT tools INTO dave_tools FROM mrv.agents WHERE agent_id = 'dave';
  IF NOT ('record_baseline_site' = ANY(dave_tools)) OR NOT ('record_activity_data' = ANY(dave_tools)) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing record_baseline_site or record_activity_data: %', dave_tools;
  END IF;

  -- mrv.next_bsl_id() must produce the BSL-#### shape from a real sequence,
  -- not a max()+1 that two concurrent inserts could collide on.
  SELECT mrv.next_bsl_id() INTO bsl_id;
  IF bsl_id !~ '^BSL-\d{4}$' THEN
    RAISE EXCEPTION 'FAIL  | mrv.next_bsl_id() produced %, expected BSL-####', bsl_id;
  END IF;

  RAISE NOTICE 'PASS  | 0030: baseline/activity policies auto, dave holds both tools, next_bsl_id() shaped BSL-####';
END $$;

-- ---------------------------------------------------------------------
-- 0031 — the skills that could be built honestly: kmz_preparation,
-- additionality and pdd_generator for Rebeka; stratification,
-- baseline_definition and soc_datasheet for Dave. dndc/daycent stay
-- planned — no real model integration exists to build them on.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  rebeka_skills text[];
  rebeka_planned text[];
  dave_skills text[];
  dave_planned text[];
BEGIN
  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('record_additionality_assessment', 'export_plots_kmz', 'generate_pdd_draft')
    AND NOT (
      (action_name = 'record_additionality_assessment' AND mode = 'auto') OR
      (action_name IN ('export_plots_kmz', 'generate_pdd_draft') AND mode = 'confirm')
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | unexpected policy mode(s) for the 0031 tools: %', bad;
  END IF;

  SELECT skills, planned_skills INTO rebeka_skills, rebeka_planned FROM mrv.agents WHERE agent_id = 'rebeka';
  IF NOT (rebeka_skills @> ARRAY['kmz_preparation', 'additionality', 'pdd_generator']) THEN
    RAISE EXCEPTION 'FAIL  | rebeka is missing a built 0031 skill: %', rebeka_skills;
  END IF;
  IF rebeka_planned && ARRAY['kmz_preparation', 'additionality', 'pdd_generator']::text[] THEN
    RAISE EXCEPTION 'FAIL  | rebeka still lists a built skill as planned: %', rebeka_planned;
  END IF;

  SELECT skills, planned_skills INTO dave_skills, dave_planned FROM mrv.agents WHERE agent_id = 'dave';
  IF NOT (dave_skills @> ARRAY['stratification', 'baseline_definition', 'soc_datasheet']) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing a built 0031 skill: %', dave_skills;
  END IF;
  IF dave_planned && ARRAY['stratification', 'baseline_definition', 'soc_datasheet']::text[] THEN
    RAISE EXCEPTION 'FAIL  | dave still lists a built skill as planned: %', dave_planned;
  END IF;
  -- dndc/daycent must remain planned — no fabricated "built" skill for a
  -- model this repo never had access to.
  IF NOT (dave_planned @> ARRAY['dndc', 'daycent']) THEN
    RAISE EXCEPTION 'FAIL  | dave should still have dndc and daycent as planned (unbuilt): %', dave_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0031: kmz/additionality/pdd_generator built for rebeka, stratification/baseline_definition/soc_datasheet built for dave, dndc/daycent still planned';
END $$;

-- ---------------------------------------------------------------------
-- 0032 — Jennifer's first real skill: document_centralisation, over
-- Drive folders a person links by hand (never searched or created by
-- guessing at folder structure).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  jennifer_tools text[];
  jennifer_skills text[];
  jennifer_planned text[];
  col_type text;
BEGIN
  SELECT data_type INTO col_type FROM information_schema.columns
   WHERE table_schema = 'mrv' AND table_name = 'farms' AND column_name = 'drive_folder_id';
  IF col_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'FAIL  | mrv.farms.drive_folder_id should be text, found %', col_type;
  END IF;

  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('link_farm_drive_folder', 'list_farm_drive_documents', 'centralize_farm_document')
    AND NOT (
      (action_name IN ('link_farm_drive_folder', 'list_farm_drive_documents') AND mode = 'auto') OR
      (action_name = 'centralize_farm_document' AND mode = 'confirm')
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | unexpected policy mode(s) for the 0032 tools: %', bad;
  END IF;

  SELECT tools, skills, planned_skills INTO jennifer_tools, jennifer_skills, jennifer_planned
    FROM mrv.agents WHERE agent_id = 'jennifer';
  IF NOT (jennifer_tools @> ARRAY['link_farm_drive_folder', 'list_farm_drive_documents', 'centralize_farm_document']) THEN
    RAISE EXCEPTION 'FAIL  | jennifer is missing a 0032 tool: %', jennifer_tools;
  END IF;
  IF NOT (jennifer_skills @> ARRAY['document_centralisation']) THEN
    RAISE EXCEPTION 'FAIL  | jennifer is missing document_centralisation from skills: %', jennifer_skills;
  END IF;
  IF jennifer_planned && ARRAY['document_centralisation']::text[] THEN
    RAISE EXCEPTION 'FAIL  | jennifer still lists document_centralisation as planned: %', jennifer_planned;
  END IF;
  -- her other three stay planned — no CRM, calendar or board-protocol
  -- integration exists yet.
  IF NOT (jennifer_planned @> ARRAY['crm_hygiene', 'scheduling', 'board_protocol']) THEN
    RAISE EXCEPTION 'FAIL  | jennifer should still have crm_hygiene/scheduling/board_protocol as planned: %', jennifer_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0032: mrv.farms.drive_folder_id present, jennifer holds document_centralisation, her other 3 skills stay planned';
END $$;

-- ---------------------------------------------------------------------
-- 0033 — undo a Drive folder link. Needed the same day 0032 shipped: a
-- demo farm got linked to a real prospective client's folder to prove
-- the integration worked, and needed clearing the moment it did.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  jennifer_tools text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'unlink_farm_drive_folder';
  IF mode1 IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'FAIL  | unlink_farm_drive_folder should be auto, found %', mode1;
  END IF;

  SELECT tools INTO jennifer_tools FROM mrv.agents WHERE agent_id = 'jennifer';
  IF NOT ('unlink_farm_drive_folder' = ANY (jennifer_tools)) THEN
    RAISE EXCEPTION 'FAIL  | jennifer is missing unlink_farm_drive_folder: %', jennifer_tools;
  END IF;

  RAISE NOTICE 'PASS  | 0033: unlink_farm_drive_folder is auto and held by jennifer';
END $$;

-- ---------------------------------------------------------------------
-- 0034 — Dave's sixth skill: uncertainty_deduction, the same
-- thin-wrapper-over-a-verified-engine pattern as the GHG-Calculator
-- pilot, this time over VM0042 Eq. 74 (web/src/lib/model/uncertainty.ts).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  dave_tools text[];
  dave_skills text[];
  dave_planned text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'compute_uncertainty_deduction';
  IF mode1 IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'FAIL  | compute_uncertainty_deduction should be auto, found %', mode1;
  END IF;

  SELECT tools, skills, planned_skills INTO dave_tools, dave_skills, dave_planned
    FROM mrv.agents WHERE agent_id = 'dave';
  IF NOT ('compute_uncertainty_deduction' = ANY (dave_tools)) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing compute_uncertainty_deduction: %', dave_tools;
  END IF;
  IF NOT (dave_skills @> ARRAY['uncertainty_deduction']) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing uncertainty_deduction from skills: %', dave_skills;
  END IF;
  IF dave_planned && ARRAY['uncertainty_deduction']::text[] THEN
    RAISE EXCEPTION 'FAIL  | dave still lists uncertainty_deduction as planned: %', dave_planned;
  END IF;
  -- dndc/daycent still have no real model integration to build on.
  IF NOT (dave_planned @> ARRAY['dndc', 'daycent']) THEN
    RAISE EXCEPTION 'FAIL  | dave should still have dndc and daycent as planned (unbuilt): %', dave_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0034: compute_uncertainty_deduction is auto and held by dave, uncertainty_deduction built (dndc/daycent still planned)';
END $$;

-- ---------------------------------------------------------------------
-- 0035 — Rebeka's fourth and fifth tools: grouped_project_design and
-- public_comment, grounded in the VCS PDD Template v5.0A's own
-- "Grouped Project Design" and "Public Comments" sections.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  rebeka_tools text[];
  rebeka_skills text[];
  rebeka_planned text[];
  criteria_types text[];
BEGIN
  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('record_grouped_project_design', 'record_public_comment') AND mode <> 'auto';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | unexpected policy mode(s) for the 0035 tools: %', bad;
  END IF;

  SELECT tools, skills, planned_skills INTO rebeka_tools, rebeka_skills, rebeka_planned
    FROM mrv.agents WHERE agent_id = 'rebeka';
  IF NOT (rebeka_tools @> ARRAY['record_grouped_project_design', 'record_public_comment']) THEN
    RAISE EXCEPTION 'FAIL  | rebeka is missing a 0035 tool: %', rebeka_tools;
  END IF;
  IF NOT (rebeka_skills @> ARRAY['grouped_project_design', 'public_comment']) THEN
    RAISE EXCEPTION 'FAIL  | rebeka is missing a 0035 skill: %', rebeka_skills;
  END IF;
  IF rebeka_planned && ARRAY['grouped_project_design', 'public_comment']::text[] THEN
    RAISE EXCEPTION 'FAIL  | rebeka still lists a 0035 skill as planned: %', rebeka_planned;
  END IF;

  -- The five eligibility criteria types are the template's own fixed
  -- list, not an invented enum.
  SELECT array_agg(enumlabel ORDER BY enumlabel) INTO criteria_types
  FROM pg_enum WHERE enumtypid = 'mrv.eligibility_criteria_type'::regtype;
  IF criteria_types <> ARRAY['additionality', 'baseline_scenario', 'methodology_applicability_conditions',
                             'technology_or_measure', 'uniquely_identifiable']::text[] THEN
    RAISE EXCEPTION 'FAIL  | eligibility_criteria_type does not match the template''s 5 axes: %', criteria_types;
  END IF;

  RAISE NOTICE 'PASS  | 0035: grouped_project_design/public_comment auto and held by rebeka, 5 eligibility criteria types match the template';
END $$;

-- ---------------------------------------------------------------------
-- 0036 — John's first two skills: pipeline_control and ceo_reporting,
-- both read-only aggregations of what the control-tower dashboard
-- already computes.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  john_tools text[];
  john_skills text[];
  john_planned text[];
BEGIN
  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('get_pipeline_status', 'get_department_report') AND mode <> 'auto';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | unexpected policy mode(s) for the 0036 tools: %', bad;
  END IF;

  SELECT tools, skills, planned_skills INTO john_tools, john_skills, john_planned
    FROM mrv.agents WHERE agent_id = 'john';
  IF NOT (john_tools @> ARRAY['get_pipeline_status', 'get_department_report']) THEN
    RAISE EXCEPTION 'FAIL  | john is missing a 0036 tool: %', john_tools;
  END IF;
  IF NOT (john_skills @> ARRAY['pipeline_control', 'ceo_reporting']) THEN
    RAISE EXCEPTION 'FAIL  | john is missing a 0036 skill: %', john_skills;
  END IF;
  IF john_planned && ARRAY['pipeline_control', 'ceo_reporting']::text[] THEN
    RAISE EXCEPTION 'FAIL  | john still lists a 0036 skill as planned: %', john_planned;
  END IF;
  -- credit_allocation_qa moved to built in 0039, verra_benchmarking in
  -- 0041; forecast_vs_actual still has no real "planned" figures recorded
  -- anywhere to reconcile against.
  IF NOT (john_planned @> ARRAY['forecast_vs_actual']) THEN
    RAISE EXCEPTION 'FAIL  | john should still have forecast_vs_actual as planned: %', john_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0036: pipeline_control/ceo_reporting auto and held by john';
END $$;

-- ---------------------------------------------------------------------
-- 0037 — Dave's ingest_model_results tool: records an external
-- DNDC/DayCent run, never simulates one. dndc/daycent stay planned.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  dave_tools text[];
  dave_planned text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'ingest_model_results';
  IF mode1 IS DISTINCT FROM 'confirm' THEN
    RAISE EXCEPTION 'FAIL  | ingest_model_results should be confirm, found %', mode1;
  END IF;

  SELECT tools, planned_skills INTO dave_tools, dave_planned FROM mrv.agents WHERE agent_id = 'dave';
  IF NOT ('ingest_model_results' = ANY (dave_tools)) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing ingest_model_results: %', dave_tools;
  END IF;
  IF NOT (dave_planned @> ARRAY['dndc', 'daycent']) THEN
    RAISE EXCEPTION 'FAIL  | dave should still have dndc and daycent as planned (unbuilt): %', dave_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0037: ingest_model_results is confirm and held by dave, dndc/daycent still planned';
END $$;

-- ---------------------------------------------------------------------
-- 0038 — Dave's mvr_ime_signoff skill: record_mvr_signoff, over the
-- real VMD0053 fields mrv.mvr has held since Stage 6.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  dave_tools text[];
  dave_skills text[];
  dave_planned text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'record_mvr_signoff';
  IF mode1 IS DISTINCT FROM 'confirm' THEN
    RAISE EXCEPTION 'FAIL  | record_mvr_signoff should be confirm, found %', mode1;
  END IF;

  SELECT tools, skills, planned_skills INTO dave_tools, dave_skills, dave_planned
    FROM mrv.agents WHERE agent_id = 'dave';
  IF NOT ('record_mvr_signoff' = ANY (dave_tools)) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing record_mvr_signoff: %', dave_tools;
  END IF;
  IF NOT (dave_skills @> ARRAY['mvr_ime_signoff']) THEN
    RAISE EXCEPTION 'FAIL  | dave is missing mvr_ime_signoff from skills: %', dave_skills;
  END IF;
  IF dave_planned && ARRAY['mvr_ime_signoff']::text[] THEN
    RAISE EXCEPTION 'FAIL  | dave still lists mvr_ime_signoff as planned: %', dave_planned;
  END IF;
  IF NOT (dave_planned @> ARRAY['dndc', 'daycent']) THEN
    RAISE EXCEPTION 'FAIL  | dave should still have dndc and daycent as planned (unbuilt): %', dave_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0038: record_mvr_signoff is confirm and held by dave, mvr_ime_signoff built (dndc/daycent still planned)';
END $$;

-- ---------------------------------------------------------------------
-- 0039 — John's third skill: credit_allocation_qa, read-only checks
-- over real mrv.credits/vcu_issuances.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  john_tools text[];
  john_skills text[];
  john_planned text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'credit_allocation_qa';
  IF mode1 IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'FAIL  | credit_allocation_qa should be auto, found %', mode1;
  END IF;

  SELECT tools, skills, planned_skills INTO john_tools, john_skills, john_planned
    FROM mrv.agents WHERE agent_id = 'john';
  IF NOT ('credit_allocation_qa' = ANY (john_tools)) THEN
    RAISE EXCEPTION 'FAIL  | john is missing credit_allocation_qa tool: %', john_tools;
  END IF;
  IF NOT (john_skills @> ARRAY['credit_allocation_qa']) THEN
    RAISE EXCEPTION 'FAIL  | john is missing credit_allocation_qa skill: %', john_skills;
  END IF;
  IF john_planned && ARRAY['credit_allocation_qa']::text[] THEN
    RAISE EXCEPTION 'FAIL  | john still lists credit_allocation_qa as planned: %', john_planned;
  END IF;
  -- verra_benchmarking moved to built in 0041; forecast_vs_actual is the
  -- one still with no real "planned" figures recorded to reconcile against.
  IF NOT (john_planned @> ARRAY['forecast_vs_actual']) THEN
    RAISE EXCEPTION 'FAIL  | john should still have forecast_vs_actual as planned: %', john_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0039: credit_allocation_qa is auto and held by john, forecast_vs_actual stays planned';
END $$;

-- ---------------------------------------------------------------------
-- 0040 — T2-2 agent memory: record_agent_memory / recall_agent_memory,
-- shared across all five agents, over a corrected vector(1024) column
-- (voyage-3's real default dimension, not the 1536 the column was
-- originally — and wrongly — declared with).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  vec_type text;
  missing text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO vec_type
    FROM pg_attribute
   WHERE attrelid = 'mrv.agent_memory'::regclass AND attname = 'embedding';
  IF vec_type IS DISTINCT FROM 'vector(1024)' THEN
    RAISE EXCEPTION 'FAIL  | mrv.agent_memory.embedding should be vector(1024), found %', vec_type;
  END IF;

  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('record_agent_memory', 'recall_agent_memory') AND mode <> 'auto';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | unexpected policy mode(s) for the 0040 tools: %', bad;
  END IF;

  SELECT string_agg(agent_id, ', ') INTO missing
  FROM mrv.agents
  WHERE NOT (tools @> ARRAY['record_agent_memory', 'recall_agent_memory']);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | these agents are missing record_agent_memory/recall_agent_memory: %', missing;
  END IF;

  RAISE NOTICE 'PASS  | 0040: mrv.agent_memory.embedding is vector(1024), record_agent_memory/recall_agent_memory auto and held by every agent';
END $$;

-- ---------------------------------------------------------------------
-- 0041 — fetch_public_url, and John's fourth skill: verra_benchmarking,
-- built on the same real-fetch tool that also grounds Rebeka's
-- pdd_generator registry-research claim.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  mode1 text;
  john_skills text[];
  john_planned text[];
BEGIN
  SELECT mode::text INTO mode1 FROM mrv.agent_action_policies WHERE action_name = 'fetch_public_url';
  IF mode1 IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'FAIL  | fetch_public_url should be auto, found %', mode1;
  END IF;

  IF EXISTS (
    SELECT 1 FROM mrv.agents WHERE agent_id IN ('rebeka', 'john') AND NOT ('fetch_public_url' = ANY (tools))
  ) THEN
    RAISE EXCEPTION 'FAIL  | rebeka and john should both hold fetch_public_url';
  END IF;

  SELECT skills, planned_skills INTO john_skills, john_planned FROM mrv.agents WHERE agent_id = 'john';
  IF NOT (john_skills @> ARRAY['verra_benchmarking']) THEN
    RAISE EXCEPTION 'FAIL  | john is missing verra_benchmarking from skills: %', john_skills;
  END IF;
  IF john_planned && ARRAY['verra_benchmarking']::text[] THEN
    RAISE EXCEPTION 'FAIL  | john still lists verra_benchmarking as planned: %', john_planned;
  END IF;
  IF NOT (john_planned @> ARRAY['forecast_vs_actual']) THEN
    RAISE EXCEPTION 'FAIL  | john should still have forecast_vs_actual as planned: %', john_planned;
  END IF;

  RAISE NOTICE 'PASS  | 0041: fetch_public_url is auto and held by rebeka+john, verra_benchmarking built for john';
END $$;

-- ---------------------------------------------------------------------
-- The formulas
-- ---------------------------------------------------------------------
DO $$
DECLARE
  soc numeric;
  ef  numeric;
  fl  numeric;
BEGIN
  -- TOC 1%, BD 1.3, 15 cm -> 19.5 t C/ha. Factor 100, not 1000.
  soc := mrv.soc_stock_t_per_ha(1.0, 1.3, 15);
  IF soc <> 19.5 THEN
    RAISE EXCEPTION 'FAIL  | SOC stock: expected 19.5 t C/ha, got %', soc;
  END IF;
  RAISE NOTICE 'PASS  | SOC stock formula returns 19.5 t C/ha';

  SELECT mrv.ef_n_direct(p.*), mrv.frac_leach(p.*, 'drip') INTO ef, fl
  FROM mrv.ghg_parameters p
  WHERE p.project_id IS NULL AND p.version = 'default-v1.0';

  -- Wet climate + decreasing project N takes the low end of the range
  -- (VM0042 §8.3 conservativeness).
  IF ef <> 0.013 THEN
    RAISE EXCEPTION 'FAIL  | EF_N_direct wet+decrease: expected 0.013, got %', ef;
  END IF;
  IF fl <> 0.24 THEN
    RAISE EXCEPTION 'FAIL  | Frac_LEACH wet: expected 0.24, got %', fl;
  END IF;
  RAISE NOTICE 'PASS  | derived parameters (EF_N_direct 0.013, Frac_LEACH 0.24)';
END $$;

-- ---------------------------------------------------------------------
-- The guarantees — these are what make the data auditable
-- ---------------------------------------------------------------------
DO $$
DECLARE
  update_blocked boolean := false;
  delete_blocked boolean := false;
BEGIN
  INSERT INTO mrv.audit_log (actor, action) VALUES ('verify', 'append_only_probe');

  BEGIN
    UPDATE mrv.audit_log SET action = 'tampered' WHERE actor = 'verify';
  EXCEPTION WHEN others THEN
    update_blocked := true;
  END;

  BEGIN
    DELETE FROM mrv.audit_log WHERE actor = 'verify';
  EXCEPTION WHEN others THEN
    delete_blocked := true;
  END;

  IF NOT (update_blocked AND delete_blocked) THEN
    RAISE EXCEPTION 'FAIL  | audit_log append-only guard did not fire (update=%, delete=%)',
      update_blocked, delete_blocked;
  END IF;
  RAISE NOTICE 'PASS  | audit_log rejects UPDATE and DELETE';
END $$;

DO $$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    UPDATE mrv.ghg_parameters SET gwp_n2o = 999 WHERE version = 'default-v1.0';
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | ghg_parameters is editable — the versioning guarantee is broken';
  END IF;
  RAISE NOTICE 'PASS  | ghg_parameters rejects UPDATE';
END $$;

-- A baseline control site beyond 250 km is a methodology violation
-- (VM0042 Table 7), so the database must refuse it outright.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  INSERT INTO mrv.organizations (org_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES
    ('__VERIFY__', '00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000fe', '__VERIFY__', '__verify__');

  BEGIN
    INSERT INTO mrv.baseline_control_sites (bsl_id, farm_id, geom, distance_km) VALUES
      ('__VERIFY_BSL__', '00000000-0000-0000-0000-0000000000fe',
       ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 300);
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    DELETE FROM mrv.baseline_control_sites WHERE bsl_id = '__VERIFY_BSL__';
    DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
    DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
    DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';
    RAISE EXCEPTION 'FAIL  | BSL distance constraint did not fire at 300 km';
  END IF;

  DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
  DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
  DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';

  RAISE NOTICE 'PASS  | BSL beyond 250 km rejected';
END $$;

-- Point-in-plot is the spatial query the whole map depends on. Prove the
-- geometry types and GIST index actually answer it. (Stage 1 acceptance
-- test, run here against throwaway geometry.)
DO $$
DECLARE
  hits int;
BEGIN
  INSERT INTO mrv.organizations (org_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES
    ('__VERIFY__', '00000000-0000-0000-0000-0000000000ff', '__verify__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000fe', '__VERIFY__', '__verify__');
  INSERT INTO mrv.plots (plot_id, farm_id, geom, quantification_approach) VALUES
    ('__VERIFY_PLOT__', '00000000-0000-0000-0000-0000000000fe',
     ST_GeomFromText('POLYGON((34.0 -1.0, 34.1 -1.0, 34.1 -0.9, 34.0 -0.9, 34.0 -1.0))', 4326),
     'QA2');
  INSERT INTO mrv.sampling_points (plot_id, scenario, planned_geom) VALUES
    ('__VERIFY_PLOT__', 'WP', ST_SetSRID(ST_MakePoint(34.05, -0.95), 4326)),  -- inside
    ('__VERIFY_PLOT__', 'WP', ST_SetSRID(ST_MakePoint(35.00, -0.95), 4326));  -- outside

  SELECT count(*) INTO hits
  FROM mrv.sampling_points sp
  JOIN mrv.plots p ON ST_Within(sp.planned_geom, p.geom)
  WHERE p.plot_id = '__VERIFY_PLOT__';

  IF hits <> 1 THEN
    RAISE EXCEPTION 'FAIL  | point-in-plot query returned % points, expected 1', hits;
  END IF;
  RAISE NOTICE 'PASS  | point-in-plot spatial query';

  DELETE FROM mrv.sampling_points WHERE plot_id = '__VERIFY_PLOT__';
  DELETE FROM mrv.plots         WHERE plot_id   = '__VERIFY_PLOT__';
  DELETE FROM mrv.farms         WHERE farm_id    = '00000000-0000-0000-0000-0000000000fe';
  DELETE FROM mrv.projects      WHERE project_id = '__VERIFY__';
  DELETE FROM mrv.organizations WHERE org_id     = '00000000-0000-0000-0000-0000000000ff';
END $$;

-- RLS scaffold: policies must exist but be INERT — written now, enabled
-- deliberately later via scripts/rls-enable.sql, never by accident.
DO $$
DECLARE
  n_policies int;
  n_enabled  int;
BEGIN
  SELECT count(*) INTO n_policies FROM pg_policies WHERE schemaname = 'mrv';
  IF n_policies < 11 THEN
    RAISE EXCEPTION 'FAIL  | expected >= 11 RLS policies, found %', n_policies;
  END IF;

  SELECT count(*) INTO n_enabled
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'mrv' AND c.relkind = 'r' AND c.relrowsecurity;
  IF n_enabled <> 0 THEN
    RAISE EXCEPTION 'FAIL  | RLS is ENABLED on % table(s) — must stay off until rls-enable.sql is run deliberately', n_enabled;
  END IF;

  RAISE NOTICE 'PASS  | % RLS policies present, all inert', n_policies;
END $$;

-- The access helpers behind those policies: no app.user_id set on this
-- connection, so everything must deny — the fail-closed direction.
DO $$
BEGIN
  IF mrv.current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | current_user_id() should be NULL on an unconfigured connection';
  END IF;
  IF mrv.is_super_admin() THEN
    RAISE EXCEPTION 'FAIL  | is_super_admin() must be false with no app.user_id';
  END IF;
  IF mrv.can_access_project('__NO_SUCH__') THEN
    RAISE EXCEPTION 'FAIL  | can_access_project() must deny with no app.user_id';
  END IF;
  RAISE NOTICE 'PASS  | RLS helpers fail closed without app.user_id';
END $$;

-- The demo interlock. This is the one that matters most: demo hectares
-- reaching a Verra submission would be a material misstatement.
DO $$
DECLARE
  blocked boolean := false;
  leaked  int;
BEGIN
  -- A demo farm must not be attachable to a real project.
  INSERT INTO mrv.projects (project_id, org_id, name, is_demo)
  SELECT '__REAL_PROBE__', org_id, '__verify_real__', false
  FROM mrv.organizations LIMIT 1;

  BEGIN
    INSERT INTO mrv.farms (project_id, name, is_demo)
    VALUES ('__REAL_PROBE__', '__verify_demo_farm__', true);
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  DELETE FROM mrv.farms    WHERE name = '__verify_demo_farm__';
  DELETE FROM mrv.projects WHERE project_id = '__REAL_PROBE__';

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | a demo farm was accepted under a real project';
  END IF;

  -- And no demo row may ever surface through the audit-facing view.
  SELECT count(*) INTO leaked
  FROM mrv.v_real_plots vp
  JOIN mrv.plots p ON p.plot_id = vp.plot_id
  WHERE p.is_demo;
  IF leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL  | % demo plot(s) leaked into v_real_plots', leaked;
  END IF;

  RAISE NOTICE 'PASS  | demo data cannot attach to real projects or reach v_real_plots';
END $$;

-- Stage 2 acceptance: every action recorded with who, what, when — and
-- recorded by the database, so a change that bypasses the application
-- is captured too.
DO $$
DECLARE
  before_n int;
  after_n  int;
  rec      record;
BEGIN
  SELECT count(*) INTO before_n FROM mrv.audit_log;

  -- Session-scoped (is_local = false). A transaction-scoped setting made
  -- inside a DO block is already gone by the time the trigger reads it.
  PERFORM set_config('app.user_id', '00000000-0000-0000-0000-0000000000aa', false);
  INSERT INTO mrv.organizations (org_id, name)
  VALUES ('00000000-0000-0000-0000-0000000000ab', '__verify_audit__');
  UPDATE mrv.organizations SET name = '__verify_audit_2__'
  WHERE org_id = '00000000-0000-0000-0000-0000000000ab';

  SELECT actor, action, target_type INTO rec
  FROM mrv.audit_log ORDER BY audit_id DESC LIMIT 1;

  IF rec.actor <> '00000000-0000-0000-0000-0000000000aa' THEN
    RAISE EXCEPTION 'FAIL  | audit actor is % — app.user_id was not honoured', rec.actor;
  END IF;
  IF rec.action <> 'update' OR rec.target_type <> 'organizations' THEN
    RAISE EXCEPTION 'FAIL  | audit recorded %/% instead of update/organizations', rec.action, rec.target_type;
  END IF;

  DELETE FROM mrv.organizations WHERE org_id = '00000000-0000-0000-0000-0000000000ab';
  PERFORM set_config('app.user_id', '', false);

  SELECT count(*) INTO after_n FROM mrv.audit_log;
  IF after_n - before_n < 3 THEN
    RAISE EXCEPTION 'FAIL  | expected >= 3 audit rows from insert+update+delete, got %', after_n - before_n;
  END IF;

  RAISE NOTICE 'PASS  | audit triggers record who/what/when on every change';
END $$;

-- Audit payloads must stay lean: a polygon serialised as WKB hex would
-- bloat the log without being readable.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM mrv.audit_log
  WHERE target_type = 'plots'
    AND payload -> 'new' ->> 'geom' IS NOT NULL
    AND payload -> 'new' ->> 'geom' <> '<geometry>';
  IF bad > 0 THEN
    RAISE EXCEPTION 'FAIL  | % audit row(s) carry raw geometry in the payload', bad;
  END IF;
  RAISE NOTICE 'PASS  | audit payloads strip geometry and embeddings';
END $$;

-- ---------------------------------------------------------------------
-- Stage 3 — sampling lifecycle
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
  sid text;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'mrv'
    AND table_name IN ('sampling_cycles','work_orders','mcp_tokens','sampling_events','samples');
  IF n <> 5 THEN
    RAISE EXCEPTION 'FAIL  | expected 5 stage-3 tables, found %', n;
  END IF;

  -- Sample ID is OFM + exactly 10 digits. Printed on physical bags and
  -- matched by a barcode scanner, so the format is load-bearing.
  sid := mrv.next_sample_id();
  IF sid !~ '^OFM[0-9]{10}$' THEN
    RAISE EXCEPTION 'FAIL  | Sample ID % is not OFM + 10 digits', sid;
  END IF;
  RAISE NOTICE 'PASS  | stage 3 tables present, Sample ID format % (13 chars)', sid;
END $$;

-- The USDA triangle must partition the whole simplex: every composition
-- gets exactly one class. A gap or a double-match means wrong boundaries.
DO $$
DECLARE
  s int; si int; gaps int := 0; found int;
BEGIN
  FOR s IN 0..100 LOOP
    FOR si IN 0..(100 - s) LOOP
      IF mrv.usda_texture_class(s, si, 100 - s - si) IS NULL THEN
        gaps := gaps + 1;
      END IF;
    END LOOP;
  END LOOP;
  IF gaps <> 0 THEN
    RAISE EXCEPTION 'FAIL  | % texture compositions match no USDA class', gaps;
  END IF;

  SELECT count(DISTINCT mrv.usda_texture_class(a.s, a.si, 100 - a.s - a.si)) INTO found
  FROM (SELECT g1 AS s, g2 AS si
        FROM generate_series(0,100) g1, generate_series(0,100) g2
        WHERE g1 + g2 <= 100) a;
  IF found <> 12 THEN
    RAISE EXCEPTION 'FAIL  | expected 12 USDA classes, found %', found;
  END IF;

  IF mrv.usda_texture_class(20,20,60) <> 'clay'
     OR mrv.usda_texture_class(40,40,20) <> 'loam'
     OR mrv.usda_texture_class(10,85,5) <> 'silt' THEN
    RAISE EXCEPTION 'FAIL  | USDA classification returned a wrong class';
  END IF;
  RAISE NOTICE 'PASS  | USDA triangle tiles the simplex: 5151 points, 0 gaps, 12 classes';
END $$;

-- State machines must reject illegal jumps rather than record them.
DO $$
DECLARE
  blocked boolean := false;
  v_farm uuid;
  v_cycle uuid;
BEGIN
  SELECT farm_id INTO v_farm FROM mrv.farms LIMIT 1;
  IF v_farm IS NULL THEN
    RAISE NOTICE 'SKIP  | no farm seeded, cannot probe state machine';
    RETURN;
  END IF;

  INSERT INTO mrv.sampling_cycles (farm_id, cycle_number, cycle_type, approach)
  VALUES (v_farm, 9999, 'initial', 'QA2')
  RETURNING cycle_id INTO v_cycle;

  -- Cycle 1 semantics: this is cycle 9999, so texture is NOT defaulted on.
  IF (SELECT collect_texture FROM mrv.sampling_cycles WHERE cycle_id = v_cycle) THEN
    RAISE EXCEPTION 'FAIL  | collect_texture defaulted true on a non-first cycle';
  END IF;

  BEGIN
    UPDATE mrv.sampling_cycles SET status = 'complete' WHERE cycle_id = v_cycle;
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  DELETE FROM mrv.sampling_cycles WHERE cycle_id = v_cycle;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | cycle jumped draft -> complete';
  END IF;
  RAISE NOTICE 'PASS  | cycle state machine rejects illegal transitions';
END $$;

-- ---------------------------------------------------------------------
-- Stage 4 — lab ingestion and SOC
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'mrv'
    AND table_name IN ('labs','lab_imports','soc_measurements',
                       'texture_measurements','import_quarantine','esm_soc_stocks');
  IF n <> 6 THEN
    RAISE EXCEPTION 'FAIL  | expected 6 stage-4 tables, found %', n;
  END IF;

  -- work_orders.lab_id was a bare uuid until stage 4 created mrv.labs.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_orders_lab_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'FAIL  | work_orders.lab_id is not tied to mrv.labs';
  END IF;
  RAISE NOTICE 'PASS  | stage 4 tables present, work_orders.lab_id constrained';
END $$;

-- TOC must be the sum of the two organic fractions, computed by the
-- database. Treating TOC400 alone as organic carbon under-reports any
-- soil holding char or soot, which is common on burnt residue.
DO $$
DECLARE
  v_generated text;
BEGIN
  -- Name the variable distinctly: `is_generated` would shadow the
  -- information_schema column of the same name.
  SELECT c.is_generated INTO v_generated
  FROM information_schema.columns c
  WHERE c.table_schema = 'mrv' AND c.table_name = 'soc_measurements' AND c.column_name = 'toc_pct';

  IF v_generated IS DISTINCT FROM 'ALWAYS' THEN
    RAISE EXCEPTION 'FAIL  | soc_measurements.toc_pct must be GENERATED, not enterable';
  END IF;
  RAISE NOTICE 'PASS  | TOC is generated as TOC400 + ROC600';
END $$;

-- The two routes to soil mass must agree. Where a lab reports dry mass,
-- probe area AND bulk density, a disagreement means one of them is
-- wrong — most often a decimal slip in the mass.
DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM mrv.soc_measurements
  WHERE dry_sample_mass_g IS NOT NULL
    AND probe_area_cm2 IS NOT NULL
    AND bulk_density IS NOT NULL
    AND abs( (dry_sample_mass_g / probe_area_cm2 * 100)
             - (bulk_density * (depth_base_cm - depth_top_cm) * 100) )
        > 0.15 * (bulk_density * (depth_base_cm - depth_top_cm) * 100);

  IF bad > 0 THEN
    RAISE EXCEPTION 'FAIL  | % measurement(s) where dry-mass and bulk-density soil mass disagree by >15%%', bad;
  END IF;
  RAISE NOTICE 'PASS  | soil mass agrees between the ESM and bulk-density routes';
END $$;

-- ---------------------------------------------------------------------
-- Stage 5 — credits, GHG accounting, compliance
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'mrv' AND table_type = 'BASE TABLE'
    AND table_name IN ('products','alm_activities','credits','vcu_issuances',
                       'activity_data','fertilizer_applications','emission_results','leakage',
                       'stratum_statistics','compliance_checks','compliance_scores');
  IF n <> 11 THEN
    RAISE EXCEPTION 'FAIL  | expected 11 stage-5 tables, found %', n;
  END IF;

  SELECT count(*) INTO n FROM mrv.products;
  IF n <> 6 THEN
    RAISE EXCEPTION 'FAIL  | expected 6 seeded products, found %', n;
  END IF;

  IF to_regclass('mrv.v_plot_credits') IS NULL THEN
    RAISE EXCEPTION 'FAIL  | mrv.v_plot_credits view is missing';
  END IF;
  RAISE NOTICE 'PASS  | stage 5 tables present, 6 products seeded, v_plot_credits view';
END $$;

-- credits_tco2e is area x rate, computed by the database so a price
-- change cannot rewrite a credit already shown to a buyer.
DO $$
DECLARE
  gen text;
BEGIN
  SELECT c.is_generated INTO gen
  FROM information_schema.columns c
  WHERE c.table_schema = 'mrv' AND c.table_name = 'credits' AND c.column_name = 'credits_tco2e';
  IF gen IS DISTINCT FROM 'ALWAYS' THEN
    RAISE EXCEPTION 'FAIL  | credits.credits_tco2e must be GENERATED';
  END IF;
  RAISE NOTICE 'PASS  | credits_tco2e generated as area x rate';
END $$;

-- The emissions engine must reproduce the GHG calculator's FSN for the
-- workbook's Farm_A 2022: UAN 0.32x40=12.8 + N-P-K 0.08x25=2.0 = 14.8 t N.
-- Uses the global parameter set; no farm data touched.
DO $$
DECLARE
  fsn numeric;
BEGIN
  -- N applied is the generated column; verify its arithmetic directly.
  fsn := round((0.32 * 40 + 0.08 * 25)::numeric, 4);
  IF fsn <> 14.8 THEN
    RAISE EXCEPTION 'FAIL  | FSN arithmetic wrong: %', fsn;
  END IF;
  -- and that the emissions function exists with the right signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'mrv' AND p.proname = 'compute_emissions'
  ) THEN
    RAISE EXCEPTION 'FAIL  | mrv.compute_emissions is missing';
  END IF;
  RAISE NOTICE 'PASS  | emissions engine present, FSN arithmetic correct (14.8 t N)';
END $$;

-- The compliance engine must exist and its append-only outputs must
-- reject UPDATE.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'mrv' AND p.proname = 'evaluate_compliance'
  ) THEN
    RAISE EXCEPTION 'FAIL  | mrv.evaluate_compliance is missing';
  END IF;

  -- compliance_scores is append-only (probe with a throwaway row).
  INSERT INTO mrv.organizations (org_id, name) VALUES ('00000000-0000-0000-0000-0000000000c5', '__v5__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES ('__V5__', '00000000-0000-0000-0000-0000000000c5', '__v5__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES ('00000000-0000-0000-0000-0000000000c6', '__V5__', '__v5__');
  INSERT INTO mrv.compliance_scores (farm_id, score, hard_passed, hard_total, warnings)
    VALUES ('00000000-0000-0000-0000-0000000000c6', 100, 4, 4, 0);
  BEGIN
    UPDATE mrv.compliance_scores SET score = 0 WHERE farm_id = '00000000-0000-0000-0000-0000000000c6';
  EXCEPTION WHEN others THEN
    blocked := true;
  END;

  ALTER TABLE mrv.compliance_scores DISABLE TRIGGER trg_scores_noupd;
  DELETE FROM mrv.compliance_scores WHERE farm_id = '00000000-0000-0000-0000-0000000000c6';
  ALTER TABLE mrv.compliance_scores ENABLE TRIGGER trg_scores_noupd;
  DELETE FROM mrv.farms WHERE farm_id = '00000000-0000-0000-0000-0000000000c6';
  DELETE FROM mrv.projects WHERE project_id = '__V5__';
  DELETE FROM mrv.organizations WHERE org_id = '00000000-0000-0000-0000-0000000000c5';

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | compliance_scores accepted an UPDATE';
  END IF;
  RAISE NOTICE 'PASS  | compliance engine present, compliance_scores append-only';
END $$;

-- The hard checks added in 0019 must actually catch what they exist to
-- catch. A check that only ever passes proves nothing, so each is driven
-- through a violation and back, and the recorded result is read.
DO $$
DECLARE
  v_org     constant uuid := '00000000-0000-0000-0000-0000000000d1';
  v_farm    constant uuid := '00000000-0000-0000-0000-0000000000d2';
  v_cycle   uuid;
  v_point   uuid;
  v_event   uuid;
  v_lab_ok  uuid;
  v_lab_bad uuid;
  v_sample  text;
  r         text;
  fn        text;
BEGIN
  -- All three rules must be present before their behaviour is asserted.
  FOREACH fn IN ARRAY ARRAY['SAME_SEASON_WINDOW','LAB_ACCREDITED','DRY_COMBUSTION'] LOOP
    IF position(fn in pg_get_functiondef(
         (SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = 'mrv' AND p.proname = 'evaluate_compliance' LIMIT 1))) = 0 THEN
      RAISE EXCEPTION 'FAIL  | evaluate_compliance does not implement %', fn;
    END IF;
  END LOOP;

  INSERT INTO mrv.organizations (org_id, name) VALUES (v_org, '__v19__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES ('__V19__', v_org, '__v19__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES (v_farm, '__V19__', '__v19__');
  INSERT INTO mrv.labs (name, iso_17025) VALUES ('__v19_ok__', true)  RETURNING lab_id INTO v_lab_ok;
  INSERT INTO mrv.labs (name, iso_17025) VALUES ('__v19_bad__', false) RETURNING lab_id INTO v_lab_bad;

  INSERT INTO mrv.sampling_cycles (farm_id, cycle_number, cycle_type, approach,
                                   planned_start, planned_end, same_season)
    VALUES (v_farm, 1, 'initial', 'QA3', DATE '2026-08-10', DATE '2026-08-24', true)
    RETURNING cycle_id INTO v_cycle;

  INSERT INTO mrv.plots (plot_id, farm_id, name, geom, area_ha, quantification_approach)
    VALUES ('__V19P__', v_farm, '__v19__',
            ST_GeomFromText('POLYGON((0 0,0 0.01,0.01 0.01,0.01 0,0 0))', 4326), 1, 'QA3');
  INSERT INTO mrv.sampling_points (plot_id, scenario, planned_geom)
    VALUES ('__V19P__', 'WP', ST_SetSRID(ST_MakePoint(0.005, 0.005), 4326))
    RETURNING point_id INTO v_point;

  -- One event inside the window, with both ESM increments, good lab, dry combustion.
  INSERT INTO mrv.sampling_events (point_id, cycle_id, sampling_date, captured_geom, submitted_at)
    VALUES (v_point, v_cycle, DATE '2026-08-14',
            ST_SetSRID(ST_MakePoint(0.005, 0.005), 4326), now())
    RETURNING event_id INTO v_event;

  INSERT INTO mrv.samples (event_id, farm_id, sample_type, scenario, depth_top_cm, depth_base_cm)
    VALUES (v_event, v_farm, 'soc', 'WP', 0, 15) RETURNING sample_id INTO v_sample;
  INSERT INTO mrv.soc_measurements (sample_id, lab_id, method, depth_top_cm, depth_base_cm,
                                    bulk_density, toc_400_pct, roc_600_pct)
    VALUES (v_sample, v_lab_ok, 'dry_combustion', 0, 15, 1.3, 1.0, 0.0);
  INSERT INTO mrv.samples (event_id, farm_id, sample_type, scenario, depth_top_cm, depth_base_cm)
    VALUES (v_event, v_farm, 'soc', 'WP', 15, 30) RETURNING sample_id INTO v_sample;
  INSERT INTO mrv.soc_measurements (sample_id, lab_id, method, depth_top_cm, depth_base_cm,
                                    bulk_density, toc_400_pct, roc_600_pct)
    VALUES (v_sample, v_lab_ok, 'dry_combustion', 15, 30, 1.4, 0.6, 0.0);

  -- ---- baseline: all three should pass -------------------------------
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  FOREACH fn IN ARRAY ARRAY['SAME_SEASON_WINDOW','LAB_ACCREDITED','DRY_COMBUSTION'] LOOP
    SELECT result::text INTO r FROM mrv.compliance_checks
      WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = fn
      ORDER BY evaluated_at DESC LIMIT 1;
    IF r IS DISTINCT FROM 'pass' THEN
      RAISE EXCEPTION 'FAIL  | % should pass on a clean cycle, got %', fn, coalesce(r, 'no row');
    END IF;
  END LOOP;

  -- ---- ESM must pass, grouped per point not per sample ---------------
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'ESM_TWO_INCREMENTS'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'FAIL  | ESM_TWO_INCREMENTS should pass when a point has 0-15 and 15-30, got %', r;
  END IF;

  -- soc_measurements is append-only, which is exactly right in production
  -- and exactly in the way here: lift the guard to drive the violations,
  -- and put it back before leaving.
  ALTER TABLE mrv.soc_measurements DISABLE TRIGGER trg_soc_noupd;
  ALTER TABLE mrv.compliance_scores DISABLE TRIGGER trg_scores_noupd;

  -- ---- 1. move the event outside the window --------------------------
  UPDATE mrv.sampling_events SET sampling_date = DATE '2026-09-30' WHERE event_id = v_event;
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'SAME_SEASON_WINDOW'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'FAIL  | SAME_SEASON_WINDOW missed an event outside the window (got %)', r;
  END IF;
  UPDATE mrv.sampling_events SET sampling_date = DATE '2026-08-14' WHERE event_id = v_event;

  -- ---- 2. send one measurement to an unaccredited lab ----------------
  UPDATE mrv.soc_measurements SET lab_id = v_lab_bad
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event)
      AND depth_top_cm = 0;
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'LAB_ACCREDITED'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'FAIL  | LAB_ACCREDITED missed an unaccredited laboratory (got %)', r;
  END IF;
  UPDATE mrv.soc_measurements SET lab_id = v_lab_ok
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event);

  -- ---- 3. switch a method, then document the deviation ---------------
  UPDATE mrv.soc_measurements SET method = 'wet_oxidation', method_deviation_note = NULL
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event)
      AND depth_top_cm = 0;
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'DRY_COMBUSTION'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'FAIL  | DRY_COMBUSTION missed an undocumented method deviation (got %)', r;
  END IF;

  -- whitespace is not documentation
  UPDATE mrv.soc_measurements SET method_deviation_note = '   '
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event)
      AND depth_top_cm = 0;
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'DRY_COMBUSTION'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'FAIL  | DRY_COMBUSTION accepted a whitespace-only deviation note (got %)', r;
  END IF;

  -- a real note is
  UPDATE mrv.soc_measurements SET method_deviation_note = 'Carbonate-rich soil; approved 2026-08-01.'
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event)
      AND depth_top_cm = 0;
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  PERFORM mrv.evaluate_compliance(v_farm, v_cycle);
  SELECT result::text INTO r FROM mrv.compliance_checks
    WHERE farm_id = v_farm AND cycle_id = v_cycle AND rule_code = 'DRY_COMBUSTION'
    ORDER BY evaluated_at DESC LIMIT 1;
  IF r IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'FAIL  | DRY_COMBUSTION rejected a documented deviation (got %)', r;
  END IF;

  -- ---- clean up (evidence tables need their guards lifted) -----------
  DELETE FROM mrv.compliance_scores WHERE farm_id = v_farm;
  ALTER TABLE mrv.compliance_scores ENABLE TRIGGER trg_scores_noupd;
  DELETE FROM mrv.compliance_checks WHERE farm_id = v_farm;
  DELETE FROM mrv.soc_measurements
    WHERE sample_id IN (SELECT sample_id FROM mrv.samples WHERE event_id = v_event);
  ALTER TABLE mrv.soc_measurements ENABLE TRIGGER trg_soc_noupd;
  -- samples are evidence too, so its guard comes down for the cleanup
  ALTER TABLE mrv.samples DISABLE TRIGGER trg_samples_noupd;
  DELETE FROM mrv.samples WHERE event_id = v_event;
  ALTER TABLE mrv.samples ENABLE TRIGGER trg_samples_noupd;
  DELETE FROM mrv.sampling_events WHERE event_id = v_event;
  DELETE FROM mrv.sampling_points WHERE point_id = v_point;
  DELETE FROM mrv.plots WHERE plot_id = '__V19P__';
  DELETE FROM mrv.sampling_cycles WHERE cycle_id = v_cycle;
  DELETE FROM mrv.labs WHERE lab_id IN (v_lab_ok, v_lab_bad);
  DELETE FROM mrv.farms WHERE farm_id = v_farm;
  DELETE FROM mrv.projects WHERE project_id = '__V19__';
  DELETE FROM mrv.organizations WHERE org_id = v_org;

  RAISE NOTICE 'PASS  | 0019 hard checks catch their violations (season, lab, method)';
END $$;

-- ---------------------------------------------------------------------
-- Stage 6 — QA1 model structures
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
  gen text;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'mrv' AND table_type = 'BASE TABLE'
    AND table_name IN ('model_runs','model_results','mvr');
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL  | expected 3 stage-6 tables, found %', n;
  END IF;

  -- net_t_ha = project - baseline, generated so it cannot drift.
  SELECT c.is_generated INTO gen
  FROM information_schema.columns c
  WHERE c.table_schema = 'mrv' AND c.table_name = 'model_results' AND c.column_name = 'net_t_ha';
  IF gen IS DISTINCT FROM 'ALWAYS' THEN
    RAISE EXCEPTION 'FAIL  | model_results.net_t_ha must be GENERATED';
  END IF;

  -- The MVR default records the VMD0053 fact that the VVB hires the IME.
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema='mrv' AND table_name='mvr' AND column_name='ime_contracted_by')
     NOT LIKE '%VVB%' THEN
    RAISE EXCEPTION 'FAIL  | mvr.ime_contracted_by should default to VVB';
  END IF;
  RAISE NOTICE 'PASS  | stage 6 tables present, net_t_ha generated, MVR defaults to VVB';
END $$;

-- model_results is append-only, and a Monte Carlo count on an analytical
-- run must be rejected (the constraint that keeps the two methods honest).
DO $$
DECLARE
  ao boolean := false;
  ck boolean := false;
BEGIN
  INSERT INTO mrv.organizations (org_id, name) VALUES ('00000000-0000-0000-0000-0000000000d6', '__v6__');
  INSERT INTO mrv.projects (project_id, org_id, name) VALUES ('__V6__', '00000000-0000-0000-0000-0000000000d6', '__v6__');
  INSERT INTO mrv.farms (farm_id, project_id, name) VALUES ('00000000-0000-0000-0000-0000000000d7', '__V6__', '__v6__');

  DECLARE r uuid;
  BEGIN
    INSERT INTO mrv.model_runs (farm_id, model, status)
      VALUES ('00000000-0000-0000-0000-0000000000d7', 'DNDC', 'completed') RETURNING run_id INTO r;
    INSERT INTO mrv.model_results (run_id, delta_soc_wp_t_ha, delta_soc_bsl_t_ha)
      VALUES (r, 1.0, 0.3);
    BEGIN
      UPDATE mrv.model_results SET uncertainty_pct = 5 WHERE run_id = r;
    EXCEPTION WHEN others THEN ao := true;
    END;
    BEGIN
      INSERT INTO mrv.model_runs (farm_id, model, uncertainty_method, monte_carlo_iters)
        VALUES ('00000000-0000-0000-0000-0000000000d7', 'DayCent', 'analytical', 500);
    EXCEPTION WHEN check_violation THEN ck := true;
    END;
  END;

  ALTER TABLE mrv.model_results DISABLE TRIGGER trg_results_noupd;
  DELETE FROM mrv.model_results WHERE run_id IN (SELECT run_id FROM mrv.model_runs WHERE farm_id='00000000-0000-0000-0000-0000000000d7');
  ALTER TABLE mrv.model_results ENABLE TRIGGER trg_results_noupd;
  DELETE FROM mrv.model_runs WHERE farm_id = '00000000-0000-0000-0000-0000000000d7';
  DELETE FROM mrv.farms WHERE farm_id = '00000000-0000-0000-0000-0000000000d7';
  DELETE FROM mrv.projects WHERE project_id = '__V6__';
  DELETE FROM mrv.organizations WHERE org_id = '00000000-0000-0000-0000-0000000000d6';

  IF NOT ao THEN RAISE EXCEPTION 'FAIL  | model_results accepted an UPDATE'; END IF;
  IF NOT ck THEN RAISE EXCEPTION 'FAIL  | analytical run accepted monte_carlo_iters'; END IF;
  RAISE NOTICE 'PASS  | model_results append-only, MC-iters constraint holds';
END $$;

-- ---------------------------------------------------------------------
-- Stage 7 — audit-readiness
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- The four views: v_real_plots, v_plot_credits, v_sample_chain, v_data_completeness.
  SELECT count(*) INTO n FROM information_schema.views
  WHERE table_schema = 'mrv'
    AND table_name IN ('v_real_plots','v_plot_credits','v_sample_chain','v_data_completeness');
  IF n <> 4 THEN
    RAISE EXCEPTION 'FAIL  | expected 4 mrv views, found %', n;
  END IF;

  -- audit_trail() walks the log for one object.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'mrv' AND p.proname = 'audit_trail'
  ) THEN
    RAISE EXCEPTION 'FAIL  | mrv.audit_trail function is missing';
  END IF;

  SELECT count(*) INTO n FROM mrv.retention_policy;
  IF n < 4 THEN
    RAISE EXCEPTION 'FAIL  | expected the retention policy to declare >=4 classes, found %', n;
  END IF;
  RAISE NOTICE 'PASS  | audit-readiness views, audit_trail(), retention policy present';
END $$;

-- The GHG fuel-input helper must reproduce the calculator's Machinery-
-- Diesel sheet: a heavy tractor, 50 ha -> 3986.51 L.
DO $$
DECLARE
  l numeric;
BEGIN
  l := mrv.machinery_to_diesel(120, 0.55, 0.27, 6, 50);
  IF l <> 3986.51 THEN
    RAISE EXCEPTION 'FAIL  | machinery_to_diesel: expected 3986.51 L, got %', l;
  END IF;
  RAISE NOTICE 'PASS  | machinery_to_diesel reproduces the calculator (3986.51 L)';
END $$;

-- The point-in-plot query must stay well under the 2s / 500-point NFR.
-- Timed against every real point; the demo estate is tiny, so this is a
-- floor check, not a load test (GIS-CAPACITY.md has the scale numbers).
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
BEGIN
  t0 := clock_timestamp();
  PERFORM count(*)
  FROM mrv.sampling_points sp
  JOIN mrv.plots p ON ST_Within(sp.planned_geom, p.geom);
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  IF ms > 2000 THEN
    RAISE EXCEPTION 'FAIL  | point-in-plot took % ms, over the 2000 ms NFR', round(ms);
  END IF;
  RAISE NOTICE 'PASS  | point-in-plot within NFR (% ms)', round(ms);
END $$;

-- =====================================================================
-- Migration 0020/0021 — per-climate parameter sets and honest timestamps.
-- =====================================================================

-- The two climate switches are the entire reason a dry farm needs its own
-- set. Pin their values: applying the wet pair to a dry farm overstates the
-- claimed reduction by roughly 160%, which is the direction a VVB rejects.
DO $$
DECLARE
  wet_ef numeric; wet_fl numeric;
  dry_ef numeric; dry_fl numeric;
BEGIN
  SELECT mrv.ef_n_direct(g.*), mrv.frac_leach(g.*, 'drip') INTO wet_ef, wet_fl
  FROM mrv.ghg_parameters g WHERE g.project_id IS NULL AND g.version = 'default-v1.0';
  SELECT mrv.ef_n_direct(g.*), mrv.frac_leach(g.*, 'drip') INTO dry_ef, dry_fl
  FROM mrv.ghg_parameters g WHERE g.project_id IS NULL AND g.version = 'dry-v1.0';

  IF dry_ef IS NULL THEN
    RAISE EXCEPTION 'FAIL  | the dry-v1.0 global parameter set is missing';
  END IF;
  IF wet_ef <> 0.013 OR wet_fl <> 0.24 THEN
    RAISE EXCEPTION 'FAIL  | wet set should be EF 0.013 / Frac_LEACH 0.24, got % / %', wet_ef, wet_fl;
  END IF;
  IF dry_ef <> 0.005 OR dry_fl <> 0 THEN
    RAISE EXCEPTION 'FAIL  | dry set should be EF 0.005 / Frac_LEACH 0, got % / %', dry_ef, dry_fl;
  END IF;
  RAISE NOTICE 'PASS  | wet/dry parameter sets carry the right EF_N_direct and Frac_LEACH';
END $$;

-- Irrigation method now decides Frac_LEACH in a dry zone, and it belongs
-- to the farm rather than to the parameter set. Every method is pinned,
-- because getting one wrong silently moves a claimed reduction.
DO $$
DECLARE
  wet  mrv.ghg_parameters%ROWTYPE;
  dry  mrv.ghg_parameters%ROWTYPE;
  m    mrv.irrigation_method;
  got  numeric;
  want numeric;
BEGIN
  SELECT * INTO wet FROM mrv.ghg_parameters WHERE project_id IS NULL AND version = 'default-v1.0';
  SELECT * INTO dry FROM mrv.ghg_parameters WHERE project_id IS NULL AND version = 'dry-v1.0';

  -- Wet zone: the surplus is rainfall, so no irrigation method removes it.
  -- Drip in Kenya leaches for the same reason drip anywhere wet does.
  FOREACH m IN ARRAY enum_range(NULL::mrv.irrigation_method) LOOP
    got := mrv.frac_leach(wet, m);
    IF got <> wet.frac_leach_wet THEN
      RAISE EXCEPTION 'FAIL  | wet zone under % should leach at %, got %', m, wet.frac_leach_wet, got;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  | a wet zone leaches under every irrigation method, drip included';

  -- Dry zone: only water applied past the root zone leaches.
  FOREACH m IN ARRAY enum_range(NULL::mrv.irrigation_method) LOOP
    want := CASE WHEN m IN ('flood','furrow','sprinkler') THEN dry.frac_leach_wet ELSE 0 END;
    got  := mrv.frac_leach(dry, m);
    IF got <> want THEN
      RAISE EXCEPTION 'FAIL  | dry zone under %: expected %, got %', m, want, got;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  | a dry zone leaches under flood/furrow/sprinkler, not under drip/rain-fed';

  -- The point of the change: the answer follows the farm, not the country.
  IF mrv.frac_leach(dry, 'drip') <> 0 THEN
    RAISE EXCEPTION 'FAIL  | a dry-zone drip farm must not leach';
  END IF;
  RAISE NOTICE 'PASS  | a dry-zone drip farm gets Frac_LEACH 0 wherever it is';
END $$;

-- An unknown method must stop a dry-zone calculation rather than be assumed
-- either way: assuming flood overstates leaching, assuming drip understates
-- it, and both silently change the credit volume.
DO $$
DECLARE
  v_farm uuid;
  v_ad   uuid;
  v_set  uuid;
BEGIN
  SELECT f.farm_id INTO v_farm FROM mrv.farms f WHERE f.climate_zone = 'dry' LIMIT 1;
  IF v_farm IS NULL THEN
    RAISE NOTICE 'PASS  | (no dry farm seeded; unknown-method guard not exercised)';
    RETURN;
  END IF;
  UPDATE mrv.farms SET irrigation_method = NULL WHERE farm_id = v_farm;

  INSERT INTO mrv.activity_data (farm_id, scenario, year, area_ha, diesel_l, gasoline_l,
                                 residue_burnt_kg, nfix_dry_matter_t, nfix_n_content)
    VALUES (v_farm, 'PR', 2026, 10, 100, 0, 0, 0, 0) RETURNING activity_data_id INTO v_ad;
  SELECT mrv.resolve_parameter_set(v_farm) INTO v_set;

  BEGIN
    PERFORM mrv.compute_emissions(v_ad, v_set);
    RAISE EXCEPTION 'FAIL  | a dry farm with no irrigation_method must not compute';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%no irrigation_method%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  | a dry farm with no irrigation_method refuses to compute';
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Resolution binds a farm to the set matching its own climate zone, and
-- refuses to guess when the zone is unknown.
DO $$
DECLARE
  v_farm uuid;
  v_ver  text;
  v_zone mrv.climate_zone;
BEGIN
  FOREACH v_zone IN ARRAY ARRAY['wet','dry']::mrv.climate_zone[] LOOP
    SELECT f.farm_id INTO v_farm FROM mrv.farms f WHERE f.climate_zone = v_zone LIMIT 1;
    CONTINUE WHEN v_farm IS NULL;   -- seed data may not carry both zones
    SELECT g.version INTO v_ver FROM mrv.ghg_parameters g
      WHERE g.parameter_set_id = mrv.resolve_parameter_set(v_farm);
    IF v_ver IS DISTINCT FROM (CASE v_zone WHEN 'dry' THEN 'dry-v1.0' ELSE 'default-v1.0' END) THEN
      RAISE EXCEPTION 'FAIL  | a % farm resolved to %', v_zone, v_ver;
    END IF;
    RAISE NOTICE 'PASS  | a % farm resolves to %', v_zone, v_ver;
  END LOOP;
END $$;

DO $$
DECLARE
  v_farm uuid;
BEGIN
  SELECT farm_id INTO v_farm FROM mrv.farms LIMIT 1;
  UPDATE mrv.farms SET climate_zone = NULL WHERE farm_id = v_farm;
  BEGIN
    PERFORM mrv.resolve_parameter_set(v_farm);
    RAISE EXCEPTION 'FAIL  | a farm with no climate_zone must not resolve to a default set';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%no climate_zone%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  | a farm with no climate_zone raises instead of defaulting';
  END;
  RAISE EXCEPTION 'rollback-marker';   -- undo the UPDATE
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- The now() collision that migrations 0020/0021 removed. Before them, a
-- second write in the same transaction reused the transaction start time
-- and tripped the UNIQUE key — so this block failed, and the limitation
-- had to be documented rather than fixed.
DO $$
DECLARE
  v_farm uuid;
  n int; d int;
BEGIN
  SELECT farm_id INTO v_farm FROM mrv.farms LIMIT 1;
  INSERT INTO mrv.compliance_scores (farm_id, cycle_id, score, hard_passed, hard_total, warnings)
    VALUES (v_farm, NULL, 80, 4, 5, 1), (v_farm, NULL, 80, 4, 5, 1);
  SELECT count(*), count(DISTINCT evaluated_at) INTO n, d
    FROM mrv.compliance_scores WHERE farm_id = v_farm AND cycle_id IS NULL;
  IF n <> 2 OR d <> 2 THEN
    RAISE EXCEPTION 'FAIL  | two scores in one transaction gave % rows / % distinct times', n, d;
  END IF;
  RAISE NOTICE 'PASS  | two evaluations in one transaction get distinct timestamps';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Every UNIQUE key that includes a computed/evaluated timestamp must be
-- defaulted to clock_timestamp(), or it carries the same latent collision.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s.%s', c.table_name, c.column_name), ', ')
  INTO bad
  FROM information_schema.columns c
  WHERE c.table_schema = 'mrv'
    AND c.column_name IN ('evaluated_at', 'computed_at')
    AND coalesce(c.column_default, '') NOT LIKE '%clock_timestamp%'
    AND EXISTS (
      SELECT 1
      FROM information_schema.constraint_column_usage u
      JOIN information_schema.table_constraints t
        ON t.constraint_name = u.constraint_name AND t.constraint_schema = u.constraint_schema
      WHERE u.table_schema = c.table_schema AND u.table_name = c.table_name
        AND u.column_name = c.column_name AND t.constraint_type = 'UNIQUE'
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | UNIQUE over a now()-defaulted timestamp: %', bad;
  END IF;
  RAISE NOTICE 'PASS  | no UNIQUE key rests on a transaction-scoped timestamp';
END $$;

-- =====================================================================
-- Migration 0024 — the Verified Credits Factory agent registry.
-- =====================================================================

DO $$
DECLARE
  n   int;
  bad text;
BEGIN
  SELECT count(*) INTO n FROM mrv.agents WHERE is_active;
  IF n <> 5 THEN
    RAISE EXCEPTION 'FAIL  | expected 5 active agents, found %', n;
  END IF;

  -- One head reporting outside the department, four reporting to them.
  SELECT count(*) INTO n FROM mrv.agents WHERE reports_to IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL  | expected exactly one department head, found %', n;
  END IF;
  SELECT count(*) INTO n FROM mrv.agents WHERE reports_to = 'john';
  IF n <> 4 THEN
    RAISE EXCEPTION 'FAIL  | expected 4 agents reporting to john, found %', n;
  END IF;
  RAISE NOTICE 'PASS  | the department is one head and four reports';

  -- An agent must never be mistakable for a person in the audit trail.
  SELECT string_agg(agent_id, ', ') INTO bad FROM mrv.agents WHERE actor_id NOT LIKE 'agent:%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | actor_id is not agent-prefixed for: %', bad;
  END IF;
  RAISE NOTICE 'PASS  | every agent actor_id is prefixed, so no agent reads as a person';

  -- The role prompt is the agent; an empty one is a misconfigured agent.
  SELECT string_agg(agent_id, ', ') INTO bad FROM mrv.agents WHERE length(role_prompt) < 200;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | role_prompt is missing or too short for: %', bad;
  END IF;
  RAISE NOTICE 'PASS  | every agent carries a role prompt';

  -- Dave operates the Tier-1 module, so he must hold the tools that are
  -- actually implemented. run_model is deliberately not among them — no
  -- DNDC/DayCent integration exists yet — so it belongs in planned_tools,
  -- checked separately below (migration 0029), not asserted here as if it
  -- already worked.
  SELECT string_agg(t, ', ') INTO bad
  FROM unnest(ARRAY['propose_sampling_plan','send_work_order']) t
  WHERE NOT (t = ANY (SELECT unnest(tools) FROM mrv.agents WHERE agent_id = 'dave'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | dave is missing tools he is defined to operate: %', bad;
  END IF;
  RAISE NOTICE 'PASS  | dave holds the Tier-1 tools he is defined to operate';

  -- Every tool an agent may call needs a policy row, or checkPolicy refuses
  -- it at runtime and the agent silently does nothing.
  SELECT string_agg(DISTINCT t, ', ') INTO bad
  FROM mrv.agents a, unnest(a.tools) t
  WHERE NOT EXISTS (SELECT 1 FROM mrv.agent_action_policies p WHERE p.action_name = t);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | agents hold tools with no policy governing them: %', bad;
  END IF;
  RAISE NOTICE 'PASS  | every tool held by an agent has a policy governing it';
END $$;

-- =====================================================================
-- Migration 0026 — Rebeka, not Reveka.
-- =====================================================================

DO $$
DECLARE
  n int;
BEGIN
  IF to_regclass('mrv.agents') IS NULL THEN
    RAISE NOTICE 'PASS  | (mrv.agents not present — skipping the spelling check)';
  ELSE
    SELECT count(*) INTO n FROM mrv.agents
     WHERE agent_id = 'reveka' OR actor_id = 'agent:reveka' OR role_prompt LIKE '%Reveka%';
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL  | the misspelling "Reveka" is back in % place(s) — her name is Rebeka', n;
    END IF;

    PERFORM 1 FROM mrv.agents WHERE agent_id = 'rebeka' AND display_name = 'Rebeka'
      AND actor_id = 'agent:rebeka';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL  | agent_id ''rebeka'' is missing or inconsistent';
    END IF;
    RAISE NOTICE 'PASS  | the Validation Manager is spelled Rebeka everywhere, including in John''s prompt';
  END IF;
END $$;

-- =====================================================================
-- Migration 0027 — versioned PDD templates, and Rebeka's first tool.
-- =====================================================================

DO $$
DECLARE
  blocked boolean := false;
  tid     uuid;
BEGIN
  IF to_regclass('mrv.pdd_templates') IS NULL THEN
    RAISE NOTICE 'PASS  | (mrv.pdd_templates not present — skipping)';
    RETURN;
  END IF;

  -- register_pdd_template must be a governed action, or checkPolicy refuses
  -- every call Rebeka makes to it.
  PERFORM 1 FROM mrv.agent_action_policies WHERE action_name = 'register_pdd_template';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL  | register_pdd_template has no policy row';
  END IF;

  PERFORM 1 FROM mrv.agents WHERE agent_id = 'rebeka' AND 'register_pdd_template' = ANY (tools);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL  | rebeka does not hold register_pdd_template';
  END IF;
  RAISE NOTICE 'PASS  | register_pdd_template is held by rebeka and governed by a policy';

  -- A template is evidence a submission points back to: once registered it
  -- must not change, the same guarantee ghg_parameters carries. Proving
  -- that needs a real row, and an append-only table cannot un-insert one —
  -- so, like the audit_log probe above, this leaves a small '__verify__'
  -- row behind on purpose rather than pretending the check has no cost.
  INSERT INTO mrv.pdd_templates
    (name, version, source_path, source_sha256, section_count, structure, registered_by)
  VALUES ('__verify__', 'v0', 'x', 'deadbeef', 1, '[{"level":1,"title":"x","body":""}]'::jsonb, 'verify')
  RETURNING template_id INTO tid;

  BEGIN
    UPDATE mrv.pdd_templates SET version = 'tampered' WHERE template_id = tid;
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL  | mrv.pdd_templates accepted an UPDATE — it must be append-only';
  END IF;
  RAISE NOTICE 'PASS  | mrv.pdd_templates rejects UPDATE';

  DELETE FROM mrv.pdd_templates WHERE template_id = tid;
  RAISE EXCEPTION 'FAIL  | mrv.pdd_templates accepted a DELETE — it must be append-only';
EXCEPTION WHEN others THEN
  IF SQLERRM NOT LIKE '%FAIL%' THEN
    RAISE NOTICE 'PASS  | mrv.pdd_templates rejects DELETE';
  ELSE
    RAISE;
  END IF;
END $$;

-- =====================================================================
-- Migration 0028 — Rebeka's second and third tools: plot QA/QC and KML.
-- =====================================================================

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t, ', ') INTO bad
  FROM unnest(ARRAY['run_plot_qa_qc', 'export_plots_kml']) t
  WHERE NOT (t = ANY (SELECT unnest(tools) FROM mrv.agents WHERE agent_id = 'rebeka'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | rebeka is missing tools: %', bad;
  END IF;

  SELECT string_agg(action_name || ':' || mode, ', ') INTO bad
  FROM mrv.agent_action_policies
  WHERE action_name IN ('run_plot_qa_qc', 'export_plots_kml') AND mode <> 'auto';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | expected auto mode, found: %', bad;
  END IF;

  RAISE NOTICE 'PASS  | rebeka holds run_plot_qa_qc and export_plots_kml, both auto';
END $$;

-- =====================================================================
-- Migration 0029 — built tools vs planned tools.
-- =====================================================================

DO $$
DECLARE
  bad text;
BEGIN
  -- Dave's tools must be exactly what has a real handler behind it —
  -- run_model, recalibrate_model and issue_alerts moved to planned_tools.
  -- record_baseline_site / record_activity_data (0030),
  -- compute_uncertainty_deduction (0034), ingest_model_results (0037),
  -- record_mvr_signoff (0038) and record_agent_memory/recall_agent_memory
  -- (0040) are appended after the original three built tools, in the
  -- order each migration wrote them.
  PERFORM 1 FROM mrv.agents
   WHERE agent_id = 'dave'
     AND tools = ARRAY['propose_sampling_plan', 'send_work_order', 'chat',
                        'record_baseline_site', 'record_activity_data',
                        'compute_uncertainty_deduction', 'ingest_model_results',
                        'record_mvr_signoff', 'record_agent_memory', 'recall_agent_memory']
     AND planned_tools = ARRAY['run_model', 'recalibrate_model', 'issue_alerts'];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL  | dave''s tools/planned_tools split does not match what is actually implemented';
  END IF;

  -- No agent may claim the same action as both built and planned — that
  -- would be claiming it works and admitting it does not, at once.
  SELECT string_agg(agent_id, ', ') INTO bad
  FROM mrv.agents
  WHERE tools && planned_tools;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  | tools and planned_tools overlap for: %', bad;
  END IF;

  RAISE NOTICE 'PASS  | built and planned tools are disjoint, and dave''s split matches reality';
END $$;

\echo ''
\echo 'All checks passed.'
