"use server";

import { revalidatePath } from "next/cache";
import { runInOrg, type ActionResult } from "@/server/actions/run";
import {
  confirmUpload,
  deleteAttachment,
  getDownloadUrl,
  requestUpload,
} from "@/server/attachments/attachment-service";
import { addRelation, removeRelation } from "@/server/tickets/relation-service";
import {
  addComment,
  assignTicket,
  createTicket,
  deleteTicket,
  transitionTicket,
  updateTicket,
} from "@/server/tickets/ticket-service";
import { addWatcher, removeWatcher } from "@/server/tickets/watcher-service";

/**
 * Ticket server actions. Each is a thin adapter: runInOrg establishes the
 * organization context from the slug + session, the service authorizes and
 * validates. Inputs are `unknown` on purpose — the services parse them.
 */

function refresh(orgSlug: string) {
  revalidatePath(`/o/${orgSlug}/tickets`, "layout");
}

async function mutate<T>(orgSlug: string, op: string, fn: Parameters<typeof runInOrg<T>>[2]): Promise<ActionResult<T>> {
  const result = await runInOrg(orgSlug, op, fn);
  if (result.ok) refresh(orgSlug);
  return result;
}

export async function createTicketAction(orgSlug: string, input: unknown): Promise<ActionResult<{ key: string }>> {
  return mutate(orgSlug, "tickets.create", async (ctx) => ({ key: (await createTicket(ctx, input)).key }));
}

export async function updateTicketAction(orgSlug: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  return mutate(orgSlug, "tickets.update", async (ctx) => ({ version: (await updateTicket(ctx, input)).version }));
}

export async function transitionTicketAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  return mutate(orgSlug, "tickets.transition", async (ctx) => ({
    version: (await transitionTicket(ctx, input)).version,
  }));
}

export async function assignTicketAction(orgSlug: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  return mutate(orgSlug, "tickets.assign", async (ctx) => ({ version: (await assignTicket(ctx, input)).version }));
}

export async function deleteTicketAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "tickets.delete", async (ctx) => {
    await deleteTicket(ctx, input);
    return null;
  });
}

export async function addCommentAction(orgSlug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return mutate(orgSlug, "tickets.comment", async (ctx) => ({ id: (await addComment(ctx, input)).id }));
}

export async function addWatcherAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "tickets.watch", async (ctx) => {
    await addWatcher(ctx, input);
    return null;
  });
}

export async function removeWatcherAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "tickets.unwatch", async (ctx) => {
    await removeWatcher(ctx, input);
    return null;
  });
}

export async function addRelationAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "tickets.relate", async (ctx) => {
    await addRelation(ctx, input);
    return null;
  });
}

export async function removeRelationAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "tickets.unrelate", async (ctx) => {
    await removeRelation(ctx, input);
    return null;
  });
}

export async function requestUploadAction(orgSlug: string, input: unknown) {
  return runInOrg(orgSlug, "attachments.request_upload", (ctx) => requestUpload(ctx, input));
}

export async function confirmUploadAction(orgSlug: string, input: unknown) {
  return mutate(orgSlug, "attachments.confirm", (ctx) => confirmUpload(ctx, input));
}

export async function getDownloadUrlAction(orgSlug: string, input: unknown): Promise<ActionResult<{ url: string }>> {
  return runInOrg(orgSlug, "attachments.download", async (ctx) => ({ url: await getDownloadUrl(ctx, input) }));
}

export async function deleteAttachmentAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  return mutate(orgSlug, "attachments.delete", async (ctx) => {
    await deleteAttachment(ctx, input);
    return null;
  });
}
