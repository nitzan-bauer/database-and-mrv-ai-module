import { auth } from "@/auth";
import {
  listAdminUsers,
  listAgentPolicies,
  listAuditLog,
  listFarms,
  listPddDrafts,
  listProjects,
  setFarmContext,
} from "@/lib/data";
import type { ClimateZone, IrrigationMethod } from "@/lib/data/types";
import { DATA_MODE } from "@/lib/env";
import { AdminView } from "@/components/admin/AdminView";
import { FarmContextForm } from "@/components/admin/FarmContextForm";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import type { DriveFile } from "@/lib/google/driveClient";
import type { LinkedDriveFolder } from "@/lib/tools/linkFarmDriveFolder";
import type { CentralizedDocument, CentralizeSource } from "@/lib/tools/centralizeFarmDocument";
import type { ToolResult } from "@/lib/tools/context";

export const dynamic = "force-dynamic";

/** Every Drive tool needs the signed-in person's own Google access token — never a service identity. */
async function driveCtx() {
  const session = await auth().catch(() => null);
  return {
    actor: session?.user?.email ?? "unknown",
    actorKind: "human" as const,
    googleAccessToken: session?.googleAccessToken,
  };
}

async function linkFarmDriveFolderAction(input: {
  farmId: string;
  driveFolderId: string;
}): Promise<ToolResult<LinkedDriveFolder>> {
  "use server";
  const { linkFarmDriveFolder } = await import("@/lib/tools/linkFarmDriveFolder");
  return linkFarmDriveFolder(await driveCtx(), input);
}

async function listFarmDriveDocumentsAction(input: { farmId: string }): Promise<ToolResult<DriveFile[]>> {
  "use server";
  const { listFarmDriveDocuments } = await import("@/lib/tools/listFarmDriveDocuments");
  return listFarmDriveDocuments(await driveCtx(), input);
}

async function centralizeFarmDocumentAction(input: {
  farmId: string;
  source: CentralizeSource;
}): Promise<ToolResult<CentralizedDocument>> {
  "use server";
  const { centralizeFarmDocument } = await import("@/lib/tools/centralizeFarmDocument");
  return centralizeFarmDocument(await driveCtx(), input);
}

const ZONES = ["wet", "dry"] as const;
const METHODS = ["flood", "furrow", "sprinkler", "drip", "rainfed"] as const;

/**
 * Screen 8 — Unified Admin (spec §6.8). Not a module-only admin: it is the
 * authoritative permissions system for the MRV module, the CarboNature SaaS,
 * and the in-house CRM when it arrives. A user, role or permission is defined
 * once and applies everywhere, which is the whole point of unifying it.
 */
export default async function AdminPage() {
  const [project] = await listProjects();
  // In db mode these are the real rows — the same users the sign-in upserts,
  // the same policies checkPolicy() enforces, the same audit trail the tools
  // write. In fixtures mode the reads fall back to the demo set themselves.
  const [farms, users, policies, audit, pddDrafts] = await Promise.all([
    listFarms(project.projectId),
    listAdminUsers(),
    listAgentPolicies(),
    listAuditLog(40),
    listPddDrafts(project.projectId),
  ]);
  const pddDraftOptions = pddDrafts.map((d) => ({
    draftId: d.draftId,
    label: `${d.templateName} ${d.templateVersion} · ${new Date(d.generatedAt).toLocaleDateString("en-GB")}`,
  }));

  /**
   * Record one farm's climate zone and irrigation method.
   *
   * Form values are validated against the enums here rather than trusted: an
   * unexpected string would otherwise reach the database cast and surface as
   * a 500 instead of a message. mrv.farms carries an audit trigger, so the
   * before/after is captured without anything extra.
   */
  async function save(farmId: string, zone: string, method: string) {
    "use server";

    const session = await auth().catch(() => null);
    const actor = session?.user?.email ?? "unknown";

    if (!farms.some((f) => f.farmId === farmId)) {
      return { ok: false, error: "That farm is not in this project." };
    }
    if (zone !== "" && !ZONES.includes(zone as (typeof ZONES)[number])) {
      return { ok: false, error: `Unknown climate zone "${zone}".` };
    }
    if (method !== "" && !METHODS.includes(method as (typeof METHODS)[number])) {
      return { ok: false, error: `Unknown irrigation method "${method}".` };
    }
    if (zone === "dry" && method === "") {
      return {
        ok: false,
        error: "A dry-zone farm needs an irrigation method — Frac_LEACH cannot be assumed.",
      };
    }

    try {
      await setFarmContext(
        farmId,
        (zone || null) as ClimateZone | null,
        (method || null) as IrrigationMethod | null,
        actor,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Admin</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          One permissions-and-admin system governing the MRV module, the CarboNature SaaS, and the
          in-house CRM to come. Defined once, applied everywhere — and every action here lands in
          the append-only audit log.
        </p>
      </div>

      <section id="farm-context" className="scroll-mt-6">
        <h2 className="text-base font-bold text-pine-700">Farm quantification context</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">
          Each farm&apos;s climate zone and irrigation method, which between them select
          EF_N_direct and Frac_LEACH and so move the claimed reduction by more than a factor of
          two. Both are recorded per farm and neither is defaulted — irrigation in particular
          varies farm by farm, with drip running at scale across East Africa as much as anywhere,
          so nothing here is inferred from the country or from a neighbouring farm.
        </p>

        {DATA_MODE === "fixtures" ? (
          <p className="mt-3 rounded-xl border border-line bg-cream px-4 py-3 text-[13px] text-muted">
            Read-only in fixtures mode — fixtures are a fixed demo set. Connect the module to the
            database to record these.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {farms.map((f) => (
              <FarmContextForm key={f.farmId} farm={f} save={save} />
            ))}
          </div>
        )}
      </section>

      {DATA_MODE === "db" && (
        <section id="documents" className="scroll-mt-6">
          <h2 className="text-base font-bold text-pine-700">Documents — Jennifer</h2>
          <p className="mt-1 max-w-3xl text-[13px] text-muted">
            Each farm&apos;s existing Drive folder, linked once by hand — never searched for or
            created by guessing at folder structure. Once linked, this farm&apos;s own KMZ export or
            a generated PDD draft can be pushed straight in.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {farms.map((f) => (
              <DocumentsPanel
                key={f.farmId}
                farmId={f.farmId}
                farmName={f.name}
                driveFolderId={f.driveFolderId}
                pddDraftOptions={pddDraftOptions}
                linkAction={linkFarmDriveFolderAction}
                listAction={listFarmDriveDocumentsAction}
                centralizeAction={centralizeFarmDocumentAction}
              />
            ))}
          </div>
        </section>
      )}

      <AdminView users={users} policies={policies} audit={audit} />
    </div>
  );
}
