import type { Metadata } from "next";
import Link from "next/link";
import { DeltaLogo } from "@/components/brand/logo";
import { CreateOrgForm } from "@/components/org/create-org-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuthPage } from "@/server/auth/context";
import { listMyOrganizations } from "@/server/organizations/organization-service";

export const metadata: Metadata = { title: "Create organization" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const auth = await requireAuthPage();
  const orgs = await listMyOrganizations(auth.user.id);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <DeltaLogo priority className="mb-8 h-10" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">
            {orgs.length ? "Create another organization" : `Welcome, ${auth.user.name.split(" ")[0]}`}
          </CardTitle>
          <CardDescription>
            An organization is an isolated workspace: its tickets, knowledge and AI history are never visible to any
            other organization. You&apos;ll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrgForm />
          {orgs.length ? (
            <p className="mt-4 text-center text-sm">
              <Link href={`/o/${orgs[0]!.slug}`} className="text-muted-foreground underline-offset-4 hover:underline">
                Back to {orgs[0]!.name}
              </Link>
            </p>
          ) : (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Invited to an existing organization? Open the link from your invitation.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
