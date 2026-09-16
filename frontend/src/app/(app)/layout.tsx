"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { syncApi } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

const AUTO_SYNC_NUDGE_MS = 5 * 60 * 1000;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // A lightweight nudge so data is fresh the moment the app is opened, complementing
  // (not replacing) the backend scheduler that keeps syncing while the tab is closed.
  // Deliberately silent: a no-op when auto-sync is off or not yet due, and must never
  // surface an error or block rendering if the request fails.
  useEffect(() => {
    if (loading || !user) return;

    const tick = () => {
      syncApi.auto().catch(() => {});
    };
    tick();
    const interval = setInterval(tick, AUTO_SYNC_NUDGE_MS);
    return () => clearInterval(interval);
  }, [loading, user]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 bg-background">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex min-h-full flex-1 flex-col">
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
