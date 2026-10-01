import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { OrgSettingsForm } from "@/components/org/org-settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrganizationPage } from "@/server/auth/context";
import { getOrganizationSettings } from "@/server/organizations/organization-service";

export const metadata: Metadata = { title: "Organization settings" };

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("organization.update")) notFound();
  const org = await getOrganizationSettings(ctx);
  return (
    <div className="grid gap-6">
      <PageHeader title="Organization settings" description={`Address: /o/${org.slug} (permanent)`} />
      <Card>
        <CardContent>
          <OrgSettingsForm
            orgSlug={orgSlug}
            padding={org.ticketNumberPadding}
            initial={{
              name: org.name,
              timezone: org.timezone,
              ticketPrefix: org.ticketPrefix,
              ticketNumberPadding: org.ticketNumberPadding,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
