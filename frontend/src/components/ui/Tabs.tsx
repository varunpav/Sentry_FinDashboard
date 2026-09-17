export interface TabItem<T extends string | undefined = string> {
  key: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string | undefined>({
  items,
  active,
  onChange,
}: {
  items: TabItem<T>[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1" role="tablist">
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "border-border bg-surface-1 text-series-1"
                : "border-transparent text-text-secondary hover:bg-surface-2"
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular ${
                  isActive ? "bg-surface-3 text-text-secondary" : "text-text-muted"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
