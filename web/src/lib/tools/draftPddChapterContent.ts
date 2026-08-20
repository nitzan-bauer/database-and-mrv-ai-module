import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

interface TemplateSection {
  level: number;
  title: string;
  body: string;
}

export interface DraftedSectionOutcome {
  sectionIndex: number;
  sectionTitle: string;
  outcome: "drafted" | "kept_answered" | "kept_skipped" | "no_guidance" | "error";
  detail?: string;
}

export interface ChapterDraftReadiness {
  chapterTitle: string;
  total: number;
  answered: number;
  drafted: number;
  pending: number;
  draftReadinessPct: number;
}

export interface DraftPddChapterContentResult {
  projectId: string;
  chaptersRequested: string[];
  sections: DraftedSectionOutcome[];
  chapterReadiness: ChapterDraftReadiness[];
  followUpQuestions: string | null;
  modelProviderId: string;
}

const DRAFTING_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent, drafting one section of a real VCS Project " +
  "Description (VM0042, grouped project) that will eventually go to Verra. Write in the professional, " +
  "concise, declarative register real registered VM0042 PDDs use — the kind of writing shown in the " +
  "precedent excerpts you're given, not marketing language. 80-200 words unless the section clearly needs " +
  "more. Ground every factual claim in the direction, project facts, or precedent given to you. If a " +
  "specific fact is needed but not given (a date, a citation, a number), do not invent one — write " +
  "'[NEEDS: <exactly what's missing>]' inline instead of a plausible-sounding placeholder — and never invent " +
  "a number, table row, or figure just to fill a table shape the guidance describes; if you don't have real " +
  "data for a row, write '[NEEDS: <the specific figure>]' for that row instead of a plausible one. " +
  "Verra's own guidance for this section sometimes describes its answer as a table (column headers, rows). " +
  "Never reproduce that as a markdown table — no '|' characters, no '---' separator rows, no markdown of any " +
  "kind. Instead write each row as its own line: 'Row label: value'. One fact per line, plain text only. " +
  "Output only the section's prose — no heading, no preamble.\n\n" +
  "Quantification approach policy (Nitzan's own direction, 2026-08-19): at this stage no GHG model is run " +
  "with real data — do not invent model output numbers. But when a section describes how emission " +
  "reductions or removals from a project activity will be quantified, write it around this project's real " +
  "quantification-tier assignment rather than generically, and name the correct approach (QA1 = process-" +
  "based biogeochemical model such as DNDC/DayCent; QA2 = measurement-based, stratified sampling; QA3 = " +
  "default emission factors) for the activity in question: mycorrhizae (biofertilizer/soil inoculant) is " +
  "QA2; fossil-fuel energy savings is QA3; fertilization efficiency / synthetic nitrogen savings is QA2. " +
  "For any other activity, name whichever of QA1/QA2/QA3 the project facts or direction indicate, or write " +
  "'[NEEDS: quantification approach for <activity>]' rather than guessing.";

const FOLLOWUP_SYSTEM_PROMPT =
  "You are Rebeka. You just drafted several PDD sections and some remain pending because no direction was " +
  "given for them. Pick exactly 3 of the pending sections whose answers would be short, factual, and quick " +
  "for a non-technical founder to supply from memory — not sections needing research or a technical model " +
  "run. For each: the section title, then exactly 2 short sentences (plain English) telling the person " +
  "precisely what to answer. Number them 1-3. Nothing else.";

/**
 * Turns raw, casual direction (mrv.pdd_section_status.input_text, typed
 * by a person as a pointer, not prose) into actual VM0042-style section
 * text — the gap Nitzan's own PDD Generator brief called out explicitly:
 * up to now the questionnaire was pure passthrough, and his answers were
 * only ever meant as "initial direction", not final wording.
 *
 * Writes to drafted_text, status='drafted' — never input_text, never
 * 'answered'. A model call is not a person standing behind a claim, and
 * conflating the two is exactly the failure mode this build has refused
 * everywhere else (fabricated GHG numbers, invented compliance scores).
 * Section rows already 'answered' by a person are left untouched.
 */
export async function draftPddChapterContent(
  ctx: ToolContext,
  input: { projectId: string; chapterTitles: string[]; maxSections?: number },
): Promise<ToolResult<DraftPddChapterContentResult>> {
  const guard = requireDbMode("draftPddChapterContent");
  if (guard) return guard;

  const policy = await checkPolicy("draft_pdd_chapter_content", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.projectId?.trim()) return fail("draftPddChapterContent: projectId is required.");
  if (!input.chapterTitles?.length) return fail("draftPddChapterContent: at least one chapterTitles entry is required.");

  const { query } = await import("../db");
  const { listPddSectionStatus } = await import("../pdd/sectionStatus");
  const { getConfiguredProvider } = await import("../agent/provider");

  const projects = await query<{ name: string; methodology: string; country: string }>(
    `SELECT name, methodology, country FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("draftPddChapterContent: no such project.");
  const project = projects[0];

  const farms = await query<{ name: string; operator: string | null; country: string | null; region: string | null }>(
    `SELECT name, operator, country, region FROM mrv.farms WHERE project_id = $1 AND NOT is_demo ORDER BY name`,
    [input.projectId],
  );
  const farmFacts = farms.length
    ? farms.map((f) => `- ${f.name} (${[f.region, f.country].filter(Boolean).join(", ")}), farmer: ${f.operator ?? "unknown"}`).join("\n")
    : "No farms recorded yet.";

  // Set once at the org level (0060), not re-typed per project — Nitzan's
  // own instruction after supplying the real letterhead: this is the last
  // time any project's drafting should need to ask for it.
  const orgProfiles = await query<{
    legal_name: string;
    address: string;
    tax_id: string | null;
    contact_name: string;
    contact_title: string;
    contact_email: string;
    contact_phone: string;
  }>(`SELECT legal_name, address, tax_id, contact_name, contact_title, contact_email, contact_phone FROM mrv.org_profile LIMIT 1`);
  const orgProfileFacts = orgProfiles.length
    ? `\n\nProject Proponent (org profile, real and confirmed — never treat as missing):\n` +
      `Organization name: ${orgProfiles[0].legal_name}\n` +
      `Address: ${orgProfiles[0].address}\n` +
      (orgProfiles[0].tax_id ? `Tax ID: ${orgProfiles[0].tax_id}\n` : "") +
      `Contact person: ${orgProfiles[0].contact_name}, ${orgProfiles[0].contact_title}\n` +
      `Email: ${orgProfiles[0].contact_email}\n` +
      `Telephone: ${orgProfiles[0].contact_phone}`
    : "";

  const templates = await query<{ template_id: string; structure: TemplateSection[] }>(
    `SELECT template_id, structure FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`,
  );
  if (!templates.length) return fail("draftPddChapterContent: no PDD template is registered yet.");
  const structure = templates[0].structure;

  const result = await listPddSectionStatus(query, input.projectId);
  if (!result) return fail("draftPddChapterContent: no PDD template is registered yet.");

  const l1 = result.rows.filter((r) => r.sectionLevel === 1);
  const provider = await getConfiguredProvider();

  const projectFacts =
    `Project: ${project.name} · ${project.methodology} · ${project.country}\n` +
    `Participating farms:\n${farmFacts}` +
    orgProfileFacts;

  // [startIndex, endIndex) per requested chapter — computed once, reused
  // for both the drafting pass below and the follow-up-questions pass.
  const chapterRanges: Array<{ title: string; start: number; end: number }> = [];
  for (const chapterTitle of input.chapterTitles) {
    const chapterIdx = l1.findIndex((r) => r.sectionTitle.trim() === chapterTitle.trim());
    if (chapterIdx === -1) {
      chapterRanges.push({ title: chapterTitle, start: -1, end: -1 });
      continue;
    }
    chapterRanges.push({
      title: chapterTitle,
      start: l1[chapterIdx].sectionIndex,
      end: chapterIdx + 1 < l1.length ? l1[chapterIdx + 1].sectionIndex : Infinity,
    });
  }

  const sections: DraftedSectionOutcome[] = [];
  // Each drafted section costs one sequential LLM call, which on a real
  // template with many pending sections at once can run well past a
  // serverless function's time budget — confirmed live: an unattended
  // scheduled task with no cap ran into Vercel's hard 60s
  // FUNCTION_INVOCATION_TIMEOUT before finishing a single chapter pass.
  // Interactive callers (the PDD Generator, manual drafting from /agents)
  // leave maxSections unset and get the old unlimited behavior — a person
  // watching the request is a different situation than an unattended cron
  // invocation with a hard ceiling. A section this call doesn't reach is
  // simply left 'pending', unchanged, for the next call to pick up.
  const maxSections = input.maxSections;
  let draftedThisCall = 0;

  outer: for (const range of chapterRanges) {
    if (range.start === -1) {
      sections.push({ sectionIndex: -1, sectionTitle: range.title, outcome: "error", detail: "no such chapter in the registered template" });
      continue;
    }
    const chapterRows = result.rows.filter((r) => r.sectionIndex >= range.start && r.sectionIndex < range.end);

    for (const row of chapterRows) {
      if (row.sectionLevel === 1) continue; // the chapter header itself carries no content requirement

      if (maxSections !== undefined && draftedThisCall >= maxSections) break outer;

      if (row.status === "answered") {
        sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "kept_answered" });
        continue;
      }
      if (row.status === "skipped") {
        sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "kept_skipped" });
        continue;
      }

      const guidance = structure[row.sectionIndex]?.body?.trim();
      if (!guidance) {
        sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "no_guidance" });
        continue;
      }

      let excerptBlock = "";
      try {
        const excerptRows = await query<{ file_name: string; excerpt: string }>(
          `SELECT file_name,
                  ts_headline('english', extracted_text, plainto_tsquery('english', $1),
                    'MaxFragments=2, MaxWords=60, MinWords=20') AS excerpt
             FROM mrv.pdd_precedents
            WHERE to_tsvector('english', extracted_text) @@ plainto_tsquery('english', $1)
            ORDER BY ts_rank_cd(to_tsvector('english', extracted_text), plainto_tsquery('english', $1)) DESC
            LIMIT 2`,
          [row.sectionTitle],
        );
        if (excerptRows.length) {
          excerptBlock = "\n\nPrecedent excerpts (real, issued VM0042 PDDs — for style/pattern only, not for this project's facts):\n" +
            excerptRows.map((e) => `[${e.file_name}] ${e.excerpt.replace(/<\/?b>/g, "")}`).join("\n");
        }
      } catch {
        // Precedent search is a quality booster, not a dependency — an empty corpus or a query hiccup still lets drafting proceed.
      }

      const direction = row.inputText?.trim() || row.draftedText?.trim();
      const userMessage =
        `Section: "${row.sectionTitle}"\n` +
        `Verra's own guidance for this section:\n${guidance}\n\n` +
        `Project facts:\n${projectFacts}` +
        (direction ? `\n\nDirection from the founder (raw, not final wording — write proper prose from this):\n${direction}` : "") +
        excerptBlock;

      try {
        const resp = await provider.complete({ system: DRAFTING_SYSTEM_PROMPT, userMessage, tools: [] });
        const text = resp.kind === "text" ? resp.text.trim() : "";
        if (!text) {
          sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "error", detail: "empty model response" });
          continue;
        }
        await query(
          `UPDATE mrv.pdd_section_status SET drafted_text = $1, status = 'drafted', updated_by = $2 WHERE status_id = $3`,
          [text, ctx.actor, row.statusId],
        );
        sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "drafted" });
        draftedThisCall++;
      } catch (e) {
        sections.push({ sectionIndex: row.sectionIndex, sectionTitle: row.sectionTitle, outcome: "error", detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Re-read so the readiness rollup reflects what was just written, not the pre-draft snapshot.
  const { summarizeByChapter } = await import("../pdd/sectionStatus");
  const refreshed = await listPddSectionStatus(query, input.projectId);
  const chapterReadiness: ChapterDraftReadiness[] = (refreshed ? summarizeByChapter(refreshed.rows) : [])
    .filter((c) => input.chapterTitles.includes(c.chapterTitle))
    .map((c) => ({
      chapterTitle: c.chapterTitle,
      total: c.total,
      answered: c.answered,
      drafted: c.drafted,
      pending: c.pending,
      draftReadinessPct: c.total ? Math.round(((c.answered + c.drafted) / c.total) * 100) : 0,
    }));

  let followUpQuestions: string | null = null;
  const pendingCandidates = (refreshed?.rows ?? []).filter(
    (r) => r.status === "pending" && chapterRanges.some((c) => r.sectionIndex >= c.start && r.sectionIndex < c.end),
  );
  if (pendingCandidates.length) {
    const listText = pendingCandidates
      .map((r) => `- "${r.sectionTitle}": ${structure[r.sectionIndex]?.body?.trim()?.slice(0, 300) || "(no guidance text)"}`)
      .join("\n");
    try {
      const resp = await provider.complete({
        system: FOLLOWUP_SYSTEM_PROMPT,
        userMessage: `Pending sections with no direction yet:\n${listText}`,
        tools: [],
      });
      followUpQuestions = resp.kind === "text" ? resp.text.trim() : null;
    } catch {
      followUpQuestions = null;
    }
  }

  await audit(ctx, "draft_pdd_chapter_content", { type: "project", id: input.projectId }, {
    chaptersRequested: input.chapterTitles,
    draftedCount: sections.filter((s) => s.outcome === "drafted").length,
    errorCount: sections.filter((s) => s.outcome === "error").length,
  });

  return ok({
    projectId: input.projectId,
    chaptersRequested: input.chapterTitles,
    sections,
    chapterReadiness,
    followUpQuestions,
    modelProviderId: provider.id,
  });
}
