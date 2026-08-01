-- migrate:up
-- =====================================================================
-- 0023 — a generator for work-order ids.
--
-- mrv.work_orders.wo_id is a text primary key in the form 'WO-2026-0042',
-- and until now nothing produced one: the id had to be supplied by the
-- caller. Composing it in application code means reading the highest
-- existing number and adding one, which two managers issuing at the same
-- moment will both do, and one of them will lose to the primary key.
--
-- So it follows mrv.next_sample_id(): a sequence does the allocation, which
-- is atomic and never reuses a number even when a transaction rolls back.
-- A gap in the numbering is not a problem — a duplicate would be.
--
-- The sequence is not reset per year. Resetting needs either a scheduled
-- job or a per-year sequence created on demand, and both introduce a moment
-- where two transactions can allocate the same value. The year in the id
-- stays useful for reading at a glance; strict within-year numbering is not
-- worth a collision, since the id is an identifier and not a count.
-- =====================================================================

CREATE SEQUENCE mrv.work_order_id_seq;

CREATE OR REPLACE FUNCTION mrv.next_wo_id() RETURNS text AS $$
  SELECT 'WO-' || to_char(current_date, 'YYYY') || '-' ||
         lpad(nextval('mrv.work_order_id_seq')::text, 4, '0');
$$ LANGUAGE sql;

COMMENT ON FUNCTION mrv.next_wo_id() IS
  'Work-order id: WO-<year>-<4 digits>, allocated from a sequence so concurrent issuance cannot collide. The counter does not reset each year; the year is for reading, not for counting.';

ALTER TABLE mrv.work_orders ALTER COLUMN wo_id SET DEFAULT mrv.next_wo_id();

-- migrate:down
ALTER TABLE mrv.work_orders ALTER COLUMN wo_id DROP DEFAULT;
DROP FUNCTION IF EXISTS mrv.next_wo_id();
DROP SEQUENCE IF EXISTS mrv.work_order_id_seq;
