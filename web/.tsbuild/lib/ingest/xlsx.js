import zlib from "node:zlib";
function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error("Not a valid .xlsx file (no zip directory).");
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const out = [];
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50)
            break;
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const localOff = buf.readUInt32LE(off + 42);
        const name = buf.subarray(off + 46, off + 46 + nameLen).toString();
        const lnLen = buf.readUInt16LE(localOff + 26);
        const leLen = buf.readUInt16LE(localOff + 28);
        const start = localOff + 30 + lnLen + leLen;
        const raw = buf.subarray(start, start + compSize);
        let data;
        try {
            data = method === 0 ? raw : zlib.inflateRawSync(raw);
        }
        catch {
            data = Buffer.alloc(0);
        }
        out.push({ name, data });
        off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}
const unescapeXml = (s) => s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
export function readWorkbook(buf) {
    const zip = readZip(buf);
    const text = (n) => zip.find((e) => e.name === n)?.data.toString("utf8") ?? "";
    // shared strings
    const shared = [];
    for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
    }
    const names = [...text("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => unescapeXml(m[1]));
    const files = zip
        .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return files.map((f, i) => {
        const xml = f.data.toString("utf8");
        const rows = [];
        for (const r of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
            const cells = {};
            for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g)) {
                const col = c[1];
                let v = c[3] ?? c[4] ?? "";
                if (c[2] === "s")
                    v = shared[Number(v)] ?? "";
                v = unescapeXml(String(v)).trim();
                if (v !== "")
                    cells[col] = v;
            }
            if (Object.keys(cells).length)
                rows.push({ r: Number(r[1]), cells });
        }
        return { name: names[i] ?? f.name, rows };
    });
}
/**
 * Excel stores dates as a serial number of days since 1899-12-30. Returns an
 * ISO date, or the original string when it is already a date.
 */
export function excelDate(v) {
    if (!v)
        return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(v))
        return v.slice(0, 10);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const ms = Math.round((n - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
