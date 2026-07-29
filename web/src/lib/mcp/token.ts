import { createHash, randomBytes } from "node:crypto";

/**
 * MCP sampler-token policy (spec §6.5, §9).
 *
 * A work order's token is the external contractor's only way in — they have
 * no SSO account. Three properties matter and are enforced here rather than
 * left to the caller:
 *
 *   scope    one work order and its sampling points, nothing else
 *   expiry   end of the sampling window + GRACE_DAYS (v2.0: 14, was 7)
 *   secrecy  only the SHA-256 hash is ever stored; the raw token is shown
 *            once, at issue, and cannot be recovered afterwards
 */

/** Days after the sampling window closes that the token stays valid. */
export const DEFAULT_GRACE_DAYS = 14;

/** Bytes of entropy in a raw token (32 -> 43 chars base64url). */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Shown once to the issuer, then discarded — never persisted. */
  rawToken: string;
  /** What goes in mrv.mcp_tokens.token_hash. */
  tokenHash: string;
  expiresAt: Date;
  /** The URL handed to the contractor. */
  url: string;
}

/** Hash a raw token the one way the database stores it. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Expiry for a sampling window. Grace is configurable per work order; the
 * default is the spec's 14 days. Computed at end-of-day UTC so a token never
 * dies mid-way through its last field day.
 */
export function tokenExpiry(windowEnd: Date | string, graceDays = DEFAULT_GRACE_DAYS): Date {
  const end = typeof windowEnd === "string" ? new Date(windowEnd) : windowEnd;
  const out = new Date(end);
  out.setUTCDate(out.getUTCDate() + graceDays);
  out.setUTCHours(23, 59, 59, 0);
  return out;
}

/**
 * Mint a token for a work order. Returns the raw token exactly once; the
 * caller persists only `tokenHash`.
 */
export function issueToken(
  woId: string,
  windowEnd: Date | string,
  graceDays = DEFAULT_GRACE_DAYS,
  baseUrl = "https://sampler.carbonature.io",
): IssuedToken {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: tokenExpiry(windowEnd, graceDays),
    url: `${baseUrl}/wo/${woId}?token=${rawToken}`,
  };
}

export type TokenState = "active" | "expired" | "revoked";

/** Current state of an issued token. Revocation beats expiry. */
export function tokenState(t: {
  expiresAt: string | Date;
  revokedAt: string | Date | null;
}, now: Date = new Date()): TokenState {
  if (t.revokedAt) return "revoked";
  const exp = typeof t.expiresAt === "string" ? new Date(t.expiresAt) : t.expiresAt;
  return exp.getTime() > now.getTime() ? "active" : "expired";
}

/** Whole days until expiry; negative once past. */
export function daysUntil(expiresAt: string | Date, now: Date = new Date()): number {
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Math.ceil((exp.getTime() - now.getTime()) / 86_400_000);
}

/* ── work-order state machine (spec §6.5) ───────────────────────────── */

export const WO_STATES = ["draft", "sent", "in_progress", "completed", "closed"] as const;
export type WoState = (typeof WO_STATES)[number];

const NEXT: Record<WoState, WoState[]> = {
  draft: ["sent"],
  sent: ["in_progress"],
  in_progress: ["completed"],
  completed: ["closed"],
  closed: [],
};

/** Whether a transition is legal. Every accepted move is audit-logged. */
export function canTransition(from: WoState, to: WoState): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

export function nextStates(from: WoState): WoState[] {
  return NEXT[from] ?? [];
}
