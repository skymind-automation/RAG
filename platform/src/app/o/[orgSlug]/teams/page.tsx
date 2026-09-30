import { Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/common/user-avatar";
import { AddTeamMember } from "@/components/teams/add-team-member";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { roleHas } from "@/lib/permissions";
import { requireOrganizationPage } from "@/server/auth/context";
import { listMembers } from "@/server/memberships/membership-service";
import { listTeams } from "@/server/teams/team-service";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("teams.read")) notFound();
  const teams = await listTeams(ctx);
  const canManage = ctx.permissions.has("teams.manage");
  // Only people who can work tickets are useful team members.
  const workers =
    canManage && ctx.permissions.has("members.read")
      ? (await listMembers(ctx)).filter((m) => roleHas(m.role, "tickets.update"))
      : [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Teams"
        description="Groups of agents for routing and boards."
        actions={canManage ? <CreateTeamDialog orgSlug={orgSlug} /> : null}
      />
      {teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description={
            canManage ? "Create a team to start routing work." : "An administrator hasn't created any teams yet."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {teams.map((t) => {
            const inTeam = new Set(t.members.map((m) => m.membershipId));
            return (
              <Card key={t.id}>
                <CardHeader>
                  <CardTitle className="text-sm">{t.name}</CardTitle>
                  <CardDescription>
                    {t.description || `${t.members.length} ${t.members.length === 1 ? "member" : "members"}`}
                  </CardDescription>
                  {canManage ? (
                    <CardAction>
                      <AddTeamMember
                        orgSlug={orgSlug}
                        teamId={t.id}
                        teamName={t.name}
                        candidates={workers
                          .filter((w) => !inTeam.has(w.membershipId))
                          .map((w) => ({ membershipId: w.membershipId, name: w.name }))}
                      />
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {t.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {t.members.map((m) => (
                        <li
                          key={m.membershipId}
                          className="flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs"
                        >
                          <UserAvatar name={m.name} className="size-5" />
                          {m.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
