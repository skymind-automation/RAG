"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { updateTicketAction } from "@/app/actions/tickets";
import { Markdown } from "@/components/common/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@/hooks/use-mutation";

export function DescriptionEditor({
  orgSlug,
  ticketId,
  version,
  description,
}: {
  orgSlug: string;
  ticketId: string;
  version: number;
  description: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);
  const { run, pending } = useMutation();
  if (!editing) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Description</h2>
          <Button variant="ghost" size="xs" onClick={() => (setValue(description), setEditing(true))}>
            <Pencil aria-hidden /> Edit
          </Button>
        </div>
        {description ? (
          <Markdown>{description}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
      </div>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() =>
          updateTicketAction(orgSlug, { ticketId, expectedVersion: version, description: value }),
        );
        if (r.ok) setEditing(false);
      }}
    >
      <label htmlFor="desc-edit" className="sr-only">
        Description
      </label>
      <Textarea id="desc-edit" rows={10} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
