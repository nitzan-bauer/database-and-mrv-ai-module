import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlotDetail } from "@/lib/data";
import { PlotTabs } from "@/components/plot/PlotTabs";
import { parseTab } from "@/components/plot/tabs";

export const dynamic = "force-dynamic";

/**
 * Screen 3 — Plot Details (spec §6.3). One pane per plot, tabbed:
 * Overview · Sampling · Lab · Photos & barcodes · Model runs. The plot's
 * Project Activities (from the marketplace catalogue) drive the credit
 * forecast alongside the GHG Calculator.
 */
export default async function PlotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ plotId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { plotId } = await params;
  const { tab } = await searchParams;
  const detail = await getPlotDetail(decodeURIComponent(plotId));
  if (!detail) notFound();

  const { plot, farm } = detail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <Link href="/projects" className="hover:text-pine-600">
              Projects
            </Link>
            <span>/</span>
            <Link href={`/map?farm=${farm.farmId}`} className="hover:text-pine-600">
              {farm.name}
            </Link>
            <span>/</span>
            <span className="text-muted">{plot.plotId}</span>
          </nav>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-bold text-pine-700">
            <span
              className="inline-block h-4 w-4 rounded"
              style={{ backgroundColor: plot.strokeColor }}
              aria-hidden
            />
            {farm.name} · Plot {plot.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-semibold text-pine-700">{plot.quantificationApproach}</span> ·{" "}
            {plot.areaHa.toFixed(2)} ha · <span className="capitalize">{plot.crop ?? "—"}</span> ·{" "}
            <span className="font-mono text-xs">{plot.plotId}</span>
          </p>
        </div>
        <Link
          href={`/map?farm=${farm.farmId}`}
          className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-pine-700 shadow-sm transition-colors hover:bg-pine-50"
        >
          View on map
        </Link>
      </div>

      <PlotTabs detail={detail} initialTab={parseTab(tab)} />
    </div>
  );
}
