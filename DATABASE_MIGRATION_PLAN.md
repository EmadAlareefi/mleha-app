# Neon ➜ Supabase Migration: Execution Checklist

## 1. Supabase Environment Parity
- [ ] Confirm Supabase Postgres 15/16 project is provisioned with the same vCPU/RAM tier as Neon’s production branch for comparable performance.
- [ ] Enable the built-in extensions already in use (`pgcrypto` for Prisma `cuid()` defaults, `uuid-ossp` if future UUID defaults are needed, `pg_stat_statements` for observability). No other custom extensions are referenced in `prisma/schema.prisma`, but double-check any raw SQL migrations in `prisma/migrations`.
- [ ] Recreate Neon roles inside Supabase: app writer (used by `DATABASE_URL`), read-only reporting users (if any), and automated job users. Enforce credential rotation and store passwords in the target secret manager (`.env.local`, deployment secrets, CI variables).
- [ ] Mirror network controls: allowed CIDRs for pooled connections, SSL enforcement (`sslmode=require`), and any private networking/peering the app depends on.
- [ ] Review Neon storage usage and set Supabase storage/connection limits accordingly; enable PITR/backup windows before ingesting production data.

## 2. Staging Dry Run
1. Snapshot Neon (use `scripts/migrate-neon-to-supabase.sh` with staging credentials) and restore into a non-production Supabase database.
2. Run Prisma introspection or `prisma migrate status` to ensure schema matches expectations; fix any drift before going live.
3. Point a staging deployment at the Supabase staging database (`DATABASE_URL=<supabase-staging>`), run smoke tests (auth, order creation, returns, barcode printing, ERP sync), and capture metrics (slow queries/logs).
4. Document runtime impacts (query latency, connection count) to anticipate production sizing.

## 3. Production Cutover Timeline
- **T-24h**: Announce maintenance window, freeze schema changes, and verify Supabase backups.
- **T-2h**: Ensure background workers are drained or paused; take a final Neon health snapshot.
- **T-0**: Run `npm run db:migrate:supabase` with production URLs, monitor pg_dump/psql output, and keep the generated `tmp/neon_dump_<timestamp>.sql` artifact.
- **T+10m**: Point application/worker `DATABASE_URL` values to Supabase, redeploy Next.js and cron workers, and run manual smoke tests.
- **T+2h**: Monitor Supabase metrics (connections, CPU, replication lag) and application logs; escalate issues per on-call plan.

## 4. Validation & Rollback
- [ ] Compare record counts for critical tables (`SallaOrder`, `SallaInvoice`, `Shipment`, `WebhookLog`) between Neon and Supabase (use `SELECT count(*)` and `max(updatedAt)` spot checks).
- [ ] Verify Prisma migrations run clean on Supabase (`npx prisma migrate deploy` if applicable).
- [ ] Run ERP/Salla integration flows end-to-end; confirm webhook ingestion and SMSA label printing succeed.
- [ ] If blocking issues arise, revert `DATABASE_URL` to the Neon value, redeploy, and restore worker schedules. Keep Neon in read-only standby until Supabase is stable for a full business cycle.
