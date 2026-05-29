import { useState, useEffect } from "react";

export type ServerMode = "local" | "vercel" | "offline";

interface ServerStatus {
  mode: ServerMode;
  healthy: boolean;
  checkedAt: string | null;
}

/**
 * Checks if the local API server is running.
 * Returns "local" if Express server responds, "vercel" if deployed, "offline" if neither.
 */
export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({
    mode: "offline",
    healthy: false,
    checkedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health", {
          signal: AbortSignal.timeout(3000),
          headers: { "x-penman-local": "1" },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setStatus({
            mode: data.mode === "local" ? "local" : "vercel",
            healthy: true,
            checkedAt: new Date().toISOString(),
          });
        } else {
          setStatus({ mode: "offline", healthy: false, checkedAt: new Date().toISOString() });
        }
      } catch {
        if (cancelled) return;
        setStatus({ mode: "offline", healthy: false, checkedAt: new Date().toISOString() });
      }
    }

    check();
    // Re-check every 60s
    const interval = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return status;
}
