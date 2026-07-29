import {
  DEMO_MODEL_INPUTS,
  DEMO_MODEL_LOG,
  DEMO_MODEL_STRATA,
} from "@/lib/data/fixtures";
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
