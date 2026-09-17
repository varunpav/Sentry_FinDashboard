// Shared tooltip shell so every chart's hover card shares one visual language
// instead of four near-identical, independently-styled `<div>`s.
export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  muted?: boolean;
}

export function TooltipShell({
  heading,
  rows,
  footnote,
}: {
  heading?: string;
  rows: TooltipRow[];
  footnote?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm shadow-md">
      {heading && <p className="font-medium text-text-primary">{heading}</p>}
      <div className="mt-0.5 flex flex-col gap-0.5">
        {rows.map((row, i) => (
          <p
            key={i}
            className={`flex items-center gap-1.5 ${row.muted ? "text-text-muted" : "text-text-secondary"}`}
          >
            {row.color && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            )}
            <span>{row.label}</span>
            <span className="tabular ml-auto font-medium text-text-primary">{row.value}</span>
          </p>
        ))}
      </div>
      {footnote && <p className="mt-1 text-xs text-text-muted">{footnote}</p>}
    </div>
  );
}
