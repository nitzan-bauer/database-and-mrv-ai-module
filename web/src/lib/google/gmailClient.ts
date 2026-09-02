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

/**
 * Real Gmail search (messages.list?q=...) — unlike listRecentInboxMessages
 * (last N inbox messages, no filter), this targets a specific reply: a
 * scheduled task watching for one person's response to one sent email
 * needs precision, not "scan the last 15 and hope it's in there."
 * Gmail's own search syntax (from:, subject:, after:, in:inbox, ...)
 * applies directly to `query`.
 */
export async function searchGmailMessages(accessToken: string, query: string, maxResults = 10): Promise<GmailMessageSummary[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => "");
    throw new Error(`Gmail messages.list (search) returned ${listRes.status}: ${body}`);
  }
  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (listData.messages ?? []).map((m) => m.id);

  const summaries: GmailMessageSummary[] = [];
  for (const id of ids) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) continue;
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

/**
 * The full plain-text body of one message — messages.get?format=full,
 * walking `payload.parts` for the first text/plain part (falling back to
 * a top-level text/plain body for a non-multipart message). Needed
 * because GmailMessageSummary.snippet is Gmail's own truncated preview,
 * not enough to reliably parse "approved" vs. a proposed new day/time
 * out of a real reply.
 */
export async function getMessagePlainTextBody(accessToken: string, gmailId: string): Promise<string> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail messages.get (full) returned ${res.status}`);
  const data = (await res.json()) as {
    payload?: {
      mimeType?: string;
      body?: { data?: string };
      parts?: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[];
    };
  };

  function decode(b64url: string): string {
    return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  }

  function findPlainText(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined): string | null {
    if (!part) return null;
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
    for (const sub of (part.parts as typeof part[] | undefined) ?? []) {
      const found = findPlainText(sub);
      if (found) return found;
    }
    return null;
  }

  if (data.payload?.mimeType === "text/plain" && data.payload.body?.data) return decode(data.payload.body.data);
  return findPlainText(data.payload) ?? "";
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
 * Reads a "send as" address's own Settings → General signature (the exact
 * HTML shown in Gmail's UI, including whatever photo/branding is currently
 * configured there). Confirmed live 2026-09-02: `messages.send` never
 * applies this on its own — it is purely a compose-UI behavior — every
 * agent's signature has been sitting configured and untouched in Settings
 * the whole time, just never carried into any automated email. This is the
 * read half of the real fix: fetch it and embed it ourselves. GET on a
 * non-primary sendAs address needs no special scope beyond what's already
 * granted (`gmail.settings.basic`) — only *writing* one needs Workspace
 * domain-wide delegation (see project_mrv_agent_email_signatures memory).
 */
export async function getSendAsSignature(accessToken: string, sendAsEmail: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(sendAsEmail)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { signature?: string };
    const sig = data.signature?.trim();
    return sig && sig.length > 0 ? sig : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bodyTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#202124;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/**
 * Send a real email, with an optional attachment (the PDD Generator
 * pipeline's own "email me the PDF" step). Builds a minimal RFC 2822
 * message by hand rather than pulling in a MIME-building library for a
 * shape this simple: multipart/mixed(attachment + multipart/alternative(
 * text/plain, text/html-with-signature)) when a signature is found for
 * `from`, otherwise the original plain single-part behavior unchanged.
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
  const signatureHtml = input.from ? await getSendAsSignature(accessToken, input.from) : null;

  const headerLines = [
    ...(input.from ? [`From: ${input.from}`] : []),
    `To: ${input.to}`,
    `Subject: ${encodeHeaderText(input.subject)}`,
    "MIME-Version: 1.0",
  ];

  let raw: Buffer;

  if (!signatureHtml) {
    // Unchanged fallback — identical to the original implementation.
    const boundary = "mrv-mime-" + Math.random().toString(36).slice(2);
    const parts: string[] = [
      ...headerLines,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.bodyText,
      "",
    ];
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
  } else {
    const altBoundary = "mrv-alt-" + Math.random().toString(36).slice(2);
    const altBody =
      `--${altBoundary}\r\n` +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
      `${input.bodyText}\r\n\r\n` +
      `--${altBoundary}\r\n` +
      "Content-Type: text/html; charset=UTF-8\r\n\r\n" +
      `<div>${bodyTextToHtml(input.bodyText)}<br>${signatureHtml}</div>\r\n\r\n` +
      `--${altBoundary}--`;

    if (input.attachment) {
      const mixedBoundary = "mrv-mime-" + Math.random().toString(36).slice(2);
      const headerBuf = Buffer.from(
        headerLines.join("\r\n") +
          "\r\n" +
          `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n` +
          `--${mixedBoundary}\r\n` +
          `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
          altBody +
          "\r\n" +
          `--${mixedBoundary}\r\n` +
          `Content-Type: ${input.attachment.mimeType}; name="${input.attachment.fileName}"\r\n` +
          `Content-Disposition: attachment; filename="${input.attachment.fileName}"\r\n` +
          "Content-Transfer-Encoding: base64\r\n\r\n",
        "utf8",
      );
      raw = Buffer.concat([
        headerBuf,
        Buffer.from(input.attachment.content.toString("base64").replace(/(.{76})/g, "$1\r\n"), "utf8"),
        Buffer.from(`\r\n--${mixedBoundary}--`, "utf8"),
      ]);
    } else {
      raw = Buffer.from(
        headerLines.join("\r\n") + "\r\n" + `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` + altBody,
        "utf8",
      );
    }
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
