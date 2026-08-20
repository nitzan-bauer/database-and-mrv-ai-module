import Link from "next/link";
import type { Project } from "@/lib/data/types";

/**
 * Which project this page is showing, and a way to pick a different one.
 * Exists because resolveActiveProject's default (the demo project) is a
 * silent choice — without this, a real project sitting alongside the demo
 * one would be invisible on pages that only ever showed "the" project.
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  basePath,
}: {
  projects: Project[];
  activeProjectId: string;
  basePath: string;
}) {
  if (projects.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-cream/60 px-3 py-2 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-wide text-faint">Project</span>
      {projects.map((p) => {
        const active = p.projectId === activeProjectId;
        return (
          <Link
            key={p.projectId}
            href={`${basePath}?project=${encodeURIComponent(p.projectId)}`}
            className={
              "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
              (active ? "bg-pine-600 text-white" : "bg-white text-muted hover:text-pine-700")
            }
          >
            {p.name}
            {p.isDemo && <span className="ml-1 opacity-70">(Demo)</span>}
          </Link>
        );
      })}
    </div>
  );
}
