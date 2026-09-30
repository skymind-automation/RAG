import Image from "next/image";
import { cn } from "@/lib/utils";

export function DeltaLogo({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/delta-logo.png"
      alt="Delta"
      width={640}
      height={218}
      priority={priority}
      className={cn("h-8 w-auto", className)}
    />
  );
}

export function DeltaMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/delta-mark.png"
      alt=""
      aria-hidden
      width={256}
      height={256}
      className={cn("size-7", className)}
    />
  );
}
