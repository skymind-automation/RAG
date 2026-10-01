#!/usr/bin/env bash
# SessionStart hook: bring up Postgres + pgvector and the venv so tests and the
# eval harness are runnable immediately in a fresh container.
set -uo pipefail

log() { echo "[session-start] $*"; }

cd "$(dirname "$0")/../.." || exit 0

if [ ! -d .venv ]; then
  log "creating venv"
  python3 -m venv .venv >/dev/null 2>&1
  .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1 \
    || log "pip install failed; run it manually"
fi

if ! pg_isready -q 2>/dev/null; then
  log "starting postgres"
  (service postgresql start || pg_ctlcluster 16 main start) >/dev/null 2>&1
  for _ in $(seq 1 15); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi

if pg_isready -q 2>/dev/null; then
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='delta'\"" 2>/dev/null \
    | grep -q 1 || su postgres -c "psql -c \"CREATE USER delta WITH PASSWORD 'delta' SUPERUSER;\"" >/dev/null 2>&1
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='delta_rag'\"" 2>/dev/null \
    | grep -q 1 || su postgres -c "psql -c 'CREATE DATABASE delta_rag OWNER delta;'" >/dev/null 2>&1
  su postgres -c "psql -d delta_rag -c 'CREATE EXTENSION IF NOT EXISTS vector;'" >/dev/null 2>&1 \
    || log "pgvector unavailable: apt-get install -y postgresql-16-pgvector"
  log "postgres ready"
else
  log "postgres did not start; integration tests will fail"
fi

log "env: set -a && . ./.env.example && set +a"
log "then: ./manage.py migrate && ./manage.py ingest && ./manage.py eval_retrieval"

# ── Delta ITSM platform (platform/) ─────────────────────────────────────────
# Best-effort and idempotent: pgvector, the itsm role + dev/test/e2e
# databases, Redis, and node_modules.
if [ -d platform ]; then
  if ! ls /usr/share/postgresql/*/extension/vector.control >/dev/null 2>&1; then
    (apt-get install -y -q postgresql-16-pgvector >/dev/null 2>&1 \
      || (apt-get update -q >/dev/null 2>&1 && apt-get install -y -q postgresql-16-pgvector >/dev/null 2>&1)) \
      || log "platform: could not install pgvector"
  fi
  if pg_isready -q 2>/dev/null; then
    su postgres -c "psql -q -d template1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'" >/dev/null 2>&1
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='itsm'\"" 2>/dev/null | grep -q 1 \
      || su postgres -c "psql -qc \"CREATE ROLE itsm LOGIN PASSWORD 'itsm' CREATEDB;\"" >/dev/null 2>&1
    for db in itsm itsm_test itsm_e2e; do
      su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" 2>/dev/null | grep -q 1 \
        || su postgres -c "createdb -O itsm $db" >/dev/null 2>&1
    done
  fi
  if command -v redis-server >/dev/null 2>&1 && ! redis-cli ping >/dev/null 2>&1; then
    redis-server --daemonize yes >/dev/null 2>&1 || log "platform: redis did not start"
  fi
  if [ ! -d platform/node_modules ]; then
    (cd platform && npm ci --no-audit --no-fund >/dev/null 2>&1) || log "platform: npm ci failed; run it manually"
  fi
  [ -f platform/.env ] || cp platform/.env.example platform/.env 2>/dev/null
  log "platform: cd platform && npm run db:migrate && npm run test:integration"
fi
