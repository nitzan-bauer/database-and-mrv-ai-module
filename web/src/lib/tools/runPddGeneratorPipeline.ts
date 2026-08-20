import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface PddGeneratorStepResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface PddGeneratorPipelineResult {
  projectId: string;
  steps: PddGeneratorStepResult[];
  pddDocUrl: string | null;
  emailedTo: string | null;
  lockedAt: string;
}

/** Everyone who should hear about a PDD Generator run, unless a specific run overrides it. */
const DEFAULT_NOTIFY_EMAIL = "nitzan@carbonature.io";

/**
 * "PDD GENERATOR FOR A NEW PROJECT" — Nitzan's own development plan,
 * run as one deterministic pipeline rather than an autonomous agent
 * loop deciding what to do next. Every step below is a call to a tool
 * that already exists and is independently audited and policy-checked;
 * this function's only job is running them in the right order and
 * surviving one step failing without losing the rest.
 *
 * Each step is wrapped so a failure doesn't abort the pipeline: a
 * transient Verra API hiccup should not also cost the person their
 * Google Doc sync and PDF email. The returned `steps` array is the
 * honest record of what actually happened — never claim success as a
 * whole when part of it silently didn't run.
 *
 * Gate + lock (Nitzan's own spec, live this session): this only runs
 * once every SEED-questionnaire section has moved off 'pending' — the
 * button that calls this is meant to be inactive until then, and this
 * hard guard is the real enforcement, not just the UI disabling a
 * button. On success it stamps mrv.projects.pdd_generator_locked_at,
 * which is what makes the questionnaire page render read-only from
 * here on — a person can still open and read it, never edit it again.
 */
export async function runPddGeneratorPipeline(
  ctx: ToolContext,
  input: { projectId: string; notifyEmail?: string },
): Promise<ToolResult<PddGeneratorPipelineResult>> {
  const guard = requireDbMode("runPddGeneratorPipeline");
  if (guard) return guard;

  const policy = await checkPolicy("run_pdd_generator_pipeline", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("runPddGeneratorPipeline: no Google Drive access token for this session — sign in with Drive access.");
  }

  const { query: gateQuery } = await import("../db");
  const { listSeedAnswers } = await import("../pdd/seedAnswers");
  const seedState = await listSeedAnswers(gateQuery, input.projectId);
  if (seedState.pendingCount > 0) {
    return fail(
      `runPddGeneratorPipeline: ${seedState.pendingCount} SEED question${seedState.pendingCount === 1 ? "" : "s"} ` +
        `${seedState.pendingCount === 1 ? "is" : "are"} still pending — every question must be answered before the PDD Generator can run.`,
    );
  }

  const steps: PddGeneratorStepResult[] = [];
  let pddDocUrl: string | null = null;

  // 0. Rebeka fills in the constants — Project Proponent, Prepared-by,
  // participating farms, methodology, geographic area — real facts
  // already on file (org profile, mrv.farms, the project row itself),
  // never asked as open questions. This step confirms they're actually
  // there before drafting leans on them, rather than assuming silently.
  steps.push({
    step: "fill_constants",
    ok: seedState.autoFacts.length > 0,
    detail: seedState.autoFacts.length
      ? seedState.autoFacts.map((f) => f.label).join(", ")
      : "no org profile / farm facts on file yet",
  });

  // 1. Research — local precedent corpus.
  try {
    const { researchPddPrecedents } = await import("./researchPddPrecedents");
    const r = await researchPddPrecedents(ctx, {});
    steps.push({
      step: "research_pdd_precedents",
      ok: r.ok,
      detail: r.ok
        ? `corpus ${r.data.corpusSize}, ${r.data.newlyIndexed} newly indexed, ${r.data.remainingToIndex} remaining`
        : r.error,
    });
  } catch (e) {
    steps.push({ step: "research_pdd_precedents", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 2. Research — live Verra registry.
  try {
    const { searchVerraRegistry } = await import("./searchVerraRegistry");
    const r = await searchVerraRegistry(ctx, {});
    steps.push({
      step: "search_verra_registry",
      ok: r.ok,
      detail: r.ok ? `${r.data.totalMatching} matching, ${r.data.newSinceLastCheck} new since last check` : r.error,
    });
  } catch (e) {
    steps.push({ step: "search_verra_registry", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 3. Seed/refresh the per-template-section tracker PDD Development runs
  // on (a no-op after the first run) — a different table from the SEED
  // questionnaire gated above; this is the one that carries drafted_text
  // per section.
  try {
    const { query } = await import("../db");
    const { listPddSectionStatus } = await import("../pdd/sectionStatus");
    const q = await listPddSectionStatus(query, input.projectId);
    steps.push({
      step: "seed_section_tracker",
      ok: Boolean(q),
      detail: q ? `${q.rows.length} sections tracked` : "no PDD template registered",
    });
  } catch (e) {
    steps.push({ step: "seed_section_tracker", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 4. Rebeka actually writes the PDD — draft every chapter that still has
  // pending/undrafted sections. Nothing upstream of this step makes that
  // happen on its own: syncPddGoogleDoc only injects whatever's already in
  // drafted_text/input_text, it never generates prose itself.
  let chapterTitles: string[] = [];
  try {
    const { query } = await import("../db");
    const { listPddSectionStatus } = await import("../pdd/sectionStatus");
    const q = await listPddSectionStatus(query, input.projectId);
    chapterTitles = (q?.rows ?? []).filter((r) => r.sectionLevel === 1).map((r) => r.sectionTitle);
    const { draftPddChapterContent } = await import("./draftPddChapterContent");
    const r = await draftPddChapterContent(ctx, { projectId: input.projectId, chapterTitles });
    steps.push({
      step: "draft_pdd_chapter_content",
      ok: r.ok,
      detail: r.ok
        ? `${r.data.sections.filter((s) => s.outcome === "drafted").length} sections drafted across ${chapterTitles.length} chapters`
        : r.error,
    });
  } catch (e) {
    steps.push({ step: "draft_pdd_chapter_content", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 5. The live PDD Google Doc — now that step 4 gave it real prose to inject.
  try {
    const { syncPddGoogleDoc } = await import("./syncPddGoogleDoc");
    const r = await syncPddGoogleDoc(ctx, { projectId: input.projectId });
    if (r.ok) pddDocUrl = r.data.googleDocUrl;
    steps.push({
      step: "sync_pdd_google_doc",
      ok: r.ok,
      detail: r.ok ? `${r.data.created ? "created" : "updated"} — ${r.data.sectionsFilled}/${r.data.sectionsTotal} sections guided` : r.error,
    });
  } catch (e) {
    steps.push({ step: "sync_pdd_google_doc", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 6 + 7. Export the PDD Doc as PDF and email it — only if step 5 actually produced a Doc.
  // Recipient defaults to Nitzan directly (Nitzan's own spec) rather than
  // whoever happened to click the button — an override is still honored
  // when a caller genuinely wants a different recipient.
  let emailedTo: string | null = null;
  let project: { name: string; google_doc_id: string | null } | undefined;
  if (pddDocUrl) {
    try {
      const { query } = await import("../db");
      const projects = await query<{ name: string; google_doc_id: string | null }>(
        `SELECT name, google_doc_id FROM mrv.projects WHERE project_id = $1`,
        [input.projectId],
      );
      project = projects[0];
      if (project?.google_doc_id) {
        const { exportGoogleDocAsPdf } = await import("../google/driveClient");
        const pdf = await exportGoogleDocAsPdf(ctx.googleAccessToken, project.google_doc_id);
        steps.push({ step: "export_pdf", ok: true, detail: `${pdf.length} bytes` });

        const to = input.notifyEmail?.trim() || DEFAULT_NOTIFY_EMAIL;
        if (to.includes("@")) {
          const { sendGmailMessage } = await import("../google/gmailClient");
          await sendGmailMessage(ctx.googleAccessToken, {
            to,
            subject: `PDD draft ready for review — ${project.name}`,
            bodyText:
              `The PDD Generator pipeline ran for ${project.name}.\n\n` +
              `Live document: ${pddDocUrl}\n` +
              `\nThe attached PDF is a snapshot for forwarding to Verra — the live Google Doc is the working copy.`,
            // Plain hyphen, not an em dash: this filename sits in a MIME
            // Content-Disposition parameter, not a header value — RFC 2047
            // (used for Subject: below) doesn't cover parameters, that's
            // RFC 2231, and it's not worth the complexity for one character.
            attachment: { fileName: `${project.name} - PDD draft.pdf`, mimeType: "application/pdf", content: pdf },
          });
          emailedTo = to;
          steps.push({ step: "email_pdf", ok: true, detail: `sent to ${to}` });
        } else {
          steps.push({ step: "email_pdf", ok: false, detail: "no valid recipient email" });
        }
      } else {
        steps.push({ step: "export_pdf", ok: false, detail: "no Google Doc id on record" });
      }
    } catch (e) {
      steps.push({ step: "export_pdf_or_email", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // 8. Save this run into Rebeka's own long-term memory — the SEED
  // questionnaire's own answers (the real intake, not the 96-row
  // template tracker) and what was produced from them, so a future
  // session can recall the intake without re-reading the raw table. A
  // real Voyage embedding, same as every other recordAgentMemory call —
  // never skipped, never faked.
  try {
    const answered = seedState.rows.filter((r) => r.status === "answered" && r.answerText?.trim());
    const summary =
      `PDD Generator ran for ${project?.name ?? input.projectId} — ${chapterTitles.length} chapters drafted, ` +
      `${answered.length} SEED questions confirmed. Key intake:\n` +
      answered
        .map((r) => `- ${r.label}: ${r.answerText!.trim().slice(0, 200)}`)
        .join("\n") +
      (pddDocUrl ? `\n\nLive PDD document: ${pddDocUrl}` : "");
    const { recordAgentMemory } = await import("./recordAgentMemory");
    const r = await recordAgentMemory(ctx, { projectId: input.projectId, content: summary, kind: "pdd_generator_intake" });
    steps.push({ step: "record_agent_memory", ok: r.ok, detail: r.ok ? `memory_id ${r.data.memoryId}` : r.error });
  } catch (e) {
    steps.push({ step: "record_agent_memory", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 9. One-time lock — the questionnaire is view-only from here on
  // (Nitzan's own spec: "cannot return to this questionnaire after
  // clicking PDD GENERATOR — can still view answers").
  const { query: stampQuery } = await import("../db");
  const stamped = await stampQuery<{ locked_at: string }>(
    `UPDATE mrv.projects
        SET last_pdd_pipeline_run_at = clock_timestamp(), pdd_generator_locked_at = clock_timestamp()
      WHERE project_id = $1
      RETURNING pdd_generator_locked_at::text AS locked_at`,
    [input.projectId],
  );

  await audit(ctx, "run_pdd_generator_pipeline", { type: "project", id: input.projectId }, {
    steps: steps.map((s) => ({ step: s.step, ok: s.ok })),
    emailedTo,
  });

  return ok({ projectId: input.projectId, steps, pddDocUrl, emailedTo, lockedAt: stamped[0].locked_at });
}
