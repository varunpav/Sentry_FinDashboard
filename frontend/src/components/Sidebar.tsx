"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { fraudApi } from "@/lib/api";
import { Icon } from "@/components/ui/Icons";

const COLLAPSE_STORAGE_KEY = "sentry_sidebar_collapsed";

interface NavLink {
  href: string;
  label: string;
  icon: keyof typeof Icon;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/accounts", label: "Accounts", icon: "wallet" },
    ],
  },
  {
    label: "Money",
    links: [
      { href: "/transactions", label: "Transactions", icon: "list" },
      { href: "/recurring", label: "Recurring", icon: "repeat" },
      { href: "/alerts", label: "Alerts", icon: "shield" },
    ],
  },
  {
    label: "Planning",
    links: [
      { href: "/budgets", label: "Budgets", icon: "piggyBank" },
      { href: "/goals", label: "Goals", icon: "target" },
      { href: "/insights", label: "Insights", icon: "chart" },
    ],
  },
];

function NavRow({
  link,
  active,
  collapsed,
  badge,
  onClick,
}: {
  link: NavLink;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={link.href}
      onClick={onClick}
      title={collapsed ? link.label : undefined}
      className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface-2 text-series-1" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      } ${collapsed ? "justify-center" : ""}`}
    >
      <span className="shrink-0">{Icon[link.icon]({ size: 18 })}</span>
      {!collapsed && <span className="flex-1 truncate">{link.label}</span>}
      {!!badge && badge > 0 && (
        <span
          className={`flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-semibold text-white ${
            collapsed ? "absolute -right-0.5 -top-0.5" : ""
          }`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function SidebarContent({
  collapsed,
  onLinkClick,
  onToggleCollapse,
  pendingAlerts,
}: {
  collapsed: boolean;
  onLinkClick?: () => void;
  onToggleCollapse?: () => void;
  pendingAlerts: number;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-2 px-4 py-4 ${collapsed ? "justify-center px-2" : ""}`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-series-1 text-white">
          {Icon.shield({ size: 16 })}
        </span>
        {!collapsed && <span className="text-base font-semibold text-text-primary">Sentry</span>}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-thin px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {group.links.map((link) => (
                <NavRow
                  key={link.href}
                  link={link}
                  active={pathname === link.href}
                  collapsed={collapsed}
                  badge={link.href === "/alerts" ? pendingAlerts : undefined}
                  onClick={onLinkClick}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-2 py-2">
        <NavRow
          link={{ href: "/settings/notifications", label: "Settings", icon: "settings" }}
          active={pathname === "/settings/notifications"}
          collapsed={collapsed}
          onClick={onLinkClick}
        />
        {!collapsed && (
          <p className="truncate px-3 pt-2 text-xs text-text-muted" title={user?.email}>
            {user?.email}
          </p>
        )}
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
          className={`mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span className="shrink-0">{Icon.logout({ size: 18 })}</span>
          {!collapsed && <span>Log out</span>}
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`mt-1 hidden w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary lg:flex ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="shrink-0">
              {collapsed ? Icon.chevronRight({ size: 18 }) : Icon.chevronLeft({ size: 18 })}
            </span>
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable — default to expanded.
    }
  }, []);

  useEffect(() => {
    fraudApi
      .listFlags("pending")
      .then((flags) => setPendingAlerts(flags.length))
      .catch(() => {});
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-border bg-surface-1 transition-[width] lg:block ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} pendingAlerts={pendingAlerts} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" onClick={onMobileClose} className="absolute inset-0 bg-overlay" />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-surface-1 shadow-xl">
            <SidebarContent collapsed={false} onLinkClick={onMobileClose} pendingAlerts={pendingAlerts} />
          </aside>
        </div>
      )}
    </>
  );
}
