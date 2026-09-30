"use server";

import { revalidatePath } from "next/cache";
import { runAuthed, runInOrg, type ActionResult } from "@/server/actions/run";
import {
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "@/server/memberships/membership-service";

/** Runtime origin for links. AUTH_URL first: NEXT_PUBLIC_* is inlined at build time. */
function appUrl(): string {
  return (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function inviteMemberAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const result = await runInOrg(orgSlug, "members.invite", async (ctx) => {
    const { token } = await inviteMember(ctx, input);
    // Email delivery arrives with the notification subsystem (Phase 4); until
    // then the inviter shares the link. The raw token is shown once, here.
    return { inviteUrl: `${appUrl()}/invite/${token}` };
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/members`);
  return result;
}

export async function revokeInvitationAction(orgSlug: string, invitationId: string): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "members.revoke_invitation", async (ctx) => {
    await revokeInvitation(ctx, invitationId);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/members`);
  return result;
}

export async function changeMemberRoleAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "members.update", async (ctx) => {
    await changeMemberRole(ctx, input);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}/members`);
  return result;
}

export async function removeMemberAction(orgSlug: string, input: unknown): Promise<ActionResult<null>> {
  const result = await runInOrg(orgSlug, "members.remove", async (ctx) => {
    await removeMember(ctx, input);
    return null;
  });
  if (result.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return result;
}

export async function acceptInvitationAction(token: string): Promise<ActionResult<{ slug: string }>> {
  return runAuthed("members.accept_invitation", (auth) => acceptInvitation(auth, token));
}
