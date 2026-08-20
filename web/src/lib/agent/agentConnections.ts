import "server-only";
import type { AgentRecord } from "@/lib/data";

export interface AgentConnection {
  name: string;
  status: "connected" | "not configured";
  detail: string;
}

/**
 * External systems each agent is defined to reach, and whether it is wired
 * — per agent, not one uniform list. A tool existing in the registry is not
 * the same as an agent holding it, so "connected" here always means this
 * specific agent's own tools array includes something that reaches that
 * system. Shared by the main /agents roster and each agent's own page so
 * the two never drift from each other.
 */
export function buildAgentConnections(agents: AgentRecord[]): Record<string, AgentConnection[]> {
  const hasModelKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const dbConn: AgentConnection = {
    name: "Project database (mrv on RDS)",
    status: "connected",
    detail: "read and write",
  };
  const DRIVE_TOOLS = ["link_farm_drive_folder", "list_farm_drive_documents", "centralize_farm_document", "unlink_farm_drive_folder"];
  const CALENDAR_TOOLS = ["check_calendar_availability", "schedule_calendar_event"];
  const CRM_TOOLS = [
    "record_lead", "update_lead_stage", "add_follow_up", "draft_outreach_message",
    "crm_hygiene", "farmer_funnel", "buyer_funnel",
  ];
  const modelConn: AgentConnection = hasModelKey
    ? { name: "Model runtime", status: "connected", detail: process.env.AGENT_MODEL_ID?.trim() || "claude-sonnet-5" }
    : { name: "Model runtime", status: "not configured", detail: "no ANTHROPIC_API_KEY" };

  return Object.fromEntries(
    agents.map((a) => {
      const holds = (names: string[]) => names.some((n) => a.tools.includes(n));
      const rows: AgentConnection[] = [
        a.tools.length ? dbConn : { ...dbConn, detail: "read only — no tools held" },
      ];

      if (holds(CRM_TOOLS)) {
        rows.push({ name: "CRM database (crm schema, shared RDS)", status: "connected", detail: "read and write" });
      }
      if (holds(DRIVE_TOOLS)) {
        rows.push({ name: "Google Drive", status: "connected", detail: "as the signed-in person, via their own OAuth session" });
      }
      if (holds(CALENDAR_TOOLS)) {
        rows.push({ name: "Google Calendar", status: "connected", detail: "as the signed-in person, via their own OAuth session" });
      }
      if (a.tools.includes("list_recent_mail")) {
        rows.push({ name: "Gmail", status: "connected", detail: "read-only, as the signed-in person" });
      }
      if (a.tools.includes("fetch_public_url")) {
        rows.push({ name: "Verra registry", status: "connected", detail: "public — no credentials needed" });
      }
      rows.push(modelConn);
      return [a.agentId, rows];
    }),
  );
}
