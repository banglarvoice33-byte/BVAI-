-- ALREADY APPLIED LIVE (version 20261114014157). Do NOT re-run in the SQL Editor; this file only keeps the repo in sync.
-- dispatch_video_render() used to read GITHUB_REPO/GITHUB_REF from public.deployment_settings, but that table only
-- accepts SITE_URL/SUPABASE_URL with https values (CHECK constraints), so the repo could never be configured and the
-- dispatcher stayed inactive forever. Read the config from Vault instead (the operator-managed secret store):
--   GITHUB_DISPATCH_TOKEN  (required; PAT or fine-grained token with Actions: write on the repo)
--   GITHUB_REPO            (required; "owner/name")
--   GITHUB_REF             (optional; defaults to "main")
create or replace function public.dispatch_video_render()
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare last_at timestamptz; tok text; repo text; ref text; req bigint;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(73920515) then return null; end if;
  select last_dispatched_at into last_at from public.video_dispatch_state where id for update;
  if last_at is not null and now() < last_at + interval '20 minutes' then return null; end if;
  if not public.video_job_due() then return null; end if;

  -- Token: a registered api_vault link wins, otherwise the Vault secret of the same name.
  select btrim(ds.decrypted_secret) into tok
    from public.api_vault v join vault.decrypted_secrets ds on ds.id = v.key_encrypted
   where v.service_name = 'GITHUB_DISPATCH_TOKEN' and v.environment = 'prod' and v.is_active limit 1;
  if coalesce(tok, '') = '' then
    select btrim(ds.decrypted_secret) into tok from vault.decrypted_secrets ds
     where ds.name = 'GITHUB_DISPATCH_TOKEN' order by ds.updated_at desc limit 1;
  end if;
  select btrim(ds.decrypted_secret) into repo from vault.decrypted_secrets ds
   where ds.name = 'GITHUB_REPO' order by ds.updated_at desc limit 1;
  select nullif(btrim(ds.decrypted_secret), '') into ref from vault.decrypted_secrets ds
   where ds.name = 'GITHUB_REF' order by ds.updated_at desc limit 1;

  if coalesce(tok, '') = '' or coalesce(repo, '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then
    update public.video_dispatch_state
       set last_note = 'dispatcher inactive: GITHUB_DISPATCH_TOKEN or GITHUB_REPO missing/invalid in Vault' where id;
    return null;
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/' || repo || '/actions/workflows/video-render.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json',
                                  'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'bvai-pg-net', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', coalesce(ref, 'main')),
    timeout_milliseconds := 15000) into req;
  update public.video_dispatch_state set last_dispatched_at = now(), last_request_id = req, last_note = 'dispatched' where id;
  return req;
end $function$;
