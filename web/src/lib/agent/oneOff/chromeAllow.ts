// Pure module (no server-only, no aliases) — shared by the form, the tool and the PC worker's own re-check.

export const MAX_CHROME_DOMAINS = 10;

export function normalizeDomains(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    let s = r.trim().toLowerCase();
    if (!s) continue;
    try {
      s = new URL(s.includes("://") ? s : `https://${s}`).hostname;
    } catch {
      continue;
    }
    s = s.replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_CHROME_DOMAINS) break;
  }
  return out;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}
