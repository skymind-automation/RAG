"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/time/format";

/** Live-ticking elapsed time since `since` (ISO). Updates every second. */
export function Elapsed({ since, className }: { since: string; className?: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // aria-live off: a per-second announcement would be unbearable for screen readers.
  return (
    <time className={className} dateTime={new Date(start).toISOString()} aria-live="off">
      {formatClock((now - start) / 1000)}
    </time>
  );
}
