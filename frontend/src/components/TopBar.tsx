"use client";

import { useState } from "react";
import { plaidApi } from "@/lib/api";
import { Icon } from "@/components/ui/Icons";
import { IconButton, Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useToast } from "@/components/ui/Toast";

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

  async function handleSync() {
    setSyncing(true);
    try {
      const results = await plaidApi.sync();
      const added = results.reduce((sum, r) => sum + r.added, 0);
      const modified = results.reduce((sum, r) => sum + r.modified, 0);
      const removed = results.reduce((sum, r) => sum + r.removed, 0);
      const newFlags = results.reduce((sum, r) => sum + r.new_fraud_flags, 0);
      const parts = [`${added} new`];
      if (modified) parts.push(`${modified} updated`);
      if (removed) parts.push(`${removed} removed`);
      let message = `Synced: ${parts.join(", ")} transaction(s).`;
      if (newFlags) message += ` ${newFlags} new fraud flag(s).`;
      showToast(message, newFlags ? "error" : "success");
    } catch {
      showToast("Sync failed. Check that a bank account is linked.", "error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface-1/90 px-4 py-3 backdrop-blur sm:px-6">
      <IconButton label="Open menu" onClick={onMenuClick} className="lg:hidden">
        {Icon.menu({ size: 20 })}
      </IconButton>
      <div className="flex flex-1 items-center justify-end gap-2">
        <Button size="sm" onClick={handleSync} loading={syncing}>
          {!syncing && Icon.refresh({ size: 14 })}
          {syncing ? "Syncing…" : "Sync"}
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
