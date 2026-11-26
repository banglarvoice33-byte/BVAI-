-- pgTAP integration tests for the isolated video distribution queue.
-- Run against a disposable Supabase local/preview database after migrations:
--   supabase test db
-- Never run this fixture script against production.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, auth;
select no_plan();

select has_table(
  'public', 'video_distribution_jobs',
  'video distribution queue table exists'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.video_distribution_jobs'::regclass),
  'RLS is enabled on the queue'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname='public' and tablename='video_distribution_jobs'),
  0,
  'queue has no client RLS policies (default deny)'
);

select ok(
  not has_table_privilege('anon','public.video_distribution_jobs','SELECT')
  and not has_table_privilege('anon','public.video_distribution_jobs','INSERT')
  and not has_table_privilege('anon','public.video_distribution_jobs','UPDATE')
  and not has_table_privilege('anon','public.video_distribution_jobs','DELETE'),
  'anon cannot read or write queue rows'
);
select ok(
  not has_table_privilege('authenticated','public.video_distribution_jobs','SELECT')
  and not has_table_privilege('authenticated','public.video_distribution_jobs','INSERT')
  and not has_table_privilege('authenticated','public.video_distribution_jobs','UPDATE')
  and not has_table_privilege('authenticated','public.video_distribution_jobs','DELETE'),
  'ordinary authenticated users cannot read or write queue rows'
);
select ok(
  has_table_privilege('service_role','public.video_distribution_jobs','SELECT')
  and not has_table_privilege('service_role','public.video_distribution_jobs','INSERT')
  and not has_table_privilege('service_role','public.video_distribution_jobs','UPDATE')
  and not has_table_privilege('service_role','public.video_distribution_jobs','DELETE'),
  'service_role reads directly and mutates only through RPCs'
);

select ok(
  not has_function_privilege('anon','public.enqueue_video_distribution(uuid,text[],jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.enqueue_video_distribution(uuid,text[],jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_video_distribution_jobs(text,integer,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.heartbeat_video_distribution_job(uuid,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_video_distribution_job(uuid,text,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.fail_video_distribution_job(uuid,text,jsonb,integer)','EXECUTE')
  and has_function_privilege('service_role','public.claim_video_distribution_jobs(text,integer,integer)','EXECUTE')
  and has_function_privilege('service_role','public.heartbeat_video_distribution_job(uuid,text,integer)','EXECUTE')
  and has_function_privilege('service_role','public.complete_video_distribution_job(uuid,text,text,text,jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.fail_video_distribution_job(uuid,text,jsonb,integer)','EXECUTE'),
  'RPC execute grants enforce editor enqueue and service worker operations'
);

create temporary table _video_distribution_fixture (
  user_id uuid not null,
  video_id uuid not null,
  job_id uuid not null
) on commit drop;

insert into _video_distribution_fixture
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

-- Supabase auth trigger creates the corresponding profiles row.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, 'authenticated', 'authenticated',
       'video-distribution-' || user_id::text || '@example.invalid',
       '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb,
       clock_timestamp(), clock_timestamp()
from _video_distribution_fixture;

update public.profiles
set role = 'desk_editor'::public.app_role
where id = (select user_id from _video_distribution_fixture);

insert into public.videos (id, title_bn)
select video_id, 'ভিডিও বিতরণ pgTAP integration test'
from _video_distribution_fixture;

insert into public.video_generation_jobs (id, video_id, title, status)
select job_id, video_id, 'ভিডিও বিতরণ approval test', 'needs_review'
from _video_distribution_fixture;

select set_config('test.video_distribution.user_id',
  (select user_id::text from _video_distribution_fixture), true);
select set_config('test.video_distribution.video_id',
  (select video_id::text from _video_distribution_fixture), true);
select set_config('test.video_distribution.job_id',
  (select job_id::text from _video_distribution_fixture), true);
select set_config('request.jwt.claim.sub',
  (select user_id::text from _video_distribution_fixture), true);

-- A missing custom GUC must fail closed for both editor enqueue and worker claim.
-- No setting has been assigned in this fresh test transaction; this is the unset case.
set local role authenticated;
select extensions.throws_ok(
  $$select public.enqueue_video_distribution(
      current_setting('test.video_distribution.video_id')::uuid,
      array['facebook']::text[], '{}'::jsonb
    )$$,
  '55000', 'video_distribution_disabled',
  'unset feature flag blocks enqueue'
);
reset role;

set local role service_role;
select extensions.throws_ok(
  $$select * from public.claim_video_distribution_jobs('test-worker-unset',1,60)$$,
  '55000', 'video_distribution_disabled',
  'unset feature flag blocks worker claim'
);
reset role;

-- Explicit false must also fail closed.
select set_config('app.video_distribution_v1','false',true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.enqueue_video_distribution(
      current_setting('test.video_distribution.video_id')::uuid,
      array['facebook']::text[], '{}'::jsonb
    )$$,
  '55000', 'video_distribution_disabled',
  'false feature flag blocks enqueue'
);
reset role;
set local role service_role;
select extensions.throws_ok(
  $$select * from public.claim_video_distribution_jobs('test-worker-false',1,60)$$,
  '55000', 'video_distribution_disabled',
  'false feature flag blocks worker claim'
);
reset role;

select set_config('app.video_distribution_v1','true',true);

-- needs_review is not approved; only the real approval RPC's publishing state is accepted.
set local role authenticated;
select extensions.throws_ok(
  $$select public.enqueue_video_distribution(
      current_setting('test.video_distribution.video_id')::uuid,
      array['facebook','youtube']::text[], '{}'::jsonb
    )$$,
  '42501', 'video_not_approved',
  'needs_review video cannot be enqueued'
);
select extensions.lives_ok(
  $$select public.approve_video_generation(
    current_setting('test.video_distribution.job_id')::uuid
  )$$,
  'existing approval RPC transitions needs_review to publishing'
);

-- Inspect internal state using the privileged test role.
reset role;

select is(
  (select status from public.video_generation_jobs
   where id=current_setting('test.video_distribution.job_id')::uuid),
  'publishing',
  'approval contract state is publishing'
);

-- Verify enqueue permissions and behavior as authenticated.
set local role authenticated;

select is(
  public.enqueue_video_distribution(
    current_setting('test.video_distribution.video_id')::uuid,
    array['facebook','youtube']::text[], '{}'::jsonb
  ),
  2,
  'publishing video enqueues one row per platform'
);
select is(
  public.enqueue_video_distribution(
    current_setting('test.video_distribution.video_id')::uuid,
    array['facebook','youtube']::text[], '{}'::jsonb
  ),
  0,
  'repeated enqueue is idempotent'
);
reset role;

-- 'approved' is not an allowed status in the existing video_generation_jobs contract.
select extensions.throws_ok(
  format(
    'update public.video_generation_jobs set status = %L where id = %L::uuid',
    'approved', current_setting('test.video_distribution.job_id')
  ),
  '23514', null,
  'legacy approved status is rejected by the existing status constraint'
);

select is(
  (select count(*)::integer from public.video_distribution_jobs
   where video_id=current_setting('test.video_distribution.video_id')::uuid),
  2,
  'exactly two unique platform rows exist'
);

-- Worker-only functions must not be callable by ordinary authenticated users.
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.claim_video_distribution_jobs('ordinary-user',1,60)$$,
  '42501', null,
  'authenticated user cannot claim jobs'
);
select extensions.throws_ok(
  $$select public.heartbeat_video_distribution_job(
      gen_random_uuid(),'ordinary-user',120
    )$$,
  '42501', null,
  'authenticated user cannot heartbeat jobs'
);
select extensions.throws_ok(
  $$select public.complete_video_distribution_job(
      gen_random_uuid(),'ordinary-user','provider','processed','{}'::jsonb
    )$$,
  '42501', null,
  'authenticated user cannot complete jobs'
);
reset role;

-- Test real worker RPC transitions using a two-platform fixture.
update public.video_distribution_jobs
set max_attempts=2
where video_id=current_setting('test.video_distribution.video_id')::uuid;

create temporary table _video_distribution_claims (
  job_id uuid not null,
  worker_id text not null,
  lease_before timestamptz
) on commit drop;
grant select, insert on _video_distribution_claims to service_role;

set local role service_role;
insert into _video_distribution_claims(job_id,worker_id,lease_before)
select id, 'worker-alpha', lock_expires_at
from public.claim_video_distribution_jobs('worker-alpha',1,120);

insert into _video_distribution_claims(job_id,worker_id,lease_before)
select id, 'worker-beta', lock_expires_at
from public.claim_video_distribution_jobs('worker-beta',1,120);

select is(
  (select count(*)::integer from _video_distribution_claims),
  2,
  'two sequential workers claim distinct available platform jobs'
);
select is(
  (select count(distinct job_id)::integer from _video_distribution_claims),
  2,
  'each job is claimed at most once in the sequential test'
);

select is(
  public.heartbeat_video_distribution_job(
    (select job_id from _video_distribution_claims where worker_id='worker-alpha'),
    'wrong-worker',120
  ),
  false,
  'wrong worker heartbeat is rejected'
);
select ok(
  (select j.lock_expires_at = c.lease_before
   from public.video_distribution_jobs j
   join _video_distribution_claims c on c.job_id=j.id
   where c.worker_id='worker-alpha'),
  'wrong worker heartbeat does not renew the lease'
);
select ok(
  public.heartbeat_video_distribution_job(
    (select job_id from _video_distribution_claims where worker_id='worker-alpha'),
    'worker-alpha',120
  ),
  'owning worker can renew an unexpired lease'
);
select extensions.lives_ok(
  $$select public.complete_video_distribution_job(
      (select job_id from _video_distribution_claims where worker_id='worker-alpha'),
      'worker-alpha','provider-test-123','processed',
      '{"permalink":"https://example.invalid/test"}'::jsonb
    )$$,
  'owning worker can complete its job'
);
select is(
  public.fail_video_distribution_job(
    (select job_id from _video_distribution_claims where worker_id='worker-beta'),
    'worker-beta',
    '{"code":"TEST_RETRY","message":"first simulated failure"}'::jsonb,
    1
  ),
  'retrying',
  'first failure schedules a retry'
);
select pg_catalog.pg_sleep(1.5);

insert into _video_distribution_claims(job_id,worker_id,lease_before)
select id, 'worker-gamma', lock_expires_at
from public.claim_video_distribution_jobs('worker-gamma',1,120);

select is(
  public.fail_video_distribution_job(
    (select job_id from _video_distribution_claims where worker_id='worker-gamma'),
    'worker-gamma',
    '{"code":"TEST_EXHAUSTED","message":"final simulated failure"}'::jsonb,
    1
  ),
  'dead_letter',
  'retry limit moves the job to dead_letter'
);
reset role;

select is(
  (select count(*)::integer from public.video_distribution_jobs
   where video_id=current_setting('test.video_distribution.video_id')::uuid
     and status='succeeded'),
  1,
  'completed job persists succeeded state'
);
select is(
  (select count(*)::integer from public.video_distribution_jobs
   where video_id=current_setting('test.video_distribution.video_id')::uuid
     and status='dead_letter'),
  1,
  'exhausted job persists dead_letter state'
);
select has_table(
  'public','social_posts',
  'legacy social_posts table remains present and isolated'
);

select * from extensions.finish();
rollback;
