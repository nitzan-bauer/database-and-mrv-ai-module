"use client";

import { useState, useTransition } from "react";
import type { PendingAgentAction } from "@/lib/data/types";
import { Card } from "@/components/ui/Card";

interface Props {
  actions: PendingAgentAction[];
  resolve: (pendingId: string, decision: "approve" | "reject") => Promise<{ ok: boolean; detail: string }>;
}

/**
 * The other half of 0113: runAgentTask now persists a 'confirm'-refused
 * call instead of throwing it away, and this is where a human actually
 * sees it and decides. One row per pending action; Approve replays the
 * exact call (see resolvePendingAgentAction.ts) with ctx.confirmed=true,
 * Reject just closes it out with no replay.
 */
export function PendingApprovalsList({ actions, resolve }: Props) {
  const [rows, setRows] = useState(actions);
  const [pendingId, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  function act(pending: PendingAgentAction, decision: "approve" | "reject") {
    setBusyId(pending.pendingId);
    startTransition(async () => {
      const result = await resolve(pending.pendingId, decision);
      setMessages((m) => ({ ...m, [pending.pendingId]: result.detail }));
      if (result.ok || decision === "reject") {
        setRows((r) => r.filter((row) => row.pendingId !== pending.pendingId));
      }
      setBusyId(null);
    });
  }

  if (!rows.length) {
    return <p className="text-sm text-muted">Nothing waiting on your approval right now.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.pendingId} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-pine-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-pine-700">
                  {row.agentDisplayName}
                </span>
                <span className="font-mono text-[11px] text-faint">{row.actionName}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{row.reason}</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-cream px-3 py-2 font-mono text-[11px] text-muted">
                {JSON.stringify(row.input, null, 2)}
              </pre>
              <p className="mt-2 font-mono text-[11px] text-faint">
                Requested by {row.requestedBy} · {new Date(row.createdAt).toLocaleString()}
              </p>
              {messages[row.pendingId] && (
                <p className="mt-2 text-xs font-medium text-pine-700">{messages[row.pendingId]}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={pendingId && busyId === row.pendingId}
                onClick={() => act(row, "approve")}
                className="rounded-lg bg-pine-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pine-600 disabled:opacity-50"
              >
                {busyId === row.pendingId ? "Working…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={pendingId && busyId === row.pendingId}
                onClick={() => act(row, "reject")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-cream disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
