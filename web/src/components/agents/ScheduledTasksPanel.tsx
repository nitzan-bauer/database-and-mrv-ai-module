"use client";

import { useState } from "react";
import type { ScheduledTaskCard } from "@/lib/data";
import type { RunScheduledTaskNowResult } from "@/lib/agent/runScheduledTaskNowAction";

export interface FarmPickerProject {
  projectId: string;
  projectName: string;
  farms: Array<{ farmId: string; name: string }>;
}

/**
 * A small "control panel" of scheduled-task status buttons for an agent's
 * dashboard (Nitzan's own spec, approved mockup). Deliberately compact — one
 * card among the others, not a section of its own — and agent-agnostic: it
 * renders for whichever agent has scheduled tasks today, and will start
 * rendering for any agent (Dave included) the moment mrv.scheduled_tasks
 * gets a row for it, with no further code change.
 *
 * `onRunNow` is optional so this stays a pure display component wherever
 * nothing wires it up (e.g. a read-only context) — where it is wired, every
 * task gets a "Run Now" button, not just 'manual'-frequency ones: a manual
 * re-run of a recurring task is just as legitimate a thing to ask for.
 *
 * `farmPickerOptions`, when given, turns dave_email_activity_ingestion's
 * "Run Now" into a 2-step picker (farm, grouped by project → the exact
 * sender address the data came from) instead of running immediately —
 * Nitzan's own request (2026-09-12), after the first live test showed the
 * model has no way to know a real farm's actual area on its own. Every
 * other task keeps the plain one-click Run Now.
 */
export function ScheduledTasksPanel({
  tasks,
  onRunNow,
  farmPickerOptions,
}: {
  tasks: ScheduledTaskCard[];
  onRunNow?: (taskKey: string, taskParams?: Record<string, string>) => Promise<RunScheduledTaskNowResult>;
  farmPickerOptions?: FarmPickerProject[];
}) {
  const [open, setOpen] = useState<ScheduledTaskCard | null>(null);

  if (!tasks.length) return null;

  return (
    <div className="w-full max-w-[280px] rounded-xl border border-line bg-white p-4">
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

      {open && (
        <TaskPopup
          task={open}
          onClose={() => setOpen(null)}
          onRunNow={onRunNow}
          farmPickerOptions={task_needsFarmPicker(open) ? farmPickerOptions : undefined}
        />
      )}
    </div>
  );
}

/** Only dave_email_activity_ingestion needs the picker today — a plain task_key check, not a config flag, since it's the one real case. */
function task_needsFarmPicker(task: ScheduledTaskCard): boolean {
  return task.taskKey === "dave_email_activity_ingestion";
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

type WizardStep = "closed" | "pickFarm" | "pickEmail";

function TaskPopup({
  task,
  onClose,
  onRunNow,
  farmPickerOptions,
}: {
  task: ScheduledTaskCard;
  onClose: () => void;
  onRunNow?: (taskKey: string, taskParams?: Record<string, string>) => Promise<RunScheduledTaskNowResult>;
  farmPickerOptions?: FarmPickerProject[];
}) {
  const isBug = task.status === "error" || task.status === "no_handler";
  const isPending = task.status === "pending";
  const isManual = task.frequency === "manual";
  const [running, setRunning] = useState(false);
  const [ranResult, setRanResult] = useState<RunScheduledTaskNowResult | null>(null);

  const needsPicker = Boolean(farmPickerOptions?.length);
  const [wizardStep, setWizardStep] = useState<WizardStep>("closed");
  const [pickedFarm, setPickedFarm] = useState<{ farmId: string; name: string; projectName: string } | null>(null);
  const [senderEmail, setSenderEmail] = useState("");

  async function runWith(taskParams?: Record<string, string>) {
    if (!onRunNow || running) return;
    setRunning(true);
    setRanResult(null);
    try {
      const result = await onRunNow(task.taskKey, taskParams);
      setRanResult(result);
      setWizardStep("closed");
    } finally {
      setRunning(false);
    }
  }

  function startRunNow() {
    if (needsPicker) {
      setPickedFarm(null);
      setSenderEmail("");
      setWizardStep("pickFarm");
    } else {
      void runWith();
    }
  }

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

        {wizardStep === "pickFarm" && farmPickerOptions ? (
          <FarmPickerStep
            options={farmPickerOptions}
            onCancel={() => setWizardStep("closed")}
            onPick={(farm) => {
              setPickedFarm(farm);
              setWizardStep("pickEmail");
            }}
          />
        ) : wizardStep === "pickEmail" && pickedFarm ? (
          <SenderEmailStep
            farmName={pickedFarm.name}
            senderEmail={senderEmail}
            onSenderEmailChange={setSenderEmail}
            onBack={() => setWizardStep("pickFarm")}
            onCancel={() => setWizardStep("closed")}
            running={running}
            onConfirm={() => void runWith({ farmId: pickedFarm.farmId, senderEmail: senderEmail.trim() })}
          />
        ) : (
          <>
            <div className="flex items-center justify-between bg-pine-50 px-4 py-2.5 text-[12.5px]">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Last run</span>
              <span className="font-mono font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {task.lastRunAt ? formatDateTime(task.lastRunAt) : "Not yet run"}
              </span>
            </div>
            <div className="flex items-center justify-between bg-gold-200 px-4 py-2.5 text-[12.5px]">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                {isManual ? "Schedule" : "Next run"}
              </span>
              <span className="font-mono font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {isManual ? "Manual — run on demand" : formatDateTime(task.nextRunAt)}
              </span>
            </div>

            <div
              className={
                "m-3 rounded-lg p-3 text-[12.5px] leading-relaxed " +
                (isPending ? "bg-cream text-muted" : isBug ? "bg-danger/10 text-[#7a1810]" : "bg-ok/10 text-[#1d5b40]")
              }
            >
              {isPending ? (
                <p>This task hasn&apos;t run yet{isManual ? " — click Run Now below when you have something for it." : " — its first run is scheduled above."}</p>
              ) : (
                <>
                  <p className="font-semibold">{task.lastRunDetail ?? (isBug ? "The last run failed." : "The last run completed.")}</p>
                  {isBug && <p className="mt-1.5">Share this with the chat to get a plan for resolving it.</p>}
                </>
              )}
            </div>

            {onRunNow && (
              <div className="mx-3 mb-3">
                <button
                  type="button"
                  onClick={startRunNow}
                  disabled={running}
                  className="w-full rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {running ? "Running…" : "Run Now"}
                </button>
                {ranResult && (
                  <p
                    className={
                      "mt-2 rounded-lg p-2.5 text-[12px] leading-relaxed " +
                      (ranResult.ok ? "bg-ok/10 text-[#1d5b40]" : "bg-danger/10 text-[#7a1810]")
                    }
                  >
                    {ranResult.detail}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Step 1 of the manual-trigger wizard: pick which real farm this submission is about, grouped by project. */
function FarmPickerStep({
  options,
  onPick,
  onCancel,
}: {
  options: FarmPickerProject[];
  onPick: (farm: { farmId: string; name: string; projectName: string }) => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-4">
      <p className="mb-3 text-[12.5px] text-muted">Which farm is this submission for?</p>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {options.map((proj) => (
          <div key={proj.projectId}>
            <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-faint">
              {proj.projectName}
            </p>
            {proj.farms.length === 0 ? (
              <p className="rounded-lg bg-cream px-3 py-2 text-[11.5px] text-faint">No farms yet</p>
            ) : (
              <div className="space-y-1">
                {proj.farms.map((farm) => (
                  <button
                    key={farm.farmId}
                    type="button"
                    onClick={() => onPick({ farmId: farm.farmId, name: farm.name, projectName: proj.projectName })}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-left text-[12.5px] font-medium text-ink transition-colors hover:border-pine-300 hover:bg-pine-50"
                  >
                    {farm.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:bg-cream"
      >
        Cancel
      </button>
    </div>
  );
}

/** Step 2 of the manual-trigger wizard: the exact sender address the data came from, so the search narrows to that one thread instead of scanning the whole inbox. */
function SenderEmailStep({
  farmName,
  senderEmail,
  onSenderEmailChange,
  onBack,
  onCancel,
  onConfirm,
  running,
}: {
  farmName: string;
  senderEmail: string;
  onSenderEmailChange: (v: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  running: boolean;
}) {
  const valid = /\S+@\S+\.\S+/.test(senderEmail.trim());
  return (
    <div className="p-4">
      <p className="mb-1 text-[12.5px] text-muted">
        Farm: <span className="font-semibold text-pine-700">{farmName}</span>
      </p>
      <p className="mb-2 text-[12.5px] text-muted">Paste the email address the data came from:</p>
      <input
        type="email"
        value={senderEmail}
        onChange={(e) => onSenderEmailChange(e.target.value)}
        placeholder="farmer@example.com"
        autoFocus
        className="w-full rounded-lg border border-line px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:bg-cream"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:bg-cream"
        >
          Cancel
        </button>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!valid || running}
        className="mt-2 w-full rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Running…" : "Run Now"}
      </button>
    </div>
  );
}
