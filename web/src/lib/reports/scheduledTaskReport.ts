import "server-only";
import type { ToolContext } from "../tools/context";
import type { ScheduledTaskOutcome } from "../agent/scheduledTaskRegistry";

/**
 * The one closing step every one of Rebeka's 5 scheduled tasks shares
 * (Nitzan's own spec, verbatim, live this session): "מוציאה דוח עדכונים
 * שומרת בזיכרון שלה, במסד הנתונים ושולחת לי למייל את הדוח על נייר
 * LETTERHEAD" — produce an update report, save it to her memory, to the
 * database, and email it to me on company letterhead. Built once here so
 * each of the 5 handlers is just its own research/update logic plus one
 * call to this.
 */
export async function finishScheduledTask(
  ctx: ToolContext,
  input: {
    taskKey: string;
    projectId: string;
    subject: string;
    bodyParagraphs: string[];
    memoryKind: string;
    /** Task 5 only sends an email when it actually found something new — everything else always emails. */
    sendEmail?: boolean;
  },
): Promise<ScheduledTaskOutcome> {
  const sendEmail = input.sendEmail ?? true;
  const bodyText = input.bodyParagraphs.join("\n\n");

  const { query } = await import("../db");
  const { recordAgentMemory } = await import("../tools/recordAgentMemory");

  // 1. Memory — "שומרת בזיכרון שלה".
  const memoryResult = await recordAgentMemory(ctx, {
    projectId: input.projectId,
    kind: input.memoryKind,
    content: `${input.subject}\n\n${bodyText}`,
  });
  if (!memoryResult.ok) {
    // A memory-write failure is worth surfacing, but not worth losing the
    // rest of the report over — the DB row and email below still carry it.
    console.warn(`[${input.taskKey}] recordAgentMemory failed: ${memoryResult.error}`);
  }

  // 2. Database — "שומרת במסד הנתונים", the literal queryable log.
  await query(
    `INSERT INTO mrv.scheduled_task_reports (task_key, project_id, subject, body_text, emailed)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.taskKey, input.projectId, input.subject, bodyText, sendEmail],
  );

  if (!sendEmail) {
    return { ok: true, detail: `${input.subject} — recorded, no email (nothing new to report).` };
  }

  // 3. Email on letterhead — "שולחת לי למייל... על נייר LETTERHEAD".
  if (!ctx.googleAccessToken) {
    return { ok: false, detail: `${input.subject} — recorded, but no Google access token to send the email.` };
  }

  const orgProfiles = await query<{
    legal_name: string;
    address: string;
    contact_name: string;
    contact_title: string;
    contact_email: string;
    contact_phone: string;
  }>(`SELECT legal_name, address, contact_name, contact_title, contact_email, contact_phone FROM mrv.org_profile LIMIT 1`);
  if (!orgProfiles.length) {
    return { ok: false, detail: `${input.subject} — recorded, but mrv.org_profile has no row to letterhead the PDF from.` };
  }
  const org = orgProfiles[0];

  try {
    const { buildLetterheadPdf } = await import("./letterheadPdf");
    const pdfBuffer = await buildLetterheadPdf({
      title: input.subject,
      bodyParagraphs: input.bodyParagraphs,
      generatedAt: new Date(),
      org: {
        legalName: org.legal_name,
        address: org.address,
        contactName: org.contact_name,
        contactTitle: org.contact_title,
        contactEmail: org.contact_email,
        contactPhone: org.contact_phone,
      },
    });

    const { sendGmailMessage } = await import("../google/gmailClient");
    await sendGmailMessage(ctx.googleAccessToken, {
      to: "nitzan@carbonature.io",
      subject: input.subject,
      bodyText,
      attachment: {
        fileName: `${input.taskKey}-${new Date().toISOString().slice(0, 10)}.pdf`,
        mimeType: "application/pdf",
        content: pdfBuffer,
      },
    });
  } catch (e) {
    return { ok: false, detail: `${input.subject} — recorded, but the email failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, detail: `${input.subject} — recorded and emailed to nitzan@carbonature.io.` };
}
