"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthRetryError } from "./auth-api";

export function useAuthRetry() {
  const retryUntil = useRef(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const retrying = retrySeconds > 0;

  const startRetry = useCallback((error: unknown) => {
    if (!(error instanceof AuthRetryError)) return;
    const now = Date.now();
    retryUntil.current = Math.max(retryUntil.current, now + error.retryAfterSeconds * 1000);
    setRetrySeconds(Math.ceil((retryUntil.current - now) / 1000));
  }, []);

  useEffect(() => {
    if (!retrying) return;
    const timer = setInterval(() => {
      setRetrySeconds(Math.max(0, Math.ceil((retryUntil.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [retrying]);

  return { retrySeconds, retrying, startRetry };
}
