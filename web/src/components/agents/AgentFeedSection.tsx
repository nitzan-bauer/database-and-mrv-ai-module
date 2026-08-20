import type { AgentFeedItem } from "@/lib/agent/agentFeed";

/**
 * Section 2 — "מתחת לדשבורד יהיה כמו PEED" (Nitzan's own spec): a feed of
 * cards for whatever this agent has actually produced, newest first.
 */
export function AgentFeedSection({ agentName, items }: { agentName: string; items: AgentFeedItem[] }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-bold text-pine-700">{agentName}&apos;s activity feed</h2>
      <p className="mb-3 max-w-3xl text-[13px] text-muted">
        Every report {agentName} has emailed, and every lesson the learning system has distilled for
        it — real rows it has actually written, newest first.
      </p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-[13px] font-semibold text-pine-700">Nothing in the feed yet.</p>
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted">
            This fills in once {agentName}&apos;s scheduled tasks run and produce reports, or the
            learning system records a lesson from one of its actions.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item, i) => (
            <FeedCard key={`${item.createdAt}-${i}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedCard({ item }: { item: AgentFeedItem }) {
  const isLesson = item.kind === "lesson";
  return (
    <details className="group overflow-hidden rounded-xl border border-line bg-white open:shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={
              "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide " +
              (isLesson ? "bg-gold-200 text-earth-600" : "bg-verify-100 text-verify-700")
            }
          >
            {isLesson ? "lesson" : "report"}
          </span>
          <span className="truncate text-[13px] font-semibold text-pine-700">{item.title}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-faint">
          {item.kind === "report" && !item.emailed && <span className="text-earth-600">not emailed</span>}
          {new Date(item.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{item.body}</p>
      </div>
    </details>
  );
}
