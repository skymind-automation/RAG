"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session; server state stays authoritative, so
  // queries refetch on focus and never outlive a stale organization context.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster richColors closeButton position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
