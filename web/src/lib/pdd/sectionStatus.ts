import "server-only";

export interface PddSectionStatusRow {
  statusId: string;
  sectionIndex: number;
  sectionTitle: string;
  sectionLevel: number;
  status: "pending" | "answered" | "skipped" | "drafted";
  inputText: string | null;
  draftedText: string | null;
  updatedAt: string;
  /** A short, concrete question for this row — set only where the section title alone isn't enough to know what a quick answer looks like. */
  questionHint: string | null;
  /** Nitzan's own comments/tasks to Rebeka about the drafted answer — human-only, PDD Development interface (0067). */
  reviewComment: string | null;
  /** Nitzan approved this section's drafted answer in the PDD Development interface — independent of `status`. */
  devApproved: boolean;
  /** Verra's own guidance/question text for this section, verbatim from the registered template — not written by us. */
  guidance: string | null;
}

export interface PddSectionStatusResult {
  templateId: string;
  templateName: string;
  templateVersion: string;
  rows: PddSectionStatusRow[];
}

/**
 * The structured questionnaire's rows for a project — seeded from the
 * currently registered template's own section outline on first read, so
 * nothing has to be seeded ahead of time by a separate step. Re-reading
 * after the template's structure changed (a new version registered)
 * adds only the newly-appearing sections; already-answered ones keep
 * their answers.
 */
export async function listPddSectionStatus(
  query: <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  projectId: string,
): Promise<PddSectionStatusResult | null> {
  const templates = await query<{
    template_id: string;
    name: string;
    version: string;
    structure: Array<{ level: number; title: string; body: string }>;
  }>(`SELECT template_id, name, version, structure FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`);
  if (!templates.length) return null;
  const template = templates[0];

  const existing = await query<{ section_index: number }>(
    `SELECT section_index FROM mrv.pdd_section_status WHERE project_id = $1 AND template_id = $2`,
    [projectId, template.template_id],
  );
  const seededIndexes = new Set(existing.map((r) => r.section_index));

  const toSeed = template.structure
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => !seededIndexes.has(s.index));

  for (const s of toSeed) {
    await query(
      `INSERT INTO mrv.pdd_section_status (project_id, template_id, section_index, section_title, section_level)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, template_id, section_index) DO NOTHING`,
      [projectId, template.template_id, s.index, s.title, s.level],
    );
  }

  const rows = await query<{
    status_id: string;
    section_index: number;
    section_title: string;
    section_level: number;
    status: "pending" | "answered" | "skipped" | "drafted";
    input_text: string | null;
    drafted_text: string | null;
    updated_at: string;
    question_hint: string | null;
    review_comment: string | null;
    dev_approved: boolean;
  }>(
    `SELECT status_id, section_index, section_title, section_level, status, input_text, drafted_text, updated_at,
            question_hint, review_comment, dev_approved
       FROM mrv.pdd_section_status
      WHERE project_id = $1 AND template_id = $2
      ORDER BY section_index`,
    [projectId, template.template_id],
  );

  return {
    templateId: template.template_id,
    templateName: template.name,
    templateVersion: template.version,
    rows: rows.map((r) => ({
      statusId: r.status_id,
      sectionIndex: r.section_index,
      sectionTitle: r.section_title,
      sectionLevel: r.section_level,
      status: r.status,
      inputText: r.input_text,
      draftedText: r.drafted_text,
      updatedAt: r.updated_at,
      questionHint: r.question_hint,
      reviewComment: r.review_comment,
      devApproved: r.dev_approved,
      guidance: template.structure[r.section_index]?.body?.trim() || null,
    })),
  };
}

/**
 * "1", "1.1", "1.2", "2", "2.1"… — computed purely from each row's own
 * level and position among its siblings, the same way Word's own
 * multi-level heading numbering would number them. The template's own
 * `structure` doesn't carry numbers as data (Word applies them via the
 * heading style at render time), so this is the one place that number
 * exists at all outside the live document itself — every caller that
 * needs to show "which section is this" reads it from here rather than
 * recomputing its own version.
 */
export function computeSectionNumbers(rows: PddSectionStatusRow[]): Record<number, string> {
  const counters: number[] = []; // counters[0] = current level-1 number, counters[1] = current level-2 number, ...
  const numbers: Record<number, string> = {};
  for (const r of rows) {
    const depth = r.sectionLevel - 1; // level 1 -> depth 0
    counters[depth] = (counters[depth] ?? 0) + 1;
    counters.length = depth + 1; // reset any deeper counters once a shallower row appears
    numbers[r.sectionIndex] = counters.slice(0, depth + 1).join(".");
  }
  return numbers;
}

/**
 * A row with no content of its own — just a heading grouping the rows
 * that follow it (the next row is nested deeper). The template's own
 * `structure[].body` is empty for these (confirmed by
 * draftPddChapterContent's own "no_guidance" outcome for them), so
 * nobody — human or Rebeka — ever has anything real to put in one, and
 * treating it as "must be answered or skipped" would make the PDD
 * Generator's completeness gate permanently unsatisfiable.
 */
function isGroupingHeader(rows: PddSectionStatusRow[], i: number): boolean {
  const next = rows[i + 1];
  return Boolean(next && next.sectionLevel > rows[i].sectionLevel);
}

/** How many rows are still pending and actually need an answer or a Skip — grouping headers don't count (see isGroupingHeader). */
export function countPendingLeafSections(rows: PddSectionStatusRow[]): number {
  return rows.filter((r, i) => r.status === "pending" && !isGroupingHeader(rows, i)).length;
}

/**
 * The level-1 chapter title that owns a given section index — walks
 * backward for the nearest row at sectionLevel 1. Used wherever a
 * scheduled task finds a specific section (a new review comment, a
 * "Project Activities" title match) and needs the chapter title
 * draftPddChapterContent's own chapterTitles input expects, since that
 * tool redrafts a whole chapter, not one section in isolation.
 */
export function chapterTitleForSectionIndex(rows: PddSectionStatusRow[], sectionIndex: number): string | null {
  let owner: string | null = null;
  for (const r of rows) {
    if (r.sectionIndex > sectionIndex) break;
    if (r.sectionLevel === 1) owner = r.sectionTitle;
  }
  return owner;
}

/**
 * Per-chapter (level-1 section) completeness — the Readiness Report's own
 * rollup. `answered`/`readinessPct` count only human-confirmed sections,
 * unchanged from before drafted_text existed — a model-drafted section
 * is not "done" until a person has read it. `drafted` is reported
 * alongside so a caller that wants "has real prose, reviewed or not" can
 * add the two, but never inside readinessPct itself.
 */
export function summarizeByChapter(rows: PddSectionStatusRow[]): Array<{
  chapterTitle: string;
  total: number;
  answered: number;
  drafted: number;
  skipped: number;
  pending: number;
  readinessPct: number;
}> {
  const chapters: Array<{ title: string; rows: PddSectionStatusRow[] }> = [];
  let current: { title: string; rows: PddSectionStatusRow[] } | null = null;
  for (const r of rows) {
    if (r.sectionLevel === 1) {
      current = { title: r.sectionTitle, rows: [] };
      chapters.push(current);
    }
    if (!current) {
      current = { title: r.sectionTitle, rows: [] };
      chapters.push(current);
    }
    current.rows.push(r);
  }
  return chapters.map((c) => {
    const total = c.rows.length;
    const answered = c.rows.filter((r) => r.status === "answered").length;
    const drafted = c.rows.filter((r) => r.status === "drafted").length;
    const skipped = c.rows.filter((r) => r.status === "skipped").length;
    const pending = total - answered - drafted - skipped;
    return {
      chapterTitle: c.title,
      total,
      answered,
      drafted,
      skipped,
      pending,
      readinessPct: total ? Math.round((answered / total) * 100) : 0,
    };
  });
}
