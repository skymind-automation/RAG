"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";
import { useUiStore } from "@/stores/ui-store";
import { ORG_NAV, PRIMARY_NAV, type NavItem } from "./nav-config";

function visible(items: NavItem[], perms: Set<Permission>) {
  return items.filter((i) => !i.anyOf || i.anyOf.some((p) => perms.has(p)));
}

function NavList({ items, base, label }: { items: NavItem[]; base: string; label: string }) {
  const pathname = usePathname();
  const close = useUiStore((s) => s.setMobileNavOpen);
  if (items.length === 0) return null;
  return (
    <div>
      <p className="px-2 pb-1 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <ul className="grid gap-0.5">
        {items.map((item) => {
          const href = `${base}${item.href}`;
          const active = item.href === "" || item.exact ? pathname === href : pathname.startsWith(href);
          const Icon = item.icon;
          if (item.comingIn) {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={`Arrives in ${item.comingIn}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/70"
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded bg-muted px-1.5 text-[0.65rem]">Soon</span>
                </span>
              </li>
            );
          }
          return (
            <li key={item.label}>
              <Link
                href={href}
                onClick={() => close(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarNav({ orgSlug, permissions }: { orgSlug: string; permissions: Permission[] }) {
  const perms = new Set(permissions);
  const base = `/o/${orgSlug}`;
  return (
    <nav aria-label="Main" className="grid gap-5">
      <NavList items={visible(PRIMARY_NAV, perms)} base={base} label="Workspace" />
      <NavList items={visible(ORG_NAV, perms)} base={base} label="Organization" />
    </nav>
  );
}
