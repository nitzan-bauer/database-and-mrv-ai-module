import {
  DEMO_MODEL_INPUTS,
  DEMO_MODEL_LOG,
  DEMO_MODEL_STRATA,
} from "@/lib/data/fixtures";
import { countModelRuns } from "@/lib/data";
import { equation74, netTHa } from "@/lib/model/uncertainty";
import { ModelRunConsole } from "@/components/model/ModelRunConsole";

export const dynamic = "force-dynamic";

/**
 * Screen 7 — Model Run Console (spec §6.7, P2). The control surface for QA1:
 * pre-validated inputs, the run itself, and the Equation-74 deduction that
 * turns a modelled SOC change into a claimable one.
 */
export default async function ModelRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const { path } = await searchParams;
  const uncertaintyPath = path === "analytical" ? "analytical" : "monte_carlo";

  // In db mode a console full of demo strata and a demo log would read as a
  // completed QA1 run that never happened. Equation 74 turns a modelled SOC
  // change into a claimable one, and a deduction computed over invented
  // variance is indistinguishable on screen from a real deduction — so when
  // there are no runs, the screen says so. Fixtures keep the demo, which is
  // what fixtures are for.
  if ((await countModelRuns()) === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-pine-700">Model Run Console</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Quantification Approach 1: DNDC and DayCent simulate SOC stock change against measured
            true-up points, and Equation 74 converts the modelled change into the part that can
            actually be claimed.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-6">
          <p className="text-sm font-semibold text-pine-700">No model run yet.</p>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            QA1 needs at least two measured cycles before a model can be calibrated: one to
            establish the baseline stock and a true-up to check the simulation against. The console
            fills in once a run exists — nothing is simulated in the meantime, because an
            Equation-74 deduction over invented variance looks exactly like a real one.
          </p>
          <p className="mt-3 font-mono text-[11px] text-faint">
            waiting on: mrv.model_runs and mrv.model_results
          </p>
        </div>
      </div>
    );
  }

  const strata = DEMO_MODEL_STRATA.map((s) => ({
    ...s,
    netTHa: netTHa(s.deltaSocWpTHa, s.deltaSocBslTHa),
  }));

  // Area-weighted mean across strata — Eq. 74 is applied to the mean ERR for
  // the pool across the project area, not to one stratum at a time.
  const totalArea = strata.reduce((s, x) => s + x.areaHa, 0);
  const meanNet =
    strata.reduce((s, x) => s + x.netTHa * x.areaHa, 0) / (totalArea || 1);
  const varModel =
    strata.reduce((s, x) => s + x.varModel * x.areaHa, 0) / (totalArea || 1);
  const varSampling =
    strata.reduce((s, x) => s + x.varSampling * x.areaHa, 0) / (totalArea || 1);

  const uncertainty = equation74({
    meanErrTHa: meanNet,
    varModel,
    varSampling,
    areaHa: totalArea,
    path: uncertaintyPath,
    degreesOfFreedom: 9, // 10 completed points, one design
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Model Run Console</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Quantification Approach 1: DNDC and DayCent simulate SOC stock change against measured
          true-up points, and Equation 74 converts the modelled change into the part that can
          actually be claimed.
        </p>
      </div>
      <ModelRunConsole
        inputs={DEMO_MODEL_INPUTS}
        log={DEMO_MODEL_LOG}
        strata={strata}
        totalAreaHa={totalArea}
        meanNetTHa={Math.round(meanNet * 10_000) / 10_000}
        varModel={varModel}
        varSampling={varSampling}
        uncertainty={uncertainty}
      />
    </div>
  );
}
