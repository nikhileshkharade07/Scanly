"use client";

import { useEffect, useState } from "react";

import { scanlyApi, type HealthInfo } from "@/lib/api/scanly";

/**
 * Polls the local processing engine so the UI recovers automatically when the
 * backend starts (or goes down) without needing a page refresh.
 * Polls every 10 s while offline, every 30 s while healthy.
 */
export function useBackendHealth(): HealthInfo | null | "loading" {
  const [health, setHealth] = useState<HealthInfo | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      const info = await scanlyApi.ping();
      if (cancelled) return;
      setHealth(info);
      // Retry sooner while the engine is offline so a late start is picked up quickly.
      timer = setTimeout(() => void check(), info ? 30_000 : 10_000);
    };

    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return health;
}
