# Stage 1 — Spatial schema + seeded farms

## ✅ Done — 21 July 2026

The spatial core is live on RDS and populated with the two demonstration farms.

## ⚠️ Everything seeded so far is DEMO data

**Elad Farm** and **Nitzan-Veg-Tech Farm** are demonstration farms, not clients. The earlier candidates — Kisima, RAI, Casterra — were also demos and have been dropped; they are not in this database.

This is enforced, not just documented. Migration `0007` adds `is_demo` to projects, farms and plots, plus a trigger that **refuses** to attach a demo farm to a real project, and `mrv.v_real_plots` — the view anything audit-facing should read from. A demo hectare reaching a Verra submission would be a material misstatement, so the interlock lives in the database rather than in a convention someone has to remember.

`scripts/verify.sql` proves both halves: that the trigger fires, and that no demo row can surface through the view.

## What was seeded

Grouped project **`CARBO-3988-DEMO`** — "CarboNature Farming Project - E.Africa (DEMO)", mirroring the marketplace heading both farms appear under.

| Farm | Country | Operator | Plots | Stored area | Geodesic area |
|---|---|---|---|---|---|
| Elad Farm | Kenya | Bouton | 2 | 44.95 ha | 44.75 ha |
| Nitzan-Veg-Tech Farm | Israel | Veg-Tech Ltd | 5 | 223.12 ha | 223.01 ha |

Plot IDs follow `<CODE>-WP-NN`: `ELD-WP-01..02`, `NVT-WP-01..05`.

Areas differ from the stored values by under 0.5%, which is ordinary for polygons digitised against imagery. The seed recomputes every area with `mrv.area_ha()` and raises a warning past 5% or 0.5 ha, so a genuinely wrong polygon surfaces at import rather than in a report months later. Nothing warned.

## Where the polygons came from

Not from a file — from the live SaaS API:

```
https://app.carbonature.io/api/public/farm-plots?farm=<saas_farm_id>
```

This is the same endpoint `carbonature.io`'s public farm pages call to draw their Mapbox maps, so the geometry in this database is byte-for-byte what the marketplace shows. `scripts/import-saas-plots.js` regenerates `seeds/0002_demo_farms.sql` from it.

Each plot also stores its `saas_plot_id`, and each farm its `saas_farm_id`, so re-syncing a corrected polygon is a lookup rather than a name match — and so the MRV record and the customer-facing record stay joinable if the two databases are ever merged.

## Acceptance test

The plan's criterion was that a point-in-plot spatial query works. Run against the real geometry, every plot's interior point resolves to exactly one plot — its own:

```
ELD-WP-01  hits=1 self=true      NVT-WP-03  hits=1 self=true
ELD-WP-02  hits=1 self=true      NVT-WP-04  hits=1 self=true
NVT-WP-01  hits=1 self=true      NVT-WP-05  hits=1 self=true
NVT-WP-02  hits=1 self=true
```

No overlaps, no gaps in coverage, no SRID confusion. A synthetic version of this test also runs in CI on every push.

## Outstanding

- **PostGIS → Mapbox one-way sync.** Deliberately not built yet. Today the flow runs the other way — Mapbox and the public pages are fed by the SaaS database, and this database imports from it. Building a second writer into the same Mapbox tilesets would create two sources of truth for the same polygons. The right sequence is to decide first whether the MRV database or the SaaS database owns plot geometry; see open decision 4 in [ROADMAP.md](ROADMAP.md).
- **Real farms.** Nothing here is a client yet. When the first real farm is onboarded it gets `is_demo = false` and a real grouped project with its Verra registry id.
- **Strata and baseline control sites.** Tables exist and are empty. Both are per-farm and arrive with the first sampling campaign (stage 3).

## Notes worth carrying forward

Nitzan-Veg-Tech is in **Israel** while its grouped project is named "E.Africa". Fine for demo data, but a real grouped project cannot span those geographies under one Verra registration — the demo is not a template for that.

`quantification_approach` is set to `QA2` on all seven plots as a working default. Real plots set this deliberately per plot, and a farm may be mixed-QA.
