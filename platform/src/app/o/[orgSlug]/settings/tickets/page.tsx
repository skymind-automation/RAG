import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { TicketConfigAdmin } from "@/components/settings/ticket-config-admin";
import { requireOrganizationPage } from "@/server/auth/context";
import { getTicketConfiguration } from "@/server/tickets/ticket-config-service";

export const metadata: Metadata = { title: "Ticket settings" };

export default async function TicketSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  const can = {
    configure: ctx.permissions.has("tickets.configure"),
    workflows: ctx.permissions.has("workflows.manage"),
  };
  if (!can.configure && !can.workflows) notFound();
  const config = await getTicketConfiguration(ctx);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Ticket settings"
        description="Categories, priorities, workflow and custom fields for this organization."
      />
      <TicketConfigAdmin
        orgSlug={orgSlug}
        can={can}
        config={{
          workflow: config.workflow,
          priorities: config.priorities,
          categories: config.categories.map((c) => ({ id: c.id, name: c.name, ticketCount: c._count.tickets })),
          customFields: config.customFields.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            ticketTypes: f.ticketTypes,
            options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : [],
          })),
        }}
      />
    </div>
  );
}
