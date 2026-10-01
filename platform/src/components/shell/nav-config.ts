import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Building2,
  SlidersHorizontal,
  ClipboardList,
  Columns3,
  Gauge,
  LineChart,
  ScrollText,
  Ticket,
  Users,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  /** Relative to /o/<slug>. */
  href: string;
  icon: LucideIcon;
  /** Hidden unless the user holds one of these. The server re-checks on the page. */
  anyOf?: Permission[];
  /** Planned; rendered disabled so the information architecture is visible. */
  comingIn?: string;
  /** Highlight only on an exact path match (for parents of other nav items). */
  exact?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Overview", href: "", icon: Gauge },
  { label: "My Work", href: "/my-work", icon: ClipboardList, anyOf: ["tickets.update"] },
  { label: "Tickets", href: "/tickets", icon: Ticket, anyOf: ["tickets.read", "tickets.read_own"] },
  { label: "Boards", href: "/boards", icon: Columns3, anyOf: ["tickets.read"] },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, anyOf: ["knowledge.read"], comingIn: "Phase 5" },
  { label: "Reports", href: "/reports", icon: LineChart, anyOf: ["reports.read"], comingIn: "Phase 4" },
  { label: "Teams", href: "/teams", icon: Users, anyOf: ["teams.read"] },
  { label: "AI", href: "/ai", icon: Bot, anyOf: ["ai.use"], comingIn: "Phase 7" },
];

export const ORG_NAV: NavItem[] = [
  { label: "Members", href: "/members", icon: Users, anyOf: ["members.read"] },
  { label: "Settings", href: "/settings", icon: Building2, anyOf: ["organization.update"], exact: true },
  {
    label: "Ticket settings",
    href: "/settings/tickets",
    icon: SlidersHorizontal,
    anyOf: ["tickets.configure", "workflows.manage"],
  },
  { label: "Audit log", href: "/audit", icon: ScrollText, anyOf: ["audit.read"] },
];
