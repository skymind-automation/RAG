"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email }: { name: string; email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
        data-testid="user-menu"
      >
        <UserAvatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logoutAction()} className="gap-2">
          <LogOut className="size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
