"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createOrganizationAction } from "@/app/actions/organizations";
import { FieldError, FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { createOrganizationSchema, type CreateOrganizationInput } from "@/lib/validation/schemas";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateOrgForm() {
  const router = useRouter();
  const [slugTouched, setSlugTouched] = useState(false);
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", slug: "", timezone: "UTC" },
  });
  const { errors, isSubmitting } = form.formState;
  const name = form.watch("name");

  useEffect(() => {
    form.setValue("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [form]);
  useEffect(() => {
    if (!slugTouched) form.setValue("slug", slugify(name ?? ""));
  }, [name, slugTouched, form]);

  async function onSubmit(values: CreateOrganizationInput) {
    const result = await createOrganizationAction(values);
    if (!result.ok) return applyServerErrors(form, result.error);
    router.replace(`/o/${result.data.slug}`);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <FormError message={errors.root?.message} />
      <div className="grid gap-1.5">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          placeholder="Acme IT"
          autoFocus
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "org-name-error" : undefined}
          {...form.register("name")}
        />
        <FieldError id="org-name-error" message={errors.name?.message} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="org-slug">Address</Label>
        <div className="flex items-center rounded-lg border focus-within:ring-3 focus-within:ring-ring/50">
          <span className="pl-2.5 text-sm text-muted-foreground" aria-hidden>
            /o/
          </span>
          <Input
            id="org-slug"
            className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
            aria-invalid={!!errors.slug}
            aria-describedby="org-slug-hint"
            {...form.register("slug", { onChange: () => setSlugTouched(true) })}
          />
        </div>
        <p id="org-slug-hint" className={errors.slug ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {errors.slug?.message ?? "Lowercase letters, numbers and hyphens. Appears in every link."}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Time zone: <span className="font-medium text-foreground">{form.watch("timezone")}</span> (change later in
        settings)
      </p>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
