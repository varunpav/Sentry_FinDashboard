import { Icon } from "@/components/ui/Icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-series-1 text-white">
            {Icon.shield({ size: 20 })}
          </span>
          <h1 className="text-2xl font-semibold text-text-primary">Sentry</h1>
          <p className="mt-1 text-sm text-text-secondary">Know where your money goes.</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-1 p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
