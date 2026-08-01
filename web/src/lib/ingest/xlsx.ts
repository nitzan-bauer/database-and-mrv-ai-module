import { readZip, unescapeXml } from "./zip";

/**
 * A small .xlsx reader — enough to read the SOC datasheet without pulling in
 * a spreadsheet library. An .xlsx is a zip of XML: we walk the central
 * directory, inflate the parts we need, and resolve shared strings.
 *
 * Deliberately narrow: cell values as strings, addressed by column letter.
 * Anything richer (styles, formulas, dates as serials) is handled by the
 * caller, which knows what each column means.
 */

/** One sheet as rows of {columnLetter: value}, plus its 1-based row numbers. */
export interface Sheet {
  name: string;
  rows: Array<{ r: number; cells: Record<string, string> }>;
}

export function readWorkbook(buf: Buffer): Sheet[] {
  const zip = readZip(buf);
  const text = (n: string) => zip.find((e) => e.name === n)?.data.toString("utf8") ?? "";

  // shared strings
  const shared: string[] = [];
  for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
  }

  const names = [...text("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(
    (m) => unescapeXml(m[1]),
  );

  const files = zip
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return files.map((f, i) => {
    const xml = f.data.toString("utf8");
    const rows: Sheet["rows"] = [];
    for (const r of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: Record<string, string> = {};
      for (const c of r[2].matchAll(
        /<c r="([A-Z]+)\d+"(?:[^>]*t="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g,
      )) {
        const col = c[1];
        let v = c[3] ?? c[4] ?? "";
        if (c[2] === "s") v = shared[Number(v)] ?? "";
        v = unescapeXml(String(v)).trim();
        if (v !== "") cells[col] = v;
      }
      if (Object.keys(cells).length) rows.push({ r: Number(r[1]), cells });
    }
    return { name: names[i] ?? f.name, rows };
  });
}

/**
 * Excel stores dates as a serial number of days since 1899-12-30. Returns an
 * ISO date, or the original string when it is already a date.
 */
export function excelDate(v: string | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
