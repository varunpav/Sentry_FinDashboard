"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, authErrorMessage } from "@/lib/auth-context";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
        Create your account
      </h2>

      <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        Password
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          At least 8 characters.
        </span>
      </label>

      {error && (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        Already have an account?{" "}
        <Link href="/login" className="font-medium" style={{ color: "var(--series-1)" }}>
          Log in
        </Link>
      </p>
    </form>
  );
}
