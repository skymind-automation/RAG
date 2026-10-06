"use client";

import { Play, Plus, Square, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteTimeEntryAction, logTimeAction, startTimerAction, stopTimerAction } from "@/app/actions/work";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "@/hooks/use-mutation";
import type { PublicError } from "@/lib/errors";
import { Elapsed } from "./elapsed";

export interface TimeEntryView {
  id: string;
  description: string;
  billable: boolean;
  source: "TIMER" | "MANUAL";
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  user: { id: string; name: string };
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function TimePanel({
  orgSlug,
  ticketId,
  ticketKey,
  entries,
  totals,
  running,
  currentUserId,
  can,
  timezone,
}: {
  orgSlug: string;
  ticketId: string;
  ticketKey: string;
  entries: TimeEntryView[];
  totals: { totalSeconds: number; billableSeconds: number };
  /** The caller's running timer anywhere in the org, if any. */
  running: { startedAt: string; ticket: { id: string; key: string } } | null;
  currentUserId: string;
  can: { track: boolean; manage: boolean };
  timezone: string;
}) {
  const { run, pending } = useMutation();
  const [logging, setLogging] = useState(false);
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(false);
  const [error, setError] = useState<string>();
  const runningHere = running?.ticket.id === ticketId;

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const total = Number(hours || 0) * 60 + Number(minutes || 0);
    const r = await run(() => logTimeAction(orgSlug, { ticketId, minutes: total, description, billable }), {
      success: `Logged ${fmt(total * 60)}`,
      onError: (er: PublicError) => setError((er.fieldErrors && Object.values(er.fieldErrors)[0]?.[0]) || er.message),
    });
    if (r.ok) {
      setLogging(false);
      setDescription("");
      setBillable(false);
    }
  }

  return (
    <section aria-label="Time tracking" className="rounded-lg border bg-card p-3" data-testid="time-panel">
      <div className="mb-2 flex items-center gap-2">
        <Timer className="size-3.5 text-muted-foreground" aria-hidden />
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Time</h2>
        <span className="ml-auto text-xs tabular-nums" aria-label="Total logged time">
          {fmt(totals.totalSeconds)}
          {totals.billableSeconds ? (
            <span className="text-muted-foreground"> · {fmt(totals.billableSeconds)} billable</span>
          ) : null}
        </span>
      </div>

      {can.track ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {runningHere ? (
            <>
              <Elapsed since={running!.startedAt} className="font-mono text-sm text-primary tabular-nums" />
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => stopTimerAction(orgSlug), { success: "Timer stopped" })}
              >
                <Square aria-hidden /> Stop timer
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => startTimerAction(orgSlug, { ticketId, switchFromRunning: Boolean(running) }), {
                  success: running ? `Timer moved from ${running.ticket.key} to ${ticketKey}` : "Timer started",
                })
              }
            >
              <Play aria-hidden /> {running ? `Switch timer here (from ${running.ticket.key})` : "Start timer"}
            </Button>
          )}
          {!logging ? (
            <Button size="sm" variant="ghost" onClick={() => setLogging(true)}>
              <Plus aria-hidden /> Log time
            </Button>
          ) : null}
        </div>
      ) : null}

      {logging ? (
        <form onSubmit={submitLog} className="mb-3 grid gap-2 rounded-md border p-2" aria-label="Log time manually">
          <div className="flex items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="log-hours" className="text-xs">
                Hours
              </Label>
              <Input
                id="log-hours"
                type="number"
                min={0}
                max={24}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="h-7 w-16"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="log-minutes" className="text-xs">
                Minutes
              </Label>
              <Input
                id="log-minutes"
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="h-7 w-16"
              />
            </div>
            <label className="mb-1 inline-flex items-center gap-1.5 text-xs">
              <Checkbox checked={billable} onCheckedChange={(c) => setBillable(c === true)} /> Billable
            </label>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="log-desc" className="text-xs">
              What did you do?
            </Label>
            <Input id="log-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-7" />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Log
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLogging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time logged.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-xs"
              data-testid="time-entry"
            >
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-medium">{e.user.name}</span>
                  {e.description ? <span className="text-muted-foreground"> · {e.description}</span> : null}
                </p>
                <p className="text-muted-foreground">
                  {new Date(e.startedAt).toLocaleString("en-US", {
                    timeZone: timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {e.billable ? " · billable" : ""}
                  {e.source === "MANUAL" ? " · manual" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-medium tabular-nums">
                  {e.endedAt ? fmt(e.durationSeconds ?? 0) : <Elapsed since={e.startedAt} className="text-primary" />}
                </span>
                {e.user.id === currentUserId || can.manage ? (
                  <button
                    type="button"
                    className="rounded text-muted-foreground hover:text-destructive"
                    aria-label={`Delete time entry by ${e.user.name}`}
                    onClick={() =>
                      run(() => deleteTimeEntryAction(orgSlug, { timeEntryId: e.id }), { success: "Entry removed" })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
