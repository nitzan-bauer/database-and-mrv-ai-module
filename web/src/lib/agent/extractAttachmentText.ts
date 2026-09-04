"use server";

/**
 * Turns a file attached to an "Ask <Agent>" chat turn into plain text that
 * can be folded into the task string — the only thing runAgentTask's
 * userMessage actually accepts. Runs server-side (not FileReader.readAsText
 * in the browser) specifically so real office formats work: a .docx/.xlsx is
 * a zip of XML, and a .pdf's content stream is compressed and font-encoded —
 * reading either as browser text produces binary noise, not content. This
 * reuses the exact same extractors ingestRelatedPddPrecedents.ts and the SOC
 * datasheet importer already rely on, rather than adding a second reader.
 */

const MAX_ATTACHMENT_CHARS = 100_000;

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "csv", "tsv", "json", "md", "log", "yaml", "yml"]);

export interface ExtractedAttachment {
  text: string;
  truncated: boolean;
}

export type ExtractAttachmentResult =
  | { ok: true; data: ExtractedAttachment }
  | { ok: false; error: string };

function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export async function extractAttachmentText(input: {
  name: string;
  base64: string;
}): Promise<ExtractAttachmentResult> {
  const ext = extensionOf(input.name);
  let buf: Buffer;
  try {
    buf = Buffer.from(input.base64, "base64");
  } catch {
    return { ok: false, error: `Could not decode "${input.name}" — the upload looks corrupted.` };
  }

  try {
    let text: string;

    if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
      text = buf.toString("utf8");
    } else if (ext === "docx") {
      const { readParagraphs } = await import("../ingest/docx");
      text = readParagraphs(buf)
        .map((p) => (p.headingLevel ? `${"#".repeat(p.headingLevel)} ${p.text}` : p.text))
        .join("\n");
    } else if (ext === "xlsx") {
      const { readWorkbook } = await import("../ingest/xlsx");
      text = readWorkbook(buf)
        .map((sheet) => {
          const rows = sheet.rows.map((row) =>
            Object.keys(row.cells)
              .sort()
              .map((col) => row.cells[col])
              .join(", "),
          );
          return `# ${sheet.name}\n${rows.join("\n")}`;
        })
        .join("\n\n");
    } else if (ext === "pdf") {
      const { extractPdfText } = await import("../ingest/pdf");
      text = await extractPdfText(buf);
    } else {
      return {
        ok: false,
        error: `"${input.name}" is a .${ext || "?"} file — only .txt, .csv, .tsv, .json, .md, .log, .docx, .xlsx and .pdf can be read as text right now.`,
      };
    }

    text = text.trim();
    if (!text) {
      return { ok: false, error: `"${input.name}" produced no readable text (it may be empty, scanned, or image-only).` };
    }
    const truncated = text.length > MAX_ATTACHMENT_CHARS;
    return { ok: true, data: { text: truncated ? text.slice(0, MAX_ATTACHMENT_CHARS) : text, truncated } };
  } catch (e) {
    return { ok: false, error: `Could not read "${input.name}": ${e instanceof Error ? e.message : String(e)}` };
  }
}
