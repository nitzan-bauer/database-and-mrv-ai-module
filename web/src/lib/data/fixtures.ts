import { generatePlan } from "@/lib/planner/generate";
import { tokenExpiry } from "@/lib/mcp/token";
import type { ActivityData } from "@/lib/ghg/engine";
import type {
  AlmActivity,
  CycleStatus,
  CycleType,
  Farm,
  Lab,
  ModelRunSummary,
  Plot,
  Product,
  Project,
  SampleRow,
  SamplingPlan,
  SamplingPoint,
  SocMeasurement,
  TextureMeasurement,
  WorkOrder,
  WorkOrderPoint,
} from "./types";

/**
 * DEV-FIXTURES — the demonstration project and its two demo farms, mirroring
 * seeds/0002_demo_farms.sql exactly (same plot IDs, areas, approaches, crops,
 * stroke colours, and polygons imported from the live SaaS on 2026-07-21).
 *
 * !! DEMONSTRATION DATA — Elad Farm and Nitzan-Veg-Tech are not clients. !!
 */

export const DEMO_PROJECT: Project = {
  projectId: "CARBO-3988-DEMO",
  name: "CarboNature Farming Project - E.Africa (DEMO)",
  methodology: "VM0042 v2.2",
  isGrouped: true,
  country: "Kenya",
  status: "under_development",
  isDemo: true,
};

const NVT = "617f7cfb-701e-4760-b13b-7663904be8bf";
const ELD = "8a42abd0-125c-49ad-9077-36b5cd76d86f";

export const DEMO_FARMS: Farm[] = [
  {
    farmId: NVT,
    projectId: DEMO_PROJECT.projectId,
    name: "Nitzan-Veg-Tech Farm",
    installationCode: "NVT-DEMO",
    operator: "Veg-Tech Ltd",
    country: "Israel",
    region: "Pardes Hana-Karkur",
    climateZone: "dry",
    irrigationMethod: "drip",
    status: "active",
    isDemo: true,
    driveFolderId: null,
    plotCount: 5,
    totalAreaHa: 223.12,
  },
  {
    farmId: ELD,
    projectId: DEMO_PROJECT.projectId,
    name: "Elad Farm",
    installationCode: "ELD-DEMO",
    operator: "Bouton",
    country: "Kenya",
    region: null,
    climateZone: "wet",
    irrigationMethod: "drip",
    status: "active",
    isDemo: true,
    driveFolderId: null,
    plotCount: 2,
    totalAreaHa: 44.95,
  },
];

export const DEMO_PLOTS: Plot[] = [
  {
    plotId: "NVT-WP-01", farmId: NVT, name: "Imri", areaHa: 36.07, applicationAreaHa: 36.07,
    quantificationApproach: "QA2", crop: "cucumber", strokeColor: "#13a4b4", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[35.12145947435931,32.99091911921724],[35.12747577276545,32.99071727051917],[35.126573328003985,32.99773124204684],[35.12410664565755,32.99737803378939],[35.12248224508761,32.996520236421006],[35.121579800327225,32.99581380879802],[35.12145947435931,32.99091911921724]]] },
  },
  {
    plotId: "NVT-WP-02", farmId: NVT, name: "Shira", areaHa: 78.89, applicationAreaHa: 78.89,
    quantificationApproach: "QA2", crop: "Tomatoes", strokeColor: "#e8743b", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[35.12121882242238,32.99081819492636],[35.12127898540638,32.98905200115091],[35.118691977092084,32.98920339057332],[35.11141225602077,32.99107050543718],[35.11393910135109,32.999345890359535],[35.118872466043854,32.998387196487286],[35.12151963734331,32.995914727375975],[35.12121882242238,32.99081819492636]]] },
  },
  {
    plotId: "NVT-WP-03", farmId: NVT, name: "Naomi Miriam", areaHa: 36.93, applicationAreaHa: 36.93,
    quantificationApproach: "QA2", crop: "Wheat", strokeColor: "#3969ac", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[35.12049688451927,32.98864829819476],[35.11827085410866,32.98254201378448],[35.12296356686565,32.983702744986914],[35.12410666356294,32.98486346092925],[35.12585139010085,32.98501485753542],[35.12759611663867,32.9859232317216],[35.12759611663867,32.98849690782025],[35.12049688451927,32.98864829819476]]] },
  },
  {
    plotId: "NVT-WP-04", farmId: NVT, name: "Maize 1", areaHa: 46.56, applicationAreaHa: 46.56,
    quantificationApproach: "QA2", crop: "Maize", strokeColor: "#3969ac", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[35.11381607492805,32.99949720112335],[35.10910918699295,33.000542903767425],[35.10639727142686,32.993797903881514],[35.10723890039512,32.99371947061775],[35.106615471530205,32.992098500894215],[35.11135353090884,32.991026552948256],[35.11381607492805,32.99949720112335]]] },
  },
  {
    plotId: "NVT-WP-05", farmId: NVT, name: "Nitzan", areaHa: 24.67, applicationAreaHa: 24.67,
    quantificationApproach: "QA2", crop: "sugarcane", strokeColor: "#cf3759", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[35.136552280077524,33.00623666694625],[35.136619064371615,33.00116797260641],[35.14159449436434,33.00231615540112],[35.14343106248171,33.004444454717316],[35.142095376577686,33.00612465474916],[35.13935722047552,33.00531256206304],[35.136552280077524,33.00623666694625]]] },
  },
  {
    plotId: "ELD-WP-01", farmId: ELD, name: "tomatoes", areaHa: 2.36, applicationAreaHa: 2.36,
    quantificationApproach: "QA2", crop: "tomatoes", strokeColor: "#13a4b4", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[37.18818524076951,-0.9172516965470408],[37.19047711386426,-0.9164584574327819],[37.19122638006817,-0.9183534172466779],[37.1888463580091,-0.919190724751445],[37.18743597456552,-0.9154008050082041],[37.18615781457086,-0.9160177689604865],[37.186422261467044,-0.9180008666598667],[37.18818524076951,-0.9172516965470408]]] },
  },
  {
    plotId: "ELD-WP-02", farmId: ELD, name: "2 matoes", areaHa: 42.59, applicationAreaHa: 42.59,
    quantificationApproach: "QA2", crop: "tomatoe", strokeColor: "#3969ac", isDemo: true,
    geom: { type: "Polygon", coordinates: [[[37.20329451848548,-0.9028493520487473],[37.204354352377834,-0.9057208023442627],[37.206644961112005,-0.9046269167857446],[37.20708940758169,-0.9055156988264912],[37.20849112337524,-0.9058575380158231],[37.210508226588985,-0.9034646630178003],[37.20992702735788,-0.903191191489114],[37.20862787613541,-0.9031228236030842],[37.20695265482152,-0.8991916680324579],[37.20096972156094,-0.901687097712383],[37.20124322708131,-0.9027809841575021],[37.20079878061034,-0.9032253754303952],[37.201345791651136,-0.9044218132061133],[37.201790238122044,-0.9045243649967176],[37.202679131063945,-0.9043876292748507],[37.202508190113434,-0.903157007546298],[37.20329451848548,-0.9028493520487473]]] },
  },
];

/* ────────────────── demo sampling points (fixtures only) ──────────────────
   The seeds carry no sampling points yet (planning starts in Slice 3), so
   fixtures generate a deterministic demo round: 5 composite points per plot
   (VM0042 ≥5/stratum), placed inside each polygon by interpolating from the
   ring centroid toward its vertices. Statuses are mixed so the map legend
   shows every colour. Replaced by real rows once plans exist in the DB.   */

const POINT_STATUS_CYCLE = ["complete", "complete", "lab_pending", "sampled", "planned"] as const;

function ringCentroid(ring: number[][]): [number, number] {
  // last vertex repeats the first — skip it
  const pts = ring.slice(0, -1);
  const [sx, sy] = pts.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / pts.length, sy / pts.length];
}

function demoPointsForPlot(plot: Plot): SamplingPoint[] {
  const ring = plot.geom.coordinates[0];
  const [cx, cy] = ringCentroid(ring);
  const verts = ring.slice(0, -1);
  const out: SamplingPoint[] = [];
  for (let i = 0; i < 5; i++) {
    const [vx, vy] = verts[Math.floor((i * verts.length) / 5) % verts.length];
    const t = 0.3; // stay well inside the polygon
    out.push({
      pointId: `${plot.plotId}-P${String(i + 1).padStart(2, "0")}`,
      plotId: plot.plotId,
      bslId: null,
      scenario: "WP",
      lonLat: [cx + t * (vx - cx), cy + t * (vy - cy)],
      compositeCores: 5,
      isRevisit: false,
      status: POINT_STATUS_CYCLE[i],
    });
  }
  return out;
}

export const DEMO_SAMPLING_POINTS: SamplingPoint[] = DEMO_PLOTS.flatMap(demoPointsForPlot);

/* ══════════════════ Plot Details fixtures (spec §6.3) ══════════════════
   Products are the REAL marketplace catalogue (seeds/0003_products.sql).
   Activities, samples, lab rows and model runs are demo values — no such
   rows exist in the database yet (lab ingestion is Slice 6, planning is
   Slice 3). They exercise every Plot-Details tab so the screen can be
   reviewed before real data lands.                                      */

export const DEMO_PRODUCTS: Record<string, Product> = {
  rootella: { name: "Rootella products", activityType: "biofertilizer", activityLabel: "Apply Mycorrhiza", costPerHaUsd: 84.96, creditPerHa: 3 },
  rootellaF: { name: "Rootella-F", activityType: "biofertilizer", activityLabel: "Apply Rootella-F", costPerHaUsd: 1298.52, creditPerHa: 38 },
  coten: { name: "CoteN", activityType: "crf", activityLabel: "Improve fertilizer management", costPerHaUsd: 13968, creditPerHa: 400 },
  multicote: { name: "Multicote Products", activityType: "crf", activityLabel: "Control Release Fertilizers", costPerHaUsd: 53237.5, creditPerHa: 1522 },
};

/** Two Project Activities per plot: a biofertilizer (removal) + a CRF (avoidance). */
export const DEMO_ACTIVITIES: AlmActivity[] = DEMO_PLOTS.flatMap((p, i) => {
  const bio = i % 2 === 0 ? DEMO_PRODUCTS.rootella : DEMO_PRODUCTS.rootellaF;
  const crf = i % 2 === 0 ? DEMO_PRODUCTS.multicote : DEMO_PRODUCTS.coten;
  return [
    {
      activityId: `${p.plotId}-ACT-1`, plotId: p.plotId, product: bio,
      activityType: "biofertilizer", rate: 2.5, rateUnit: "kg/ha",
      applicationAreaHa: p.applicationAreaHa, applicationDate: "2026-04-12",
      season: "2026 spring", scenario: "PR" as const,
      notes: "Removal pathway — soil carbon build-up",
    },
    {
      activityId: `${p.plotId}-ACT-2`, plotId: p.plotId, product: crf,
      activityType: "crf", rate: 180, rateUnit: "kg N/ha",
      applicationAreaHa: p.applicationAreaHa, applicationDate: "2026-04-20",
      season: "2026 spring", scenario: "PR" as const,
      notes: "Avoidance pathway — enters the GHG Calculator",
    },
  ];
});

/** SOC + texture samples for the completed points, two depth increments each. */
const DEPTHS: Array<[number, number]> = [[0, 15], [15, 30]];

/** Cycle-1 sampling window per farm, so dates satisfy the same-season check. */
const CYCLE1_DATE: Record<string, string> = { [ELD]: "2026-08-14", [NVT]: "2026-09-11" };

export const DEMO_SAMPLES: SampleRow[] = DEMO_SAMPLING_POINTS.filter(
  (sp) => sp.status === "complete" || sp.status === "lab_pending",
).flatMap((sp, idx) => {
  const seq = idx * 3;
  const farmId = DEMO_PLOTS.find((p) => p.plotId === sp.plotId)?.farmId ?? ELD;
  const sampledOn = CYCLE1_DATE[farmId];
  const rows: SampleRow[] = DEPTHS.map(([top, base], d) => ({
    sampleId: `OFM${String(seq + d + 1).padStart(10, "0")}`,
    pointId: sp.pointId,
    sampleType: "soc" as const,
    stratumCode: "A",
    scenario: sp.scenario,
    depthTopCm: top,
    depthBaseCm: base,
    compositeCores: sp.compositeCores,
    barcode: `OFM${String(seq + d + 1).padStart(10, "0")}`,
    samplingDate: sampledOn,
    distanceFromTargetM: 2.1 + d,
    photoUrl: null,
    fieldNotes: null,
  }));
  // VM0042: every first-round point also gets a texture spot sample at 15 cm
  rows.push({
    sampleId: `OFM${String(seq + 3).padStart(10, "0")}`,
    pointId: sp.pointId,
    sampleType: "texture" as const,
    stratumCode: "A",
    scenario: sp.scenario,
    depthTopCm: 15,
    depthBaseCm: 15,
    compositeCores: null,
    barcode: `OFM${String(seq + 3).padStart(10, "0")}`,
    samplingDate: sampledOn,
    distanceFromTargetM: 2.1,
    photoUrl: null,
    fieldNotes: "surface cleared, sieved <2 mm",
  });
  return rows;
});

/** Lab results — only for samples whose point is 'complete'. */
const COMPLETE_POINTS = new Set(
  DEMO_SAMPLING_POINTS.filter((sp) => sp.status === "complete").map((sp) => sp.pointId),
);

export const DEMO_SOC: SocMeasurement[] = DEMO_SAMPLES.filter(
  (s) => s.sampleType === "soc" && COMPLETE_POINTS.has(s.pointId),
).map((s, i) => {
  // Topsoil carbon declines with depth; values chosen so a 0–30 cm profile
  // lands near 35 t C/ha, the range the DB's own worked example implies
  // (TOC 1% x BD 1.3 x 15 cm = 19.5 t C/ha, scripts/verify.sql).
  const shallow = s.depthTopCm === 0;
  const toc400 = shallow ? 0.95 + (i % 3) * 0.05 : 0.55 + (i % 3) * 0.03;
  const roc600 = shallow ? 0.15 : 0.1;
  const bd = shallow ? 1.28 : 1.41;
  const thickness = (s.depthBaseCm ?? 0) - (s.depthTopCm ?? 0);
  return {
    sampleId: s.sampleId,
    method: "dry_combustion",
    analysisDate: "2026-06-02",
    depthTopCm: s.depthTopCm ?? 0,
    depthBaseCm: s.depthBaseCm ?? 0,
    bulkDensity: bd,
    toc400Pct: Number(toc400.toFixed(4)),
    roc600Pct: roc600,
    tic900Pct: 0.05,
    tocPct: Number((toc400 + roc600).toFixed(4)),
    // mirrors the generated column: TOC% x BD x thickness x (1 - largeCF)
    socTPerHa: Number(((toc400 + roc600) * bd * thickness).toFixed(4)),
    soilMassTHa: Number((bd * thickness * 100).toFixed(4)),
  };
});

export const DEMO_TEXTURE: TextureMeasurement[] = DEMO_SAMPLES.filter(
  (s) => s.sampleType === "texture" && COMPLETE_POINTS.has(s.pointId),
).map((s, i) => {
  const sand = 30 + (i % 3) * 5;
  const clay = 35 - (i % 3) * 3;
  return {
    sampleId: s.sampleId,
    sandPct: sand,
    siltPct: 100 - sand - clay,
    clayPct: clay,
    usdaClass: clay >= 33 ? "Clay loam" : "Loam",
    depthCm: 15,
  };
});

export const DEMO_MODEL_RUNS: ModelRunSummary[] = [
  {
    runId: "run-2026-c1-dndc",
    model: "DNDC",
    modelVersion: "v9.5",
    runType: "baseline_init",
    scenario: "paired",
    status: "complete",
    uncertaintyMethod: "monte_carlo",
    monteCarloIters: 1000,
    periodStart: "2023-01-01",
    periodEnd: "2026-06-30",
  },
];

/* ══════════════ Sampling plans — the 3-year view (spec §6.4) ══════════════
   No cycles exist in the database yet, so fixtures lay out a realistic
   three-year programme per farm. Cycle intervals follow the crop, not the
   calendar: the spec allows up to 10 months, and a short-cycle crop can
   trigger a further round in under a year (Nitzan-Veg-Tech, below).      */

const PLAN_ROWS: Array<{
  farmId: string;
  n: number;
  type: CycleType;
  start: string;
  end: string;
  status: CycleStatus;
  trigger: string;
}> = [
  // Elad Farm (Kenya) — annual-ish cadence
  { farmId: ELD, n: 1, type: "initial", start: "2026-08-10", end: "2026-08-24", status: "in_field", trigger: "end of growth cycle" },
  { farmId: ELD, n: 2, type: "true_up", start: "2027-06-14", end: "2027-06-28", status: "draft", trigger: "10-month cap from cycle 1" },
  { farmId: ELD, n: 3, type: "verification", start: "2028-05-08", end: "2028-05-22", status: "draft", trigger: "verification window" },
  // Nitzan-Veg-Tech (Israel) — short-growth crops, sub-annual second round
  { farmId: NVT, n: 1, type: "initial", start: "2026-09-07", end: "2026-09-21", status: "approved", trigger: "end of growth cycle" },
  { farmId: NVT, n: 2, type: "true_up", start: "2027-05-17", end: "2027-05-31", status: "draft", trigger: "short crop cycle — < 1 yr gap" },
  { farmId: NVT, n: 3, type: "verification", start: "2028-04-10", end: "2028-04-24", status: "draft", trigger: "verification window" },
];

export const DEMO_PLANS: SamplingPlan[] = PLAN_ROWS.map((r) => {
  const farm = DEMO_FARMS.find((f) => f.farmId === r.farmId)!;
  const plots = DEMO_PLOTS.filter((p) => p.farmId === r.farmId);
  const plan = generatePlan({
    plots,
    cycleNumber: r.n,
    approach: "QA2",
    // cycle 2 knows cycle 1's variability; cycle 3 inherits the improved figure
    cvByStratum:
      r.n === 1
        ? {}
        : Object.fromEntries(
            plots.map((p, i) => [`${p.plotId}:A`, r.n === 2 ? (i === 0 ? 0.38 : 0.22) : 0.24]),
          ),
  });
  return {
    cycleId: `${farm.installationCode}-C${r.n}`,
    farmId: r.farmId,
    farmName: farm.name,
    projectId: farm.projectId,
    cycleNumber: r.n,
    cycleType: r.type,
    approach: "QA2" as const,
    collectTexture: plan.collectTexture,
    textureDepthCm: plan.textureDepthCm,
    triggerType: r.trigger,
    depthScheme: plan.depthScheme,
    plannedStart: r.start,
    plannedEnd: r.end,
    confidenceAlpha: plan.confidenceAlpha,
    power: plan.power,
    mddTarget: plan.mddTarget,
    sameSeason: true,
    revisitPoints: r.n > 1,
    status: r.status,
    generatedBy: "manual",
    approvedAt: r.status === "draft" ? null : `${r.start}T09:00:00Z`,
    plannedPoints: plan.totalPoints,
  };
});

/* ═══════════ Work orders + MCP tokens (spec §6.5) ═══════════
   One work order per cycle that has left draft. Elad's cycle 1 is in the
   field, so it carries a live token; Nitzan-Veg-Tech's cycle 1 is approved
   but not yet sent, so its order sits in draft with no token issued.     */

export const DEMO_LAB: Lab = {
  labId: "lab-cropnut",
  name: "CropNut Kenya",
  iso17025: true,
  naptMember: false,
  glosolanMember: true,
  defaultMethod: "dry_combustion",
  contact: "lab@cropnut.example",
};

/** Sample IDs run OFM + 10 digits, as the database's next_sample_id() does. */
const ofm = (n: number) => `OFM${String(n).padStart(10, "0")}`;

function pointsForWorkOrder(farmId: string, startSeq: number): WorkOrderPoint[] {
  const plotIds = new Set(DEMO_PLOTS.filter((p) => p.farmId === farmId).map((p) => p.plotId));
  return DEMO_SAMPLING_POINTS.filter((sp) => sp.plotId && plotIds.has(sp.plotId)).map((sp, i) => ({
    sampleId: ofm(startSeq + i),
    pointId: sp.pointId,
    stratumCode: "A",
    scenario: sp.scenario,
    lat: sp.lonLat[1],
    lon: sp.lonLat[0],
    depthScheme: "0-15/15-30",
    compositeCores: sp.compositeCores,
    isRevisit: sp.isRevisit,
  }));
}

const ELD_WINDOW_END = "2026-08-24";

export const DEMO_WORK_ORDERS: WorkOrder[] = [
  {
    woId: "WO-2026-0042",
    farmId: ELD,
    farmName: "Elad Farm",
    cycleId: "ELD-DEMO-C1",
    cycleNumber: 1,
    cycleType: "initial",
    approach: "QA2",
    contractorName: "CropNut Kenya — sampling team",
    contractorEmail: "sampling@cropnut.example",
    lab: DEMO_LAB,
    projectLead: "Nitzan Bauer",
    windowStart: "2026-08-10",
    windowEnd: ELD_WINDOW_END,
    depthScheme: "0-15/15-30",
    state: "in_progress",
    pdfUrl: null,
    issuedAt: "2026-08-03T09:12:00Z",
    closedAt: null,
    points: pointsForWorkOrder(ELD, 1),
    token: {
      tokenId: "tok-eld-c1",
      workOrderId: "WO-2026-0042",
      contractorEmail: "sampling@cropnut.example",
      issuedAt: "2026-08-03T09:12:00Z",
      // window end + 14 days, per DEFAULT_GRACE_DAYS
      expiresAt: tokenExpiry(ELD_WINDOW_END).toISOString(),
      revokedAt: null,
      lastUsedAt: "2026-08-12T06:41:00Z",
    },
  },
  {
    woId: "WO-2026-0043",
    farmId: NVT,
    farmName: "Nitzan-Veg-Tech Farm",
    cycleId: "NVT-DEMO-C1",
    cycleNumber: 1,
    cycleType: "initial",
    approach: "QA2",
    contractorName: null,
    contractorEmail: null,
    lab: null,
    projectLead: "Nitzan Bauer",
    windowStart: "2026-09-07",
    windowEnd: "2026-09-21",
    depthScheme: "0-15/15-30",
    state: "draft",
    pdfUrl: null,
    issuedAt: null,
    closedAt: null,
    points: pointsForWorkOrder(NVT, 100),
    token: null,
  },
];

/* ═══════════ GHG activity data (spec AC#7) ═══════════
   Farm-years shaped after the calculator workbook's own verified rows: Elad
   mirrors Farm_B (fuel + synthetic and organic N + residue burning +
   N-fixing residue — the full set), Nitzan-Veg-Tech mirrors Farm_A. Baseline
   is the three-year pre-project average, which is why BSL is a single row. */

const UREA = (massT: number) => ({
  fertilizerName: "Urea", massT, nContent: 0.46,
  class: "synthetic" as const, intervalYears: 1,
});
const COMPOST = (massT: number, intervalYears = 1) => ({
  fertilizerName: "Compost", massT, nContent: 0.015,
  class: "organic" as const, intervalYears,
});

export const DEMO_ACTIVITY_DATA: ActivityData[] = [
  // Elad Farm — the full-coverage case
  {
    farmId: ELD, scenario: "BSL", year: 2025, areaHa: 30,
    dieselL: 5400, gasolineL: 0, residueBurntKg: 1617,
    nfixDryMatterT: 2.66, nfixNContent: 0.015,
    fertilizers: [UREA(13.6957), COMPOST(48)],
  },
  {
    farmId: ELD, scenario: "PR", year: 2026, areaHa: 30,
    // project year: less synthetic N, no burning, more compost
    dieselL: 4900, gasolineL: 0, residueBurntKg: 0,
    nfixDryMatterT: 3.10, nfixNContent: 0.015,
    fertilizers: [UREA(9.5652), COMPOST(60)],
  },
  // Nitzan-Veg-Tech Farm
  {
    farmId: NVT, scenario: "BSL", year: 2025, areaHa: 50,
    dieselL: 9000, gasolineL: 0, residueBurntKg: 0,
    nfixDryMatterT: 0, nfixNContent: 0,
    fertilizers: [UREA(32.1739), COMPOST(50)],
  },
  {
    farmId: NVT, scenario: "PR", year: 2026, areaHa: 50,
    dieselL: 8200, gasolineL: 0, residueBurntKg: 0,
    nfixDryMatterT: 0, nfixNContent: 0,
    fertilizers: [UREA(24.1304), COMPOST(70)],
  },
];

/* ═══════════ QA1 model run (spec §6.7) ═══════════
   One completed DNDC run over Elad Farm, with per-stratum deltas and the
   variance components Equation 74 is computed from. Variances are chosen so
   the project total lands on the deduction recorded in docs/STAGE-6.md.  */

export interface ModelInputStatus {
  label: string;
  detail: string;
  state: "ready" | "partial" | "missing";
}

export interface ModelStratumResult {
  stratumCode: string;
  plotId: string;
  areaHa: number;
  deltaSocWpTHa: number;
  deltaSocBslTHa: number;
  varModel: number;
  varSampling: number;
}

export const DEMO_MODEL_INPUTS: ModelInputStatus[] = [
  { label: "Initial SOC (t = 0)", detail: "10 points × 2 increments, ESM basis", state: "ready" },
  { label: "Bulk density", detail: "ISO 11272, fine earth < 2 mm", state: "ready" },
  { label: "Soil texture", detail: "cycle-1 test at every point", state: "ready" },
  { label: "Climate (PRISM daily)", detail: "6 years × 4 strata", state: "ready" },
  { label: "ALM schedule", detail: "per plot, from Project Activities", state: "ready" },
  { label: "True-up SOC", detail: "23 of 37 points returned", state: "partial" },
];

export const DEMO_MODEL_STRATA: ModelStratumResult[] = [
  { stratumCode: "A", plotId: "ELD-WP-01", areaHa: 2.36, deltaSocWpTHa: 1.48, deltaSocBslTHa: 0.22, varModel: 0.118, varSampling: 0.31 },
  { stratumCode: "B", plotId: "ELD-WP-02", areaHa: 42.59, deltaSocWpTHa: 1.38, deltaSocBslTHa: 0.19, varModel: 0.124, varSampling: 0.28 },
];

export const DEMO_MODEL_LOG: Array<{ t: string; line: string; kind: "info" | "step" | "done" }> = [
  { t: "14:02:11", line: "load PRISM daily climate, 6 yr × 4 strata … ok", kind: "info" },
  { t: "14:02:48", line: "validate inputs against VMD0053 §5.1 … ok", kind: "info" },
  { t: "14:05:02", line: "baseline scenario … done", kind: "step" },
  { t: "14:09:17", line: "project scenario … done", kind: "step" },
  { t: "14:11:03", line: "Monte Carlo, L = 1000 draws … started", kind: "info" },
  { t: "14:18:44", line: "Monte Carlo … 1000/1000 complete", kind: "step" },
  { t: "14:19:02", line: "Eq. 74 deduction computed from stored variances", kind: "done" },
  { t: "14:19:05", line: "results → mrv.model_results · logs → S3", kind: "done" },
];

/* ═══════════ Unified admin + audit (spec §6.8) ═══════════
   One permissions system over three systems. MRV rows mirror mrv.users and
   mrv.project_memberships; SaaS rows are what the module pulls from the
   CarboNature SaaS admin, so a person is defined once and governed here. */

export type AdminSystem = "MRV" | "SaaS" | "CRM";

export interface AdminUser {
  name: string;
  email: string;
  role: string;
  scope: string;
  system: AdminSystem;
  authMethod: "sso" | "password" | "mcp_token";
  isActive: boolean;
  lastActiveAt: string | null;
}

export const DEMO_ADMIN_USERS: AdminUser[] = [
  { name: "Nitzan Bauer", email: "nitzan@carbonature.io", role: "Super Admin", scope: "all projects", system: "MRV", authMethod: "sso", isActive: true, lastActiveAt: "2026-07-29" },
  { name: "Dave (AI-MRV)", email: "dave@carbonature.io", role: "Verification · service identity", scope: "CARBO-3988-DEMO", system: "MRV", authMethod: "sso", isActive: true, lastActiveAt: "2026-07-29" },
  { name: "MRV Technician", email: "tech@carbonature.io", role: "Field · reports to Dave", scope: "CARBO-3988-DEMO", system: "MRV", authMethod: "sso", isActive: true, lastActiveAt: "2026-07-28" },
  { name: "CropNut sampling team", email: "sampling@cropnut.example", role: "Sampler · work-order scoped", scope: "WO-2026-0042", system: "MRV", authMethod: "mcp_token", isActive: true, lastActiveAt: "2026-08-12" },
  { name: "Elad", email: "elad@eladfarm.example", role: "Grower · farmer portal", scope: "Elad Farm", system: "SaaS", authMethod: "password", isActive: true, lastActiveAt: "2026-07-27" },
  { name: "Nitzan Veg-Tech", email: "ops@vegtech.example", role: "Grower · farmer portal", scope: "Nitzan-Veg-Tech Farm", system: "SaaS", authMethod: "password", isActive: true, lastActiveAt: "2026-07-20" },
  { name: "Reserve buyer", email: "buyer@example.com", role: "Credit buyer · portal", scope: "reserved plots", system: "SaaS", authMethod: "password", isActive: true, lastActiveAt: "2026-07-25" },
];

/** mrv.agent_action_policies — the AUTO / CONFIRM / OFF gate per action. */
export const DEMO_AGENT_POLICIES: Array<{ action: string; mode: "auto" | "confirm" | "off"; note: string }> = [
  { action: "propose_sampling_plan", mode: "auto", note: "Read-only proposal; manager approves." },
  { action: "send_work_order", mode: "confirm", note: "Always requires manager click." },
  { action: "run_model", mode: "confirm", note: "Avoids accidental compute spend." },
  { action: "recalibrate_model", mode: "confirm", note: "Affects all subsequent runs; explicit signoff." },
  { action: "issue_alerts", mode: "auto", note: "Read-only; no system changes." },
  { action: "chat", mode: "auto", note: "Read-only by default; write actions gated per action above." },
];

/** mrv.audit_log — actor, action, target, timestamp. Append-only. */
export const DEMO_AUDIT: Array<{
  ts: string;
  actor: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
}> = [
  { ts: "2026-08-12T06:41:02Z", actor: "sampling@cropnut.example", actorRole: "sampler", action: "submit_point", targetType: "sampling_event", targetId: "OFM0000000003" },
  { ts: "2026-08-12T06:38:44Z", actor: "sampling@cropnut.example", actorRole: "sampler", action: "capture_photo", targetType: "sampling_event", targetId: "OFM0000000003" },
  { ts: "2026-08-03T09:12:00Z", actor: "nitzan@carbonature.io", actorRole: "super_admin", action: "issue_mcp_token", targetType: "work_order", targetId: "WO-2026-0042" },
  { ts: "2026-08-03T09:11:31Z", actor: "nitzan@carbonature.io", actorRole: "super_admin", action: "send_work_order", targetType: "work_order", targetId: "WO-2026-0042" },
  { ts: "2026-08-01T14:22:09Z", actor: "dave@carbonature.io", actorRole: "ai_agent", action: "propose_sampling_plan", targetType: "sampling_cycle", targetId: "ELD-DEMO-C1" },
  { ts: "2026-08-01T14:20:55Z", actor: "nitzan@carbonature.io", actorRole: "super_admin", action: "approve_sampling_plan", targetType: "sampling_cycle", targetId: "NVT-DEMO-C1" },
  { ts: "2026-07-29T15:39:27Z", actor: "nitzan@carbonature.io", actorRole: "super_admin", action: "apply_migration", targetType: "schema", targetId: "0019_compliance_full_hard_checks" },
];
