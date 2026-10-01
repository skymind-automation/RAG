"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { updateOrganizationAction } from "@/app/actions/organizations";
import { FieldError, FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { updateOrganizationSchema, type UpdateOrganizationInput } from "@/lib/validation/schemas";

export function OrgSettingsForm({
  orgSlug,
  initial,
  padding,
}: {
  orgSlug: string;
  initial: UpdateOrganizationInput;
  padding: number;
}) {
  const router = useRouter();
  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const prefix = (form.watch("ticketPrefix") || "IT").toUpperCase();
  const pad = Number(form.watch("ticketNumberPadding") ?? padding) || padding;

  async function onSubmit(values: UpdateOrganizationInput) {
    const result = await updateOrganizationAction(orgSlug, values);
    if (!result.ok) return applyServerErrors(form, result.error);
    toast.success("Settings saved");
    form.reset(values);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid max-w-lg gap-5">
      <FormError message={errors.root?.message} />
      <div className="grid gap-1.5">
        <Label htmlFor="s-name">Organization name</Label>
        <Input id="s-name" aria-invalid={!!errors.name} {...form.register("name")} />
        <FieldError id="s-name-error" message={errors.name?.message} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s-tz">Time zone</Label>
        <Input
          id="s-tz"
          list="tz-list"
          aria-invalid={!!errors.timezone}
          aria-describedby="s-tz-hint"
          {...form.register("timezone")}
        />
        <datalist id="tz-list">
          {Intl.supportedValuesOf("timeZone").map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
        <p id="s-tz-hint" className={errors.timezone ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {errors.timezone?.message ?? "Used for business hours, SLAs and dates. IANA name, e.g. Europe/London."}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s-prefix">Ticket prefix</Label>
        <Input
          id="s-prefix"
          className="w-32 uppercase"
          aria-invalid={!!errors.ticketPrefix}
          aria-describedby="s-prefix-hint"
          {...form.register("ticketPrefix")}
        />
        <p
          id="s-prefix-hint"
          className={errors.ticketPrefix ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {errors.ticketPrefix?.message ??
            `New tickets look like ${prefix}-${"1".padStart(pad, "0")}. Existing ticket keys never change.`}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s-padding">Number digits</Label>
        <Input
          id="s-padding"
          type="number"
          min={3}
          max={10}
          className="w-24"
          aria-invalid={!!errors.ticketNumberPadding}
          {...form.register("ticketNumberPadding", { valueAsNumber: true })}
        />
        <FieldError id="s-padding-error" message={errors.ticketNumberPadding?.message} />
      </div>
      <div>
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
