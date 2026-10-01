"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { addTeamMemberAction } from "@/app/actions/teams";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AddTeamMember({
  orgSlug,
  teamId,
  teamName,
  candidates,
}: {
  orgSlug: string;
  teamId: string;
  teamName: string;
  candidates: { membershipId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (candidates.length === 0) return null;
  return (
    <Select
      value=""
      disabled={pending}
      onValueChange={(membershipId) =>
        start(async () => {
          const result = await addTeamMemberAction(orgSlug, { teamId, membershipId });
          if (!result.ok) toast.error(result.error.message);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-40" aria-label={`Add member to ${teamName}`}>
        <SelectValue placeholder="Add member…" />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((c) => (
          <SelectItem key={c.membershipId} value={c.membershipId}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
