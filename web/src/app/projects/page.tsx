import { Card, Section } from "@/components/ui/Card";
import { getFarmsWithPlots, listProjects } from "@/lib/data";
import type { FarmWithPlots, Plot, Project } from "@/lib/data/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  under_development: "Under development",
  registered: "Registered",
  validated: "Validated",
  verified: "Verified",
};

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Projects</h1>
        <p className="mt-1 text-sm text-muted">
          Grouped Verra VM0042 v2.2 projects and their participating farms — the spatial core the MRV
          pipeline runs on.
        </p>
      </div>

      {projects.map((p) => (
        <ProjectBlock key={p.projectId} project={p} />
      ))}
    </div>
  );
}

async function ProjectBlock({ project }: { project: Project }) {
  const farms = await getFarmsWithPlots(project.projectId);

  const totalPlots = farms.reduce((s, f) => s + f.plotCount, 0);
  const totalHa = farms.reduce((s, f) => s + f.totalAreaHa, 0);

  return (
    <div className="space-y-4">
      {/* project hero */}
      <Card imprint className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-sage-600">
              {project.projectId}
            </p>
            <h2 className="mt-1 text-xl font-bold text-pine-700">{project.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone="pine">{project.methodology}</Pill>
              {project.isGrouped && <Pill tone="sage">Grouped project</Pill>}
              <Pill tone="gold">{STATUS_LABEL[project.status] ?? project.status}</Pill>
              {project.isDemo && <Pill tone="muted">Demo</Pill>}
            </div>
          </div>
          <div className="flex gap-6">
            <Stat label="Farms" value={String(farms.length)} />
            <Stat label="Plots" value={String(totalPlots)} />
            <Stat label="Total area" value={`${totalHa.toFixed(1)} ha`} />
          </div>
        </div>
      </Card>

      {/* farms */}
      <div className="grid gap-4 lg:grid-cols-2">
        {farms.map((f) => (
          <FarmCard key={f.farmId} farm={f} />
        ))}
      </div>
    </div>
  );
}

function FarmCard({ farm }: { farm: FarmWithPlots }) {
  return (
    <Section
      title={farm.name}
      subtitle={[farm.region, farm.country].filter(Boolean).join(", ")}
      right={
        <span
          className={
            "rounded-full px-2.5 py-1 text-xs font-medium " +
            (farm.climateZone === "wet"
              ? "bg-sage-100 text-sage-700"
              : "bg-gold-200 text-earth-600")
          }
        >
          {farm.climateZone} climate
        </span>
      }
    >
      <div className="mb-3 flex gap-6 text-sm">
        <span className="text-muted">
          <b className="font-semibold text-pine-700">{farm.plotCount}</b> plots
        </span>
        <span className="text-muted">
          <b className="font-semibold text-pine-700">{farm.totalAreaHa.toFixed(2)}</b> ha
        </span>
        <span className="font-mono text-xs text-faint">{farm.installationCode}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cream text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">Plot</th>
              <th className="px-3 py-2 font-semibold">Crop</th>
              <th className="px-3 py-2 text-right font-semibold">Area</th>
              <th className="px-3 py-2 font-semibold">QA</th>
            </tr>
          </thead>
          <tbody>
            {farm.plots.map((p) => (
              <PlotRow key={p.plotId} plot={p} />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PlotRow({ plot }: { plot: Plot }) {
  return (
    <tr className="border-t border-line first:border-t-0">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-[3px]"
            style={{ backgroundColor: plot.strokeColor }}
            aria-hidden
          />
          <div className="leading-tight">
            <div className="font-medium text-ink">{plot.name}</div>
            <div className="font-mono text-[11px] text-faint">{plot.plotId}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 capitalize text-muted">{plot.crop ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">{plot.areaHa.toFixed(2)} ha</td>
      <td className="px-3 py-2">
        <span className="rounded-md bg-pine-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-pine-700">
          {plot.quantificationApproach}
        </span>
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-lg font-bold text-pine-700 tabular-nums">{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "pine" | "sage" | "gold" | "muted"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    pine: "bg-pine-50 text-pine-700",
    sage: "bg-sage-100 text-sage-700",
    gold: "bg-gold-200 text-earth-600",
    muted: "bg-cream text-muted",
  };
  return (
    <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + tones[tone]}>{children}</span>
  );
}
