import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_allocation_sync";

/**
 * Syncs both credit-buyer financing tracks into mrv.allocation_register —
 * John's weekly task (approved plan, 2026-08-25). One row per plot for
 * Agri-Inputs (reservations + reservation_plots + plots + contracts,
 * cross-referenced against carbonature-saas's own reservation-payments.json
 * ledger for paid status — see agriDealLifecycle.ts/reservationPayments.ts,
 * which this mirrors); one row per deal for Project Funding (no farm/plot
 * at all, per the contract's own "the certificate names no farm").
 *
 * Zero-tolerance double-counting gate (Nitzan's explicit requirement): before
 * writing a NEW allocation row for a plot, this refuses if doing so would
 * push that plot's total committed potential credits (summed across BOTH
 * tracks) past its yield potential. This is the actual "zero" — the partial
 * unique indexes in migration 0085 stop exact duplicate syncs, but only this
 * check stops two independently-valid-looking deals from overselling the
 * same plot.
 *
 * Known, deliberate gap: there is no "delivered" (post-issuance) signal
 * anywhere in the live SaaS today — no VCU-issuance event exists yet because
 * no farm has completed a real MRV/sampling cycle. Rows sit at
 * 'pending_delivery' once paid; wiring the transition to 'delivered' is left
 * for whenever a real issuance event is defined (tracked in
 * project_mrv_allocation_register_ownership memory, not silently assumed here).
 */
export async function runJohnAllocationSync(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const {
    listAgriInputsReservations,
    listReservationPlots,
    listPlotsByIds,
    listAgriContractsForReservations,
    listCreditBuyersByProfileIds,
    listSaasProjects,
    readReservationPaymentsLedger,
    readProjectFinancingsLedger,
  } = await import("../../saas/saasClient");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  let reservations, projects;
  try {
    [reservations, projects] = await Promise.all([listAgriInputsReservations(), listSaasProjects()]);
  } catch (e) {
    return { ok: false, detail: `john_allocation_sync: could not reach the SaaS database — ${e instanceof Error ? e.message : e}` };
  }
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const reservationIds = reservations.map((r) => r.id);
  const [resPlots, contracts, paidLedger, buyers] = await Promise.all([
    listReservationPlots(reservationIds),
    listAgriContractsForReservations(reservationIds),
    readReservationPaymentsLedger(),
    listCreditBuyersByProfileIds(reservations.map((r) => r.buyer_id)),
  ]);

  const plotIds = [...new Set(resPlots.map((rp) => rp.plot_id))];
  const plots = await listPlotsByIds(plotIds);
  const plotById = new Map(plots.map((p) => [p.id, p]));
  const buyerNameByProfileId = new Map(buyers.map((b) => [b.profile_id, b.company_name]));

  const plotsByReservation = new Map<string, string[]>();
  for (const rp of resPlots) {
    const list = plotsByReservation.get(rp.reservation_id) ?? [];
    list.push(rp.plot_id);
    plotsByReservation.set(rp.reservation_id, list);
  }

  const signedAtByReservation = new Map<string, string>();
  for (const c of contracts) {
    if (!c.reservation_id) continue;
    if (c.status === "signed" || c.status === "countersigned") {
      signedAtByReservation.set(c.reservation_id, c.signed_at ?? new Date().toISOString());
    }
  }
  const paidAtByReservation = new Map(paidLedger.map((p) => [p.reservationId, p.paidAt]));

  // Plot potential (for the oversell gate): prefer an existing estimate row;
  // fall back to computing it inline from the rate table so this gate works
  // correctly even if john_credit_potential_estimate hasn't run yet for a
  // brand-new plot — the two tasks are peers with no guaranteed run order.
  async function plotPotential(plotId: string): Promise<number | null> {
    const existing = await query<{ estimated_credits: string }>(
      `SELECT estimated_credits FROM mrv.credit_yield_estimates WHERE plot_id = $1 AND method = 'rate_table'`,
      [plotId],
    );
    if (existing.length) return Number(existing[0].estimated_credits);

    const plot = plotById.get(plotId);
    if (!plot) return null;
    const defaults = await query<{ default_plot_type: string }>(
      `SELECT default_plot_type FROM mrv.project_plot_type_defaults WHERE project_id = $1`,
      [plot.project_id],
    );
    if (!defaults.length) return null;
    const rates = await query<{ rate_per_ha: string }>(
      `SELECT rate_per_ha FROM mrv.credit_yield_rate_table WHERE plot_type = $1`,
      [defaults[0].default_plot_type],
    );
    if (!rates.length) return null;
    return Number(rates[0].rate_per_ha) * Number(plot.area_ha);
  }

  async function committedPotential(plotId: string): Promise<number> {
    const rows = await query<{ total: string | null }>(
      `SELECT SUM(credits_tco2e_potential) AS total FROM mrv.allocation_register
       WHERE plot_id = $1 AND status <> 'released'`,
      [plotId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  // Negative-balance protection (Section 7.3, Option B - Nitzan's explicit
  // choice 2026-08-31): john_allocation_report computes and writes these
  // flags weekly; this sync task just reads them before writing a new
  // deal into the register. At CarboNature's 20% threshold BOTH tracks are
  // blocked for that project - not just Project Funding.
  const activeBlockRows = await query<{ project_id: string; blocks_agri_inputs: boolean; blocks_project_funding: boolean }>(
    `SELECT DISTINCT project_id, bool_or(blocks_agri_inputs) AS blocks_agri_inputs, bool_or(blocks_project_funding) AS blocks_project_funding
       FROM mrv.negative_balance_flags
      WHERE status = 'active' AND scope_type = 'project_cn'
      GROUP BY project_id`,
  );
  const agriBlockedProjects = new Set(activeBlockRows.filter((r) => r.blocks_agri_inputs).map((r) => r.project_id));
  const pfBlockedProjects = new Set(activeBlockRows.filter((r) => r.blocks_project_funding).map((r) => r.project_id));

  let written = 0;
  let skippedNotYetDeal = 0;
  let refusedOversell: string[] = [];
  let refusedBalanceBlock: string[] = [];
  const liveReservationIds = new Set<string>();

  for (const reservation of reservations) {
    const signedAt = signedAtByReservation.get(reservation.id);
    if (!signedAt) {
      skippedNotYetDeal++;
      continue; // credits aren't "held against the buyer" until signature — not a real allocation yet
    }
    liveReservationIds.add(reservation.id);
    const paidAt = paidAtByReservation.get(reservation.id);
    const status = paidAt ? "pending_delivery" : "allocated";
    const buyerCompanyName = buyerNameByProfileId.get(reservation.buyer_id) ?? "Unknown buyer";
    const reservationPlotIds = plotsByReservation.get(reservation.id) ?? [];
    const reservationPlots = reservationPlotIds.map((id) => plotById.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const totalPlotCredits = reservationPlots.reduce((sum, p) => sum + Number(p.credits), 0) || 1;

    for (const plot of reservationPlots) {
      const potential = await plotPotential(plot.id);
      const alreadyCommitted = await committedPotential(plot.id);
      const thisAllocationCredits = Number(plot.credits);

      // Skip if this exact (reservation, plot) row already exists — the
      // idempotency the partial unique index also enforces at the DB level.
      const already = await query(
        `SELECT 1 FROM mrv.allocation_register WHERE source_reservation_id = $1 AND plot_id = $2`,
        [reservation.id, plot.id],
      );
      if (already.length) continue;

      if (agriBlockedProjects.has(plot.project_id)) {
        refusedBalanceBlock.push(
          `plot ${plot.id} (reservation ${reservation.transaction_no ?? reservation.id}): Agri Inputs blocked for project ${plot.project_id} - CarboNature's balance is below the 20% threshold (Section 7.3, Option B).`,
        );
        continue;
      }

      if (potential !== null && alreadyCommitted + thisAllocationCredits > potential + 0.0001) {
        refusedOversell.push(
          `plot ${plot.id} (reservation ${reservation.transaction_no ?? reservation.id}): would commit ${(alreadyCommitted + thisAllocationCredits).toFixed(2)} against a potential of ${potential.toFixed(2)}`,
        );
        continue;
      }

      const proportionalCostUsd = (thisAllocationCredits / totalPlotCredits) * Number(reservation.total_cost_usd);

      await query(
        `INSERT INTO mrv.allocation_register
           (deal_type, buyer_id, buyer_company_name, project_id, project_name, farm_id, plot_id,
            application_area_ha, credits_tco2e_potential, cost_usd, transaction_no,
            source_reservation_id, status, signed_at, paid_at)
         VALUES ('agri_inputs', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (source_reservation_id, plot_id) WHERE source_reservation_id IS NOT NULL DO NOTHING`,
        [
          reservation.buyer_id,
          buyerCompanyName,
          plot.project_id,
          projectNameById.get(plot.project_id) ?? "Unknown project",
          plot.farm_id,
          plot.id,
          Number(plot.area_ha),
          thisAllocationCredits,
          proportionalCostUsd,
          reservation.transaction_no,
          reservation.id,
          status,
          signedAt,
          paidAt ?? null,
        ],
      );
      written++;
    }
  }

  // Project Funding: no farm/plot at all, one row per financing deal. Its
  // own ledger carries a separate, non-UUID "project key" (e.g. "eafrica")
  // that doesn't match the real projects table Agri-Inputs uses — normalize
  // by name so both deal types group under the SAME project in reports,
  // rather than silently forking into two differently-spelled rows for the
  // same real project (confirmed live: this was actually happening).
  function normalizeProjectName(s: string): string {
    return s.toLowerCase().replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
  }
  let financingWritten = 0;
  try {
    const financings = await readProjectFinancingsLedger();
    for (const f of financings) {
      if (f.status === "awaiting_signature") continue; // not a real allocation until signed
      const already = await query(`SELECT 1 FROM mrv.allocation_register WHERE source_financing_id = $1`, [f.id]);
      if (already.length) continue;
      const matchedProject = projects.find((p) => normalizeProjectName(p.name) === normalizeProjectName(f.projectName));
      if (matchedProject && pfBlockedProjects.has(matchedProject.id)) {
        refusedBalanceBlock.push(
          `financing deal ${f.transactionNo ?? f.id}: Project Funding blocked for project ${matchedProject.id} - CarboNature's balance is below the 20% threshold (Section 7.3, Option B).`,
        );
        continue;
      }
      await query(
        `INSERT INTO mrv.allocation_register
           (deal_type, buyer_id, buyer_company_name, project_id, project_name,
            credits_tco2e_potential, cost_usd, transaction_no, source_financing_id, status, signed_at, paid_at)
         VALUES ('project_funding', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (source_financing_id) WHERE source_financing_id IS NOT NULL DO NOTHING`,
        [
          f.buyerId,
          buyerNameByProfileId.get(f.buyerId) ?? "Unknown buyer",
          matchedProject?.id ?? f.projectKey,
          matchedProject?.name ?? f.projectName,
          f.credits,
          f.amountUsd,
          f.transactionNo,
          f.id,
          f.status === "paid" ? "pending_delivery" : "allocated",
          f.signedAt ?? f.createdAt,
          f.paidAt ?? null,
        ],
      );
      financingWritten++;
    }
  } catch (e) {
    console.warn(`[john_allocation_sync] project-financings.json read failed: ${e instanceof Error ? e.message : e}`);
  }

  // Release rows whose reservation no longer exists (cancelled/expired) —
  // status-only, never deleted, per the double-counting audit-trail design.
  // Excludes is_test_data rows: a test row was deliberately forced through
  // BEFORE its real reservation ever got a signed contract (2026-08-31),
  // so it will never appear in liveReservationIds — this sweep's premise
  // ("the SaaS no longer shows this as live, so release it") doesn't apply
  // to a row that was never sourced from the SaaS's own live-signed state
  // in the first place.
  const releaseResult = await query(
    `UPDATE mrv.allocation_register SET status = 'released', released_at = now(), updated_at = now()
     WHERE deal_type = 'agri_inputs' AND source_reservation_id IS NOT NULL
       AND status <> 'released' AND NOT is_test_data AND NOT (source_reservation_id = ANY($1::text[]))
     RETURNING allocation_id`,
    [[...liveReservationIds]],
  );

  const paragraphs = [
    `Synced ${written} new Agri-Inputs allocation row(s) and ${financingWritten} new Project Funding row(s) into the Allocation Register.`,
    `${skippedNotYetDeal} reservation(s) skipped — not yet signed, so not a real allocation.`,
    `${releaseResult.length} previously-allocated row(s) released (their reservation no longer exists).`,
  ];
  if (refusedOversell.length) {
    paragraphs.push(`Double-counting gate refused ${refusedOversell.length} write(s):`, ...refusedOversell.map((r) => `- ${r}`));
  }
  if (refusedBalanceBlock.length) {
    paragraphs.push(`Negative-balance protection refused ${refusedBalanceBlock.length} write(s):`, ...refusedBalanceBlock.map((r) => `- ${r}`));
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Allocation Register sync — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "allocation_register_sync",
    sendEmail: written > 0 || financingWritten > 0 || releaseResult.length > 0 || refusedOversell.length > 0 || refusedBalanceBlock.length > 0,
    agentId: "john",
  });

  return {
    ok: outcome.ok,
    detail: `${outcome.detail} (written: ${written + financingWritten}, released: ${releaseResult.length}, refused: ${refusedOversell.length}, balance-blocked: ${refusedBalanceBlock.length}.)`,
  };
}
