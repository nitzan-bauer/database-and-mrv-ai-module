import type { Farm, Plot, Project, SamplingPoint } from "./types";

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
    status: "active",
    isDemo: true,
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
    status: "active",
    isDemo: true,
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
