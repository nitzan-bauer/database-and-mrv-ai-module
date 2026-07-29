import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { parseSocDatasheet } from "@/lib/ingest/socDatasheet";

/**
 * Parse an uploaded SOC datasheet and return what would be written (spec §8).
 *
 * Parsing is separated from committing on purpose: the operator sees the
 * accepted rows, the quarantined ones with reasons, and every disagreement
 * with the workbook's own figures *before* anything reaches the evidence
 * tables, which are append-only and cannot be tidied up afterwards.
 */
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1e6).toFixed(1)} MB; the limit is 10 MB.` },
      { status: 413 },
    );
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Expected the .xlsx datasheet the laboratory returns." },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // The raw file is kept for audit; its hash is what proves it never changed.
  const sha256 = createHash("sha256").update(buf).digest("hex");

  try {
    const parsed = parseSocDatasheet(buf);
    return NextResponse.json({
      fileName: file.name,
      sizeBytes: file.size,
      sha256,
      ...parsed,
      parserStatus:
        parsed.quarantined.length === 0
          ? "success"
          : parsed.rows.length === 0
            ? "quarantined"
            : "partial",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read the workbook." },
      { status: 422 },
    );
  }
}
