import { readZip, unescapeXml } from "./zip";

/**
 * A small .docx reader — enough to recover a document's section outline
 * without pulling in a Word-processing library. Built for one job: reading
 * Verra's project-description template so its structure can be stored as
 * data (see registerPddTemplate) rather than typed into agent code, because
 * the template itself changes — per project, and whenever Verra revises it.
 *
 * Deliberately narrow, matching xlsx.ts's approach to the SOC datasheet:
 * paragraph text and heading level, nothing about formatting, tables, or
 * images. A PDD-writing skill needs to know what sections exist and what
 * each one instructs; it does not need the document's typography.
 */

export interface DocxParagraph {
  /** Concatenated run text, in document order. */
  text: string;
  /** 1 for Heading1/Title, 2 for Heading2, etc. Null for body text. */
  headingLevel: number | null;
}

function headingLevel(styleId: string | null): number | null {
  if (!styleId) return null;
  if (/^title$/i.test(styleId)) return 1;
  const m = styleId.match(/^Heading(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/** Every paragraph in document order, each tagged with its heading level if any. */
export function readParagraphs(buf: Buffer): DocxParagraph[] {
  const zip = readZip(buf);
  const xml = zip.find((e) => e.name === "word/document.xml")?.data.toString("utf8");
  if (!xml) throw new Error("Not a valid .docx file (word/document.xml is missing).");

  const out: DocxParagraph[] = [];
  // Split on paragraph boundaries. w:p elements do not nest in the body, so
  // this is safe for the structural read this module exists to do.
  for (const p of xml.split(/(?=<w:p[ >])/).slice(1)) {
    const styleMatch = p.match(/<w:pStyle w:val="([^"]+)"\s*\/>/);

    // <w:t(?:\s[^>]*)?> requires a word boundary after "w:t" — without it,
    // this matches the opening of <w:tab/> too (both start "<w:t"), which
    // then reads as an unclosed <w:t> and swallows every tag up to the next
    // real </w:t>, splicing raw XML into the text. A run's <w:t> can also
    // self-close when empty (<w:t/>), contributing nothing; the alternation
    // below matches that case with no capture group rather than letting it
    // fall through to the same trap.
    const text = [
      ...p.matchAll(/<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
    ]
      .map((m) => unescapeXml(m[1] ?? ""))
      .join("");
    if (!text.trim()) continue;
    out.push({ text: text.trim(), headingLevel: headingLevel(styleMatch?.[1] ?? null) });
  }
  return out;
}

export interface TemplateSection {
  level: number;
  title: string;
  /** Body/instruction text between this heading and the next one at any level. */
  body: string;
}

/**
 * The document as an ordered list of sections. Each heading starts a
 * section; every non-heading paragraph until the next heading becomes that
 * section's body. Nesting is recoverable from `level` — a level-2 section
 * belongs to the nearest preceding level-1 — without needing a tree here,
 * since the consumer (a PDD-writing skill walking section by section) reads
 * the list in order regardless of depth.
 *
 * Text before the first heading (a cover page, a table of contents) is
 * dropped: it is not a section a PDD response gets written into.
 */
export function extractOutline(buf: Buffer): TemplateSection[] {
  const paras = readParagraphs(buf);
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;

  for (const p of paras) {
    if (p.headingLevel) {
      current = { level: p.headingLevel, title: p.text, body: "" };
      sections.push(current);
    } else if (current) {
      current.body = current.body ? `${current.body}\n${p.text}` : p.text;
    }
  }
  return sections;
}
