"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { PublicError } from "@/lib/errors";

type Result<T> = { ok: true; data: T } | { ok: false; error: PublicError };

/**
 * Run a server action, then re-render from the server so the screen always
 * reconciles with authoritative state (including the new `version`). A
 * ConflictError means someone else changed the record first: we tell the user
 * and refresh instead of retrying blindly.
 */
export function useMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T>(
      action: () => Promise<Result<T>>,
      opts: { success?: string; onSuccess?: (data: T) => void; onError?: (e: PublicError) => void } = {},
    ) =>
      new Promise<Result<T>>((resolve) => {
        startTransition(async () => {
          const result = await action();
          if (result.ok) {
            if (opts.success) toast.success(opts.success);
            opts.onSuccess?.(result.data);
          } else if (result.error.code === "CONFLICT") {
            toast.warning("This ticket was just changed by someone else. Showing the latest version.");
          } else if (opts.onError) {
            opts.onError(result.error);
          } else {
            toast.error(result.error.message);
          }
          router.refresh();
          resolve(result);
        });
      }),
    [router],
  );

  return { run, pending };
}
