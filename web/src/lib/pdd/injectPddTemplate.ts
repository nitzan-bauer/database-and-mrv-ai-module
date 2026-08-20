import "server-only";
import { readZip } from "../ingest/zip";
import { createZip } from "../kml/zipWriter";

/**
 * Fill in the REAL Verra template file — not a document rebuilt from
 * its extracted outline. generatePddDraft/buildPddDocx's approach threw
 * away everything registerPddTemplate's own extraction never captured:
 * the cover page, Verra's real logo images, headers/footers, fonts,
 * every style. What a person got back read as "some document with the
 * right section titles", not "Verra's template, filled in" — and
 * "built on Verra's template" was stated as a hard requirement, not a
 * preference.
 *
 * So this edits the template's own word/document.xml directly: every
 * other part of the zip (word/media/*, headers, footers, styles,
 * theme, fonts) is carried through completely unchanged, byte for
 * byte. A section's own instructional *paragraphs* (no table) are
 * dropped and replaced with the real fill — but every real Verra
 * <w:tbl> now always stays, whole, whether or not the section has an
 * answer yet (confirmed live: dropping tables broke page layout and
 * made whole sections look corrupted — "the template must stay
 * identical to the original" is a hard requirement, not a preference).
 * Known facts get written directly into a table's own placeholder cells
 * (applyTableCellFixes, below) rather than only appended as prose after
 * it, matching how a real issued PDD looks.
 *
 * Paragraphs do not nest in a docx body (confirmed the same way
 * docx.ts's reader relies on it), so splitting document.xml on `<w:p`
 * boundaries safely isolates one paragraph's raw XML per chunk — the
 * same technique lib/ingest/docx.ts's readParagraphs already uses for
 * reading; this is its write-side counterpart.
 *
 * Front matter (everything before "1 Project Details") is Verra's own
 * blank-template instructions — "Instructions for completing this
 * template", file-naming rules, and the like — meant to be deleted, not
 * submitted. Confirmed against a real, issued PDD (screenshot supplied
 * directly, not guessed): every real filing replaces that front matter
 * with its own title page — a "PROJECT DESCRIPTION: <name>" title, the
 * preparer's logo, and a metadata table (project name/ID, crediting
 * period, document date/version, request type). This does the same for
 * CarboNature, reusing Verra's own logo paragraph and TemplateTitle
 * style rather than inventing new visual design.
 */

interface SectionFill {
  /** null = leave as [NEEDS NARRATIVE]; a string = the real, human-confirmed answered text. */
  inputText: string | null;
  /** Set only when status='drafted' — Rebeka's own text, not yet reviewed by a person. */
  draftedText?: string | null;
}

export interface CoverPageFacts {
  projectName: string;
  /** Verra's own registry id, or an honest placeholder — never fabricated. */
  projectIdDisplay: string;
  /**
   * When project activities actually began (e.g. the earliest farmer
   * kick-off meeting) — a real, distinct fact from the crediting period
   * start, which is a Verra-defined date that can land later. Falls back
   * to creditingStartDisplay only when the real activity start isn't
   * known yet, so the cover page never shows a blank.
   */
  projectStartDisplay: string;
  creditingStartDisplay: string;
  creditingEndDisplay: string;
  documentCompletionDateDisplay: string;
  documentVersion: string;
  /** Index into REQUEST_TYPES, or null when the status doesn't map cleanly and a person must confirm. */
  requestTypeChecked: number | null;
  /** CarboNature's own logo, PNG bytes — embedded fresh into the docx. */
  logoPngBuffer: Buffer;
}

/** Verified verbatim against a real issued VM0042 PDD's cover page — not invented wording. */
export const REQUEST_TYPES = [
  "Pipeline listing (under development)",
  "Pipeline listing (under validation)",
  "Registration",
  "Crediting period renewal",
  "Verification approval with revised project description for a project description deviation, including methodology change",
  "Verification approval with revised project description for baseline reassessment",
  "Requantification with revised project description for methodology change",
];

function headingLevel(styleId: string | null): number | null {
  if (!styleId) return null;
  if (/^title$/i.test(styleId)) return 1;
  const m = styleId.match(/^Heading(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * generatePddDraft's content is Markdown-lite (**bold**, whole-line
 * _italic_ for guidance/disclaimer lines) — the same convention
 * buildPddDocx.ts parses for the from-scratch document. Left unparsed,
 * the asterisks and underscores sit in the Doc as literal characters,
 * which is exactly the "doesn't read as a real document" problem the
 * template switch was meant to fix. Splits one line into runs so **bold**
 * spans become real <w:b/> runs instead of literal asterisks.
 */
function runsForLine(line: string, forceItalic: boolean): string {
  const wholeLineItalic = /^_(.*)_$/.test(line) ? line.slice(1, -1) : null;
  const body = wholeLineItalic ?? line;
  const italic = forceItalic || wholeLineItalic !== null;

  const tokens: { text: string; bold: boolean }[] = [];
  const boldRe = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(body))) {
    if (m.index > lastIndex) tokens.push({ text: body.slice(lastIndex, m.index), bold: false });
    tokens.push({ text: m[1], bold: true });
    lastIndex = boldRe.lastIndex;
  }
  if (lastIndex < body.length) tokens.push({ text: body.slice(lastIndex), bold: false });
  if (!tokens.length) tokens.push({ text: body, bold: false });

  const runsXml = tokens
    .filter((t) => t.text)
    .map((t) => {
      const rPrParts = [t.bold ? "<w:b/>" : "", italic ? "<w:i/>" : ""].filter(Boolean);
      const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(t.text)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p>${runsXml}</w:p>`;
}

/**
 * A model asked to fill a section Verra's own guidance describes as a
 * table sometimes reproduces that shape as a literal markdown table —
 * confirmed live, "| Deadline | Date |" / "|---|---|" rendered as plain
 * text runs, unreadable in the real document. The drafting prompt now
 * forbids this outright, but existing drafted text and any future model
 * that doesn't fully comply both need a floor: turn a pipe-delimited row
 * into a plain "label: value" line, and drop separator rows entirely.
 */
function convertMarkdownTableLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^\|?[\s:-]*-{2,}[\s:|-]*\|?$/.test(trimmed) && trimmed.includes("-")) return null; // |---|---| separator
  if (!(trimmed.startsWith("|") && trimmed.endsWith("|"))) return line;
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!cells.length) return null;
  if (cells.length === 1) return cells[0];
  if (cells.length === 2) return `${cells[0]}: ${cells[1]}`;
  return cells.join(" — ");
}

/** One or more <w:p> paragraphs, one per line, run in italic when it's a placeholder. */
function paragraphsFor(text: string, italic: boolean): string {
  return text
    .split(/\r?\n/)
    .map((line) => convertMarkdownTableLine(line))
    .filter((line): line is string => line !== null && line.trim() !== "")
    .map((line) => runsForLine(line, italic))
    .join("");
}

const NEEDS_MARKER_RE = /\[NEEDS:[^\]]*\]/g;

/**
 * Pull every "[NEEDS: ...]" Rebeka's own drafting left inline (see
 * draftPddChapterContent.ts's system prompt) out of a piece of text —
 * used both to clean the submission-facing doc and, separately, to
 * list the same gaps in the Readiness Report (see
 * buildReadinessReportDocx.ts), so a real gap is never simply dropped,
 * only moved to where an AI fingerprint belongs.
 */
export function extractNeedsMarkers(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(NEEDS_MARKER_RE)].map((m) => m[0].slice("[NEEDS:".length, -1).trim());
}

/** Same text with every "[NEEDS: ...]" marker removed and the surrounding whitespace tidied. */
function stripNeedsMarkers(text: string): string {
  return text
    .replace(NEEDS_MARKER_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

/**
 * The document itself carries no trace of which sections are Rebeka's own
 * draft versus a person's confirmed text — Nitzan's own instruction: a
 * PDD that will eventually reach a VVB or Verra should read as one
 * document, not as one with AI fingerprints on part of it. That
 * distinction still exists and still matters — it's tracked in the PDD
 * Readiness Report instead (see buildReadinessReportDocx.ts), which is
 * the internal tracking document, not the submission itself. Same
 * reasoning for "[NEEDS: ...]" markers: real in the drafting process,
 * never meant to reach the document a VVB reads.
 */
function fillParagraphsXml(fill: SectionFill | undefined): string {
  if (fill?.inputText?.trim()) return paragraphsFor(stripNeedsMarkers(fill.inputText), false);
  if (fill?.draftedText?.trim()) return paragraphsFor(stripNeedsMarkers(fill.draftedText), false);
  return "";
}

/**
 * Real values written straight into a kept table's own placeholder text
 * — "DD-MMM-YYYY" becomes the real date, an unchecked ☐ becomes ☒ —
 * instead of only ever appended as separate prose after an unfilled
 * table. Confirmed live as the second half of the same complaint: tables
 * no longer vanish, but were still showing Verra's own placeholders with
 * the real answer sitting oddly beside them. Scoped per sectionIndex and
 * applied with a plain, non-global .replace() (first match only) — each
 * of these placeholder strings appears exactly once in its own section's
 * table, but "DD-MMM-YYYY" alone appears throughout the whole template,
 * so an unscoped replace would corrupt unrelated sections' own dates.
 */
function applyTableCellFixes(chunk: string, sectionIndex: number, coverPage: CoverPageFacts): string {
  const escaped = escapeXml(coverPage.creditingStartDisplay);
  const escapedEnd = escapeXml(coverPage.creditingEndDisplay);
  switch (sectionIndex) {
    case 13: // Project Start Date — real activity start, not the crediting period's own start
      return chunk.replace(/DD-MMM-YYYY/, escapeXml(coverPage.projectStartDisplay));
    case 14: // Initial Crediting Period Start Date
      return chunk.replace(/DD-MMM-YYYY/, escaped);
    case 15: // Project Crediting Period
      return chunk
        .replace(/☐(\s*20)/, "☒$1") // "20–100 years" checked, not "Five years"
        .replace(/DD-MMM-YYYY/, escaped)
        .replace(/DD-MMM-YYYY/, escapedEnd);
    case 16: // Project Scale
      return chunk.replace(/☐(\s*≤300)/, "☒$1"); // "≤300,000 tCO2e/year (project)" checked
    default:
      return chunk;
  }
}

/** Plain text of one `<w:tc>...</w:tc>` cell, tags stripped — used only to match a row's own label. */
function cellPlainText(cellXml: string): string {
  return cellXml.replace(/<[^>]+>/g, "").trim();
}

/** Keeps a cell's own <w:tcPr> (width, shading) but replaces all of its paragraph content with one new paragraph. */
function replaceCellValue(cellXml: string, newText: string): string {
  const tcPrMatch = cellXml.match(/^<w:tc>(<w:tcPr>[\s\S]*?<\/w:tcPr>)?/);
  const tcPr = tcPrMatch?.[1] ?? "";
  return `<w:tc>${tcPr}<w:p><w:r><w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r></w:p></w:tc>`;
}

/**
 * Fills a real 2-column Verra table (label cell, value cell — e.g. every
 * row of the Project Proponent / Other Entities tables) by matching each
 * row's OWN label text against a lookup. General on purpose, not
 * hardcoded to one section: any table of this label/value shape can use
 * it. A row whose label isn't in the lookup — a question this project
 * genuinely has no answer for yet — is left exactly as Verra wrote it,
 * not guessed at.
 */
function fillTableRowsByLabel(tableXml: string, valuesByLabel: Record<string, string>): string {
  const lookup = new Map(Object.entries(valuesByLabel).map(([k, v]) => [k.toLowerCase(), v]));
  return tableXml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (rowXml) => {
    const cells = rowXml.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g);
    if (!cells || cells.length < 2) return rowXml;
    const value = lookup.get(cellPlainText(cells[0]).toLowerCase());
    if (value === undefined) return rowXml;
    const lastCell = cells[cells.length - 1];
    return rowXml.replace(lastCell, replaceCellValue(lastCell, value));
  });
}

/** Finds the first `<w:tbl>` after a unique heading anchor and fills its rows by label. */
function fillTableAfterAnchor(xml: string, anchor: string, valuesByLabel: Record<string, string>): string {
  const anchorIdx = xml.indexOf(anchor);
  if (anchorIdx === -1) return xml;
  const tblStart = xml.indexOf("<w:tbl>", anchorIdx);
  if (tblStart === -1) return xml;
  const tblEnd = xml.indexOf("</w:tbl>", tblStart) + "</w:tbl>".length;
  return xml.slice(0, tblStart) + fillTableRowsByLabel(xml.slice(tblStart, tblEnd), valuesByLabel) + xml.slice(tblEnd);
}

/**
 * Some cells' guidance text is fragmented across many separate <w:r><w:t>
 * runs (spell-check/revision-tracking artifacts in the real template —
 * confirmed live: "Method applied"'s value cell splits "State which
 * additionality method(s)..." into 11 separate runs), so a plain text
 * pattern can never match it and per-chunk replacement can't safely
 * rewrite it either (the runs and the chunk boundary don't line up).
 * This runs once on the fully assembled document instead, anchored on
 * the unique structural XML immediately before and after the run mess
 * — an exact byte sequence real elsewhere in the template only once —
 * so it can drop everything between them and splice in one clean run
 * without needing to parse the runs it's replacing at all.
 */
export interface OrgProfileFacts {
  legalName: string;
  address: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
}

/**
 * Word's spell-check/revision-tracking splits real heading text across
 * many separate <w:r><w:t> runs mid-word — confirmed live: "Capacity
 * Limit Eligibility" lands as five runs, "Capacity " + "L" + "imit " +
 * "E" + "ligibility ", so a plain `indexOf(">Capacity Limit
 * Eligibility<")` never matches even though the heading is right there.
 * This finds the same text tolerating an optional run break — closing
 * and reopening tags — between any two characters, without caring how
 * many runs the real template happens to split it into.
 */
function looseTextIndex(xml: string, text: string): number {
  const runBreak = String.raw`(?:</w:t></w:r><w:r(?:\s[^>]*)?>(?:<w:rPr>(?:(?!</w:rPr>)[\s\S])*</w:rPr>)?<w:t(?:\s[^>]*)?>)?`;
  const pattern = [...text].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(runBreak);
  const m = xml.match(new RegExp(pattern));
  return m ? (m.index ?? -1) : -1;
}

/**
 * Flips the SECOND of the first two Yes/No checkboxes found after a
 * unique heading anchor — no stop phrase, because there isn't a safe one:
 * "If answering yes/no..." is boilerplate Verra reuses after several
 * different checkbox groups in this same template, so bounding the
 * search on it silently swept in unrelated later checkboxes and made
 * the "exactly two" guard refuse to touch anything. The real structural
 * fact that makes this safe without a stop phrase: this heading's own
 * gate question is always the first checkbox pair encountered right
 * after it, by construction of the template, so "first two" already
 * identifies it precisely.
 */
function flipSecondCheckboxAfterAnchor(xml: string, anchorText: string, checkedGlyph = "☒"): string {
  const anchorIdx = looseTextIndex(xml, anchorText);
  if (anchorIdx === -1) return xml;
  const sdtRe = /<w:sdt>(?:(?!<\/w:sdt>)[\s\S])*?<w:t>☐<\/w:t>(?:(?!<\/w:sdt>)[\s\S])*?<\/w:sdt>/g;
  sdtRe.lastIndex = anchorIdx;
  const first = sdtRe.exec(xml);
  if (!first) return xml;
  const second = sdtRe.exec(xml);
  if (!second) return xml;
  const flipped = second[0].replace("☐", checkedGlyph);
  return xml.slice(0, second.index) + flipped + xml.slice(second.index + second[0].length);
}

export interface GhgReductionRow {
  startDisplay: string;
  endDisplay: string;
  totalTco2e: number;
  /** true when this year's figure continues the founder's last given rate rather than being one they typed in. */
  extrapolated: boolean;
}

function formatTco2e(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const GHG_COLUMN_WIDTHS = [1527, 1527, 1528, 1530, 1530, 1530, 1530, 1533];
const GHG_PENDING = "[NEEDS: VM0042 model run]";

function ghgCell(text: string, widthDxa: number): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa" /></w:tcPr><w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

function ghgRowXml(cells: string[]): string {
  return `<w:tr>${cells.map((c, i) => ghgCell(c, GHG_COLUMN_WIDTHS[i])).join("")}</w:tr>`;
}

/**
 * Replaces every DATA row of the Estimated GHG Emission Reductions and
 * Removals table with one row per real vintage period, keeping only the
 * table's own header row (column titles) verbatim. Verra ships this
 * table with a handful of illustrative "Example: ..." rows — neither
 * real data nor enough rows for a 20-year crediting period, so this
 * replaces them rather than stretching them.
 *
 * Baseline/project/leakage/net-reduction/net-removal columns are left as
 * an explicit [NEEDS: ...] marker, per Nitzan's own instruction: this
 * project has exactly one real number per year so far — the founder's
 * own draft total — not a modeled breakdown, and inventing a breakdown
 * just to make a row look "complete" is exactly the fabrication this
 * build refuses to do (the same mistake already found and fixed once
 * this project, in the GHG numbers a drafting pass invented outright).
 */
function fillGhgReductionsTable(xml: string, anchorText: string, rows: GhgReductionRow[]): string {
  const anchorIdx = looseTextIndex(xml, anchorText);
  if (anchorIdx === -1) return xml;
  const tblStart = xml.indexOf("<w:tbl>", anchorIdx);
  if (tblStart === -1) return xml;
  const tblEnd = xml.indexOf("</w:tbl>", tblStart) + "</w:tbl>".length;
  const tbl = xml.slice(tblStart, tblEnd);

  const allRows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);
  if (!allRows || allRows.length < 2) return xml; // not the shape this was built against — leave untouched rather than guess

  const headerRow = allRows[0];
  const tblOpenTag = tbl.slice(0, tbl.indexOf(headerRow));
  const grandTotal = rows.reduce((sum, r) => sum + r.totalTco2e, 0);
  const dataRows = rows
    .map((r) =>
      ghgRowXml([
        r.startDisplay,
        r.endDisplay,
        GHG_PENDING,
        GHG_PENDING,
        GHG_PENDING,
        GHG_PENDING,
        GHG_PENDING,
        formatTco2e(r.totalTco2e),
      ]),
    )
    .join("");
  const totalRow = ghgRowXml(["Total", "", "", "", "", "", "", formatTco2e(grandTotal)]);
  const newTbl = tblOpenTag + headerRow + dataRows + totalRow + "</w:tbl>";

  return xml.slice(0, tblStart) + newTbl + xml.slice(tblEnd);
}

/** Adds one plain paragraph right after a table — pure addition, never a rewrite of what Verra already has there. */
function insertParagraphAfterTable(xml: string, anchorText: string, paragraphText: string): string {
  const anchorIdx = looseTextIndex(xml, anchorText);
  if (anchorIdx === -1) return xml;
  const tblStart = xml.indexOf("<w:tbl>", anchorIdx);
  if (tblStart === -1) return xml;
  const tblEnd = xml.indexOf("</w:tbl>", tblStart) + "</w:tbl>".length;
  return xml.slice(0, tblEnd) + runsForLine(paragraphText, true) + xml.slice(tblEnd);
}

/**
 * Runs once on the fully assembled document. Several kinds of fix live
 * here because all of them need the WHOLE document string, not one
 * chunk: the Additionality "Method applied" cell (its run-fragmented
 * guidance text can't be matched any other way — see below), the Project
 * Proponent / Other Entities tables (their real <w:tbl> spans multiple
 * chunks, opening on the heading chunk and closing several chunks
 * later, so a single chunk never holds the whole table to parse rows
 * from), and the two Eligibility checkbox fixes below (each needs to see
 * past its own chunk boundary to find its stop anchor). The front matter
 * carrying the TOC's own mentions of these headings is already gone by
 * this point (replaced by the cover page), so each heading text is
 * unique here even though it appears twice in the original template.
 */
function applyStructuralCellFixes(
  xml: string,
  orgProfile: OrgProfileFacts | null,
  ghgReductions: GhgReductionRow[] | null,
): string {
  let out = xml.replace(
    /(Method applied<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc>(?:(?!<\/w:tc>)[\s\S])*?<\/w:pPr>)[\s\S]*?(<\/w:p><\/w:tc><\/w:tr><\/w:tbl>)/,
    (_m, before, after) =>
      `${before}<w:r><w:t xml:space="preserve">Project method (VM0042 v2.2 §7): regulatory surplus, barrier analysis (VT0008 Step 2), and common-practice assessment (VT0008)</w:t></w:r>${after}`,
  );

  if (orgProfile) {
    out = fillTableAfterAnchor(out, ">Project Proponent<", {
      "Organization name": orgProfile.legalName,
      "Contact person": orgProfile.contactName,
      Title: orgProfile.contactTitle,
      Address: orgProfile.address,
      Telephone: orgProfile.contactPhone,
      Email: orgProfile.contactEmail,
    });
  }
  // No other entities exist for this project (Nitzan's own default,
  // recorded in the questionnaire) — the table stays, its rows just say
  // so plainly rather than being left with Verra's blank prompts.
  out = fillTableAfterAnchor(out, ">Other Entities Involved in the Project<", {
    "Organization name": "N/A — no entities other than the Project Proponent",
    "Role in the project": "N/A",
    "Contact person": "N/A",
    Title: "N/A",
    Address: "N/A",
    Telephone: "N/A",
    Email: "N/A",
  });

  // VM0042 (Improved Agricultural Land Management) and VT0008 carry no
  // capacity-limit provision — that concept applies to methodologies
  // like grid-connected energy ones, not AFOLU. Verra's own instruction
  // for this gate question is explicit: "If answering no, delete the
  // rest of this section" — the five dependent sub-questions this build
  // deliberately leaves untouched rather than deleting, since deleting
  // paragraphs and their tables is exactly the risky move that caused
  // the earlier structural-corruption incident this file's tables policy
  // exists to prevent.
  out = flipSecondCheckboxAfterAnchor(out, "Capacity Limit Eligibility");

  // Eligibility of Projects Registered with Other GHG Programs (section
  // 7) needs no equivalent insertion here: its own checkbox paragraphs
  // now survive via forceKeepCheckboxParagraph above, and this project's
  // real, human-confirmed answer (mrv.pdd_section_status, status
  // 'answered') already states plainly that no other GHG program
  // registration exists — that drafted prose renders at the end of the
  // section on its own, nothing to add or guess here.

  if (ghgReductions && ghgReductions.length) {
    const anchor = "Summary of Estimated Reductions and Removals";
    out = fillGhgReductionsTable(out, anchor, ghgReductions);
    const extrapolatedCount = ghgReductions.filter((r) => r.extrapolated).length;
    const givenCount = ghgReductions.length - extrapolatedCount;
    const note = extrapolatedCount
      ? `Note: the first ${givenCount} vintage years above (through ${ghgReductions[givenCount - 1]?.endDisplay}) are the Project Proponent's own draft estimates. The remaining ${extrapolatedCount} years continue at the last given rate (${formatTco2e(ghgReductions.find((r) => r.extrapolated)?.totalTco2e ?? 0)} tCO2e/yr) as a placeholder pending a VM0042 model run. Baseline, project, leakage, and net reduction/removal breakdowns are not yet separately estimated. All figures here are preliminary and will be superseded once GHG modelling is complete.`
      : `Note: these are the Project Proponent's own draft estimates. Baseline, project, leakage, and net reduction/removal breakdowns are not yet separately estimated. All figures here are preliminary and will be superseded once GHG modelling is complete.`;
    out = insertParagraphAfterTable(out, anchor, note);
  }

  return out;
}

/**
 * Word bookmarks (`<w:bookmarkStart>`/`<w:bookmarkEnd>`, id-paired) are used
 * throughout Verra's real template for internal cross-references inside the
 * guidance text this build now drops section by section — dropping a
 * paragraph that opens or closes a bookmark whose partner survives
 * elsewhere leaves an unpaired id, which is invalid OOXML: Word tolerates
 * it silently, but Google Drive's docx-to-Doc converter rejects the whole
 * upload with a bare 400 (confirmed live — 164 balanced pairs in the
 * template, 5 unmatched starts and 9 unmatched ends after a real section
 * strip). A dropped bookmark's target is guidance text nobody reads in the
 * filled document anyway, so the fix is simply: any id missing its partner
 * loses its other half too.
 */
function stripOrphanedBookmarks(xml: string): string {
  const starts = new Set([...xml.matchAll(/<w:bookmarkStart[^>]*\sw:id="(\d+)"[^>]*\/>/g)].map((m) => m[1]));
  const ends = new Set([...xml.matchAll(/<w:bookmarkEnd[^>]*\sw:id="(\d+)"[^>]*\/>/g)].map((m) => m[1]));
  return xml
    .replace(/<w:bookmarkStart[^>]*\sw:id="(\d+)"[^>]*\/>/g, (full, id) => (ends.has(id) ? full : ""))
    .replace(/<w:bookmarkEnd[^>]*\sw:id="(\d+)"[^>]*\/>/g, (full, id) => (starts.has(id) ? full : ""));
}

/** PNG header: width/height are big-endian uint32 at fixed offsets (IHDR always comes first). */
function pngDimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Next unused numeric rId in a document.xml.rels — so a new relationship can't collide with an existing one. */
function nextRelationshipId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function buildDrawingXml(relId: string, widthEmu: number, heightEmu: number, docPrId: number, name: string): string {
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}" /><wp:effectExtent l="0" t="0" r="0" b="0" />` +
    `<wp:docPr id="${docPrId}" name="${escapeXml(name)}" />` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" /></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapeXml(name)}" /><pic:cNvPicPr /></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}" /><a:stretch><a:fillRect /></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0" /><a:ext cx="${widthEmu}" cy="${heightEmu}" /></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst /></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

function tableCell(text: string, opts: { navy?: boolean; widthDxa: number }): string {
  const shd = opts.navy ? `<w:shd w:val="clear" w:fill="1F3864" />` : "";
  const rPr = opts.navy ? `<w:rPr><w:b/><w:color w:val="FFFFFF" /></w:rPr>` : "";
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${opts.widthDxa}" w:type="dxa" />${shd}</w:tcPr>` +
    `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

function tableRow(label: string, value: string): string {
  return `<w:tr>${tableCell(label, { navy: true, widthDxa: 2500 })}${tableCell(value, { widthDxa: 6800 })}</w:tr>`;
}

function buildMetadataTableXml(facts: CoverPageFacts): string {
  const requestLines = REQUEST_TYPES.map(
    (label, i) => `${facts.requestTypeChecked === i ? "☒" : "☐"} ${label}`,
  ).join("\n");
  const requestValueCell =
    `<w:tc><w:tcPr><w:tcW w:w="6800" w:type="dxa" /></w:tcPr>${paragraphsFor(requestLines, false)}</w:tc>`;
  const requestRow = `<w:tr>${tableCell("Request type", { navy: true, widthDxa: 2500 })}${requestValueCell}</w:tr>`;

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9300" w:type="dxa" /><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="D9D9D9" /><w:left w:val="single" w:sz="4" w:color="D9D9D9" />` +
    `<w:bottom w:val="single" w:sz="4" w:color="D9D9D9" /><w:right w:val="single" w:sz="4" w:color="D9D9D9" />` +
    `<w:insideH w:val="single" w:sz="4" w:color="D9D9D9" /><w:insideV w:val="single" w:sz="4" w:color="D9D9D9" />` +
    `</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2500" /><w:gridCol w:w="6800" /></w:tblGrid>` +
    tableRow("Project name", facts.projectName) +
    tableRow("Project ID", facts.projectIdDisplay) +
    tableRow("Crediting period start", facts.creditingStartDisplay) +
    tableRow("Crediting period end", facts.creditingEndDisplay) +
    tableRow("Document completion date", facts.documentCompletionDateDisplay) +
    tableRow("Document version", facts.documentVersion) +
    requestRow +
    `</w:tbl>`
  );
}

export async function buildPddDocxFromTemplate(
  templateBuffer: Buffer,
  sectionFills: Map<number, SectionFill>,
  annexTitle: string,
  annexBodyText: string,
  coverPage: CoverPageFacts,
  orgProfile: OrgProfileFacts | null = null,
  ghgReductions: GhgReductionRow[] | null = null,
): Promise<Buffer> {
  const entries = readZip(templateBuffer);
  const docEntry = entries.find((e) => e.name === "word/document.xml");
  if (!docEntry) throw new Error("buildPddDocxFromTemplate: word/document.xml not found in the template.");
  const xml = docEntry.data.toString("utf8");

  const relsEntry = entries.find((e) => e.name === "word/_rels/document.xml.rels");
  if (!relsEntry) throw new Error("buildPddDocxFromTemplate: word/_rels/document.xml.rels not found in the template.");
  const relsXml = relsEntry.data.toString("utf8");

  // chunks[0] is everything before the first <w:p (namespace decls, body open
  // tag). chunks[1..] each start with one paragraph's own <w:p ...> — except
  // the LAST chunk, which also carries whatever follows the final paragraph
  // (a trailing <w:sectPr>, </w:body>, </w:document>) glued onto its end,
  // since that content is not itself a <w:p> and so never starts a new split.
  const chunks = xml.split(/(?=<w:p[ >])/);

  // Find where the real content starts (the first Heading1/Title paragraph —
  // "1 Project Details") and capture Verra's own logo paragraph along the
  // way, so it can be reused verbatim on the new title page.
  let firstHeadingIdx = -1;
  let vcsLogoParagraphXml = "";
  for (let i = 1; i < chunks.length; i++) {
    const styleMatch = chunks[i].match(/<w:pStyle w:val="([^"]+)"\s*\/>/);
    if (headingLevel(styleMatch?.[1] ?? null) !== null) {
      firstHeadingIdx = i;
      break;
    }
    if (!vcsLogoParagraphXml && /<w:drawing>/.test(chunks[i])) vcsLogoParagraphXml = chunks[i];
  }
  if (firstHeadingIdx === -1) {
    throw new Error("buildPddDocxFromTemplate: no heading found in the template — cannot locate where the front matter ends.");
  }
  if (!vcsLogoParagraphXml) {
    throw new Error("buildPddDocxFromTemplate: no logo image found in the template's front matter to reuse.");
  }
  // Drop bookmarkStart/End tied to the front matter's own Table of Contents
  // fields — those fields are being deleted along with the rest of the
  // front matter, so their bookmark targets would otherwise be orphaned.
  vcsLogoParagraphXml = vcsLogoParagraphXml.replace(/<w:bookmarkStart[^>]*\/>|<w:bookmarkEnd[^>]*\/>/g, "");

  const logoRelId = nextRelationshipId(relsXml);
  const logoDims = pngDimensions(coverPage.logoPngBuffer);
  const logoWidthEmu = 2743200; // 3 inches
  const logoHeightEmu = Math.round(logoWidthEmu * (logoDims.height / logoDims.width));
  const carboNatureLogoDrawing = buildDrawingXml(logoRelId, logoWidthEmu, logoHeightEmu, 9001, "CarboNature logo");

  const coverPageXml =
    vcsLogoParagraphXml +
    `<w:p />` +
    `<w:p><w:pPr><w:pStyle w:val="TemplateTitle" /></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(coverPage.projectName)}</w:t></w:r></w:p>` +
    `<w:p />` +
    `<w:p><w:pPr><w:jc w:val="center" /></w:pPr><w:r>${carboNatureLogoDrawing}</w:r></w:p>` +
    `<w:p />` +
    buildMetadataTableXml(coverPage) +
    `<w:p />`;

  // Every real Verra table stays — Nitzan's own instruction after seeing
  // tables vanish and page layout break in the generated doc: the
  // template's structure must stay identical to the original, whether or
  // not a section has a real answer yet. Only plain instructional
  // paragraphs (no table) are ever dropped now. A table's opening
  // <w:tbl>/<w:tr>/<w:tc> tags land wherever the split fell right before
  // it (often glued onto a heading chunk), so this first pass marks the
  // table's *entire* span — open chunk through close chunk — as kept,
  // before the real pass decides anything; a table cannot straddle a
  // heading, so each span is self-contained.
  const forceKeepTableSpan = new Array<boolean>(chunks.length).fill(false);
  {
    let depth = 0;
    let spanStart = -1;
    for (let i = firstHeadingIdx; i < chunks.length; i++) {
      const chunk = chunks[i];
      const tblOpens = (chunk.match(/<w:tbl>/g) ?? []).length;
      const tblCloses = (chunk.match(/<\/w:tbl>/g) ?? []).length;
      if (depth === 0 && tblOpens > tblCloses) spanStart = i;
      depth = Math.max(0, depth + tblOpens - tblCloses);
      if (depth === 0 && spanStart !== -1) {
        for (let j = spanStart; j <= i; j++) forceKeepTableSpan[j] = true;
        spanStart = -1;
      }
    }
  }

  // A real Word checkbox control (`<w14:checkbox>`) is a form field, not
  // disposable guidance text — confirmed live as the actual root cause
  // behind "Rebeka never marks the Eligibility checkboxes": those
  // checkboxes sit in bare paragraphs, not inside a `<w:tbl>`, so before
  // this they were being wiped along with ordinary guidance prose the
  // moment a section had any fill at all — drafted text replaced them
  // outright rather than sitting alongside them. One drafted section
  // (Capacity Limit Eligibility) even shows the model writing out its
  // own fake "☒ No" inside plain prose, the closest it could get without
  // a real control to act on. Keeping every checkbox paragraph, exactly
  // like every table, fixes that at the root instead of per section.
  const forceKeepCheckboxParagraph = new Array<boolean>(chunks.length).fill(false);
  for (let i = firstHeadingIdx; i < chunks.length; i++) {
    if (chunks[i].includes("<w14:checkbox>")) forceKeepCheckboxParagraph[i] = true;
  }
  // A checkbox with no question above it reads as noise — Verra's own
  // template always puts the question in the plain paragraph directly
  // before the checkbox paragraph, so keeping exactly that one neighbor
  // (from a snapshot, not the growing array, so this adds one sentence
  // per checkbox rather than cascading back through the whole section)
  // restores "question, then its answer" instead of a bare run of boxes.
  const checkboxChunkSnapshot = forceKeepCheckboxParagraph.slice();
  for (let i = firstHeadingIdx + 1; i < chunks.length; i++) {
    if (checkboxChunkSnapshot[i] && !forceKeepTableSpan[i - 1]) forceKeepCheckboxParagraph[i - 1] = true;
  }

  let sectionIndex = -1;
  const out: string[] = [chunks[0], coverPageXml];
  let pendingInject: string | null = null;

  const flushPending = () => {
    if (pendingInject) {
      out.push(pendingInject);
      pendingInject = null;
    }
  };

  for (let i = firstHeadingIdx; i < chunks.length; i++) {
    const chunk = chunks[i];
    const styleMatch = chunk.match(/<w:pStyle w:val="([^"]+)"\s*\/>/);
    const level = headingLevel(styleMatch?.[1] ?? null);
    // A mid-body <w:sectPr> is a section-break marker (Verra's template
    // uses these for landscape tables) — dropping it desyncs the
    // document's section count from its own header/footer references,
    // which OOXML validators (Google Drive's docx importer, confirmed
    // live) reject outright. Keep the whole paragraph even though it is
    // not a heading; the section break matters, the handful of guidance
    // sentences that occasionally ride along with it are a rare, minor
    // trade-off against corrupting the file.
    const carriesSectionBreak = /<w:sectPr[ >]/.test(chunk);
    const carriesTable = forceKeepTableSpan[i];
    const carriesCheckbox = forceKeepCheckboxParagraph[i];

    if (level !== null) {
      // A new section starts here — emit whatever was queued for the
      // section that just ended (i.e. right before its next heading).
      flushPending();
      sectionIndex++;
      pendingInject = fillParagraphsXml(sectionFills.get(sectionIndex));
    }

    // The last chunk carries trailing non-paragraph XML after its own
    // </w:p> (typically a body-level <w:sectPr>...). Split that off so
    // the pending injection — and the new Annex section — land before
    // it, not after </w:body>.
    if (i === chunks.length - 1) {
      const sectPrIdx = chunk.indexOf("<w:sectPr");
      const bodyCloseIdx = chunk.indexOf("</w:body>");
      const cut = sectPrIdx !== -1 ? sectPrIdx : bodyCloseIdx !== -1 ? bodyCloseIdx : chunk.length;
      // A heading is kept verbatim; a guidance chunk (level === null) is
      // dropped unless it carries a section break or sits inside a table
      // that must stay whole — its replacement is whatever flushPending()
      // emits next. A table chunk also gets its known placeholder cells
      // replaced with real values before being kept.
      const fixedHead = carriesTable ? applyTableCellFixes(chunk.slice(0, cut), sectionIndex, coverPage) : chunk.slice(0, cut);
      if (level !== null || carriesSectionBreak || carriesTable || carriesCheckbox) out.push(fixedHead);
      flushPending();
      const annexHeading = `<w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>${escapeXml(annexTitle)}</w:t></w:r></w:p>`;
      out.push(annexHeading, paragraphsFor(annexBodyText, false));
      out.push(chunk.slice(cut));
    } else if (carriesTable) {
      out.push(applyTableCellFixes(chunk, sectionIndex, coverPage));
    } else if (level !== null || carriesSectionBreak || carriesCheckbox) {
      out.push(chunk);
    }
    // else: a guidance/table chunk belonging to the current section —
    // dropped, not forwarded. Its replacement is queued in pendingInject
    // and lands when the next heading triggers flushPending().
  }

  const newDocXml = applyStructuralCellFixes(stripOrphanedBookmarks(out.join("")), orgProfile, ghgReductions);
  const newRelsXml = relsXml.replace(
    "</Relationships>",
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/carbonature-logo.png" Id="${logoRelId}" /></Relationships>`,
  );

  const newEntries = entries
    .map((e) => {
      if (e.name === "word/document.xml") return { name: e.name, data: Buffer.from(newDocXml, "utf8") };
      if (e.name === "word/_rels/document.xml.rels") return { name: e.name, data: Buffer.from(newRelsXml, "utf8") };
      return e;
    })
    .concat([{ name: "word/media/carbonature-logo.png", data: coverPage.logoPngBuffer }]);

  return createZip(newEntries);
}

/** Pulls the "# Annex A — ..." section out of generatePddDraft's own content string, dropping the leading '#'. */
export function extractAnnexSection(content: string): { title: string; body: string } {
  const idx = content.indexOf("# Annex A");
  if (idx === -1) return { title: "Annex A — Verified Project Facts", body: content };
  const section = content.slice(idx);
  const firstLineEnd = section.indexOf("\n");
  const title = section.slice(2, firstLineEnd).trim();
  const body = section.slice(firstLineEnd + 1).trim();
  return { title, body };
}
