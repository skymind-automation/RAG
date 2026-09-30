"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createTeamAction } from "@/app/actions/teams";
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
import { Textarea } from "@/components/ui/textarea";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { createTeamSchema, type CreateTeamInput } from "@/lib/validation/schemas";

export function CreateTeamDialog({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<CreateTeamInput>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: "", description: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: CreateTeamInput) {
    const result = await createTeamAction(orgSlug, values);
    if (!result.ok) return applyServerErrors(form, result.error);
    toast.success(`Team "${values.name}" created`);
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>Teams group agents for routing, boards and reporting.</DialogDescription>
        </DialogHeader>
        <form id="team-form" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <FormError message={errors.root?.message} />
          <div className="grid gap-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "team-name-error" : undefined}
              {...form.register("name")}
            />
            <FieldError id="team-name-error" message={errors.name?.message} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="team-description" rows={3} {...form.register("description")} />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="team-form" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
