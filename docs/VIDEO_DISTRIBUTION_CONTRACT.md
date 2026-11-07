# Video Distribution Queue v1 — PR-1 Contract

## Scope and safety boundary

This PR adds `public.video_distribution_jobs`, its narrowly granted RPCs, pgTAP coverage, a PostgreSQL 17 CI harness, and documented two-session concurrency scripts.
It does not modify `social_posts`, article publishing, existing newsroom worker
agents, `video_generation_jobs`, `video_generation_assets`,
`video_generation_events`, `videos`, or the Vercel project/deployment.

No FFmpeg renderer, Facebook/YouTube adapter, worker process, production
migration, environment-variable change, or deployment is part of PR-1.

## Audited existing schema contract

The migration begins with a fail-closed catalog preflight. It verifies the
required relations and columns through `information_schema` and
`pg_catalog`, checks that `profiles.role` uses `public.app_role`, confirms
the role enum values, and inspects the actual function definitions for:

- `public.current_app_role()`
- `public.approve_video_generation(uuid)`

The audited approval contract is important: the existing
`approve_video_generation(p_job uuid)` accepts a job in `needs_review`,
requires a linked `video_id`, checks `desk_editor`, `chief_editor`, or
`admin`, and changes the job status to `publishing`. It does **not** set
status to `approved`. Therefore enqueue checks for an existing linked
`video_generation_jobs` row with status `publishing` and a matching
`videos.id`.

The existing asset contract is `video_generation_assets.job_id` and
`kind`; the existing job lock contract is `claimed_by`, `claimed_at`,
and `next_attempt_at`. PR-1 does not write to those existing tables.

If the preflight detects drift, the migration aborts before creating the queue.
Do not bypass the preflight by changing names to guessed equivalents.

## Feature flag

The database feature flag is the custom PostgreSQL setting
`app.video_distribution_v1`. Every new session defaults to OFF because an
unset setting is treated as `false`. Enqueue and claim raise
`video_distribution_disabled` unless the value is exactly `true`.

PR-1 does not enable the setting. A future, separately approved activation
would require an operator-controlled database setting change and new
connections, for example:

```sql
-- NOT PART OF PR-1. Do not run on production as part of this PR.
alter database postgres set app.video_distribution_v1 = 'true';
```

Tests set the flag only within their own rollback-only transaction.

## Queue and state machine

Supported platforms: `facebook`, `youtube`, `instagram`, `tiktok`,
`x`, `linkedin`, and `telegram`.

States:

- `queued`: eligible when `next_attempt_at <= now()`
- `processing`: leased to exactly one worker
- `succeeded`: provider accepted/completed and result persisted
- `retrying`: transient failure with exponential backoff
- `dead_letter`: attempts exhausted or expired lease after final attempt
- `failed`: reserved terminal state for operator disposition
- `cancelled`: operator-cancelled state for future administrative tooling

A claim increments `attempt_count` and sets `claimed_by`, `claimed_at`,
and `lock_expires_at` atomically. The claim query uses
`FOR UPDATE SKIP LOCKED`; expired processing leases can be reclaimed, while
expired leases with exhausted attempts are moved to `dead_letter`.

Heartbeat, completion, and failure require the matching worker ID, processing
state, and an unexpired lease. A stale or different worker cannot renew,
complete, or fail another worker's claim. Failure schedules bounded
exponential retry or moves the job to `dead_letter`.

## RPC privileges and RLS

RLS is enabled and no client policies are created. The queue table has no
direct table grants for `PUBLIC`, `anon`, or `authenticated`; only
`service_role` receives operational table privileges.

All mutating RPCs are `SECURITY DEFINER` with an empty fixed
`search_path = ''` and schema-qualified object references:

| RPC | EXECUTE grant | Purpose |
|---|---|---|
| `enqueue_video_distribution(uuid,text[],jsonb)` | `authenticated` only | editorial-role + approval-gated enqueue |
| `claim_video_distribution_jobs(text,integer,integer)` | `service_role` only | atomic worker claim |
| `heartbeat_video_distribution_job(uuid,text,integer)` | `service_role` only | ownership-verified lease renewal |
| `complete_video_distribution_job(uuid,text,text,text,jsonb)` | `service_role` only | ownership-verified completion |
| `fail_video_distribution_job(uuid,text,jsonb,integer)` | `service_role` only | retry or dead-letter |

Each function explicitly revokes EXECUTE from `PUBLIC`, `anon`, and
`authenticated` before granting only the required role. The service-role key
must remain server-side; it must never be put in a browser bundle.

The SECURITY DEFINER functions do not use `current_user = 'service_role'`
as an authorization check: inside a SECURITY DEFINER function
`current_user` is the function owner. EXECUTE grants are the boundary.

## Storage and media delivery contract

PR-1 stores no media and does not generate public URLs. The rendered master
must remain in a private Storage bucket. Website/social delivery in a later PR
must use a time-limited signed URL or a separately controlled public delivery
bucket after editorial approval. A `getPublicUrl()` string does not make a
private bucket object public and must not be treated as proof of accessibility.

Never put provider tokens, signed URLs with long validity, or service-role
credentials in the queue payload. Store only non-secret publication metadata.

## Test procedure

Run the isolated PostgreSQL 17 contract fixture, migration, and pgTAP suite in CI:

```sh
TEST_DATABASE_URL=postgresql:///video_distribution_test \
  bash scripts/test-video-distribution-pgtap.sh
```

The runner is compatible with a disposable local/preview PostgreSQL database. It bootstraps only the minimal Supabase contract needed for this queue migration; it does not replace the later full Supabase preview-branch replay.

The SQL integration test is transactional and rolls back its fixture identity,
video, generation job, and queue rows. It checks:

- schema/RLS/table grants and function EXECUTE grants
- unset and explicit false feature flag block enqueue and claim
- anon and ordinary authenticated users cannot directly read/write the queue or invoke worker RPCs
- unapproved `needs_review` video is rejected
- the existing approval RPC enables enqueue via `publishing`
- repeated enqueue is idempotent
- sequential workers receive disjoint claims
- the existing status constraint rejects the non-contract `approved` status
- wrong worker heartbeat returns false without changing the lease
- correct worker heartbeat succeeds
- completion persists `succeeded`
- transient failure retries and max attempts reach `dead_letter`

### Required two-session concurrency check

The exact setup, Session A, Session B, and cleanup scripts are checked in:

- `supabase/tests/video_distribution_concurrency_setup.sql`
- `supabase/tests/video_distribution_concurrency_session_a.sql`
- `supabase/tests/video_distribution_concurrency_session_b.sql`
- `supabase/tests/video_distribution_concurrency_cleanup.sql`

Follow `docs/VIDEO_DISTRIBUTION_CONCURRENCY.md`. Session A holds its claimed row lock while Session B calls the same claim RPC. Acceptance is one returned row in A, zero in B, and exactly one persisted owner. This remains a manual two-connection gate; sequential pgTAP checks do not substitute for it.

## Preview-only migration policy

This migration must be applied and tested only on a disposable local or
dedicated preview/staging Supabase database. The connected production project
was used for read-only schema introspection only. Do not run
`supabase db push`, `apply_migration`, or any DDL against production for
this PR.

## Migration idempotency

The queue table is created with `CREATE TABLE IF NOT EXISTS`, followed by a fail-closed shape check so an incompatible pre-existing table is not silently accepted. All four indexes use `CREATE INDEX IF NOT EXISTS`; no index uses `CONCURRENTLY`. Functions use `CREATE OR REPLACE FUNCTION`, and privilege statements are repeatable revokes/grants. Idempotent syntax does not replace schema validation: the shape guard is part of the migration contract.

## Merge gates

- PostgreSQL 17 CI harness and pgTAP suite pass.
- Migration preflight passes against the full Supabase preview schema.
- SQL integration tests pass.
- Two-session SKIP LOCKED check passes.
- Confirm no diff to `social_posts`, article publishing, newsroom worker, or
  Vercel configuration/deployment.
- Confirm `app.video_distribution_v1` remains unset/OFF.
- No production migration, deployment, or merge is included in PR-1.
