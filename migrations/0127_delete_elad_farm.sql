-- migrate:up
-- =====================================================================
-- 0127 — permanently delete Elad Farm and its records.
--
-- Nitzan's own request (2026-10-18): Elad Farm is an old demo farm that is
-- no longer active — delete it and its records from the system for good.
-- Everything below is keyed by the farm's own id and its owner's profile id,
-- so on a database that never had them it is a no-op.
--
--   farm  8a42abd0-125c-49ad-9077-36b5cd76d86f   ("elad" / company "bouton")
--   owner 3a49c6a4-9719-4b83-aa63-1adcd3d5237b   (profile "elad", farmer, one farm)
--
-- What goes: the SaaS farm, its 2 plots, the owner's profile + login +
-- countersigned carbon-rights contract + MRV directory row; the MRV farm and
-- everything under it (plots, strata, 11 sampling points, the draft sampling
-- cycle, BSL activity data and its fertiliser lines, baseline site, crop
-- cycles), plus the allocation-register row (a released agri-inputs deal),
-- the 2 credit-yield estimates, the plot-type override and the 3
-- negative-balance flags.
--
-- What deliberately stays: mrv.audit_log (append-only by design — a record of
-- what happened is not a record about the farm), the historical weekly
-- reports and agent lessons that merely mention it, and the CRM mailbox.
-- One audit row is written for this deletion itself.
--
-- Checked first (2026-10-18): no reservation or work order references either
-- plot, so no live buyer deal is touched.
-- =====================================================================

-- MRV rows that either have no FK or point at public.* with NO ACTION
DELETE FROM mrv.negative_balance_flags    WHERE scope_id = '8a42abd0-125c-49ad-9077-36b5cd76d86f';
DELETE FROM mrv.plot_crop_cycles          WHERE farm_id  = '8a42abd0-125c-49ad-9077-36b5cd76d86f';
DELETE FROM mrv.allocation_register       WHERE farm_id  = '8a42abd0-125c-49ad-9077-36b5cd76d86f';
DELETE FROM mrv.credit_yield_estimates    WHERE farm_id  = '8a42abd0-125c-49ad-9077-36b5cd76d86f';
DELETE FROM mrv.farm_plot_type_overrides  WHERE farm_id  = '8a42abd0-125c-49ad-9077-36b5cd76d86f';

-- the MRV farm — cascades plots, strata, sampling points, cycles, activity data (+ fertiliser lines), baseline sites
DELETE FROM mrv.farms WHERE farm_id = '8a42abd0-125c-49ad-9077-36b5cd76d86f';

-- the SaaS side
DELETE FROM public.plots WHERE farm_id = '8a42abd0-125c-49ad-9077-36b5cd76d86f';
DELETE FROM public.farms WHERE id      = '8a42abd0-125c-49ad-9077-36b5cd76d86f';

-- the owner: directory row, contract, profile, login
DELETE FROM mrv.users          WHERE user_id    = '3a49c6a4-9719-4b83-aa63-1adcd3d5237b';
DELETE FROM public.contracts   WHERE profile_id = '3a49c6a4-9719-4b83-aa63-1adcd3d5237b';
DELETE FROM public.profiles    WHERE id         = '3a49c6a4-9719-4b83-aa63-1adcd3d5237b';
DELETE FROM auth.users         WHERE id         = '3a49c6a4-9719-4b83-aa63-1adcd3d5237b';

INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
VALUES (
  'nitzan@carbonature.io',
  'delete_farm',
  'farm',
  '8a42abd0-125c-49ad-9077-36b5cd76d86f',
  '{"farm":"Elad Farm","reason":"old inactive demo farm — permanent deletion requested by Nitzan","migration":"0127"}'::jsonb
);

-- migrate:down
-- Not reversible: this deletion is permanent by request. (A transient copy of the
-- deleted rows was kept only for the duration of the session that ran it.)
SELECT 1;
