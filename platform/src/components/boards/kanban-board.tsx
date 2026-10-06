"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, GripVertical, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { moveTicketAction } from "@/app/actions/work";
import { UserAvatar } from "@/components/common/user-avatar";
import { PriorityBadge, TICKET_TYPE_LABELS } from "@/components/tickets/badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PublicError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { applyMove, COLUMN_LABELS, COLUMNS, type BoardCardData, type BoardData, type Column } from "./board-model";

export { COLUMN_LABELS, COLUMNS, type BoardCardData, type BoardData, type Column } from "./board-model";

const COLUMN_ACCENT: Record<Column, string> = {
  NEW: "bg-sky-500",
  OPEN: "bg-blue-500",
  IN_PROGRESS: "bg-amber-500",
  PENDING: "bg-violet-500",
  RESOLVED: "bg-emerald-500",
};

type Group = "none" | "assignee" | "priority";

class ActionFailure extends Error {
  constructor(public readonly publicError: PublicError) {
    super(publicError.message);
  }
}

interface MoveVars {
  card: BoardCardData;
  from: Column;
  to: Column;
  resolution?: string;
}

function laneOf(card: BoardCardData, group: Group): { id: string; label: string; order: number } {
  if (group === "assignee") {
    return card.assignee
      ? { id: card.assignee.id, label: card.assignee.name, order: 1 }
      : { id: "unassigned", label: "Unassigned", order: 0 };
  }
  if (group === "priority") return { id: card.priority.key, label: card.priority.name, order: card.priority.level };
  return { id: "all", label: "", order: 0 };
}

export function KanbanBoard({
  orgSlug,
  initialData,
  initialFilterKey,
  canMove,
  timezone,
}: {
  orgSlug: string;
  initialData: BoardData;
  initialFilterKey: string;
  canMove: boolean;
  timezone: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const group = (["assignee", "priority"].includes(params.get("group") ?? "") ? params.get("group") : "none") as Group;

  const filterKey = useMemo(() => {
    const f = new URLSearchParams();
    for (const k of ["teamId", "assigneeId", "priorityKey", "type"]) {
      const v = params.get(k);
      if (v) f.set(k, v);
    }
    return f.toString();
  }, [params]);
  const queryKey = useMemo(() => ["board", orgSlug, filterKey] as const, [orgSlug, filterKey]);

  const { data: board, isFetching } = useQuery({
    queryKey,
    queryFn: async (): Promise<BoardData> => {
      const res = await fetch(`/api/orgs/${orgSlug}/board${filterKey ? `?${filterKey}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't load the board.");
      return ((await res.json()) as { data: BoardData }).data;
    },
    initialData: filterKey === initialFilterKey ? initialData : undefined,
    // Poor man's real-time until SSE arrives (Phase 4).
    refetchInterval: 30_000,
  });

  const [needsResolution, setNeedsResolution] = useState<MoveVars | null>(null);
  const [resolution, setResolution] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: async (v: MoveVars) => {
      const r = await moveTicketAction(orgSlug, {
        ticketId: v.card.id,
        expectedVersion: v.card.version,
        toCategory: v.to,
        resolution: v.resolution,
      });
      if (!r.ok) throw new ActionFailure(r.error);
      return r.data;
    },
    // Optimistic: move the card now, remember the snapshot to roll back to.
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardData>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, applyMove(previous, v.card.id, v.to));
      return { previous };
    },
    onError: (err, v, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      const pe = err instanceof ActionFailure ? err.publicError : null;
      if (pe?.fieldErrors?.resolution && !v.resolution) {
        setResolution("");
        setNeedsResolution(v);
        return;
      }
      if (pe?.code === "CONFLICT")
        toast.warning(`${v.card.key} was changed by someone else. The board has been refreshed.`);
      else toast.error(pe?.message ?? "The move failed. The board has been refreshed.");
    },
    onSuccess: (_d, v) => {
      setNeedsResolution(null);
      toast.success(`${v.card.key} moved to ${COLUMN_LABELS[v.to]}`);
    },
    // Always reconcile with the server, success or failure.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["board", orgSlug] }),
  });

  // Pointer dragging via dnd-kit. Keyboard moving is handled explicitly below
  // (pick up / choose column / drop) so it never depends on layout geometry
  // or scroll position.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [kbMove, setKbMove] = useState<{ cardId: string; target: Column } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function onHandleKeyDown(e: React.KeyboardEvent, cardId: string) {
    const entry = cardsById.get(cardId);
    if (!entry) return;
    const pick = e.key === " " || e.key === "Enter";
    if (!kbMove || kbMove.cardId !== cardId) {
      if (!pick) return;
      e.preventDefault();
      setKbMove({ cardId, target: entry.column });
      setAnnouncement(
        `Picked up ${entry.card.key} in ${COLUMN_LABELS[entry.column]}. Use left and right arrows to choose a column, space to drop, escape to cancel.`,
      );
      return;
    }
    const idx = COLUMNS.indexOf(kbMove.target);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = COLUMNS[Math.min(COLUMNS.length - 1, Math.max(0, idx + (e.key === "ArrowRight" ? 1 : -1)))]!;
      setKbMove({ cardId, target: next });
      setAnnouncement(`${entry.card.key} over ${COLUMN_LABELS[next]}.`);
    } else if (pick) {
      e.preventDefault();
      setKbMove(null);
      if (kbMove.target === entry.column) {
        setAnnouncement(`${entry.card.key} stays in ${COLUMN_LABELS[entry.column]}.`);
      } else {
        setAnnouncement(`Moving ${entry.card.key} to ${COLUMN_LABELS[kbMove.target]}.`);
        requestMove(cardId, kbMove.target);
        // The card re-mounts in its new column: keep keyboard focus on it.
        const key = entry.card.key;
        setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-handle="${key}"]`)?.focus(), 50);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setKbMove(null);
      setAnnouncement(`Move of ${entry.card.key} cancelled.`);
    }
  }

  const cardsById = useMemo(() => {
    const m = new Map<string, { card: BoardCardData; column: Column }>();
    for (const col of board?.columns ?? [])
      for (const card of col.cards) m.set(card.id, { card, column: col.category });
    return m;
  }, [board]);

  function requestMove(cardId: string, to: Column) {
    const entry = cardsById.get(cardId);
    if (!entry || entry.column === to || move.isPending) return;
    move.mutate({ card: entry.card, from: entry.column, to });
  }

  const columnOf = (overId: string | number | undefined) => {
    const raw = String(overId ?? "")
      .split(":")
      .pop();
    return COLUMNS.find((c) => c === raw);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const e = cardsById.get(String(active.id));
      return e
        ? `Picked up ${e.card.key}, in ${COLUMN_LABELS[e.column]}. Use arrow keys to choose a column, space to drop, escape to cancel.`
        : "";
    },
    onDragOver: ({ active, over }) => {
      const e = cardsById.get(String(active.id));
      const c = columnOf(over?.id);
      return e && c ? `${e.card.key} is over ${COLUMN_LABELS[c]}.` : "";
    },
    onDragEnd: ({ active, over }) => {
      const e = cardsById.get(String(active.id));
      const c = columnOf(over?.id);
      return e && c
        ? c === e.column
          ? `${e.card.key} stays in ${COLUMN_LABELS[c]}.`
          : `Moving ${e.card.key} to ${COLUMN_LABELS[c]}.`
        : "Move cancelled.";
    },
    onDragCancel: ({ active }) => `Move of ${cardsById.get(String(active.id))?.card.key ?? "card"} cancelled.`,
  };

  const lanes = useMemo(() => {
    const map = new Map<string, { id: string; label: string; order: number }>();
    for (const col of board?.columns ?? []) for (const c of col.cards) map.set(laneOf(c, group).id, laneOf(c, group));
    if (map.size === 0) map.set("all", { id: "all", label: "", order: 0 });
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [board, group]);

  const activeCard = activeId ? cardsById.get(activeId)?.card : undefined;

  if (!board) return <p className="text-sm text-muted-foreground">Loading board…</p>;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3" aria-busy={isFetching || move.isPending}>
      <div className="flex items-center gap-2">
        <Select
          value={group}
          onValueChange={(v) => {
            const next = new URLSearchParams(params.toString());
            if (v === "none") next.delete("group");
            else next.set("group", v);
            router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Group cards by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="assignee">Group by assignee</SelectItem>
            <SelectItem value="priority">Group by priority</SelectItem>
          </SelectContent>
        </Select>
        {!canMove ? (
          <span className="text-xs text-muted-foreground">Read-only: your role can&apos;t change status.</span>
        ) : null}
      </div>

      <DndContext
        sensors={sensors}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "To move a ticket, press space or enter on its handle, use the left and right arrow keys to choose a column, then press space or enter to drop. Or use the card's Move to menu.",
          },
        }}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={(e: DragEndEvent) => {
          setActiveId(null);
          const to = columnOf(e.over?.id);
          if (to) requestMove(String(e.active.id), to);
        }}
      >
        <div className="grid min-w-0 grid-cols-1 gap-4">
          {lanes.map((lane) => (
            <section
              key={lane.id}
              aria-label={lane.label ? `Lane: ${lane.label}` : "Board"}
              className="grid min-w-0 grid-cols-1 gap-2"
            >
              {lane.label ? <h2 className="text-sm font-semibold">{lane.label}</h2> : null}
              {/* `relative`: makes this scroller the containing block for absolutely
                  positioned descendants (sr-only text), so they are clipped here
                  instead of widening the whole page. */}
              <div
                className="relative grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2"
                role="list"
                aria-label="Columns"
              >
                {board.columns.map((col) => {
                  const cards = col.cards.filter((c) => laneOf(c, group).id === lane.id);
                  return (
                    <BoardColumn
                      key={col.category}
                      id={`${lane.id}:${col.category}`}
                      category={col.category}
                      count={group === "none" ? col.total : cards.length}
                      truncated={group === "none" && col.total > col.cards.length}
                      keyboardTarget={
                        kbMove?.target === col.category &&
                        laneOf(cardsById.get(kbMove.cardId)!.card, group).id === lane.id
                      }
                    >
                      {cards.map((card) => (
                        <BoardCard
                          key={card.id}
                          orgSlug={orgSlug}
                          card={card}
                          column={col.category}
                          canMove={canMove}
                          timezone={timezone}
                          onMove={(to) => requestMove(card.id, to)}
                          dimmed={activeId === card.id}
                          lifted={kbMove?.cardId === card.id}
                          onHandleKeyDown={(e) => onHandleKeyDown(e, card.id)}
                          onHandleBlur={() => kbMove?.cardId === card.id && setKbMove(null)}
                        />
                      ))}
                    </BoardColumn>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="rotate-1 rounded-lg border bg-card p-2.5 text-sm shadow-lg">
              <span className="font-mono text-xs text-muted-foreground">{activeCard.key}</span>
              <p className="line-clamp-2 font-medium">{activeCard.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </p>

      <Dialog open={needsResolution !== null} onOpenChange={(o) => !o && setNeedsResolution(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {needsResolution?.card.key}</DialogTitle>
            <DialogDescription>This workflow requires a resolution before a ticket can be resolved.</DialogDescription>
          </DialogHeader>
          <form
            id="board-resolve"
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (needsResolution && resolution.trim()) move.mutate({ ...needsResolution, resolution });
            }}
          >
            <Label htmlFor="board-resolution">Resolution</Label>
            <Textarea
              id="board-resolution"
              rows={4}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              autoFocus
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeedsResolution(null)}>
              Cancel
            </Button>
            <Button type="submit" form="board-resolve" disabled={!resolution.trim() || move.isPending}>
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardColumn({
  id,
  category,
  count,
  truncated,
  keyboardTarget,
  children,
}: {
  id: string;
  category: Column;
  count: number;
  truncated: boolean;
  keyboardTarget: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-label={`${COLUMN_LABELS[category]}, ${count} tickets`}
      data-testid={`column-${category}`}
      className={cn(
        "flex min-h-40 flex-col gap-2 rounded-lg border bg-muted/40 p-2 transition-colors",
        (isOver || keyboardTarget) && "border-primary bg-primary/5",
      )}
      data-keyboard-target={keyboardTarget || undefined}
    >
      <div className="flex items-center gap-2 px-1 pt-0.5">
        <span className={cn("size-2 rounded-full", COLUMN_ACCENT[category])} aria-hidden />
        <h3 className="text-xs font-semibold tracking-wide uppercase">{COLUMN_LABELS[category]}</h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>
      </div>
      <ul className="grid grid-cols-1 gap-2">{children}</ul>
      {truncated ? (
        <p className="px-1 text-xs text-muted-foreground">Showing the 50 most urgent. Use filters to narrow.</p>
      ) : null}
    </div>
  );
}

function BoardCard({
  orgSlug,
  card,
  column,
  canMove,
  timezone,
  onMove,
  dimmed,
  lifted,
  onHandleKeyDown,
  onHandleBlur,
}: {
  orgSlug: string;
  card: BoardCardData;
  column: Column;
  canMove: boolean;
  timezone: string;
  onMove: (to: Column) => void;
  dimmed: boolean;
  lifted: boolean;
  onHandleKeyDown: (e: React.KeyboardEvent) => void;
  onHandleBlur: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: card.id, disabled: !canMove });
  const overdue = card.dueAt !== null && new Date(card.dueAt).getTime() < Date.now();
  return (
    <li
      ref={setNodeRef}
      data-testid="board-card"
      data-key={card.key}
      className={cn(
        "grid gap-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs",
        dimmed && "opacity-40",
        lifted && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-1">
        {canMove ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="-ml-1 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
            aria-label={`Move ${card.key}`}
            data-handle={card.key}
            {...attributes}
            {...listeners}
            // After dnd-kit's spread: these win. Keyboard moving is ours.
            aria-pressed={lifted}
            onKeyDown={onHandleKeyDown}
            onBlur={onHandleBlur}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{card.key}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">· {TICKET_TYPE_LABELS[card.type]}</span>
        {canMove ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Move ${card.key} to…`}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
              {COLUMNS.filter((c) => c !== column).map((c) => (
                <DropdownMenuItem key={c} onSelect={() => onMove(c)}>
                  {COLUMN_LABELS[c]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Link
        href={`/o/${orgSlug}/tickets/${card.key}`}
        className="line-clamp-2 font-medium hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {card.title}
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <PriorityBadge {...card.priority} />
        {card.dueAt ? (
          <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
            <CalendarClock className="size-3" aria-hidden />
            {overdue ? "Overdue · " : ""}
            {new Date(card.dueAt).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" })}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1">
          {card.assignee ? (
            <>
              <UserAvatar name={card.assignee.name} className="size-5" />
              <span className="sr-only">Assigned to {card.assignee.name}</span>
            </>
          ) : (
            <span>Unassigned</span>
          )}
        </span>
      </div>
    </li>
  );
}
