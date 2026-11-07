# Video distribution queue: two-session concurrency acceptance

Run only against a disposable local/preview Supabase database after migrations and pgTAP tests pass. Never run against production.

1. Prepare the single-row fixture:
   `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/video_distribution_concurrency_setup.sql`
2. Open two independent psql sessions using the same disposable database.
3. In Session A, execute `supabase/tests/video_distribution_concurrency_session_a.sql`.
4. While Session A is inside its 10-second sleep, execute `supabase/tests/video_distribution_concurrency_session_b.sql` in Session B.
5. Acceptance: Session A returns the fixture UUID exactly once. Session B returns zero rows. The persisted row is `processing`, claimed by `concurrency-session-a`; it must never be returned to both workers.
6. Cleanup with `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/video_distribution_concurrency_cleanup.sql`.

The scripts deliberately use a deterministic disposable fixture ID and abort if it collides. They insert directly as the database owner only to isolate the atomic claim primitive; the pgTAP integration test separately verifies the editorial approval and enqueue contract.

## Queue migration safety

- Queue table uses `CREATE TABLE IF NOT EXISTS`, followed by a fail-closed shape check.
- All four queue indexes use `CREATE INDEX IF NOT EXISTS`; no `CONCURRENTLY`.
- RPCs use `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, empty search_path, schema-qualified objects, explicit revoke/grant.
- Feature flag `app.video_distribution_v1` defaults to disabled when unset; tests cover unset and explicit false.
- pgTAP test covers role grants, RLS default-deny, needs_review → publishing approval, invalid legacy `approved` status, enqueue idempotency, wrong-worker heartbeat, completion, retry and dead-letter.
