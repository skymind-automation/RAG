"use server";

import { revalidatePath } from "next/cache";
import { runInOrg, type ActionResult } from "@/server/actions/run";
import { addTeamMember, createTeam, removeTeamMember } from "@/server/teams/team-service";

export async function createTeamAction(orgSlug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runInOrg(orgSlug, "teams.create", async (ctx) => {
    const team = await createTeam(ctx, input);
    return { id: team.id };
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/teams`);
  return result;
}

export async function addTeamMemberAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "teams.add_member", async (ctx) => {
    await addTeamMember(ctx, input);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/teams`);
  return result;
}

export async function removeTeamMemberAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "teams.remove_member", async (ctx) => {
    await removeTeamMember(ctx, input);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/teams`);
  return result;
}
