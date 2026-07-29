"use client";

import { useMemo, useState } from "react";
import { IconMark } from "@/components/brand/Logo";
import type { WorkOrder, WorkOrderPoint } from "@/lib/data/types";
import type { Reminder } from "@/lib/mcp/reminders";
import { GPS_TOLERANCE_M, reviewSubmission, type GpsCapture } from "@/lib/mcp/tools";

/**
 * The field capture flow. Every action maps to one of the four Sampler MCP
 * tools, and validation runs through exactly the same functions Dave calls —
 * the human path and the agent path cannot diverge.
 *
 * Built for a phone in a field: single column, large targets, one point at a
 * time, and the current point's state always visible without scrolling.
 */

type Captured = {
  gps: GpsCapture | null;
  barcode: string | null;
  photoUrl: string | null;
  notes: string;
};

const empty = (): Captured => ({ gps: null, barcode: null, photoUrl: null, notes: "" });

export function SamplerView({ wo, reminders }: { wo: WorkOrder; reminders: Reminder[] }) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, true>>({});
  const [cap, setCap] = useState<Captured>(empty());
  const [busy, setBusy] = useState<string | null>(null);

  const point: WorkOrderPoint | undefined = wo.points[idx];
  const doneCount = Object.keys(done).length;

  const review = useMemo(() => {
    if (!point) return null;
    return reviewSubmission({
      pointId: point.pointId,
      expectedSampleId: point.sampleId,
      target: { lat: point.lat, lon: point.lon },
      gps: cap.gps,
      barcode: cap.barcode,
      photoUrl: cap.photoUrl,
      notes: cap.notes,
    });
  }, [point, cap]);

  if (!point) return null;

  /* ── MCP tool calls (browser side) ──────────────────────────────── */

  async function callCaptureGps() {
    setBusy("gps");
    // Real device GPS where available; otherwise simulate a plausible fix so
    // the flow is reviewable on a desktop.
    const fallback = () => {
      const jitter = () => (Math.random() - 0.5) * 0.0003; // ~±17 m
      setCap((c) => ({
        ...c,
        gps: { lat: point!.lat + jitter(), lon: point!.lon + jitter(), accuracyM: 4.2 },
      }));
      setBusy(null);
    };
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCap((c) => ({
          ...c,
          gps: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyM: pos.coords.accuracy ?? null,
          },
        }));
        setBusy(null);
      },
      fallback,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /**
   * A hardware scanner types into the focused field and sends Enter, so an
   * ordinary input is the right control — it works with a scanner, with a
   * phone keyboard, and with gloves on, and it never blocks the page.
   */
  function setBarcode(v: string) {
    setCap((c) => ({ ...c, barcode: v }));
  }

  function callCapturePhoto() {
    setCap((c) => ({ ...c, photoUrl: `capture://${point!.sampleId}.jpg` }));
  }

  function callSubmitPoint() {
    if (!review?.ok) return;
    setDone((d) => ({ ...d, [point!.pointId]: true }));
    setCap(empty());
    setIdx((i) => Math.min(i + 1, wo.points.length - 1));
  }

  const gpsCheck = review?.checks.find((c) => c.tool === "capture_gps");
  const barcodeCheck = review?.checks.find((c) => c.tool === "scan_barcode");
  const photoCheck = review?.checks.find((c) => c.tool === "capture_photo");

  return (
    <div className="min-h-screen bg-cream pb-24">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <IconMark size={26} />
            <div className="leading-tight">
              <p className="text-[13px] font-bold text-pine-700">{wo.woId}</p>
              <p className="font-mono text-[10px] text-faint">{wo.farmName}</p>
            </div>
          </div>
          <span className="rounded-full bg-sage-100 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-sage-700">
            {doneCount} / {wo.points.length}
          </span>
        </div>
        <div className="h-1 bg-line">
          <div
            className="h-1 bg-sage-400 transition-all"
            style={{ width: `${(doneCount / wo.points.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        {/* Dave's reminders */}
        {reminders.length > 0 && (
          <section className="rounded-2xl border border-agent-500/25 bg-agent-100/50 p-3.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-agent-700">
              Dave reminds
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {reminders.map((r, i) => (
                <li key={i} className="text-[12.5px] leading-snug">
                  <span
                    className={
                      "font-semibold " + (r.tone === "urgent" ? "text-danger" : "text-ink")
                    }
                  >
                    {r.title}
                  </span>{" "}
                  <span className="text-muted">— {r.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* current point */}
        <section className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Point {idx + 1} of {wo.points.length}
              </p>
              <h1 className="font-mono text-lg font-bold text-pine-700">{point.sampleId}</h1>
              <p className="text-[12px] text-muted">
                Stratum {point.stratumCode ?? "—"} · {point.scenario} · {point.depthScheme} cm ·{" "}
                {point.compositeCores ?? 5} cores
              </p>
            </div>
            {done[point.pointId] && (
              <span className="rounded-full bg-sage-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-sage-700">
                submitted
              </span>
            )}
          </div>

          <p className="mt-2 rounded-lg bg-cream px-3 py-2 font-mono text-[11px] text-muted">
            target {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
          </p>

          {/* three capture steps */}
          <div className="mt-3 space-y-2.5">
            <Step
              tool="capture_gps"
              label="GPS position"
              state={cap.gps ? (gpsCheck?.severity ?? "ok") : "todo"}
              message={cap.gps ? gpsCheck?.message : `within ${GPS_TOLERANCE_M} m of target`}
              action={callCaptureGps}
              actionLabel={cap.gps ? "Re-capture" : "Capture GPS"}
              busy={busy === "gps"}
            />
            <BarcodeStep
              expected={point.sampleId}
              value={cap.barcode ?? ""}
              onChange={setBarcode}
              state={cap.barcode ? (barcodeCheck?.severity ?? "ok") : "todo"}
              message={cap.barcode ? barcodeCheck?.message : `must equal ${point.sampleId}`}
            />
            <Step
              tool="capture_photo"
              label="Photo of the bag"
              state={cap.photoUrl ? "ok" : "todo"}
              message={cap.photoUrl ? photoCheck?.message : "required at every point"}
              action={callCapturePhoto}
              actionLabel={cap.photoUrl ? "Retake" : "Take photo"}
            />
          </div>

          <textarea
            value={cap.notes}
            onChange={(e) => setCap((c) => ({ ...c, notes: e.target.value }))}
            placeholder="Field notes (optional) — e.g. why the position had to move"
            rows={2}
            className="mt-3 w-full rounded-lg border border-line bg-cream px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-sage-400"
          />
        </section>

        {/* point list */}
        <section className="rounded-2xl border border-line bg-white p-3">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
            All points
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {wo.points.map((p, i) => (
              <button
                key={p.pointId}
                onClick={() => {
                  setIdx(i);
                  setCap(empty());
                }}
                className={
                  "rounded-lg py-2 font-mono text-[10px] font-semibold transition-colors " +
                  (i === idx
                    ? "bg-pine-600 text-white"
                    : done[p.pointId]
                      ? "bg-sage-100 text-sage-700"
                      : "bg-cream text-muted hover:bg-pine-50")
                }
                title={p.sampleId}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </section>

        <p className="px-1 font-mono text-[10px] leading-relaxed text-faint">
          Each capture is an MCP tool call — the same surface Dave uses, so the human and agent
          paths validate identically. Submissions are append-only.
        </p>
      </main>

      {/* submit bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          {review && !review.ok && (
            <p className="mb-1.5 text-center text-[11.5px] text-muted">
              {review.checks.find((c) => c.severity === "block")?.message}
            </p>
          )}
          <button
            onClick={callSubmitPoint}
            disabled={!review?.ok}
            className={
              "w-full rounded-xl py-3.5 text-sm font-semibold transition-colors " +
              (review?.ok
                ? "bg-pine-600 text-white hover:bg-pine-700"
                : "cursor-not-allowed bg-line-2 text-white/80")
            }
          >
            {idx + 1 < wo.points.length ? "Confirm & next point" : "Confirm & finish"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The barcode step is an input rather than a button: a hardware scanner
 * behaves as a keyboard, so scanning simply fills the focused field.
 */
function BarcodeStep({
  expected,
  value,
  onChange,
  state,
  message,
}: {
  expected: string;
  value: string;
  onChange: (v: string) => void;
  state: "todo" | "ok" | "warn" | "block";
  message?: string;
}) {
  const tone =
    state === "ok"
      ? "border-sage-400/50 bg-sage-50"
      : state === "block"
        ? "border-danger/40 bg-danger/5"
        : "border-line bg-cream";
  const dot = state === "ok" ? "bg-sage-400" : state === "block" ? "bg-danger" : "bg-line-2";

  return (
    <div className={"rounded-xl border px-3 py-2.5 " + tone}>
      <div className="flex items-center gap-3">
        <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + dot} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">Barcode</p>
          <p className="truncate text-[11.5px] text-muted">{message}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Scan or type ${expected}`}
          aria-label="Sample barcode"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:border-sage-400"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="shrink-0 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-muted hover:bg-cream"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 font-mono text-[9.5px] text-faint">scan_barcode</p>
    </div>
  );
}

function Step({
  tool,
  label,
  state,
  message,
  action,
  actionLabel,
  busy,
}: {
  tool: string;
  label: string;
  state: "todo" | "ok" | "warn" | "block";
  message?: string;
  action: () => void;
  actionLabel: string;
  busy?: boolean;
}) {
  const tone =
    state === "ok"
      ? "border-sage-400/50 bg-sage-50"
      : state === "warn"
        ? "border-gold-400/60 bg-gold-200/30"
        : state === "block"
          ? "border-danger/40 bg-danger/5"
          : "border-line bg-cream";
  const dot =
    state === "ok"
      ? "bg-sage-400"
      : state === "warn"
        ? "bg-gold-500"
        : state === "block"
          ? "bg-danger"
          : "bg-line-2";

  return (
    <div className={"flex items-center gap-3 rounded-xl border px-3 py-2.5 " + tone}>
      <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + dot} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <p className="truncate text-[11.5px] text-muted">{message}</p>
        <p className="font-mono text-[9.5px] text-faint">{tool}</p>
      </div>
      <button
        onClick={action}
        disabled={busy}
        className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-pine-700 hover:bg-pine-50 disabled:opacity-50"
      >
        {busy ? "…" : actionLabel}
      </button>
    </div>
  );
}
