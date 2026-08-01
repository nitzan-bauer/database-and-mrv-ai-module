import "server-only";
import { DEFAULT_GRACE_DAYS, hashToken, tokenExpiry } from "../mcp/token";
import { randomBytes } from "node:crypto";
import {
  audit,
  checkPolicy,
  fail,
  ok,
  requireDbMode,
  type ToolContext,
  type ToolResult,
} from "./context";

export interface IssuedWorkOrder {
  woId: string;
  tokenId: string;
  /** Returned once. Only its hash is stored, so it cannot be shown again. */
  rawToken: string;
  samplerUrl: string;
  expiresAt: string;
  points: number;
}

/**
 * Issue a work order and the one token that opens it.
 *
 * The token is the whole access model for an external sampler. They never
 * get an account: they get a link scoped to one work order, valid until the
 * sampling window closes plus a grace period, and revocable on its own
 * without touching anyone else. So the way it is stored matters more than
 * most things here.
 *
 * Only the SHA-256 hash is written. The raw token is returned once, from
 * this call, and cannot be recovered afterwards — a database dump, a backup,
 * or someone with read access to mrv.mcp_tokens gets hashes and no way into
 * the field. Re-sending the link means issuing a new token and revoking the
 * old one, which is the correct behaviour rather than a limitation: a link
 * that can be re-read is a link that can be re-read by the wrong person.
 *
 * The grace period exists because sampling happens in fields, on schedules
 * that weather moves. Expiring exactly at window_end would strand a sampler
 * who was rained off, and the workaround for that is worse than the grace:
 * someone would start extending windows to keep tokens alive, and the window
 * is evidence about when sampling occurred.
 *
 * Issuance is 'confirm' in mrv.agent_action_policies — an agent proposing a
 * work order still needs a manager's click, because this one sends a person
 * into a field.
 */
export async function issueWorkOrder(
  ctx: ToolContext,
  input: {
    cycleId: string;
    contractorName: string;
    contractorEmail?: string | null;
    windowStart: string;
    windowEnd: string;
    graceDays?: number;
    baseUrl?: string;
  },
): Promise<ToolResult<IssuedWorkOrder>> {
  const guard = requireDbMode("issueWorkOrder");
  if (guard) return guard;

  const policy = await checkPolicy("send_work_order", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.userId) {
    return fail(
      "issueWorkOrder: no user_id for the actor. A work order that leaves 'draft' must record " +
        "who issued it (wo_issued_chk), so it cannot be sent by an unidentified caller.",
    );
  }
  if (!input.contractorName?.trim()) {
    return fail("issueWorkOrder: a contractor name is required — the work order names who is going.");
  }

  const start = new Date(input.windowStart);
  const end = new Date(input.windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fail("issueWorkOrder: the sampling window dates are not valid dates.");
  }
  if (end < start) {
    return fail("issueWorkOrder: the sampling window ends before it starts.");
  }

  const { query, withTransaction } = await import("../db");

  const cycles = await query<{
    cycle_id: string;
    farm_id: string;
    depth_scheme: string;
    same_season: boolean;
    farm_name: string;
  }>(
    `SELECT c.cycle_id, c.farm_id, c.depth_scheme, c.same_season, f.name AS farm_name
       FROM mrv.sampling_cycles c JOIN mrv.farms f ON f.farm_id = c.farm_id
      WHERE c.cycle_id = $1`,
    [input.cycleId],
  );
  if (!cycles.length) return fail("issueWorkOrder: no such sampling cycle.");
  const cycle = cycles[0];

  // A work order with no points sends someone to a field with nothing to do.
  const pointRows = await query<{ n: string }>(
    `SELECT count(*)::text n
       FROM mrv.sampling_points sp
       JOIN mrv.plots p ON p.plot_id = sp.plot_id
      WHERE p.farm_id = $1 AND sp.status = 'planned'`,
    [cycle.farm_id],
  );
  const points = Number(pointRows[0].n);
  if (points === 0) {
    return fail(
      "issueWorkOrder: this farm has no planned sampling points. Create the sampling plan first.",
    );
  }

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = tokenExpiry(end, input.graceDays ?? DEFAULT_GRACE_DAYS);

  const result = await withTransaction(async (tx) => {
    const wo = await tx.query<{ wo_id: string }>(
      `INSERT INTO mrv.work_orders
         (farm_id, cycle_id, contractor_name, contractor_email, project_lead,
          window_start, window_end, depth_scheme, state, issued_by, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent', $5, clock_timestamp())
       RETURNING wo_id`,
      [
        cycle.farm_id,
        input.cycleId,
        input.contractorName.trim(),
        input.contractorEmail?.trim() || null,
        ctx.userId,
        input.windowStart,
        input.windowEnd,
        cycle.depth_scheme,
      ],
    );
    const woId = wo.rows[0].wo_id;

    // idx_mcp_token_one_live enforces a single unrevoked token per work
    // order, so this cannot quietly leave two links working.
    const tok = await tx.query<{ token_id: string }>(
      `INSERT INTO mrv.mcp_tokens (work_order_id, token_hash, contractor_email, issued_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING token_id`,
      [woId, hashToken(rawToken), input.contractorEmail?.trim() || null, ctx.userId, expiresAt],
    );

    return { woId, tokenId: tok.rows[0].token_id };
  });

  const baseUrl = input.baseUrl ?? "http://localhost:3007";
  const samplerUrl = `${baseUrl}/sampler?wo=${result.woId}&token=${rawToken}`;

  await audit(ctx, "issue_work_order", { type: "work_order", id: result.woId }, {
    cycleId: input.cycleId,
    farmId: cycle.farm_id,
    farmName: cycle.farm_name,
    contractor: input.contractorName.trim(),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    graceDays: input.graceDays ?? DEFAULT_GRACE_DAYS,
    plannedPoints: points,
    tokenId: result.tokenId,
    // The token itself is deliberately absent. An audit log a VVB reads is
    // not a place to leave a working credential.
    tokenExpiresAt: expiresAt.toISOString(),
  });

  return ok({
    woId: result.woId,
    tokenId: result.tokenId,
    rawToken,
    samplerUrl,
    expiresAt: expiresAt.toISOString(),
    points,
  });
}
