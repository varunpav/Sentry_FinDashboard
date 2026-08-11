"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/recurring", label: "Recurring" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings/notifications", label: "Settings" },
];

export function NavBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-6 py-3"
      style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-8">
        <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Sentry
        </span>
        <nav className="flex gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  color: active ? "var(--series-1)" : "var(--text-secondary)",
                  background: active ? "var(--surface-2)" : "transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          {user?.email}
        </span>
        <button
          onClick={handleLogout}
          className="rounded-md px-3 py-1.5 text-sm font-medium"
          style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          Log out
        </button>
      </div>
    </header>
  );
}
