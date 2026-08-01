import zlib from "node:zlib";

/**
 * A minimal zip reader, shared by every OOXML parser in this directory.
 *
 * .xlsx and .docx are both zip archives of XML parts, and reading one
 * without a library is exactly the same problem twice: walk the central
 * directory, locate each part's local header, inflate it if it is
 * compressed. Originally written for the SOC datasheet reader; the PDD
 * template reader needs the identical zip layer over different XML.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid zip-based Office file (no zip directory).");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
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

    let data: Buffer;
    try {
      data = method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch {
      data = Buffer.alloc(0);
    }
    out.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
