/** Domain types for the MRV module, aligned to the mrv schema (Appendix B). */

export type QuantApproach = "QA1" | "QA2" | "QA3";
export type ClimateZone = "wet" | "dry";
export type ProjectStatus =
  | "under_development"
  | "registered"
  | "validated"
  | "verified";

export interface Project {
  projectId: string;
  name: string;
  methodology: string;
  isGrouped: boolean;
  country: string;
  status: ProjectStatus;
  isDemo: boolean;
}

export interface Farm {
  farmId: string;
  projectId: string;
  name: string;
  installationCode: string;
  operator: string | null;
  country: string;
  region: string | null;
  climateZone: ClimateZone;
  status: string;
  isDemo: boolean;
  /** derived */
  plotCount: number;
  totalAreaHa: number;
}

/** A GeoJSON Polygon, as stored (SRID 4326). */
export interface PolygonGeoJSON {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Plot {
  plotId: string;
  farmId: string;
  name: string;
  geom: PolygonGeoJSON;
  areaHa: number;
  applicationAreaHa: number;
  quantificationApproach: QuantApproach;
  crop: string | null;
  strokeColor: string;
  isDemo: boolean;
}

/** A farm with its plots, for the map / overview. */
export interface FarmWithPlots extends Farm {
  plots: Plot[];
}

/** mrv.point_status */
export type PointStatus = "planned" | "sampled" | "lab_pending" | "complete";
/** mrv.sample_scenario */
export type SampleScenario = "BSL" | "PR" | "WP";

export interface SamplingPoint {
  pointId: string;
  plotId: string | null;
  bslId: string | null;
  scenario: SampleScenario;
  /** [lon, lat] of planned_geom */
  lonLat: [number, number];
  compositeCores: number | null;
  isRevisit: boolean;
  status: PointStatus;
}
