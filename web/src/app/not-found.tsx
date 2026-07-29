import Link from "next/link";
import { IconMark } from "@/components/brand/Logo";

/**
 * The 404. Without this, a mistyped plot or work-order id lands on Next's
 * unbranded fallback with no way back into the module — which for a link
 * pasted into an email is where the reader gives up.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-5">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-[var(--shadow-card)]">
        <IconMark size={46} className="mx-auto" />
        <p className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
          404
        </p>
        <h1 className="mt-1 text-lg font-bold text-pine-700">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          That plot, work order or page does not exist — check the identifier in the link.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/projects"
            className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
          >
            Projects
          </Link>
          <Link
            href="/map"
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-pine-700 transition-colors hover:bg-pine-50"
          >
            Map
          </Link>
        </div>
        <p className="mt-6 font-mono text-[10.5px] text-faint">
          CarboNature · AI Soil MRV Module
        </p>
      </div>
    </div>
  );
}
