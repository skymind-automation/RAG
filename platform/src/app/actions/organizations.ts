"use server";

import { revalidatePath } from "next/cache";
import { runAuthed, runInOrg, type ActionResult } from "@/server/actions/run";
import {
  createOrganization,
  switchOrganization,
  updateOrganization,
} from "@/server/organizations/organization-service";

export async function createOrganizationAction(input: unknown): Promise<ActionResult<{ slug: string }>> {
  return runAuthed("organization.create", async (auth) => {
    const org = await createOrganization(auth, input);
    return { slug: org.slug };
  });
}

export async function switchOrganizationAction(slug: string): Promise<ActionResult<{ slug: string }>> {
  return runAuthed("organization.switch", async (auth) => {
    const ctx = await switchOrganization(auth, slug);
    return { slug: ctx.organization.slug };
  });
}

export async function updateOrganizationAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "organization.update", async (ctx) => {
    await updateOrganization(ctx, input);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return result;
}
