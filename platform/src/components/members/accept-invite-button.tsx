"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptInvitationAction } from "@/app/actions/members";
import { FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <FormError message={error} />
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptInvitationAction(token);
            if (!result.ok) return setError(result.error.message);
            router.replace(`/o/${result.data.slug}`);
            router.refresh();
          })
        }
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
