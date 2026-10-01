import { afterAll } from "vitest";
import { TEST_DATABASE_URL } from "./test-env";

// Must run before any module imports the Prisma client.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = TEST_DATABASE_URL;
// In-memory rate limiter: tests are deterministic and don't share state.
// Set to "" rather than deleting: Prisma loads .env on import, and dotenv
// only fills variables that are *unset*, so a deleted REDIS_URL would come
// back and the suite would silently use (and accumulate counters in) Redis.
process.env.REDIS_URL = "";
// Attachments: local storage driver in a throwaway directory.
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/itsm-test-storage-${process.pid}`;
process.env.AUTH_SECRET ??= "integration-test-secret-0123456789abcdef0123456789";
process.env.AUTH_URL = "http://localhost:3999";

afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.$disconnect();
});
