import { useEffect, useRef } from "react";

export function usePolling(
  enabled: boolean,
  poll: () => Promise<void> | void,
  intervalMs = 1_000,
): void {
  const pollRef = useRef(poll);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      void pollRef.current();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}
