"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DeltaLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import type { Permission } from "@/lib/permissions";
import { useUiStore } from "@/stores/ui-store";
import { OrgSwitcher, type SwitcherOrg } from "./org-switcher";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { RunningTimer, type RunningTimerView } from "@/components/time/running-timer";

export function AppShell({
  current,
  organizations,
  permissions,
  user,
  runningTimer,
  children,
}: {
  current: SwitcherOrg;
  organizations: SwitcherOrg[];
  permissions: Permission[];
  user: { name: string; email: string };
  runningTimer?: RunningTimerView | null;
  children: React.ReactNode;
}) {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link
        href={`/o/${current.slug}`}
        className="flex items-center px-1 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DeltaLogo className="h-7" />
        <span className="sr-only">Delta ITSM home</span>
      </Link>
      <OrgSwitcher current={current} organizations={organizations} />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav orgSlug={current.slug} permissions={permissions} />
      </div>
      {runningTimer ? <RunningTimer orgSlug={current.slug} timer={runningTimer} /> : null}
      <UserMenu name={user.name} email={user.email} />
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-sidebar lg:block" aria-label="Sidebar">
        {sidebar}
      </aside>

      <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu />
        </Button>
        <DeltaLogo className="h-6" />
        <span className="ml-auto truncate text-sm font-medium">{current.name}</span>
      </div>

      {/* Radix Dialog: focus trap, Escape to close, focus return. Mounted only
          while open so the sidebar never exists twice in the DOM. */}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-sidebar outline-none lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="Close navigation">
                <X />
              </Button>
            </DialogPrimitive.Close>
            {sidebar}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main id="main" className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
