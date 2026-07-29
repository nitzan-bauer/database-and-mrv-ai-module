"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { FarmWithPlots, SamplingPoint } from "@/lib/data/types";

/** Point-status colours (match the spec legend + brand palette). */
const STATUS_COLOR: Record<string, string> = {
  planned: "#2b6161",
  sampled: "#2563eb",
  lab_pending: "#e8a13b",
  complete: "#75bb94",
};

const STATUS_LABEL: Record<string, string> = {
  planned: "planned",
  sampled: "sampled",
  lab_pending: "lab pending",
  complete: "complete",
};

type LayerKey = "plots" | "points" | "strata" | "bsl";

export function MapView({
  token,
  farms,
  points,
  initialFarm = "all",
}: {
  token: string;
  farms: FarmWithPlots[];
  points: SamplingPoint[];
  /** farm_id to focus on load (deep link ?farm=...) */
  initialFarm?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    plots: true,
    points: true,
    strata: true,
    bsl: true,
  });
  const [activeFarm, setActiveFarm] = useState<string>(initialFarm);

  /* GeoJSON built once from props */
  const plotsGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: farms.flatMap((f) =>
        f.plots.map((p) => ({
          type: "Feature" as const,
          properties: {
            plotId: p.plotId,
            farmId: f.farmId,
            name: p.name,
            crop: p.crop ?? "—",
            areaHa: p.areaHa,
            qa: p.quantificationApproach,
            color: p.strokeColor,
            farm: f.name,
          },
          geometry: p.geom,
        })),
      ),
    }),
    [farms],
  );

  const pointsGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: points.map((sp) => ({
        type: "Feature" as const,
        properties: {
          pointId: sp.pointId,
          plotId: sp.plotId ?? "",
          scenario: sp.scenario,
          status: sp.status,
          color: STATUS_COLOR[sp.status] ?? "#2b6161",
          cores: sp.compositeCores ?? 0,
        },
        geometry: { type: "Point" as const, coordinates: sp.lonLat },
      })),
    }),
    [points],
  );

  const boundsFor = useMemo(() => {
    return (farmId: string): mapboxgl.LngLatBounds => {
      const b = new mapboxgl.LngLatBounds();
      for (const f of farms) {
        if (farmId !== "all" && f.farmId !== farmId) continue;
        for (const p of f.plots)
          for (const [lon, lat] of p.geom.coordinates[0]) b.extend([lon, lat]);
      }
      return b;
    };
  }, [farms]);

  /* init once */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      bounds: boundsFor(initialFarm),
      fitBoundsOptions: { padding: 60 },
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    map.on("load", () => {
      map.addSource("plots", { type: "geojson", data: plotsGeoJSON });
      map.addSource("points", { type: "geojson", data: pointsGeoJSON });

      map.addLayer({
        id: "plots-fill",
        type: "fill",
        source: "plots",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "plots-line",
        type: "line",
        source: "plots",
        paint: { "line-color": ["get", "color"], "line-width": 2.5 },
      });
      map.addLayer({
        id: "plots-label",
        type: "symbol",
        source: "plots",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 13,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(20,40,35,.85)",
          "text-halo-width": 1.4,
        },
      });
      map.addLayer({
        id: "points-circle",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": 5.5,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.6,
          "circle-stroke-color": "#ffffff",
        },
      });

      /* plot popup, styled like the SaaS marketplace popup */
      map.on("click", "plots-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const pr = f.properties as Record<string, string>;
        new mapboxgl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:inherit;color:#1c2b27;min-width:210px">
               <img src="/brand/icon-2co.png" alt="" style="display:block;margin:0 auto 6px;height:26px;width:auto">
               <h3 style="margin:0 0 6px;font-size:14px;text-align:center;color:#244f4f;font-weight:700">${pr.name}</h3>
               <table style="width:100%;font-size:12px;border-collapse:collapse">
                 <tr><td style="color:#5b6b66;padding:3px 4px">Plot</td><td style="padding:3px 4px;font-family:monospace">${pr.plotId}</td></tr>
                 <tr><td style="color:#5b6b66;padding:3px 4px">Farm</td><td style="padding:3px 4px">${pr.farm}</td></tr>
                 <tr><td style="color:#5b6b66;padding:3px 4px">Crop</td><td style="padding:3px 4px;text-transform:capitalize">${pr.crop}</td></tr>
                 <tr><td style="color:#5b6b66;padding:3px 4px">Area</td><td style="padding:3px 4px">${Number(pr.areaHa).toFixed(2)} ha</td></tr>
                 <tr><td style="color:#5b6b66;padding:3px 4px">Approach</td><td style="padding:3px 4px;font-weight:700;color:#2b6161">${pr.qa}</td></tr>
               </table>
               <a href="/plots/${encodeURIComponent(pr.plotId)}"
                  style="display:block;margin-top:8px;padding:7px 10px;border-radius:8px;background:#2b6161;color:#fff;font-size:12px;font-weight:600;text-align:center;text-decoration:none">
                 Open Plot Details
               </a>
             </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "plots-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "plots-fill", () => (map.getCanvas().style.cursor = ""));

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* layer visibility */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    for (const id of ["plots-fill", "plots-line", "plots-label"])
      map.setLayoutProperty(id, "visibility", vis(visible.plots));
    map.setLayoutProperty("points-circle", "visibility", vis(visible.points));
  }, [visible, ready]);

  /* farm switcher */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.fitBounds(boundsFor(activeFarm), { padding: 60, duration: 1200 });
  }, [activeFarm, ready, boundsFor]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line shadow-[var(--shadow-card)]">
      <div ref={containerRef} className="h-[560px] w-full" />

      {/* farm switcher */}
      <div className="absolute left-3 top-3 z-10 ml-10 flex gap-2">
        {[{ farmId: "all", name: "All farms" }, ...farms].map((f) => (
          <button
            key={f.farmId}
            onClick={() => setActiveFarm(f.farmId)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold shadow transition-colors " +
              (activeFarm === f.farmId
                ? "bg-pine-600 text-white"
                : "bg-white/95 text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* layers panel + legend */}
      <div className="absolute right-3 top-3 z-10 w-56 space-y-3">
        <div className="rounded-xl border border-line bg-white/95 p-3 shadow backdrop-blur">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
            Layers
          </p>
          {(
            [
              ["plots", `Project plots (WP) · ${plotsGeoJSON.features.length}`],
              ["points", `Sampling points · ${points.length}`],
              ["strata", "Strata boundaries · 0"],
              ["bsl", "Baseline control (BSL) · 0"],
            ] as [LayerKey, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                className="h-3.5 w-3.5 accent-[#2b6161]"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white/95 p-3 shadow backdrop-blur">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
            Point status
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted">
                <i
                  className="h-2.5 w-2.5 rounded-full border border-white"
                  style={{ backgroundColor: STATUS_COLOR[k] }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>

        <button
          disabled
          title="Dave — the AI-MRV agent — arrives with Tier 2"
          className="w-full cursor-not-allowed rounded-full bg-agent-500/90 px-4 py-2.5 text-sm font-semibold text-white opacity-80 shadow"
        >
          Ask Dave (AI-MRV) · Tier 2
        </button>
      </div>
    </div>
  );
}
