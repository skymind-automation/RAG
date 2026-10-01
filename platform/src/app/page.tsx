import { redirect } from "next/navigation";
import { requireAuthPage } from "@/server/auth/context";
import { resolveLandingOrganization } from "@/server/organizations/organization-service";

export const dynamic = "force-dynamic";

/** Entry point: land in the last active organization, or onboard. */
export default async function Home() {
  const auth = await requireAuthPage();
  const slug = await resolveLandingOrganization(auth.user.id);
  redirect(slug ? `/o/${slug}` : "/onboarding");
}
