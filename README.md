## Database Migration (Neon ➜ Supabase)

Use the provided Supabase session pooler connection string  
`postgresql://postgres.eutnyhtxikflaanqulfe:Aa102030!!!%%%@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
to receive the Neon snapshot.

1. Populate `.env`:
   - `NEON_DATABASE_URL` (or `DATABASE_URL`) → current Neon connection string.
   - `SUPABASE_DATABASE_URL` → Supabase string above with your password.
2. Run the migration script (requires `pg_dump`/`psql` client tools):

   ```bash
   npm run db:migrate:supabase
   ```

   The script dumps Neon into `tmp/neon_dump_<timestamp>.sql` and replays it into Supabase.
   The dump file is left on disk so you can re-run or inspect it.
3. After verifying the data in Supabase, update `DATABASE_URL` to the Supabase value so the app
   reads/writes from the new database going forward, then redeploy/restart the app.

## Getting Started

```bash
npm run dev   # Next.js dev server (Turbopack)
npm run build # Production build
npm run lint  # ESLint
```
