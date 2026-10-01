-- CreateEnum
CREATE TYPE "TicketRelationType" AS ENUM ('RELATES_TO', 'DUPLICATES', 'BLOCKS', 'CAUSED_BY');

-- CreateEnum
CREATE TYPE "CommentVisibilityMirror" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING_UPLOAD', 'PENDING_SCAN', 'AVAILABLE', 'QUARANTINED', 'DELETED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('NOT_SCANNED', 'SKIPPED', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'DATE', 'CHECKBOX');

-- CreateTable
CREATE TABLE "ticket_relations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceTicketId" TEXT NOT NULL,
    "targetTicketId" TEXT NOT NULL,
    "type" "TicketRelationType" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "commentId" TEXT,
    "visibility" "CommentVisibilityMirror" NOT NULL DEFAULT 'PUBLIC',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_mentions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "ticketTypes" "TicketType"[] DEFAULT ARRAY[]::"TicketType"[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_relations_organizationId_targetTicketId_idx" ON "ticket_relations"("organizationId", "targetTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_relations_sourceTicketId_targetTicketId_type_key" ON "ticket_relations"("sourceTicketId", "targetTicketId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_organizationId_ticketId_createdAt_idx" ON "attachments"("organizationId", "ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_organizationId_id_key" ON "attachments"("organizationId", "id");

-- CreateIndex
CREATE INDEX "comment_mentions_organizationId_userId_createdAt_idx" ON "comment_mentions"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "comment_mentions_commentId_userId_key" ON "comment_mentions"("commentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_organizationId_key_key" ON "custom_field_definitions"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "comments_organizationId_id_key" ON "comments"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_organizationId_sourceTicketId_fkey" FOREIGN KEY ("organizationId", "sourceTicketId") REFERENCES "tickets"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_organizationId_targetTicketId_fkey" FOREIGN KEY ("organizationId", "targetTicketId") REFERENCES "tickets"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_organizationId_createdById_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "tickets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_commentId_fkey" FOREIGN KEY ("organizationId", "commentId") REFERENCES "comments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_uploadedById_fkey" FOREIGN KEY ("organizationId", "uploadedById") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organizationId_commentId_fkey" FOREIGN KEY ("organizationId", "commentId") REFERENCES "comments"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules Prisma cannot express ─────────────────────────────────
ALTER TABLE "ticket_relations"
  ADD CONSTRAINT "ticket_relations_not_self_chk" CHECK ("sourceTicketId" <> "targetTicketId");

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_positive_chk" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "attachments_storage_key_tenant_chk"
    CHECK ("storageKey" LIKE 'org/' || "organizationId" || '/%');

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_key_format_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');
