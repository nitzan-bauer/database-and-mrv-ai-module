/**
 * The Sampler MCP tool surface (spec §9).
 *
 * The same four tools are used by the human contractor's field view and by
 * Dave, so there is no second code path to drift: the browser calls these
 * through /api/sampler/*, the agent calls them over MCP, and both land on
 * the same validation below.
 *
 * Validation follows spec §6.6:
 *   GPS      within GPS_TOLERANCE_M of target — soft, warns but allows
 *   barcode  must equal the expected Sample ID exactly — hard, blocks
 *   photo    required — hard, blocks
 */

/** Soft radius: beyond this the capture is flagged, not refused (§6.6). */
export const GPS_TOLERANCE_M = 25;

export type Severity = "ok" | "warn" | "block";

export interface CheckResult {
  severity: Severity;
  message: string;
}

/** Great-circle distance in metres. */
export function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ── capture_gps ─────────────────────────────────────────────────────── */

export interface GpsCapture {
  lat: number;
  lon: number;
  accuracyM: number | null;
}

/** Soft check: record the distance, warn beyond tolerance, never refuse. */
export function checkGps(
  target: { lat: number; lon: number },
  got: GpsCapture,
): CheckResult & { distanceM: number } {
  const d = distanceM(target, got);
  if (d <= GPS_TOLERANCE_M)
    return { severity: "ok", message: `${d.toFixed(1)} m from target`, distanceM: d };
  return {
    severity: "warn",
    message: `${d.toFixed(1)} m from target — beyond the ${GPS_TOLERANCE_M} m tolerance; note why`,
    distanceM: d,
  };
}

/* ── scan_barcode ────────────────────────────────────────────────────── */

/**
 * Hard check: the scanned barcode must equal the expected Sample ID exactly.
 * A mismatch means the bag and the point have been crossed — the one error
 * that silently corrupts a whole cycle's lineage, so it blocks.
 */
export function checkBarcode(expectedSampleId: string, scanned: string): CheckResult {
  const got = scanned.trim().toUpperCase();
  const want = expectedSampleId.trim().toUpperCase();
  if (!got) return { severity: "block", message: "No barcode scanned" };
  if (got !== want)
    return {
      severity: "block",
      message: `Barcode ${got} does not match the expected ${want}`,
    };
  return { severity: "ok", message: `matches ${want}` };
}

/* ── capture_photo ───────────────────────────────────────────────────── */

export function checkPhoto(photoUrl: string | null): CheckResult {
  return photoUrl
    ? { severity: "ok", message: "photo attached" }
    : { severity: "block", message: "Photo of the labelled bag is required" };
}

/* ── submit_point ────────────────────────────────────────────────────── */

export interface PointSubmission {
  pointId: string;
  expectedSampleId: string;
  target: { lat: number; lon: number };
  gps: GpsCapture | null;
  barcode: string | null;
  photoUrl: string | null;
  notes?: string | null;
}

export interface SubmissionReview {
  ok: boolean;
  checks: Array<CheckResult & { tool: string }>;
  distanceM: number | null;
}

/** Run every check for a point. `ok` is false if anything blocks. */
export function reviewSubmission(s: PointSubmission): SubmissionReview {
  const checks: Array<CheckResult & { tool: string }> = [];
  let distance: number | null = null;

  if (s.gps) {
    const g = checkGps(s.target, s.gps);
    distance = g.distanceM;
    checks.push({ tool: "capture_gps", severity: g.severity, message: g.message });
  } else {
    checks.push({ tool: "capture_gps", severity: "block", message: "GPS position not captured" });
  }

  checks.push({ tool: "scan_barcode", ...checkBarcode(s.expectedSampleId, s.barcode ?? "") });
  checks.push({ tool: "capture_photo", ...checkPhoto(s.photoUrl) });

  return { ok: checks.every((c) => c.severity !== "block"), checks, distanceM: distance };
}

/** The tool list, as advertised to the agent. */
export const SAMPLER_TOOLS = [
  {
    name: "capture_gps",
    description:
      "Record the actual GPS position at a sampling point. Warns beyond 25 m from the planned target but does not refuse.",
  },
  {
    name: "scan_barcode",
    description:
      "Scan the sample bag's barcode. Must match the expected Sample ID exactly, or the submission is refused.",
  },
  {
    name: "capture_photo",
    description: "Attach a photograph of the labelled bag. Required for every point.",
  },
  {
    name: "submit_point",
    description:
      "Submit a completed point once GPS, barcode and photo are captured. Writes an append-only sampling event.",
  },
] as const;
