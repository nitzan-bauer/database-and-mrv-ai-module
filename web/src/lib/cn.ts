/** Join class names, dropping falsy values. Mirrors the SaaS helper. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
