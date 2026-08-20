import Image from "next/image";

/**
 * A real photo per agent — Nitzan's own spec: "draw human-like figures
 * with facial expression, like a human profile picture on a social-
 * network card," then, after seeing the first (hand-drawn SVG) attempt
 * read as the generic default-user silhouette every app uses for "no
 * photo set" rather than as a character: real, licensed headshots
 * (Adobe Stock, via the Adobe MCP), five distinct people, gendered
 * correctly against the real roster (John/Dave/Ron male, Rebeka/Jennifer
 * female) — not five recolors of one shape.
 */
const AVATAR_PHOTOS: Record<string, string> = {
  john: "/agents/avatar-john.png",
  rebeka: "/agents/avatar-rebeka.png",
  dave: "/agents/avatar-dave.png",
  ron: "/agents/avatar-ron.png",
  jennifer: "/agents/avatar-jennifer.png",
};

export function AgentAvatar({ agentId, hue, size = 40 }: { agentId: string; hue: number; size?: number }) {
  const photo = AVATAR_PHOTOS[agentId];
  if (photo) {
    return (
      <span
        className="relative block shrink-0 overflow-hidden rounded-full ring-1 ring-black/5"
        style={{ width: size, height: size }}
      >
        <Image src={photo} alt="" fill sizes={`${size}px`} className="object-cover" />
      </span>
    );
  }

  // Fallback for any future agent without a photo yet — same
  // illustrated-bust design as before, in the agent's own brand hue.
  const skin = `hsl(${hue} 40% 42%)`;
  const skinDark = `hsl(${hue} 44% 32%)`;
  const badgeBg = `hsl(${hue} 45% 94%)`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <circle cx="20" cy="20" r="20" fill={badgeBg} />
      <path d="M9 33c1.6-6 5.4-9 11-9s9.4 3 11 9" fill={skinDark} />
      <circle cx="20" cy="17" r="8" fill={skin} />
      <circle cx="16.8" cy="16.2" r="1.15" fill="white" />
      <circle cx="23.2" cy="16.2" r="1.15" fill="white" />
      <path d="M16.5 20c1 1.1 2.2 1.6 3.5 1.6s2.5-.5 3.5-1.6" stroke="white" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.85" />
    </svg>
  );
}
