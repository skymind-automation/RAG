-- Runs once, on first container start (empty data volume).
-- pgvector in template1 so every database created later (tests, Prisma's
-- shadow database) has it without superuser rights at migration time.
\connect template1
CREATE EXTENSION IF NOT EXISTS vector;
\connect postgres
CREATE DATABASE itsm_test OWNER itsm;
