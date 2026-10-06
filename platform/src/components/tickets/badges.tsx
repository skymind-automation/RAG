import type { StatusCategory } from "@prisma/client";
import { cn } from "@/lib/utils";

const CATEGORY_STYLE: Record<StatusCategory, string> = {
  NEW: "bg-sky-50 text-sky-800 ring-sky-200",
  OPEN: "bg-blue-50 text-blue-800 ring-blue-200",
  IN_PROGRESS: "bg-amber-50 text-amber-900 ring-amber-200",
  PENDING: "bg-violet-50 text-violet-800 ring-violet-200",
  RESOLVED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  CLOSED: "bg-neutral-100 text-neutral-700 ring-neutral-200",
};

export function TicketStatusBadge({ name, category }: { name: string; category: StatusCategory }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        CATEGORY_STYLE[category],
      )}
    >
      {name}
    </span>
  );
}

export function PriorityBadge({ name, color, level }: { name: string; color: string; level: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={`Priority level ${level}`}>
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {name}
    </span>
  );
}

export const TICKET_TYPE_LABELS = {
  INCIDENT: "Incident",
  SERVICE_REQUEST: "Service request",
  PROBLEM: "Problem",
  CHANGE: "Change",
  TASK: "Task",
  QUESTION: "Question",
} as const;
