## Database Migration (Neon ➜ Supabase)

Use the provided Supabase session pooler connection string  
`postgresql://postgres.eutnyhtxikflaanqulfe:Aa102030!!!%%%@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
to receive the Neon snapshot.

1. Populate `.env`:
   - `NEON_DATABASE_URL_UNPOOLED` → direct Neon connection (no PgBouncer) so `pg_dump` can run DDL.
   - `NEON_DATABASE_URL` (or `DATABASE_URL`) → pooled Neon URL used by the app; the script falls back to these if `_UNPOOLED` is absent.
   - `SUPABASE_DIRECT_URL` → Supabase direct connection on port 5432 for the restore step.
   - `SUPABASE_DATABASE_URL` / `SUPABASE_DATABASE_POOL_URL` → pooled Supabase URLs that the script falls back to when the direct URL is missing.
2. Run the migration script (requires `pg_dump`/`psql` client tools):

   ```bash
   npm run db:migrate:supabase
   ```

   The script dumps Neon into `tmp/neon_dump_<timestamp>.sql` and replays it into Supabase.
   The dump file is left on disk so you can re-run or inspect it.
   If multiple Postgres versions are installed, point the script at the right binaries via
   `PG_DUMP_BIN="/path/to/pg_dump-17"` and `PSQL_BIN="/path/to/psql-17"` environment variables.
   Windows-style paths such as `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` are converted automatically for both WSL (`/mnt/c/...`) and Git Bash (`/c/...`).
3. After verifying the data in Supabase, update `DATABASE_URL` to the Supabase value so the app
   reads/writes from the new database going forward, then redeploy/restart the app.

## Getting Started

```bash
npm run dev   # Next.js dev server (Turbopack)
npm run build # Production build
npm run lint  # ESLint
```
