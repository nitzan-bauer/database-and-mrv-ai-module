import "server-only";

/**
 * Text extraction for real, issued PDD PDFs — the precedent documents a
 * PDD-writing skill benchmarks against. pdf-parse is a thin wrapper over
 * pdf.js's own text layer, so this stays a one-function module rather
 * than the hand-rolled reader docx.ts uses: unlike a .docx (plain zipped
 * XML, easy to walk by hand), a PDF's content stream is compressed and
 * font-encoded, and reimplementing that is not a good use of anyone's
 * time when a maintained, dependency-free-of-native-bindings library
 * already does it correctly.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  // Import the inner lib file, not the package root: pdf-parse's own
  // index.js runs `let isDebugMode = !module.parent` at import time and,
  // when true, synchronously reads its own test fixture off disk — which
  // throws under a dynamic import (module.parent is unset there) long
  // before any real PDF is touched. lib/pdf-parse.js is the same function
  // without that side effect.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const { text } = await pdfParse(buf);
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}
