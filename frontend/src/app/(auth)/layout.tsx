export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Sentry
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Know where your money goes.
          </p>
        </div>
        <div
          className="rounded-xl p-6 shadow-sm"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
