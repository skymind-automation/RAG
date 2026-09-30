import { PrismaClient } from "@prisma/client";

/**
 * The unscoped Prisma client.
 *
 * Tenant data must be reached through `scopedDb(organizationId)` (see
 * ./tenant.ts). Direct use of `prisma` is reserved for genuinely global
 * operations — authenticating a user, resolving a membership, creating an
 * organization — and each such call site is listed in docs/multi-tenancy.md.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
