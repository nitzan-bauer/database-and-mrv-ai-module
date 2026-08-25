import "server-only";

/**
 * Per-agent "send as" addresses (Nitzan's own request, live this session:
 * every agent's reports should visibly come from that agent, not all as
 * one undifferentiated "nitzan@carbonature.io").
 *
 * This list only takes effect once Nitzan configures each address as a
 * verified alias of his own Google Workspace account in the Admin Console
 * (Directory → Users → nitzan@carbonature.io → alternate emails) — Gmail's
 * send API silently rewrites the From header back to the primary address
 * for any address that isn't a verified alias on the sending account, so
 * this mapping has to stay in sync with what's actually configured there,
 * not the other way around. Until an alias exists, that agent's mail keeps
 * landing as nitzan@carbonature.io exactly as it does today — nothing
 * breaks, it just doesn't visibly change yet.
 */
export const AGENT_EMAIL_ALIASES: Record<string, string> = {
  john: "john@carbonature.io",
  dave: "dave@carbonature.io",
  rebeka: "rebeka@carbonature.io",
  ron: "ron@carbonature.io",
  jennifer: "jennifer@carbonature.io",
};

/** Falls back to Nitzan's own address for any actor that isn't a known agent id (a human acting directly, or an unmapped agent). */
export function agentSenderEmail(agentId: string | undefined | null): string {
  return (agentId && AGENT_EMAIL_ALIASES[agentId]) || "nitzan@carbonature.io";
}
