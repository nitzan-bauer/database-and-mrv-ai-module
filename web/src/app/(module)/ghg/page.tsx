import Link from "next/link";
import { auth } from "@/auth";
import {
  countActivityData,
  listActivityData,
  listFarms,
  listFertilizers,
  listProjects,
} from "@/lib/data";
import type { Farm } from "@/lib/data/types";
import { DATA_MODE } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { resolveParameters } from "@/lib/ghg/engine";
import { computeReduction, explainFarmYear, explainParameters, GHG_TOOLS } from "@/lib/ghg/skill";
import { GhgView } from "@/components/ghg/GhgView";
import { ActivityDataForm } from "@/components/ghg/ActivityDataForm";
import type { RecordedActivityData } from "@/lib/tools/recordActivityData";
import type { ToolResult } from "@/lib/tools/context";

export const dynamic = "force-dynamic";

/**
 * Record one farm/scenario/year of activity data as the signed-in person —
 * the same recordActivityData tool an agent would call, run here under a
 * human actor, which the policy gate always allows.
 */
async function recordActivityDataAction(input: {
  farmId: string;
  scenario: "BSL" | "PR" | "WP";
  year: number;
  areaHa: number;
  dieselL?: number;
  gasolineL?: number;
  residueBurntKg?: number;
  nfixDryMatterT?: number;
  nfixNContent?: number;
  fertilizers: Array<{ fertilizerName: string; massT: number; intervalYears?: number }>;
}): Promise<ToolResult<RecordedActivityData>> {
  "use server";
  const session = await auth().catch(() => null);
  const { recordActivityData } = await import("@/lib/tools/recordActivityData");
  return recordActivityData({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/**
 * GHG Calculator (spec AC#7) — emissions from fuel and nitrogen fertiliser
 * per farm-year, with the full working, plus the pilot of Dave's
 * GHG-Calculator skill over the same engine.
 */
export default async function GhgPage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string }>;
}) {
  const { farm } = await searchParams;
  const [project] = await listProjects();
  const farms = await listFarms(project.projectId);
  const active = farms.find((f) => f.farmId === farm) ?? farms[0];

  // The engine refuses to compute without a climate zone, and without an
  // irrigation method in a dry zone — guessing either would be guessing the
  // credit volume. That refusal is correct, but it must not reach the user
  // as a crashed page: what they need is which field is missing and where
  // to set it. Anything else is a real fault and still throws.
  const missing: string[] = [];
  if (!active.climateZone) missing.push("climate zone");
  if (!active.irrigationMethod && active.climateZone === "dry") missing.push("irrigation method");

  if (missing.length) {
    return (
      <MissingContext
        farms={farms}
        active={active}
        missing={missing}
        needsMethod={missing.includes("irrigation method")}
      />
    );
  }

  // In db mode the demo activity data must not stand in for the farm's
  // real fuel and fertiliser records — an emissions figure over invented
  // inputs looks exactly like a real one. countActivityData returns -1 in
  // fixtures mode, where the demo set is the point.
  const activityCount = await countActivityData(active.farmId);
  const fertilizers = DATA_MODE === "db" ? await listFertilizers() : [];
  if (activityCount === 0) {
    return (
      <NoActivityData
        farms={farms}
        active={active}
        fertilizers={fertilizers}
        recordActivityDataAction={DATA_MODE === "db" ? recordActivityDataAction : undefined}
      />
    );
  }

  const p = resolveParameters(active.climateZone);

  // Frac_LEACH needs the farm's own irrigation method — it is not a
  // property of the parameter set, because two farms in one climate zone
  // can and do irrigate differently.
  const irrigation = active.irrigationMethod;
  const activity = await listActivityData(active.farmId);
  const reduction = computeReduction(activity, p, irrigation, active.farmId);
  const workingBsl = explainFarmYear(activity, p, irrigation, active.farmId, "BSL");
  const workingPr = explainFarmYear(activity, p, irrigation, active.farmId, "PR");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">GHG Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Emissions from fuel combustion and nitrogen-fertiliser use, per farm-year, under VM0042
          v2.2 Quantification Approach 3. Every figure is shown with the equation that produced it.
        </p>
      </div>
      <GhgView
        farms={farms.map((f) => ({
          farmId: f.farmId,
          name: f.name,
          climateZone: f.climateZone,
          irrigationMethod: f.irrigationMethod,
        }))}
        activeFarmId={active.farmId}
        parameters={p}
        parameterExplanations={explainParameters(p, irrigation)}
        activity={activity}
        reduction={reduction}
        workingBsl={workingBsl}
        workingPr={workingPr}
        tools={GHG_TOOLS}
      />
      {DATA_MODE === "db" && (
        <section>
          <h2 className="mb-2 text-base font-bold text-pine-700">Add another farm-year</h2>
          <ActivityDataForm
            farmId={active.farmId}
            fertilizers={fertilizers}
            action={recordActivityDataAction}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Shown instead of a calculation when the farm is missing a field the
 * calculation depends on. It names the field and the size of the effect,
 * because "set the irrigation method" without "it moves Frac_LEACH between
 * 0 and 0.24" invites someone to pick whichever value clears the error.
 */
function MissingContext({
  farms,
  active,
  missing,
  needsMethod,
}: {
  farms: Farm[];
  active: Farm;
  missing: string[];
  needsMethod: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">GHG Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Emissions from fuel combustion and nitrogen-fertiliser use, per farm-year, under VM0042
          v2.2 Quantification Approach 3.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {farms.map((f) => (
          <Link
            key={f.farmId}
            href={`/ghg?farm=${f.farmId}`}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (f.farmId === active.farmId
                ? "bg-pine-600 text-white"
                : "border border-line bg-white text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
            <span className="ml-1.5 opacity-70">
              {f.climateZone ?? "zone?"} · {f.irrigationMethod ?? "irrigation?"}
            </span>
          </Link>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-base font-bold text-danger">
          {active.name} cannot be quantified yet
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Its {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} not recorded, and the
          engine will not assume {missing.length > 1 ? "them" : "it"}.
        </p>

        <ul className="mt-4 max-w-2xl space-y-2 text-[13px] text-muted">
          {missing.includes("climate zone") && (
            <li className="rounded-lg border border-line bg-cream px-3 py-2">
              <b className="text-pine-700">Climate zone</b> selects the parameter set. EF_N_direct is
              0.013 in a wet zone and 0.005 in a dry one — a factor of 2.6 straight onto the claimed
              reduction.
            </li>
          )}
          {needsMethod && (
            <li className="rounded-lg border border-line bg-cream px-3 py-2">
              <b className="text-pine-700">Irrigation method</b> decides Frac_LEACH in a dry zone:
              flood, furrow and sprinkler put water past the root zone and hold it at 0.24, while
              drip and rain-fed give 0. It is a property of this farm — it cannot be taken from the
              country or from a neighbouring farm.
            </li>
          )}
        </ul>

        <Link
          href="/admin#farm-context"
          className="mt-5 inline-block rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
        >
          Record it in Admin
        </Link>
      </Card>
    </div>
  );
}

/**
 * Shown in db mode when the farm has no activity data. The demo figures are
 * deliberately not substituted: an emissions number computed over invented
 * fuel and fertiliser reads exactly like a real one, and this screen is the
 * kind a VVB gets shown.
 */
function NoActivityData({
  farms,
  active,
  fertilizers,
  recordActivityDataAction: action,
}: {
  farms: Farm[];
  active: Farm;
  fertilizers: Array<{ name: string; nContent: number; class: string }>;
  recordActivityDataAction?: (input: {
    farmId: string;
    scenario: "BSL" | "PR" | "WP";
    year: number;
    areaHa: number;
    dieselL?: number;
    gasolineL?: number;
    residueBurntKg?: number;
    nfixDryMatterT?: number;
    nfixNContent?: number;
    fertilizers: Array<{ fertilizerName: string; massT: number; intervalYears?: number }>;
  }) => Promise<ToolResult<RecordedActivityData>>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">GHG Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Emissions from fuel combustion and nitrogen-fertiliser use, per farm-year, under VM0042
          v2.2 Quantification Approach 3.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {farms.map((f) => (
          <Link
            key={f.farmId}
            href={`/ghg?farm=${f.farmId}`}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (f.farmId === active.farmId
                ? "bg-pine-600 text-white"
                : "border border-line bg-white text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
            <span className="ml-1.5 opacity-70">
              {f.climateZone ?? "zone?"} · {f.irrigationMethod ?? "irrigation?"}
            </span>
          </Link>
        ))}
      </div>

      <Card className="p-6">
        <p className="text-sm font-semibold text-pine-700">
          {active.name} has no activity data recorded.
        </p>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          The calculator needs the farm&apos;s fuel and fertiliser records — diesel and gasoline
          litres, each fertiliser application with its nitrogen content — for a baseline period and
          each project year. Nothing is estimated in their place: an emissions figure over invented
          inputs would read exactly like a real one.
        </p>
        <p className="mt-3 font-mono text-[11px] text-faint">
          waiting on: mrv.activity_data and mrv.fertilizer_applications for this farm
        </p>
      </Card>

      {action && (
        <ActivityDataForm farmId={active.farmId} fertilizers={fertilizers} action={action} />
      )}
    </div>
  );
}
