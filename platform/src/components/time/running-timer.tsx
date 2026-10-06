"use client";

import { Square, Timer } from "lucide-react";
import Link from "next/link";
import { stopTimerAction } from "@/app/actions/work";
import { Button } from "@/components/ui/button";
import { useMutation } from "@/hooks/use-mutation";
import { Elapsed } from "./elapsed";

export interface RunningTimerView {
  startedAt: string;
  ticket: { key: string; title: string };
}

/** Sidebar indicator: visible on every page while a timer runs. */
export function RunningTimer({ orgSlug, timer }: { orgSlug: string; timer: RunningTimerView }) {
  const { run, pending } = useMutation();
  return (
    <div
      role="status"
      aria-label="Running timer"
      className="grid gap-1 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs"
      data-testid="running-timer"
    >
      <div className="flex items-center gap-1.5 font-medium text-primary">
        <Timer className="size-3.5" aria-hidden />
        <Elapsed since={timer.startedAt} className="tabular-nums" />
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          disabled={pending}
          onClick={() =>
            run(() => stopTimerAction(orgSlug), {
              success: "Timer stopped",
            })
          }
        >
          <Square aria-hidden /> Stop
        </Button>
      </div>
      <Link
        href={`/o/${orgSlug}/tickets/${timer.ticket.key}`}
        className="truncate text-muted-foreground hover:underline"
      >
        <span className="font-mono">{timer.ticket.key}</span> {timer.ticket.title}
      </Link>
    </div>
  );
}
