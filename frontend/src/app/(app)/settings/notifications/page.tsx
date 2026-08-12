"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type NotificationLogEntry,
  type NotificationPreferences,
  type SyncPreferences,
  notificationsApi,
  syncApi,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { IntervalSlider } from "@/components/ui/IntervalSlider";
import { Toggle } from "@/components/ui/Toggle";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const TYPE_LABEL: Record<NotificationLogEntry["type"], string> = {
  budget: "Budget alert",
  bill: "Bill reminder",
  fraud: "Fraud alert",
  digest: "Weekly digest",
};

const STATUS_COLOR: Record<NotificationLogEntry["status"], string> = {
  sent: "var(--status-good-text)",
  skipped: "var(--text-muted)",
  failed: "var(--status-critical)",
};

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const [syncPrefs, setSyncPrefs] = useState<SyncPreferences | null>(null);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prefsRes, logRes, syncPrefsRes] = await Promise.all([
        notificationsApi.getPreferences(),
        notificationsApi.log(20),
        syncApi.getPreferences(),
      ]);
      setPrefs(prefsRes);
      setLog(logRes);
      setSyncPrefs(syncPrefsRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) {
    setPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!prefs) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await notificationsApi.updatePreferences(prefs);
      setPrefs(updated);
      setSaveMessage("Preferences saved.");
    } catch {
      setSaveMessage("Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setRunMessage(null);
    try {
      const result = await notificationsApi.run();
      const total = result.budget + result.bill + result.fraud + result.digest;
      setRunMessage(
        total === 0
          ? "Ran check — nothing new to notify about."
          : `Ran check — ${total} new notification(s): ${result.budget} budget, ${result.bill} bill, ${result.fraud} fraud, ${result.digest} digest.` +
              (result.resend_configured ? "" : " (RESEND_API_KEY not set — logged as skipped, not emailed.)")
      );
      await load();
    } catch {
      setRunMessage("Run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function handleSyncSave() {
    if (!syncPrefs) return;
    setSyncSaving(true);
    setSyncMessage(null);
    try {
      const updated = await syncApi.updatePreferences(syncPrefs.auto_sync_enabled, syncPrefs.interval_hours);
      setSyncPrefs(updated);
      setSyncMessage("Saved.");
    } catch {
      setSyncMessage("Failed to save.");
    } finally {
      setSyncSaving(false);
    }
  }

  if (loading || !prefs || !syncPrefs) {
    return <p style={{ color: "var(--text-muted)" }}>Loading notification settings…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Notification settings
        </h1>
        <button
          onClick={handleRun}
          disabled={running}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {running ? "Running…" : "Run check now"}
        </button>
      </div>

      {runMessage && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{runMessage}</p>}

      <Card>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text-secondary)" }}>Alerts only fire after a sync</strong> —
          notifications are evaluated at the end of each sync, so how often you sync sets the floor
          on how quickly any alert can reach you. Turn on automatic sync below for a background
          check on your chosen interval, or use &ldquo;Run check now&rdquo; above for an immediate
          one-off. Emails are sent via{" "}
          <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: "var(--series-1)" }}>
            Resend
          </a>
          . Without a configured API key, checks still run and log normally, they just don&apos;t send.
        </p>
      </Card>

      <Card title="Automatic sync">
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--gridline)" }}>
          <Toggle
            label="Sync automatically"
            description="Sync linked accounts in the background on the interval below, even while you're not using the app."
            checked={syncPrefs.auto_sync_enabled}
            onChange={(v) => setSyncPrefs((prev) => (prev ? { ...prev, auto_sync_enabled: v } : prev))}
          />
          {syncPrefs.auto_sync_enabled && (
            <div className="flex flex-col gap-4 py-4 pl-4">
              <IntervalSlider
                hours={syncPrefs.interval_hours}
                onChange={(hours) => setSyncPrefs((prev) => (prev ? { ...prev, interval_hours: hours } : prev))}
              />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Auto-sync only runs while the app's backend is running — a 2-day interval on a
                machine that's been off will catch up on the next check, not run precisely on
                schedule.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSyncSave}
            disabled={syncSaving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {syncSaving ? "Saving…" : "Save sync settings"}
          </button>
          {syncMessage && <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{syncMessage}</span>}
        </div>

        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Last synced: {formatWhen(syncPrefs.last_auto_sync_at)}
          {syncPrefs.last_auto_sync_status && ` (${syncPrefs.last_auto_sync_status})`}
        </p>
      </Card>

      <Card title="Preferences">
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--gridline)" }}>
          <Toggle
            label="Budget threshold alerts"
            description="Email when a category's spend crosses a percentage of its monthly limit."
            checked={prefs.budget_alerts_enabled}
            onChange={(v) => update("budget_alerts_enabled", v)}
          />
          {prefs.budget_alerts_enabled && (
            <div className="flex items-center gap-3 py-3 pl-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Alert at
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={prefs.budget_threshold_pct}
                onChange={(e) => update("budget_threshold_pct", Number(e.target.value))}
                className="w-20 rounded-md px-2 py-1 text-sm"
                style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }}
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                % of budget
              </span>
              <label className="ml-4 flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={prefs.budget_alert_at_100}
                  onChange={(e) => update("budget_alert_at_100", e.target.checked)}
                />
                Also alert at 100%
              </label>
            </div>
          )}

          <Toggle
            label="Upcoming bill reminders"
            description="Email before a detected recurring charge's predicted due date."
            checked={prefs.bill_reminders_enabled}
            onChange={(v) => update("bill_reminders_enabled", v)}
          />
          {prefs.bill_reminders_enabled && (
            <div className="flex items-center gap-3 py-3 pl-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Remind
              </span>
              <input
                type="number"
                min={0}
                max={30}
                value={prefs.bill_lead_days}
                onChange={(e) => update("bill_lead_days", Number(e.target.value))}
                className="w-20 rounded-md px-2 py-1 text-sm"
                style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }}
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                day(s) before due
              </span>
            </div>
          )}

          <Toggle
            label="New fraud flag alerts"
            description="Email as soon as a transaction is flagged as a possible anomaly."
            checked={prefs.fraud_alerts_enabled}
            onChange={(v) => update("fraud_alerts_enabled", v)}
          />

          <Toggle
            label="Weekly summary digest"
            description="One email covering spend vs. budget, net worth, and upcoming bills."
            checked={prefs.weekly_digest_enabled}
            onChange={(v) => update("weekly_digest_enabled", v)}
          />
          {prefs.weekly_digest_enabled && (
            <div className="flex items-center gap-3 py-3 pl-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Digest week resets on
              </span>
              <select
                value={prefs.weekly_digest_day}
                onChange={(e) => update("weekly_digest_day", Number(e.target.value))}
                className="rounded-md px-2 py-1 text-sm"
                style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-primary)" }}
              >
                {DAY_LABELS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
          {saveMessage && <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{saveMessage}</span>}
        </div>
      </Card>

      <Card title="Recent activity">
        {log.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No notifications logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="pb-2 text-left font-medium">When</th>
                <th className="pb-2 text-left font-medium">Type</th>
                <th className="pb-2 text-left font-medium">Status</th>
                <th className="pb-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry) => (
                <tr key={entry.id} style={{ borderTop: "1px solid var(--gridline)" }}>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {formatSentAt(entry.sent_at)}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-primary)" }}>
                    {TYPE_LABEL[entry.type]}
                  </td>
                  <td className="py-2" style={{ color: STATUS_COLOR[entry.status] }}>
                    {entry.status}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-muted)" }}>
                    {entry.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
