"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, UserPlus } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { inviteMemberAction } from "@/app/actions/members";
import { FieldError, FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/permissions";
import { inviteMemberSchema, type InviteMemberInput } from "@/lib/validation/schemas";

export function InviteDialog({ orgSlug, grantableRoles }: { orgSlug: string; grantableRoles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const defaultRole: Role = grantableRoles.includes("AGENT") ? "AGENT" : grantableRoles[grantableRoles.length - 1]!;
  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", role: defaultRole },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: InviteMemberInput) {
    const result = await inviteMemberAction(orgSlug, values);
    if (!result.ok) return applyServerErrors(form, result.error);
    setInviteUrl(result.data.inviteUrl);
  }

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setInviteUrl(null);
      form.reset({ email: "", role: defaultRole });
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{inviteUrl ? "Invitation created" : "Invite a member"}</DialogTitle>
          <DialogDescription>
            {inviteUrl
              ? "Share this link with the invitee. It works once, only for their email address, and expires in 7 days."
              : "They'll join with the role you choose. You can only grant roles below your own."}
          </DialogDescription>
        </DialogHeader>
        {inviteUrl ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={inviteUrl}
              aria-label="Invitation link"
              data-testid="invite-url"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy link"
              onClick={() => navigator.clipboard.writeText(inviteUrl).then(() => toast.success("Link copied"))}
            >
              <Copy />
            </Button>
          </div>
        ) : (
          <form id="invite-form" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
            <FormError message={errors.root?.message} />
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "invite-email-error" : undefined}
                {...form.register("email")}
              />
              <FieldError id="invite-email-error" message={errors.email?.message} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {grantableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[form.watch("role") as Role]}</p>
            </div>
          </form>
        )}
        <DialogFooter>
          {inviteUrl ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <Button type="submit" form="invite-form" disabled={isSubmitting}>
              {isSubmitting ? "Inviting…" : "Create invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
