"use server";

import { revalidatePath } from "next/cache";
import { runInOrg, type ActionResult } from "@/server/actions/run";
import {
  addWorkflowStatus,
  archiveCategory,
  archiveCustomField,
  createCategory,
  createCustomField,
  renameCategory,
  renameWorkflowStatus,
  setDefaultPriority,
  setWorkflowTransition,
  updatePriority,
} from "@/server/tickets/ticket-config-service";
import type { OrgContext } from "@/server/context";

async function configure(
  orgSlug: string,
  op: string,
  fn: (ctx: OrgContext) => Promise<unknown>,
): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, op, async (ctx) => {
    await fn(ctx);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return result;
}

export async function createCategoryAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.create_category", (ctx) => createCategory(ctx, input));
}
export async function renameCategoryAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.rename_category", (ctx) => renameCategory(ctx, input));
}
export async function archiveCategoryAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.archive_category", (ctx) => archiveCategory(ctx, input));
}
export async function updatePriorityAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.update_priority", (ctx) => updatePriority(ctx, input));
}
export async function setDefaultPriorityAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.default_priority", (ctx) => setDefaultPriority(ctx, input));
}
export async function addWorkflowStatusAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "workflow.add_status", (ctx) => addWorkflowStatus(ctx, input));
}
export async function renameWorkflowStatusAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "workflow.rename_status", (ctx) => renameWorkflowStatus(ctx, input));
}
export async function setWorkflowTransitionAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "workflow.set_transition", (ctx) => setWorkflowTransition(ctx, input));
}
export async function createCustomFieldAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.create_field", (ctx) => createCustomField(ctx, input));
}
export async function archiveCustomFieldAction(orgSlug: string, input: unknown) {
  return configure(orgSlug, "ticket_config.archive_field", (ctx) => archiveCustomField(ctx, input));
}
