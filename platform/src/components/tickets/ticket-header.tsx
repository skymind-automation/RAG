"use client";

import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTicketAction, transitionTicketAction, updateTicketAction } from "@/app/actions/tickets";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@/hooks/use-mutation";
import { TicketStatusBadge } from "./badges";

export interface TransitionOption {
  requiresResolution: boolean;
  toStatus: { id: string; name: string; category: "NEW" | "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" };
}

export function TicketHeader({
  orgSlug,
  ticket,
  transitions,
  can,
}: {
  orgSlug: string;
  ticket: {
    id: string;
    key: string;
    title: string;
    version: number;
    resolution: string | null;
    status: TransitionOption["toStatus"];
  };
  transitions: TransitionOption[];
  can: { update: boolean; transition: boolean; delete: boolean };
}) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ticket.title);
  const [resolving, setResolving] = useState<TransitionOption | null>(null);
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [resolutionError, setResolutionError] = useState<string>();

  async function transition(t: TransitionOption, res?: string) {
    const r = await run(
      () =>
        transitionTicketAction(orgSlug, {
          ticketId: ticket.id,
          toStatusId: t.toStatus.id,
          expectedVersion: ticket.version,
          resolution: res,
        }),
      {
        success: `Status changed to ${t.toStatus.name}`,
        onError: (e) =>
          t.requiresResolution ? setResolutionError(e.fieldErrors?.resolution?.[0] ?? e.message) : undefined,
      },
    );
    if (r.ok) setResolving(null);
  }

  return (
    <div className="grid gap-3 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-mono">{ticket.key}</span>
        <span aria-hidden>·</span>
        {can.transition && transitions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Status: ${ticket.status.name}. Change status`}
              data-testid="status-menu"
              disabled={pending}
            >
              <TicketStatusBadge name={ticket.status.name} category={ticket.status.category} />
              <ChevronDown className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
              {transitions.map((t) => (
                <DropdownMenuItem
                  key={t.toStatus.id}
                  onSelect={() =>
                    t.requiresResolution ? (setResolutionError(undefined), setResolving(t)) : void transition(t)
                  }
                >
                  <TicketStatusBadge name={t.toStatus.name} category={t.toStatus.category} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <TicketStatusBadge name={ticket.status.name} category={ticket.status.category} />
        )}
        <div className="ml-auto flex gap-1">
          {can.update && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit title
            </Button>
          ) : null}
          {can.delete ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" aria-label="Delete ticket">
                  <Trash2 aria-hidden />
                </Button>
              }
              title={`Delete ${ticket.key}?`}
              description="The ticket disappears from lists and search. Its history is retained in the audit log."
              confirmLabel="Delete"
              destructive
              onConfirm={async () => {
                const r = await deleteTicketAction(orgSlug, { ticketId: ticket.id, expectedVersion: ticket.version });
                if (!r.ok) return false;
                router.replace(`/o/${orgSlug}/tickets`);
                return true;
              }}
            />
          ) : null}
        </div>
      </div>

      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() =>
              updateTicketAction(orgSlug, { ticketId: ticket.id, expectedVersion: ticket.version, title }),
            );
            if (r.ok) setEditing(false);
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Ticket title"
            autoFocus
            className="text-base"
          />
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => (setTitle(ticket.title), setEditing(false))}>
            Cancel
          </Button>
        </form>
      ) : (
        <h1 className="text-xl font-semibold tracking-tight break-words">{ticket.title}</h1>
      )}

      <Dialog open={resolving !== null} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {ticket.key}</DialogTitle>
            <DialogDescription>Describe how this was resolved. The requester will see it.</DialogDescription>
          </DialogHeader>
          <form
            id="resolve-form"
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (resolving) void transition(resolving, resolution);
            }}
          >
            <Label htmlFor="resolution">Resolution</Label>
            <Textarea
              id="resolution"
              rows={5}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              aria-invalid={!!resolutionError}
              aria-describedby={resolutionError ? "resolution-error" : undefined}
            />
            {resolutionError ? (
              <p id="resolution-error" className="text-xs text-destructive">
                {resolutionError}
              </p>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button type="submit" form="resolve-form" disabled={pending}>
              Move to {resolving?.toStatus.name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
