"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { plaidApi } from "@/lib/api";

export function PlaidLinkButton({ onLinked }: { onLinked: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);

  useEffect(() => {
    plaidApi
      .createLinkToken()
      .then((res) => setLinkToken(res.link_token))
      .catch(() => setError("Could not initialize Plaid Link. Check your Plaid API credentials."));
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setExchanging(true);
      setError(null);
      try {
        await plaidApi.exchangePublicToken(publicToken);
        onLinked();
      } catch {
        setError("Failed to link account.");
      } finally {
        setExchanging(false);
      }
    },
    [onLinked]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  return (
    <div>
      <button
        onClick={() => open()}
        disabled={!ready || !linkToken || exchanging}
        className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        {exchanging ? "Linking…" : "Link a bank account"}
      </button>
      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
