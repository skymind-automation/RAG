import { AppShell } from "@/components/shell/app-shell";
import { requireOrganizationPage } from "@/server/auth/context";
import { listMyOrganizations } from "@/server/organizations/organization-service";

export const dynamic = "force-dynamic";

/**
 * Every page under /o/<slug> renders inside this layout, which establishes
 * the organization context first (non-members get a 404). Pages call
 * requireOrganizationPage() again — memoised per request — and perform their
 * own permission checks; a layout alone is not an authorization boundary.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  const organizations = await listMyOrganizations(ctx.user.id);
  return (
    <AppShell
      current={{ slug: ctx.organization.slug, name: ctx.organization.name, role: ctx.role }}
      organizations={organizations.map((o) => ({ slug: o.slug, name: o.name, role: o.role }))}
      permissions={[...ctx.permissions]}
      user={{ name: ctx.user.name, email: ctx.user.email }}
    >
      {children}
    </AppShell>
  );
}
