/**
 * Tab definitions for Plot Details. Kept out of the "use client" component so
 * the server page can resolve ?tab= without calling into client code.
 */
export const TABS = ["Overview", "Sampling", "Lab", "Photos", "Model runs"] as const;
export type Tab = (typeof TABS)[number];

const slugOf = (t: string) => t.toLowerCase().replace(/\s+/g, "-");

/** Resolve a ?tab= query value (e.g. "lab", "model-runs") to a tab name. */
export function parseTab(v: string | undefined): Tab | undefined {
  if (!v) return undefined;
  const slug = v.toLowerCase().replace(/[\s_]+/g, "-");
  return TABS.find((t) => slugOf(t) === slug);
}

/** The ?tab= value for a tab. */
export function tabSlug(t: Tab): string {
  return slugOf(t);
}
