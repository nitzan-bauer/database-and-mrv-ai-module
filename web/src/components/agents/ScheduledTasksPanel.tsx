"use client";

import { useState } from "react";
import type { ScheduledTaskCard } from "@/lib/data";

/**
 * A small "control panel" of scheduled-task status buttons for an agent's
 * dashboard (Nitzan's own spec, approved mockup). Deliberately compact — one
 * card among the others, not a section of its own — and agent-agnostic: it
 * renders for whichever agent has scheduled tasks today, and will start
 * rendering for any agent (Dave included) the moment mrv.scheduled_tasks
 * gets a row for it, with no further code change.
 */
export function ScheduledTasksPanel({ tasks }: { tasks: ScheduledTaskCard[] }) {
  const [open, setOpen] = useState<ScheduledTaskCard | null>(null);

  if (!tasks.length) return null;

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-[12.5px] font-bold text-pine-700">Scheduled Tasks</h3>
        <span className="font-mono text-[10px] text-faint">
          {tasks.length} active
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line-2 bg-[#fafcfb]">
        {tasks.map((task) => (
          <TaskRow key={task.taskKey} task={task} onOpen={() => setOpen(task)} />
        ))}
      </div>

      {open && <TaskPopup task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: ScheduledTaskCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-t border-line bg-gradient-to-b from-white to-[#f8fbfa] px-3 py-2.5 text-left text-[12.5px] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.9),inset_0_-1px_0_rgba(27,54,54,.05)] transition-[background,box-shadow,transform] first:border-t-0 hover:from-white hover:to-pine-50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(27,54,54,.07),0_2px_5px_rgba(27,54,54,.06)] active:translate-y-px active:from-pine-100 active:to-pine-100 active:shadow-[inset_0_2px_4px_rgba(27,54,54,.12)]"
    >
      <StatusDot status={task.status} />
      <span className="flex-1 truncate">{task.shortTitle}</span>
      <span className="flex-shrink-0 text-[13px] text-faint">›</span>
    </button>
  );
}

function StatusDot({ status }: { status: ScheduledTaskCard["status"] }) {
  if (status === "ok") {
    return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_rgba(43,138,94,.14),0_0_5px_rgba(43,138,94,.55)]" />;
  }
  if (status === "error" || status === "no_handler") {
    return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-danger shadow-[0_0_0_3px_rgba(180,35,24,.14),0_0_5px_rgba(180,35,24,.55)]" />;
  }
  return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-line" />;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function TaskPopup({ task, onClose }: { task: ScheduledTaskCard; onClose: () => void }) {
  const isBug = task.status === "error" || task.status === "no_handler";
  const isPending = task.status === "pending";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-pine-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2.5 border-b border-line p-4">
          <div className="mt-1.5">
            <StatusDot status={task.status} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold text-pine-700">{task.shortTitle}</h2>
            <p className="mt-0.5 text-[11px] text-faint">{task.fullTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-cream"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center justify-between bg-pine-50 px-4 py-2.5 text-[12.5px]">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Last run</span>
          <span className="font-mono font-semibold text-ink [font-variant-numeric:tabular-nums]">
            {task.lastRunAt ? formatDateTime(task.lastRunAt) : "Not yet run"}
          </span>
        </div>
        <div className="flex items-center justify-between bg-gold-200 px-4 py-2.5 text-[12.5px]">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Next run</span>
          <span className="font-mono font-semibold text-ink [font-variant-numeric:tabular-nums]">
            {formatDateTime(task.nextRunAt)}
          </span>
        </div>

        <div
          className={
            "m-3 rounded-lg p-3 text-[12.5px] leading-relaxed " +
            (isPending ? "bg-cream text-muted" : isBug ? "bg-danger/10 text-[#7a1810]" : "bg-ok/10 text-[#1d5b40]")
          }
        >
          {isPending ? (
            <p>This task hasn&apos;t run yet — its first run is scheduled above.</p>
          ) : (
            <>
              <p className="font-semibold">{task.lastRunDetail ?? (isBug ? "The last run failed." : "The last run completed.")}</p>
              {isBug && <p className="mt-1.5">Share this with the chat to get a plan for resolving it.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
