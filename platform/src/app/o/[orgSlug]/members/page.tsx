import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { RoleBadge } from "@/components/common/role-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { InviteDialog } from "@/components/members/invite-dialog";
import { RemoveMemberButton, RevokeInvitationButton, RoleSelect } from "@/components/members/member-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLES, ROLE_LABELS, canGrantRole, canManageMember } from "@/lib/permissions";
import { requireOrganizationPage } from "@/server/auth/context";
import { listMembers, listPendingInvitations } from "@/server/memberships/membership-service";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("members.read")) notFound();

  const members = await listMembers(ctx);
  const canInvite = ctx.permissions.has("members.invite");
  const invites = canInvite ? await listPendingInvitations(ctx) : [];
  const grantable = ROLES.filter((r) => canGrantRole(ctx.role, r));
  const tz = ctx.organization.timezone;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Members"
        description={`${members.length} active ${members.length === 1 ? "member" : "members"}`}
        actions={canInvite ? <InviteDialog orgSlug={orgSlug} grantableRoles={grantable} /> : null}
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="hidden md:table-cell">Teams</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isSelf = m.userId === ctx.user.id;
              const manageable = !isSelf && canManageMember(ctx.role, m.role);
              return (
                <TableRow key={m.membershipId} data-testid={`member-${m.email}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserAvatar name={m.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.name}
                          {isSelf ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {m.teams.map((t) => t.name).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {m.joinedAt.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" })}
                  </TableCell>
                  <TableCell>
                    {manageable && ctx.permissions.has("members.update") ? (
                      <RoleSelect
                        orgSlug={orgSlug}
                        membershipId={m.membershipId}
                        role={m.role}
                        grantableRoles={grantable}
                        memberName={m.name}
                      />
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isSelf || (manageable && ctx.permissions.has("members.remove")) ? (
                      <RemoveMemberButton
                        orgSlug={orgSlug}
                        membershipId={m.membershipId}
                        memberName={m.name}
                        isSelf={isSelf}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {canInvite && invites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableBody>
                {invites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-4">{i.email}</TableCell>
                    <TableCell className="text-muted-foreground">{ROLE_LABELS[i.role]}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      Expires {i.expiresAt.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeInvitationButton orgSlug={orgSlug} invitationId={i.id} email={i.email} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
