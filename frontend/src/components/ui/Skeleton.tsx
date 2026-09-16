export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-md bg-surface-3 ${className}`}
      style={{ animation: "pulse-skeleton 1.6s ease-in-out infinite", ...style }}
      aria-hidden="true"
    />
  );
}

export function StatTileSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
    </div>
  );
}

export function CardSkeleton({ lines = 4, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface-1 p-5 ${className}`}>
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}
