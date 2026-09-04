import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";

const RECIPIENT = "nitzan@carbonature.io";

export interface SentEmail {
  to: string;
  subject: string;
}

/**
 * A real, general-purpose "send an email" tool. Every email path that
 * already exists in this codebase — runPddGeneratorPipeline's project PDF,
 * finishScheduledTask's report emails, Jennifer's meeting-cycle mail — is
 * hardcoded to one specific pipeline and calls sendGmailMessage directly;
 * nothing lets an agent decide, mid-turn, to just send a message. This
 * reuses sendGmailMessage exactly as those callers do, including the same
 * per-agent "send as" alias (agentSenderEmail) so the mail visibly comes
 * from whichever agent sent it, with that agent's own real signature.
 *
 * The recipient is deliberately not an input — every existing caller in
 * this codebase sends to Nitzan's own address, and this tool keeps that
 * same narrow scope rather than opening up arbitrary outbound mail.
 */
export async function sendEmail(
  ctx: ToolContext,
  input: { subject: string; body: string },
): Promise<ToolResult<SentEmail>> {
  const policy = await checkPolicy("send_email", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) {
    return fail("sendEmail: both subject and body are required.");
  }
  if (!ctx.googleAccessToken) {
    return fail("sendEmail: no Google access token is available for this actor.");
  }

  try {
    const { sendGmailMessage } = await import("../google/gmailClient");
    const { agentSenderEmail } = await import("../agent/agentEmailAliases");
    await sendGmailMessage(ctx.googleAccessToken, {
      to: RECIPIENT,
      from: agentSenderEmail(ctx.actorKind === "agent" ? ctx.actor : undefined),
      subject,
      bodyText: body,
    });
  } catch (e) {
    return fail(`sendEmail: could not send — ${e instanceof Error ? e.message : String(e)}`);
  }

  await audit(ctx, "send_email", null, { to: RECIPIENT, subject });

  return ok({ to: RECIPIENT, subject });
}
