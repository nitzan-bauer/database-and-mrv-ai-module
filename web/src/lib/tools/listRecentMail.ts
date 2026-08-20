import "server-only";
import { checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import { listRecentInboxMessages, type GmailMessageSummary } from "../google/gmailClient";

/**
 * Read-only view of the signed-in person's own recent inbox — Jennifer's
 * correspondence visibility. Never sends, drafts, or modifies anything;
 * gmail.readonly is the only Gmail scope this app ever requests.
 */
export async function listRecentMail(
  ctx: ToolContext,
  input: { maxResults?: number },
): Promise<ToolResult<GmailMessageSummary[]>> {
  const policy = await checkPolicy("list_recent_mail", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("listRecentMail: no Gmail access token for this session — sign out and back in to grant it.");
  }

  const maxResults = input.maxResults ?? 15;
  if (!(maxResults > 0)) return fail("listRecentMail: maxResults must be positive.");

  let messages: GmailMessageSummary[];
  try {
    messages = await listRecentInboxMessages(ctx.googleAccessToken, maxResults);
  } catch (e) {
    return fail(`listRecentMail: ${e instanceof Error ? e.message : String(e)}`);
  }

  return ok(messages);
}
