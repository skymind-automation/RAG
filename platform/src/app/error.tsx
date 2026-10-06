"use client";

import { Button } from "@/components/ui/button";

/** Never renders error details: production digests go to logs, not users. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Please try again. If it keeps happening, contact your administrator
        {error.digest ? ` and quote reference ${error.digest}` : ""}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
