"use server";

import { revalidatePath } from "next/cache";
import { runInOrg, type ActionResult } from "@/server/actions/run";
import { moveTicket } from "@/server/boards/board-service";
import { deleteTimeEntry, logTime, startTimer, stopTimer } from "@/server/time/time-service";

function refresh(orgSlug: string) {
  revalidatePath(`/o/${orgSlug}`, "layout");
}

export async function moveTicketAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ version: number; moved: boolean }>> {
  const r = await runInOrg(orgSlug, "boards.move", async (ctx) => {
    const res = await moveTicket(ctx, input);
    return { version: res.version, moved: res.moved };
  });
  if (r.ok) revalidatePath(`/o/${orgSlug}/tickets`, "layout");
  return r;
}

export async function startTimerAction(orgSlug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runInOrg(orgSlug, "time.start", async (ctx) => ({ id: (await startTimer(ctx, input)).id }));
  if (r.ok) refresh(orgSlug);
  return r;
}

export async function stopTimerAction(
  orgSlug: string,
): Promise<ActionResult<{ durationSeconds: number; capped: boolean }>> {
  const r = await runInOrg(orgSlug, "time.stop", async (ctx) => {
    const { durationSeconds, capped } = await stopTimer(ctx);
    return { durationSeconds, capped };
  });
  if (r.ok) refresh(orgSlug);
  return r;
}

export async function logTimeAction(orgSlug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runInOrg(orgSlug, "time.log", async (ctx) => ({ id: (await logTime(ctx, input)).id }));
  if (r.ok) refresh(orgSlug);
  return r;
}

export async function deleteTimeEntryAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const r = await runInOrg(orgSlug, "time.delete", async (ctx) => {
    await deleteTimeEntry(ctx, input);
    return null;
  });
  if (r.ok) refresh(orgSlug);
  return r;
}
