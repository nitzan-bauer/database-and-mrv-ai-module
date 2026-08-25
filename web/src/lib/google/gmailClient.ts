import "server-only";

/**
 * Real Gmail API v1 calls, readonly scope only, over the same person's own
 * OAuth session as driveClient.ts. Ported from the carbonature-crm repo's
 * gmail.ts (live-tested there against a real inbox, 2026-08-08), trimmed to
 * what Jennifer's correspondence visibility actually needs — no lead
 * matching, since that concept lives in the CRM schema, not mrv's.
 */

export interface GmailMessageSummary {
  gmailId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
}

function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

function extractName(fromHeader: string): string | null {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  const name = match ? match[1].trim() : null;
  return name && name.length > 0 ? name : null;
}

/**
 * List recent inbox messages — messages.list (id only) then messages.get
 * with format=metadata per id (developers.google.com/gmail/api/reference/rest).
 */
export async function listRecentInboxMessages(accessToken: string, maxResults = 15): Promise<GmailMessageSummary[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => "");
    throw new Error(`Gmail messages.list returned ${listRes.status}: ${body}`);
  }
  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (listData.messages ?? []).map((m) => m.id);

  const summaries: GmailMessageSummary[] = [];
  for (const id of ids) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) continue; // one bad message shouldn't fail the whole list
    const data = (await res.json()) as {
      id: string;
      snippet?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const headers = data.payload?.headers ?? [];
    const from = headers.find((h) => h.name === "From")?.value;
    const subject = headers.find((h) => h.name === "Subject")?.value ?? null;
    const dateHeader = headers.find((h) => h.name === "Date")?.value;

    if (!from) continue;
    summaries.push({
      gmailId: data.id,
      fromEmail: extractEmail(from),
      fromName: extractName(from),
      subject,
      snippet: data.snippet ?? null,
      receivedAt: dateHeader ? new Date(dateHeader).toISOString() : null,
    });
  }
  return summaries;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RFC 2047 encoded-word for header fields — headers are 7-bit ASCII only,
 * so a plain UTF-8 em dash or Hebrew character sitting directly in a
 * Subject: line renders as mojibake in the inbox (confirmed directly:
 * "—" came through as "Ã¢Â€Â"" the first time this shipped without it).
 * ASCII-only subjects pass through unchanged rather than being wrapped
 * for no reason.
 */
function encodeHeaderText(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/**
 * Send a real email, with an optional attachment (the PDD Generator
 * pipeline's own "email me the PDF" step). Builds a minimal RFC 2822
 * multipart/mixed message by hand — one text part plus one attachment
 * part — rather than pulling in a MIME-building library for a shape
 * this simple.
 */
export async function sendGmailMessage(
  accessToken: string,
  input: {
    to: string;
    subject: string;
    bodyText: string;
    attachment?: { fileName: string; mimeType: string; content: Buffer };
    /**
     * Send as this address instead of the account's own primary address —
     * only takes effect if it's a verified "send mail as" alias on the
     * authenticated account (see agentEmailAliases.ts); otherwise Gmail
     * silently rewrites this back to the primary address rather than
     * erroring, so a missing alias fails safe, not loud.
     */
    from?: string;
  },
): Promise<{ id: string }> {
  const boundary = "mrv-mime-" + Math.random().toString(36).slice(2);
  const parts: string[] = [
    ...(input.from ? [`From: ${input.from}`] : []),
    `To: ${input.to}`,
    `Subject: ${encodeHeaderText(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.bodyText,
    "",
  ];
  let raw: Buffer;
  if (input.attachment) {
    const headerBuf = Buffer.from(
      parts.join("\r\n") +
        `--${boundary}\r\n` +
        `Content-Type: ${input.attachment.mimeType}; name="${input.attachment.fileName}"\r\n` +
        `Content-Disposition: attachment; filename="${input.attachment.fileName}"\r\n` +
        "Content-Transfer-Encoding: base64\r\n\r\n",
      "utf8",
    );
    raw = Buffer.concat([
      headerBuf,
      Buffer.from(input.attachment.content.toString("base64").replace(/(.{76})/g, "$1\r\n"), "utf8"),
      Buffer.from(`\r\n--${boundary}--`, "utf8"),
    ]);
  } else {
    raw = Buffer.from(parts.join("\r\n") + `--${boundary}--`, "utf8");
  }

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: base64Url(raw) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail messages.send returned ${res.status}: ${body}`);
  }
  return (await res.json()) as { id: string };
}
