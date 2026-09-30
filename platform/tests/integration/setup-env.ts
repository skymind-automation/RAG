import { afterAll } from "vitest";
import { TEST_DATABASE_URL } from "./test-env";

// Must run before any module imports the Prisma client.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = TEST_DATABASE_URL;
// In-memory rate limiter: tests are deterministic and don't need Redis.
delete process.env.REDIS_URL;

afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.$disconnect();
});
