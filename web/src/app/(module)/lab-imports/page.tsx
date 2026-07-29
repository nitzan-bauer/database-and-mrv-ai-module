import { LabImport } from "@/components/lab/LabImport";

export const dynamic = "force-dynamic";

/**
 * Lab ingestion (spec §8). The laboratory returns
 * CarboNature_SOC_Datasheet_v2.0; this screen parses it, shows exactly what
 * would be written, and quarantines anything that fails validation.
 */
export default function LabImportsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Lab ingestion</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Drop the <b>CarboNature_SOC_Datasheet_v2.0</b> workbook the laboratory returns. Rows are
          validated against VM0042 v2.2, and TOC and SOC are <b>recomputed</b> rather than taken
          from the sheet — the workbook&apos;s own figures are shown alongside so any disagreement
          is visible before anything is written.
        </p>
      </div>
      <LabImport />
    </div>
  );
}
