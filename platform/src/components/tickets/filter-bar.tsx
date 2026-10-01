"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TICKET_TYPE_LABELS } from "./badges";

const ANY = "__any";

export interface FilterOptions {
  priorities: { key: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string; assignable: boolean }[];
  staff: boolean;
}

/** URL-driven filters: every view is a shareable, bookmarkable link. */
export function FilterBar({
  options,
  show = { search: true, state: true },
}: {
  options: FilterOptions;
  /** Boards hide search and state (columns already are the state). */
  show?: { search?: boolean; state?: boolean };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  function set(name: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ANY) next.delete(name);
    else next.set(name, value);
    next.delete("cursor");
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`));
  }

  const active = ["q", "state", "assigneeId", "priorityKey", "type", "teamId"].some((k) => params.has(k));

  function select(name: string, label: string, items: { value: string; label: string }[], width = "w-36") {
    return (
      <Select value={params.get(name) ?? ANY} onValueChange={(v) => set(name, v)}>
        <SelectTrigger size="sm" className={width} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{label}: any</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div role="search" aria-busy={pending} className="flex flex-wrap items-center gap-2">
      {show.search ? (
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", q.trim() || null);
          }}
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key or title"
            aria-label="Search tickets"
            className="h-7 w-52 pl-7 text-sm"
          />
        </form>
      ) : null}
      {show.state
        ? select("state", "State", [
            { value: "open", label: "Open tickets" },
            { value: "closed", label: "Resolved & closed" },
          ])
        : null}
      {options.staff
        ? select(
            "assigneeId",
            "Assignee",
            [
              { value: "me", label: "Assigned to me" },
              { value: "unassigned", label: "Unassigned" },
              ...options.members.filter((m) => m.assignable).map((m) => ({ value: m.id, label: m.name })),
            ],
            "w-44",
          )
        : null}
      {select(
        "priorityKey",
        "Priority",
        options.priorities.map((p) => ({ value: p.key, label: p.name })),
      )}
      {select(
        "type",
        "Type",
        Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        "w-40",
      )}
      {options.staff && options.teams.length > 0
        ? select(
            "teamId",
            "Team",
            options.teams.map((t) => ({ value: t.id, label: t.name })),
          )
        : null}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            start(() => router.replace(pathname));
          }}
        >
          <X aria-hidden /> Clear
        </Button>
      ) : null}
    </div>
  );
}
