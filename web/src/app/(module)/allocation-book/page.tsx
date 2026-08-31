import { getAllocationBookView } from "@/lib/agent/scheduledTasks/allocationBook/liveView";
import { AllocationBookView } from "@/components/allocationBook/AllocationBookView";
import { DATA_MODE } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The live Book page (Option B's other half — the weekly PDF Snapshot is
 * the archival record, this is the always-current source of truth). In
 * fixtures mode there's no mrv.* database to read, so this page is
 * explicitly unavailable rather than silently rendering an empty book.
 */
export default async function AllocationBookPage() {
  if (DATA_MODE === "fixtures") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[14px] text-muted">
        The Allocation Book reads live from the MRV database and isn't available in fixtures mode.
      </div>
    );
  }
  const view = await getAllocationBookView();
  return <AllocationBookView view={view} />;
}
