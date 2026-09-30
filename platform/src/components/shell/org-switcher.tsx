"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchOrganizationAction } from "@/app/actions/organizations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export interface SwitcherOrg {
  slug: string;
  name: string;
  role: Role;
}

export function OrgSwitcher({ current, organizations }: { current: SwitcherOrg; organizations: SwitcherOrg[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function switchTo(slug: string) {
    if (slug === current.slug) return;
    start(async () => {
      const result = await switchOrganizationAction(slug);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      router.push(`/o/${result.data.slug}`);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Current organization: ${current.name}. Switch organization`}
        data-testid="org-switcher"
      >
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-xs font-semibold text-primary-foreground"
          aria-hidden
        >
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{current.name}</span>
          <span className="block text-xs text-muted-foreground">
            {pending ? "Switching…" : ROLE_LABELS[current.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
        {organizations.map((o) => (
          <DropdownMenuItem key={o.slug} onSelect={() => switchTo(o.slug)} className="gap-2">
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[o.role]}</span>
            {o.slug === current.slug ? <Check className="size-4" aria-label="current" /> : <span className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding" className="gap-2">
            <Plus className="size-4" aria-hidden />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
