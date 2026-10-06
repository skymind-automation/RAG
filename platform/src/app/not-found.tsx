import Link from "next/link";
import { DeltaLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <DeltaLogo className="h-8" />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        It doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  );
}
