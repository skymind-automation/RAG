import type { Prisma } from "@prisma/client";

export function formatTicketKey(prefix: string, number: number, padding: number): string {
  return `${prefix}-${String(number).padStart(padding, "0")}`;
}

/**
 * Allocate the next ticket number for (organization, prefix).
 *
 * A single upsert-and-increment statement: the row lock it takes serialises
 * concurrent creators, and because it runs inside the ticket-creating
 * transaction a rolled-back ticket also rolls back its number (no gaps from
 * failures). The organization id is an explicit parameter — this is raw SQL
 * and bypasses the scoped client.
 */
export async function allocateTicketNumber(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  organizationId: string,
  prefix: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ allocated: number }[]>`
    INSERT INTO ticket_sequences ("organizationId", prefix, "nextValue", "updatedAt")
    VALUES (${organizationId}, ${prefix}, 2, now())
    ON CONFLICT ("organizationId", prefix)
    DO UPDATE SET "nextValue" = ticket_sequences."nextValue" + 1, "updatedAt" = now()
    RETURNING ("nextValue" - 1)::int AS allocated`;
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== "number") throw new Error("ticket number allocation returned no row");
  return allocated;
}
