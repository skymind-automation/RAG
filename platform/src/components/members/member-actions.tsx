"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction } from "@/app/actions/members";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export function RoleSelect({
  orgSlug,
  membershipId,
  role,
  grantableRoles,
  memberName,
}: {
  orgSlug: string;
  membershipId: string;
  role: Role;
  grantableRoles: Role[];
  memberName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const options = grantableRoles.includes(role) ? grantableRoles : [role, ...grantableRoles];
  return (
    <Select
      value={role}
      disabled={pending}
      onValueChange={(next) =>
        start(async () => {
          const result = await changeMemberRoleAction(orgSlug, { membershipId, role: next });
          if (!result.ok) toast.error(result.error.message);
          else toast.success(`${memberName} is now ${ROLE_LABELS[next as Role]}`);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${memberName}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((r) => (
          <SelectItem key={r} value={r} disabled={!grantableRoles.includes(r)}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RemoveMemberButton({
  orgSlug,
  membershipId,
  memberName,
  isSelf,
}: {
  orgSlug: string;
  membershipId: string;
  memberName: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          {isSelf ? "Leave" : "Remove"}
        </Button>
      }
      title={isSelf ? "Leave this organization?" : `Remove ${memberName}?`}
      description={
        isSelf
          ? "You'll lose access immediately. An administrator can invite you again."
          : "They'll lose access on their next request. Their past tickets and comments are kept."
      }
      confirmLabel={isSelf ? "Leave" : "Remove"}
      destructive
      onConfirm={async () => {
        const result = await removeMemberAction(orgSlug, { membershipId });
        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }
        if (isSelf) {
          router.replace("/");
        } else {
          toast.success(`${memberName} removed`);
        }
        router.refresh();
        return true;
      }}
    />
  );
}

export function RevokeInvitationButton({
  orgSlug,
  invitationId,
  email,
}: {
  orgSlug: string;
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      }
      title={`Revoke invitation for ${email}?`}
      description="The link stops working immediately."
      confirmLabel="Revoke"
      destructive
      onConfirm={async () => {
        const result = await revokeInvitationAction(orgSlug, invitationId);
        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }
        router.refresh();
        return true;
      }}
    />
  );
}
