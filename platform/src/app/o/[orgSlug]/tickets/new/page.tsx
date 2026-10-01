import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { TicketCreateForm } from "@/components/tickets/ticket-create-form";
import { requireOrganizationPage } from "@/server/auth/context";
import { getTicketFormOptions } from "@/server/tickets/ticket-config-service";

export const metadata: Metadata = { title: "New ticket" };

export default async function NewTicketPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("tickets.create")) notFound();
  const options = await getTicketFormOptions(ctx);
  const staff = ctx.permissions.has("tickets.update");
  return (
    <div className="grid gap-4">
      <PageHeader
        title={staff ? "New ticket" : "New request"}
        description={staff ? undefined : "Tell us what's going on. We'll keep you updated here."}
      />
      <TicketCreateForm orgSlug={orgSlug} options={options} staff={staff} currentUserId={ctx.user.id} />
    </div>
  );
}
