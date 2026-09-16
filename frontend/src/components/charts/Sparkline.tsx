// A minimal decorative trend line for a StatTile — no axes, no tooltip. The tile
// itself already states the value and delta in text, so the line's only job is to
// give the trend a shape at a glance. Per dataviz guidance: de-emphasis hue for the
// full line, current period highlighted as the accent end-dot.
export function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;

  const width = 64;
  const height = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.55} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.25} fill="currentColor" stroke="var(--surface-1)" strokeWidth={1} />
    </svg>
  );
}
