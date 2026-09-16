"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { plaidApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";

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
      <Button variant="primary" onClick={() => open()} disabled={!ready || !linkToken} loading={exchanging}>
        {exchanging ? "Linking…" : "Link a bank account"}
      </Button>
      {error && <p className="mt-2 text-sm text-status-critical">{error}</p>}
    </div>
  );
}
