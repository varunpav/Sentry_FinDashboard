"use client";

const FIELD_BASE =
  "rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60";

function FieldShell({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!label) return <>{children}</>;
  return (
    <label className={`flex flex-col gap-1 text-sm text-text-secondary ${className}`}>
      {label}
      {children}
    </label>
  );
}

export function Input({
  label,
  wrapperClassName,
  className = "",
  ...rest
}: { label?: string; wrapperClassName?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} className={wrapperClassName}>
      <input className={`${FIELD_BASE} ${className}`} {...rest} />
    </FieldShell>
  );
}

export function Select({
  label,
  wrapperClassName,
  className = "",
  children,
  ...rest
}: {
  label?: string;
  wrapperClassName?: string;
  children: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} className={wrapperClassName}>
      <select className={`${FIELD_BASE} ${className}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export function DateInput(props: { label?: string; wrapperClassName?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input type="date" {...props} />;
}
