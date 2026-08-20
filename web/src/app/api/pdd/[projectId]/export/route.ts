import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildProjectDraftDocx } from "@/lib/pdd/exportProjectDocx";

export const runtime = "nodejs";

/**
 * "Download Drafted PDD" — a real file in the user's own Downloads
 * folder, not another Drive link to click through. Same build steps as
 * the live Google Doc sync (src/lib/pdd/exportProjectDocx.ts), just
 * returned as bytes instead of uploaded.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const session = await auth().catch(() => null);

    const result = await buildProjectDraftDocx(
      { actor: session?.user?.email ?? "unknown", actorKind: "human" },
      decodeURIComponent(projectId),
    );

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${result.fileName.replace(/"/g, "'")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    return new NextResponse(message, { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}
