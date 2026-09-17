"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, authErrorMessage } from "@/lib/auth-context";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const { login } = useAuth();
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
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-text-primary">Log in</h2>

      <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input
        label="Password"
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="text-sm text-status-critical">{error}</p>}

      <Button type="submit" variant="primary" loading={submitting} className="mt-2 w-full">
        Log in
      </Button>

      <p className="rounded-md bg-surface-2 px-3 py-2 text-center text-xs text-text-muted">
        Demo login: <span className="tabular text-text-secondary">demo@sentryapp.dev</span> /{" "}
        <span className="tabular text-text-secondary">demo12345</span>
      </p>

      <p className="text-center text-sm text-text-secondary">
        No account?{" "}
        <Link href="/register" className="font-medium text-series-1">
          Register
        </Link>
      </p>
    </form>
  );
}
