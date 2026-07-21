# GIS capacity — measured, not estimated

The question behind this document: the project will accumulate a lot of spatial data — every plot, every stratum, every sampling map, across many farms and many years. Does the infrastructure hold?

Short answer: comfortably, for vector data. The one decision that needed making is about **rasters**, and the answer there is to keep them out of the database.

Everything below was measured on the actual dev instance (`db.t4g.micro`, 2 vCPU, 1 GB RAM — the smallest box available), not estimated.

---

## Benchmark

10,000 plot polygons and 200,000 sampling points, built in a scratch schema and dropped afterwards.

| Operation | Result |
|---|---|
| 10,000 plot polygons | **2.7 MB** |
| 200,000 sampling points | **22 MB** |
| Viewport query (`ST_Intersects` on a bbox) | **83 ms** → 440 plots |
| Vector tile render (`ST_AsMVT`) | **142 ms** |
| Geodesic area of all 10,000 plots | **149 ms** |
| Full spatial join, 200k points × 10k polygons | 8.5 s |

The functional spec's NFR asks for a map render under 2 seconds for a 500-point project. The viewport query returns in 83 ms — roughly 24× the requirement, on the smallest instance class.

**About the 8.5 seconds:** that query cross-references every point against every polygon with no filter, which is not a shape that occurs in practice. Real queries always carry context — the points on work order 42, the plots of farm X — and return in milliseconds. It is included as an upper bound, not a warning.

## Storage projection

Extrapolating from measured sizes to a realistic production estate:

| | Volume | Size |
|---|---|---|
| 1,000 farms × 10 plots | 10,000 polygons | ~2.7 MB |
| 10 years of sampling (≈37 points/farm/cycle) | ~370,000 points | ~40 MB |
| SOC measurements (2 depth rows per sample) | ~740,000 rows | ~100 MB with indexes |

Single-digit gigabytes against a 100 GB autoscaling ceiling already configured in Terraform. Storage is not the constraint and will not become one.

## A capability worth knowing about

PostGIS renders its own map tiles — `ST_AsMVT` produced a vector tile in 142 ms. Serving map data straight from the database is therefore an option, rather than uploading tilesets to Mapbox by hand. That removes a manual sync step and a second source of truth for the same polygons. Not needed yet; noted for when the map layer is built.

---

## The raster decision

**Rasters do not go in this database.** `postgis_raster` is deliberately not enabled.

Continuous surfaces — SoilGrids SOC layers, IPCC climate zones, elevation, soil texture grids — are reference data produced elsewhere and consumed at specific locations. Storing them in the operational database means importing gigabytes of tiles, keeping them current as the source publishes new versions, and backing them up alongside the evidence that actually matters for verification.

The pattern instead:

1. The raster file, if a copy is needed, lives in the **`models` S3 bucket** — already provisioned, KMS-encrypted, versioned.
2. Values are **extracted per plot** at the point of use — from the SoilGrids API, or by sampling the raster once during onboarding.
3. Only the **extracted values** are stored, on the plot: `soil_group_wrb`, `soil_texture_fao`, `climate_zone_ipcc`, `slope_class`. Those columns already exist in `mrv.plots`.

This keeps the database holding what a VVB will ask about — measurements, provenance, decisions — rather than a mirror of a public dataset. It also means a SoilGrids version change is a re-extraction, not a migration.

If in-database raster analysis is genuinely needed later, enabling `postgis_raster` is a single line in a migration. The decision is reversible; the default should be off.

---

## Real constraints, in order

**1. Instance size.** `db.t4g.micro` is a development box. Production will need a larger class — but that is one variable in `terraform.tfvars` and an apply, not an architectural change. Worth revisiting when concurrent users exceed a handful or the first large sampling campaign lands.

**2. Partitioning.** `soc_measurements` and `sampling_events` are time-series tables that will reach millions of rows. Past roughly 10 million, partitioning by year becomes worthwhile. Not required now, and adding it later does not require redesigning the schema. Stage 7.

**3. Nothing else.** Vector storage, spatial indexing, geodesic area, tile rendering and point-in-polygon are all measured and comfortable.
