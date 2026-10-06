-- pgvector is required from day one (Phase 6 embeddings); fail fast if absent.
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'REQUESTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AI', 'API_KEY');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'PROBLEM', 'CHANGE', 'TASK', 'QUESTION');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('AGENT', 'PORTAL', 'EMAIL', 'API');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastActiveOrganizationId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "logoUrl" TEXT,
    "ticketPrefix" TEXT NOT NULL DEFAULT 'IT',
    "ticketNumberPadding" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_sequences" (
    "organizationId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_sequences_pkey" PRIMARY KEY ("organizationId","prefix")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_statuses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "position" INTEGER NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId" TEXT NOT NULL,
    "requiresResolution" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_priorities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#737373',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "statusId" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "categoryId" TEXT,
    "teamId" TEXT,
    "requesterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "source" "TicketSource" NOT NULL DEFAULT 'AGENT',
    "resolution" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "dueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_watchers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_memberships_userId_status_idx" ON "organization_memberships"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_userId_key" ON "organization_memberships"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_id_key" ON "organization_memberships"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_email_status_idx" ON "invitations"("organizationId", "email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_organizationId_id_key" ON "invitations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_name_key" ON "teams"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_id_key" ON "teams"("organizationId", "id");

-- CreateIndex
CREATE INDEX "team_memberships_organizationId_membershipId_idx" ON "team_memberships"("organizationId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_teamId_membershipId_key" ON "team_memberships"("teamId", "membershipId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workflows_organizationId_name_key" ON "workflows"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_organizationId_id_key" ON "workflows"("organizationId", "id");

-- CreateIndex
CREATE INDEX "workflow_statuses_organizationId_category_idx" ON "workflow_statuses"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_statuses_workflowId_key_key" ON "workflow_statuses"("workflowId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_statuses_organizationId_id_key" ON "workflow_statuses"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_workflowId_fromStatusId_toStatusId_key" ON "workflow_transitions"("workflowId", "fromStatusId", "toStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_organizationId_key_key" ON "ticket_priorities"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_organizationId_id_key" ON "ticket_priorities"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_organizationId_name_key" ON "ticket_categories"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_organizationId_id_key" ON "ticket_categories"("organizationId", "id");

-- CreateIndex
CREATE INDEX "tickets_organizationId_statusId_updatedAt_idx" ON "tickets"("organizationId", "statusId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "tickets_organizationId_assigneeId_updatedAt_idx" ON "tickets"("organizationId", "assigneeId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "tickets_organizationId_requesterId_createdAt_idx" ON "tickets"("organizationId", "requesterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "tickets_organizationId_createdAt_id_idx" ON "tickets"("organizationId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_organizationId_key_key" ON "tickets"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_organizationId_id_key" ON "tickets"("organizationId", "id");

-- CreateIndex
CREATE INDEX "comments_organizationId_ticketId_createdAt_idx" ON "comments"("organizationId", "ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_watchers_organizationId_userId_idx" ON "ticket_watchers"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_watchers_ticketId_userId_key" ON "ticket_watchers"("ticketId", "userId");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "teams"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sequences" ADD CONSTRAINT "ticket_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "workflows"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "workflows"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organizationId_fromStatusId_fkey" FOREIGN KEY ("organizationId", "fromStatusId") REFERENCES "workflow_statuses"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organizationId_toStatusId_fkey" FOREIGN KEY ("organizationId", "toStatusId") REFERENCES "workflow_statuses"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_priorities" ADD CONSTRAINT "ticket_priorities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_statusId_fkey" FOREIGN KEY ("organizationId", "statusId") REFERENCES "workflow_statuses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_priorityId_fkey" FOREIGN KEY ("organizationId", "priorityId") REFERENCES "ticket_priorities"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_categoryId_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "ticket_categories"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_requester_membership_fkey" FOREIGN KEY ("organizationId", "requesterId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_assignee_membership_fkey" FOREIGN KEY ("organizationId", "assigneeId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_creator_membership_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "tickets"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_author_membership_fkey" FOREIGN KEY ("organizationId", "authorId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "tickets"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_org_membership_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

