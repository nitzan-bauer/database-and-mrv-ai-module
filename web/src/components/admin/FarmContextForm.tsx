"use client";

import { useState, useTransition } from "react";
import type { ClimateZone, Farm, IrrigationMethod } from "@/lib/data/types";

const ZONES: ClimateZone[] = ["wet", "dry"];
const METHODS: IrrigationMethod[] = ["flood", "furrow", "sprinkler", "drip", "rainfed"];

/** Which methods open the leaching pathway — the same three the engine uses. */
const LEACHES = new Set<string>(["flood", "furrow", "sprinkler"]);

/**
 * Records one farm's climate zone and irrigation method.
 *
 * One farm at a time, and no "apply to all" — irrigation is decided farm by
 * farm, and a bulk control would quietly turn one farm's answer into every
 * farm's. The consequence of the current selection is shown live, so the
 * person choosing can see that drip and flood are not interchangeable.
 */
export function FarmContextForm({
  farm,
  save,
}: {
  farm: Farm;
  save: (farmId: string, zone: string, method: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [zone, setZone] = useState<string>(farm.climateZone ?? "");
  const [method, setMethod] = useState<string>(farm.irrigationMethod ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = zone !== (farm.climateZone ?? "") || method !== (farm.irrigationMethod ?? "");
  const complete = zone !== "" && (zone === "wet" || method !== "");

  const efn = zone === "dry" ? "0.005" : zone === "wet" ? "0.013" : "—";
  const fracLeach =
    zone === "wet" ? "0.24" : zone === "dry" ? (LEACHES.has(method) ? "0.24" : method ? "0" : "—") : "—";

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-pine-700">{farm.name}</h3>
        <span className="font-mono text-[11px] text-faint">
          {[farm.region, farm.country].filter(Boolean).join(", ")}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted">Climate zone</span>
          <select
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setMsg(null);
            }}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-pine-700"
          >
            <option value="">not recorded</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[12px] font-semibold text-muted">Irrigation method</span>
          <select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              setMsg(null);
            }}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-pine-700"
          >
            <option value="">not recorded</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* What the choice does, while it is being made. */}
      <p className="mt-3 rounded-lg bg-cream px-3 py-2 font-mono text-[11.5px] text-muted">
        EF_N_direct <b className="text-pine-700">{efn}</b> · Frac_LEACH{" "}
        <b className="text-pine-700">{fracLeach}</b>
        {zone === "wet" && method && (
          <span className="ml-1 font-sans">
            — a wet zone leaches on rainfall, so {method} does not change this.
          </span>
        )}
        {zone === "dry" && method && (
          <span className="ml-1 font-sans">
            {LEACHES.has(method)
              ? `— ${method} puts water past the root zone.`
              : `— ${method} leaves no surplus to carry nitrate down.`}
          </span>
        )}
      </p>

      {zone === "dry" && !method && (
        <p className="mt-2 text-[12px] text-danger">
          A dry-zone farm cannot be quantified without this — the engine refuses rather than
          assuming a value.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || !complete || pending}
          onClick={() =>
            start(async () => {
              const r = await save(farm.farmId, zone, method);
              setMsg(
                r.ok
                  ? { ok: true, text: "Saved — the change is in the audit log." }
                  : { ok: false, text: r.error ?? "Could not save." },
              );
            })
          }
          className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span className={`text-[12.5px] ${msg.ok ? "text-sage-700" : "text-danger"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
