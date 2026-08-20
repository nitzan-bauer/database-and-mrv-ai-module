/**
 * A small illustrated character per agent — a face, not an initial. Nitzan's
 * own spec: "draw human-like figures with facial expression, like a human
 * profile picture on a social-network card." Built as inline SVG (no
 * external art tool wired into this pipeline yet) so every agent gets a
 * consistent, recognizable bust in its own brand hue: a round head with two
 * eyes and a small smile, a body underneath, on a soft tinted badge.
 */
export function AgentAvatar({ hue, size = 40 }: { hue: number; size?: number }) {
  const skin = `hsl(${hue} 40% 42%)`;
  const skinDark = `hsl(${hue} 44% 32%)`;
  const badgeBg = `hsl(${hue} 45% 94%)`;

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <circle cx="20" cy="20" r="20" fill={badgeBg} />
      {/* body */}
      <path d="M9 33c1.6-6 5.4-9 11-9s9.4 3 11 9" fill={skinDark} />
      {/* head */}
      <circle cx="20" cy="17" r="8" fill={skin} />
      {/* eyes */}
      <circle cx="16.8" cy="16.2" r="1.15" fill="white" />
      <circle cx="23.2" cy="16.2" r="1.15" fill="white" />
      {/* smile */}
      <path d="M16.5 20c1 1.1 2.2 1.6 3.5 1.6s2.5-.5 3.5-1.6" stroke="white" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.85" />
    </svg>
  );
}
