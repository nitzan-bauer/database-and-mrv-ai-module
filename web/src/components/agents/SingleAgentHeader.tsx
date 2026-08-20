"use client";

import { useState } from "react";
import type { AgentRecord } from "@/lib/data";
import type { AgentTaskResult } from "@/lib/agent/runAgentTask";
import { AgentBlock, AgentModal } from "./AgentOrgChart";

interface Connection {
  name: string;
  status: "connected" | "not configured";
  detail: string;
}

/**
 * The top of an agent's own page (spec's "Section 1", first element): the
 * same block as the department roster, wide. On this page there is nowhere
 * further to navigate to, so clicking it always opens the prompt/skills/
 * tools popup — the same popup the main /agents page opens directly on
 * John's block.
 */
export function SingleAgentHeader({
  agent,
  connections,
  askAgent,
}: {
  agent: AgentRecord;
  connections: Connection[];
  askAgent?: (agentId: string, task: string) => Promise<AgentTaskResult>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AgentBlock agent={agent} wide onOpen={() => setOpen(true)} />
      {open && (
        <AgentModal agent={agent} connections={connections} askAgent={askAgent} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
