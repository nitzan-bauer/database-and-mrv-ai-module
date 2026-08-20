import "server-only";
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from "docx";
import type { GeneratedPddDraft } from "../tools/generatePddDraft";

/**
 * Turn generatePddDraft's plain-text/Markdown content into a real .docx —
 * not for its own sake, but because Google Drive's own .docx-to-Google-Doc
 * conversion (uploadAndConvertToGoogleDoc) reads real Word heading styles
 * and turns them into a real, properly structured Google Doc: headings
 * that appear in the outline, not literal "#" characters sitting in
 * plain text. Building a correct .docx here is what makes that
 * conversion produce something a person would recognise as a document
 * rather than a wall of Markdown.
 *
 * Parses the same '#'-prefixed heading convention generatePddDraft's
 * own content already uses (see generatePddDraft.ts's `lines.push`
 * calls) — this is the inverse of writing that convention, not a new
 * one invented here.
 */
export function buildPddDocx(draft: Pick<GeneratedPddDraft, "content">): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  for (const rawLine of draft.content.split("\n")) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingLevel =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : level === 3
              ? HeadingLevel.HEADING_3
              : level === 4
                ? HeadingLevel.HEADING_4
                : HeadingLevel.HEADING_5;
      paragraphs.push(new Paragraph({ text: headingMatch[2], heading: headingLevel }));
      continue;
    }
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    // Template guidance / placeholder lines (generatePddDraft's own
    // "> ..." and "_[...]_" conventions) rendered in italic, so they read
    // as instructions rather than as if they were the section's real
    // content once this lands in Google Docs.
    const isGuidance = /^>\s/.test(line) || /^_\[.*\]_$/.test(line) || /^_.*_$/.test(line);
    const text = line.replace(/^>\s/, "").replace(/^_(.*)_$/, "$1");
    paragraphs.push(new Paragraph({ children: [new TextRun({ text, italics: isGuidance })] }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  return Packer.toBuffer(doc);
}
