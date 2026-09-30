import type { Metadata } from "next";
import Link from "next/link";
import { DeltaLogo } from "@/components/brand/logo";
import { AcceptInviteButton } from "@/components/members/accept-invite-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireAuth } from "@/server/auth/context";
import { previewInvitation } from "@/server/memberships/membership-service";

export const metadata: Metadata = { title: "Invitation", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvitation(token);
  const auth = await requireAuth().catch(() => null);
  const here = `/invite/${token}`;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <DeltaLogo priority className="mb-8 h-10" />
      <Card className="w-full max-w-md">
        {!invite ? (
          <CardHeader>
            <CardTitle className="text-lg">This invitation isn&apos;t valid</CardTitle>
            <CardDescription>
              It may have expired, been revoked, or already been used. Ask an administrator for a new one.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Join {invite.organizationName}</CardTitle>
              <CardDescription>
                You&apos;ve been invited as <strong>{ROLE_LABELS[invite.role]}</strong>. This invitation is for{" "}
                <strong>{invite.email}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!auth ? (
                <div className="grid gap-2">
                  <Button asChild size="lg">
                    <Link href={`/register?callbackUrl=${encodeURIComponent(here)}`}>Create account</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href={`/login?callbackUrl=${encodeURIComponent(here)}`}>I already have an account</Link>
                  </Button>
                </div>
              ) : auth.user.email !== invite.email ? (
                <p className="text-sm text-muted-foreground" role="alert">
                  You&apos;re signed in as <strong>{auth.user.email}</strong>. Sign in with the invited address to
                  accept.
                </p>
              ) : (
                <AcceptInviteButton token={token} />
              )}
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
