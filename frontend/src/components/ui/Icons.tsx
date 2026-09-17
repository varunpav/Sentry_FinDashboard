// Small hand-rolled icon set (24x24, stroke-based) so the app doesn't need an icon
// library dependency for what amounts to ~20 glyphs.
type IconProps = { className?: string; size?: number };

function base(children: React.ReactNode, { className, size = 18 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  dashboard: (p?: IconProps) =>
    base(
      <>
        <rect x="3" y="3" width="8" height="9" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="14" width="8" height="7" rx="1.5" />
      </>,
      p
    ),
  wallet: (p?: IconProps) =>
    base(
      <>
        <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M16 13.5h3" />
      </>,
      p
    ),
  list: (p?: IconProps) =>
    base(
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>,
      p
    ),
  repeat: (p?: IconProps) =>
    base(
      <>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </>,
      p
    ),
  shield: (p?: IconProps) =>
    base(<path d="M12 2l8 4v5c0 5-3.5 9-8 11-4.5-2-8-6-8-11V6l8-4z" />, p),
  target: (p?: IconProps) =>
    base(
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>,
      p
    ),
  chart: (p?: IconProps) =>
    base(
      <>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 5-7" />
      </>,
      p
    ),
  settings: (p?: IconProps) =>
    base(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.07 4.24l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9c.16.6.58 1.04 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
      </>,
      p
    ),
  chevronLeft: (p?: IconProps) => base(<path d="M15 18l-6-6 6-6" />, p),
  chevronRight: (p?: IconProps) => base(<path d="M9 18l6-6-6-6" />, p),
  chevronDown: (p?: IconProps) => base(<path d="M6 9l6 6 6-6" />, p),
  menu: (p?: IconProps) => base(<path d="M3 6h18M3 12h18M3 18h18" />, p),
  close: (p?: IconProps) => base(<path d="M18 6L6 18M6 6l12 12" />, p),
  sun: (p?: IconProps) =>
    base(
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>,
      p
    ),
  moon: (p?: IconProps) => base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />, p),
  bell: (p?: IconProps) =>
    base(
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>,
      p
    ),
  logout: (p?: IconProps) =>
    base(
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </>,
      p
    ),
  refresh: (p?: IconProps) =>
    base(
      <>
        <path d="M21 2v6h-6" />
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M3 22v-6h6" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      </>,
      p
    ),
  search: (p?: IconProps) =>
    base(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </>,
      p
    ),
  alertTriangle: (p?: IconProps) =>
    base(
      <>
        <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>,
      p
    ),
  check: (p?: IconProps) => base(<path d="M20 6L9 17l-5-5" />, p),
  x: (p?: IconProps) => base(<path d="M18 6L6 18M6 6l12 12" />, p),
  arrowUp: (p?: IconProps) => base(<path d="M12 19V5M5 12l7-7 7 7" />, p),
  arrowDown: (p?: IconProps) => base(<path d="M12 5v14M19 12l-7 7-7-7" />, p),
  creditCard: (p?: IconProps) =>
    base(
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>,
      p
    ),
  building: (p?: IconProps) =>
    base(
      <>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01" />
      </>,
      p
    ),
  piggyBank: (p?: IconProps) =>
    base(
      <>
        <path d="M11 5a5 5 0 0 1 5 5v.5l2 1.5-2 1v.5a5 5 0 0 1-1 3v2.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-.5a6 6 0 0 1-4-1.5H6a1 1 0 0 1-1-1v-2a4 4 0 0 1 1.3-2.9A5 5 0 0 1 11 5z" />
        <path d="M15 9h.01" />
      </>,
      p
    ),
  download: (p?: IconProps) =>
    base(
      <>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M4 21h16" />
      </>,
      p
    ),
  plus: (p?: IconProps) => base(<path d="M12 5v14M5 12h14" />, p),
  trash: (p?: IconProps) =>
    base(
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </>,
      p
    ),
  edit: (p?: IconProps) =>
    base(
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>,
      p
    ),
  externalLink: (p?: IconProps) =>
    base(
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14L21 3" />
      </>,
      p
    ),
  spinner: (p?: IconProps) =>
    base(<path d="M21 12a9 9 0 1 1-9-9" />, p),
};
