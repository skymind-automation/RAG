-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('TIMER', 'MANUAL');

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "source" "TimeEntrySource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_organizationId_ticketId_startedAt_idx" ON "time_entries"("organizationId", "ticketId", "startedAt");

-- CreateIndex
CREATE INDEX "time_entries_organizationId_userId_startedAt_idx" ON "time_entries"("organizationId", "userId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "tickets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules Prisma cannot express ─────────────────────────────────
-- At most one running timer per user per organization ("no overlapping
-- active timers"), enforced by the database even under concurrent starts.
CREATE UNIQUE INDEX "time_entries_one_running_timer"
  ON "time_entries"("organizationId", "userId")
  WHERE "endedAt" IS NULL AND "deletedAt" IS NULL;

-- A closed entry has a consistent end and duration; an open one has neither.
ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_closed_consistency_chk" CHECK (
    ("endedAt" IS NULL AND "durationSeconds" IS NULL)
    OR ("endedAt" IS NOT NULL AND "durationSeconds" IS NOT NULL
        AND "endedAt" >= "startedAt"
        AND "durationSeconds" BETWEEN 0 AND 86400)
  ),
  -- Only timers may be open; manual entries are always closed.
  ADD CONSTRAINT "time_entries_manual_closed_chk" CHECK ("source" = 'TIMER' OR "endedAt" IS NOT NULL);
