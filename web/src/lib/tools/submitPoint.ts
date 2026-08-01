import "server-only";
import { hashToken } from "../mcp/token";
import { audit, fail, ok, requireDbMode, type ToolResult } from "./context";

export interface SubmittedPoint {
  eventId: string;
  pointId: string;
  distanceFromTargetM: number;
  remaining: number;
}

/**
 * A sampler submits one point, authenticated only by the work-order token.
 *
 * This is the one write that arrives from outside the organisation, so it is
 * the one that assumes least. The caller has no account and no session: they
 * have a link. Everything they are allowed to touch is derived from that
 * link, in the database, on every call — the token is resolved to its work
 * order, and the point must belong to that work order's farm. A point id
 * from a different farm is rejected even though the token is perfectly
 * valid, because possession of a link is authority over one work order and
 * nothing else.
 *
 * The token is looked up by hash. The raw value never touches the database,
 * in a query or in a log.
 *
 * Distance from the planned location is computed here rather than accepted
 * from the caller. VM0042 §8.2.1.3(9) wants both the intended and the actual
 * position recorded, and the gap between them is exactly the number a VVB
 * uses to judge whether the sample represents the stratum. A field device
 * could compute it, but a figure the submitter supplies is a figure the
 * submitter can choose.
 */
export async function submitPoint(
  input: {
    rawToken: string;
    pointId: string;
    lat: number;
    lon: number;
    gpsAccuracyM?: number | null;
    samplingDate: string;
    photoUrl?: string | null;
    fieldNotes?: string | null;
  },
): Promise<ToolResult<SubmittedPoint>> {
  const guard = requireDbMode("submitPoint");
  if (guard) return guard;

  if (!input.rawToken) return fail("submitPoint: no token.");
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon)) {
    return fail("submitPoint: latitude and longitude are required — a submitted point needs coordinates.");
  }
  if (Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180) {
    return fail("submitPoint: those coordinates are outside the valid range.");
  }
  if (!input.samplingDate) {
    return fail("submitPoint: the sampling date is required (event_submitted_chk).");
  }

  const { query, withTransaction } = await import("../db");

  const tokens = await query<{
    token_id: string;
    work_order_id: string;
    cycle_id: string;
    farm_id: string;
    expires_at: string;
    revoked_at: string | null;
    state: string;
  }>(
    `SELECT t.token_id, t.work_order_id, w.cycle_id, w.farm_id,
            t.expires_at, t.revoked_at, w.state::text
       FROM mrv.mcp_tokens t
       JOIN mrv.work_orders w ON w.wo_id = t.work_order_id
      WHERE t.token_hash = $1`,
    [hashToken(input.rawToken)],
  );

  // One message for "no such token" and "revoked": telling the difference
  // apart would confirm to a stranger that a token once existed.
  if (!tokens.length) return fail("submitPoint: that link is not valid.");
  const t = tokens[0];
  if (t.revoked_at) return fail("submitPoint: that link is not valid.");
  if (new Date(t.expires_at) < new Date()) {
    return fail("submitPoint: that link has expired. Ask the project lead to issue a new one.");
  }
  if (t.state === "closed") {
    return fail("submitPoint: this work order is closed and no longer accepts submissions.");
  }

  // The point must belong to the farm this token covers.
  const points = await query<{ point_id: string; plot_id: string }>(
    `SELECT sp.point_id, sp.plot_id
       FROM mrv.sampling_points sp
       JOIN mrv.plots p ON p.plot_id = sp.plot_id
      WHERE sp.point_id = $1 AND p.farm_id = $2`,
    [input.pointId, t.farm_id],
  );
  if (!points.length) {
    return fail("submitPoint: that point is not part of this work order.");
  }

  const result = await withTransaction(async (tx) => {
    // UNIQUE (point_id, cycle_id) makes a repeat submission an update of the
    // same event rather than a second one — a sampler correcting a reading
    // in the field is ordinary, and should not create a duplicate. The row
    // freezes once `locked` is set.
    const ev = await tx.query<{
      event_id: string;
      distance_from_target_m: string;
      locked: boolean;
    }>(
      `INSERT INTO mrv.sampling_events
         (point_id, cycle_id, work_order_id, sampling_date, captured_geom, gps_accuracy_m,
          distance_from_target_m, photo_url, field_notes, sampler_token_id, submitted_at)
       SELECT sp.point_id, $2, $3, $4::date,
              ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326),
              $7,
              ST_Distance(
                sp.planned_geom::geography,
                ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography
              ),
              $8, $9, $10, clock_timestamp()
         FROM mrv.sampling_points sp
        WHERE sp.point_id = $1
       ON CONFLICT (point_id, cycle_id) DO UPDATE SET
              sampling_date          = EXCLUDED.sampling_date,
              captured_geom          = EXCLUDED.captured_geom,
              gps_accuracy_m         = EXCLUDED.gps_accuracy_m,
              distance_from_target_m = EXCLUDED.distance_from_target_m,
              photo_url              = coalesce(EXCLUDED.photo_url, mrv.sampling_events.photo_url),
              field_notes            = EXCLUDED.field_notes,
              submitted_at           = clock_timestamp(),
              updated_at             = clock_timestamp()
        WHERE mrv.sampling_events.locked = false
       RETURNING event_id, distance_from_target_m, locked`,
      [
        input.pointId,
        t.cycle_id,
        t.work_order_id,
        input.samplingDate,
        input.lat,
        input.lon,
        input.gpsAccuracyM ?? null,
        input.photoUrl ?? null,
        input.fieldNotes ?? null,
        t.token_id,
      ],
    );

    if (!ev.rows.length) {
      throw new Error(
        "this point has already been locked for verification and can no longer be changed",
      );
    }

    await tx.query(
      `UPDATE mrv.sampling_points SET status = 'sampled', updated_at = clock_timestamp()
        WHERE point_id = $1 AND status = 'planned'`,
      [input.pointId],
    );

    // A work order becomes 'in_progress' on its first submission, so the
    // state reflects what has happened rather than needing a separate click.
    await tx.query(
      `UPDATE mrv.work_orders SET state = 'in_progress', updated_at = clock_timestamp()
        WHERE wo_id = $1 AND state = 'sent'`,
      [t.work_order_id],
    );

    await tx.query(`UPDATE mrv.mcp_tokens SET last_used_at = clock_timestamp() WHERE token_id = $1`, [
      t.token_id,
    ]);

    const left = await tx.query<{ n: string }>(
      `SELECT count(*)::text n
         FROM mrv.sampling_points sp
         JOIN mrv.plots p ON p.plot_id = sp.plot_id
        WHERE p.farm_id = $1 AND sp.status = 'planned'`,
      [t.farm_id],
    );

    return {
      eventId: ev.rows[0].event_id,
      distance: Number(ev.rows[0].distance_from_target_m),
      remaining: Number(left.rows[0].n),
    };
  });

  // The actor is the token, not a person: nobody signed in, and attributing
  // this to a named user would be a claim the system cannot support.
  await audit(
    { actor: `mcp_token:${t.token_id}`, actorKind: "agent" },
    "submit_point",
    { type: "sampling_event", id: result.eventId },
    {
      workOrderId: t.work_order_id,
      pointId: input.pointId,
      samplingDate: input.samplingDate,
      gpsAccuracyM: input.gpsAccuracyM ?? null,
      distanceFromTargetM: Number(result.distance.toFixed(2)),
      hasPhoto: Boolean(input.photoUrl),
    },
  );

  return ok({
    eventId: result.eventId,
    pointId: input.pointId,
    distanceFromTargetM: Number(result.distance.toFixed(2)),
    remaining: result.remaining,
  });
}
