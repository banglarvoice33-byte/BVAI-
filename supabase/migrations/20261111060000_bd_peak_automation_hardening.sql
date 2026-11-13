-- =====================================================================
-- BVAI 2026-11-11 — Bangladesh-peak automation hardening (forward-only, idempotent)
--
--  A. News sources: poll every run, +29 maintained feeds, self-healing quarantine
--  B. Video slots : 10 videos / Dhaka day, spread over Bangladesh peak windows
--  C. Video gate  : image fallback no longer blocks video; reporter videos eligible
--  D. Reporter HITL: field report -> pending article, DB guard (no publish w/o human)
--
-- Nothing here lowers a fact-fidelity / originality / rights gate.
-- Apply order: after 20261111030000_dhaka_business_hours_cadence.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. News sources
-- ---------------------------------------------------------------------
-- Existing five feeds were due only every 15 min (13 after grace) while the tick
-- runs every 14 min: poll them on every tick instead.
update public.news_sources set interval_minutes = 10 where interval_minutes > 10;

-- New sources default to "headline feed + rewrite + attribution; publisher images
-- not used" so publisher photos are NOT republished (copyright). Open-licence feeds
-- (Wikinews CC BY, NASA public domain) may reuse their media.
insert into public.news_sources (name, feed_url, enabled, kill_switch, interval_minutes, licence_note)
select v.name, v.feed_url, true, false, 10, v.note
from (values
  -- Bangladesh / Bengali
  ('DW Bangla',                 'https://rss.dw.com/rdf/rss-bn-all',                                         'Headline feed; text rewritten with attribution; publisher images not used'),
  ('The Daily Star',            'https://www.thedailystar.net/frontpage/rss.xml',                            'Headline feed; text rewritten with attribution; publisher images not used'),
  ('Dhaka Tribune',             'https://www.dhakatribune.com/feed',                                         'Headline feed; text rewritten with attribution; publisher images not used'),
  ('The Business Standard',     'https://www.tbsnews.net/rss.xml',                                           'Headline feed; text rewritten with attribution; publisher images not used'),
  ('Kaler Kantho',              'https://www.kalerkantho.com/rss.xml',                                       'Headline feed; text rewritten with attribution; publisher images not used'),
  ('Jugantor',                  'https://www.jugantor.com/feed/rss.xml',                                     'Headline feed; text rewritten with attribution; publisher images not used'),
  ('ESPNcricinfo',              'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',                'Headline feed; text rewritten with attribution; publisher images not used'),
  -- International (BBC topical)
  ('BBC Asia',                  'https://feeds.bbci.co.uk/news/world/asia/rss.xml',                          'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Technology',            'https://feeds.bbci.co.uk/news/technology/rss.xml',                          'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Business',              'https://feeds.bbci.co.uk/news/business/rss.xml',                            'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Science & Environment', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',             'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Health',                'https://feeds.bbci.co.uk/news/health/rss.xml',                              'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Sport',                 'https://feeds.bbci.co.uk/sport/rss.xml',                                    'Headline feed; text rewritten with attribution; publisher images not used'),
  ('BBC Entertainment',         'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',              'Headline feed; text rewritten with attribution; publisher images not used'),
  -- International (other)
  ('The Guardian World',        'https://www.theguardian.com/world/rss',                                     'Headline feed; text rewritten with attribution; publisher images not used'),
  ('The Guardian Technology',   'https://www.theguardian.com/technology/rss',                                'Headline feed; text rewritten with attribution; publisher images not used'),
  ('The Guardian Sport',        'https://www.theguardian.com/sport/rss',                                     'Headline feed; text rewritten with attribution; publisher images not used'),
  ('NYT World',                 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',                    'Headline feed; text rewritten with attribution; publisher images not used'),
  ('NYT Technology',            'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',               'Headline feed; text rewritten with attribution; publisher images not used'),
  ('NPR News',                  'https://feeds.npr.org/1001/rss.xml',                                        'Headline feed; text rewritten with attribution; publisher images not used'),
  ('France 24',                 'https://www.france24.com/en/rss',                                           'Headline feed; text rewritten with attribution; publisher images not used'),
  ('Sky News World',            'https://feeds.skynews.com/feeds/rss/world.xml',                             'Headline feed; text rewritten with attribution; publisher images not used'),
  ('ABC News Australia',        'https://www.abc.net.au/news/feed/2942460/rss.xml',                          'Headline feed; text rewritten with attribution; publisher images not used'),
  ('The Hindu International',   'https://www.thehindu.com/news/international/feeder/default.rss',            'Headline feed; text rewritten with attribution; publisher images not used'),
  ('Times of India',            'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',                'Headline feed; text rewritten with attribution; publisher images not used'),
  ('UN News',                   'https://news.un.org/feed/subscribe/en/news/all/rss.xml',                    'Headline feed; text rewritten with attribution; publisher images not used'),
  ('WHO News',                  'https://www.who.int/rss-feeds/news-english.xml',                            'Headline feed; text rewritten with attribution; publisher images not used'),
  -- Open licence
  ('Wikinews',                  'https://en.wikinews.org/w/index.php?title=Special:NewsFeed&feed=atom&categories=Published&count=20', 'CC BY 2.5 Wikinews; public RSS; attribution required'),
  ('NASA',                      'https://www.nasa.gov/feed/',                                                'Public domain NASA media; public RSS; attribution requested')
) as v(name, feed_url, note)
where not exists (select 1 from public.news_sources s where s.feed_url = v.feed_url);

-- Self-healing: a feed that fails 5 consecutive probes is switched off (never deleted)
-- so a wrong/retired URL cannot occupy a polling slot forever.
create or replace function public.quarantine_failing_news_sources()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  with q as (
    update public.news_sources
       set enabled = false,
           last_probe_status = 'disabled',
           last_probe_error = left(coalesce(last_probe_error, 'unknown') || ' [auto-quarantined ' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI"Z"') || ']', 500)
     where enabled
       and coalesce(consecutive_failures, 0) >= 5
    returning 1
  )
  select count(*) into n from q;
  return n;
end $$;
revoke all on function public.quarantine_failing_news_sources() from public, anon, authenticated;
grant execute on function public.quarantine_failing_news_sources() to service_role;

select cron.schedule('bvai-source-quarantine', '*/30 * * * *', 'select public.quarantine_failing_news_sources();');
select cron.schedule('bvai-video-job-recovery', '*/10 * * * *', 'select public.recover_expired_video_generation_jobs();');

-- ---------------------------------------------------------------------
-- B. Video slots — 10 / Dhaka day across Bangladesh peak windows
-- ---------------------------------------------------------------------
create table if not exists public.video_peak_windows (
  window_key text primary key,
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour   smallint not null check (end_hour between 1 and 24),
  quota      smallint not null check (quota >= 0),
  enabled    boolean  not null default true,
  check (end_hour > start_hour)
);
alter table public.video_peak_windows enable row level security;
revoke all on public.video_peak_windows from anon, authenticated;
grant all on public.video_peak_windows to service_role;
comment on table public.video_peak_windows is
  'Asia/Dhaka local-hour windows [start_hour,end_hour) and how many new video jobs may start in each. Default total = 10/day. Tune with YouTube/Facebook audience analytics.';

insert into public.video_peak_windows (window_key, start_hour, end_hour, quota) values
  ('morning', 7, 10, 2),
  ('noon',   12, 15, 2),
  ('evening',17, 20, 2),
  ('prime',  20, 23, 3),
  ('late',   23, 24, 1)
on conflict (window_key) do nothing;

create or replace function public.video_slot_available(p_ignore_window boolean default false)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  local_now  timestamp   := timezone('Asia/Dhaka', now());
  day_start  timestamptz := date_trunc('day', timezone('Asia/Dhaka', now())) at time zone 'Asia/Dhaka';
  hr         integer     := extract(hour from timezone('Asia/Dhaka', now()))::integer;
  w          record;
  day_active integer;
  day_failed integer;
  win_used   integer;
  day_cap    constant integer := 10;  -- videos per Dhaka day
  failed_cap constant integer := 12;  -- failed attempts per day (bounds provider cost)
begin
  select count(*) filter (where status <> 'failed'), count(*) filter (where status = 'failed')
    into day_active, day_failed
    from public.video_generation_jobs
   where created_at >= day_start;
  if day_active >= day_cap or day_failed >= failed_cap then return false; end if;
  if p_ignore_window then return true; end if;

  select * into w
    from public.video_peak_windows
   where enabled and quota > 0 and hr >= start_hour and hr < end_hour
   order by start_hour
   limit 1;
  if not found then return false; end if;

  select count(*) into win_used
    from public.video_generation_jobs
   where status <> 'failed'
     and created_at >= day_start + make_interval(hours => w.start_hour)
     and created_at <  day_start + make_interval(hours => w.end_hour);
  return win_used < w.quota;
end $$;
revoke all on function public.video_slot_available(boolean) from public, anon, authenticated;
grant execute on function public.video_slot_available(boolean) to service_role;

-- Same contract as before (returns article_id, job_id, claim_token). Changes:
--  * Dhaka day + peak-window quota instead of a flat UTC-day count
--  * failed attempts no longer consume the 10 daily video slots
--  * freshness uses published_at when source_published_at is empty (reporter content)
create or replace function public.claim_reviewed_video_job(p_article_id uuid default null)
returns table(article_id uuid, job_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare chosen uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(73920511);
  -- An explicit article id (manual dispatch) skips the window check, never the daily caps.
  if not public.video_slot_available(p_article_id is not null) then return; end if;
  select a.id into chosen from public.articles a
   where a.status = 'published' and length(a.content_bn) > 200
     and public.video_gate_basis(a.id) is not null
     and coalesce(a.source_published_at, a.published_at) between now() - interval '24 hours' and now() + interval '5 minutes'
     and (p_article_id is null or a.id = p_article_id)
     and not exists (select 1 from public.videos v where v.article_id = a.id)
     and not exists (select 1 from public.video_generation_jobs j where j.article_id = a.id and j.status in ('queued','processing','needs_review'))
     and (select count(*) from public.video_generation_jobs j where j.article_id = a.id and j.created_at > now() - interval '24 hours') < 3
   order by a.published_at desc nulls last, a.id
   for update of a skip locked
   limit 1;
  if chosen is null then return; end if;
  return query select * from public.claim_video_generation_job(chosen);
end $$;

-- ---------------------------------------------------------------------
-- C. Video gate: a symbolic/fallback article IMAGE says nothing about the video
--    (the video uses its own licensed b-roll), so it must not block video.
-- ---------------------------------------------------------------------
create or replace function public.video_gate_basis(p_article_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.id is null or a.status is distinct from 'published' then null
    when a.human_verified is true and a.verification_status = 'verified' then 'editorial'
    when a.field_report_id is not null or a.origin is distinct from 'aggregated' then null
    when s.id is not null and s.enabled is true and s.kill_switch is not true
     and nullif(btrim(a.source_name), '') is not null
     and a.source_url ~* '^https?://[^ ]+$'
     and a.verification_status in ('auto_verified', 'verified')
     and a.source_published_at is not null then 'trusted_source'
    else null
  end
  from (select 1) x
  left join public.articles a on a.id = p_article_id
  left join public.news_sources s on s.id = a.source_id
$$;

-- ---------------------------------------------------------------------
-- D. Reporter / field-report human-in-the-loop (enforced in the database)
-- ---------------------------------------------------------------------
create unique index if not exists articles_field_report_uidx
  on public.articles (field_report_id) where field_report_id is not null;

-- A submitted field report becomes exactly ONE pending article that appears in the
-- Admin/Studio approval queue. Nothing is auto-published.
create or replace function public.create_pending_article_from_field_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_title text;
begin
  if NEW.status is distinct from 'pending_review'::public.report_status then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then return NEW; end if;
  if exists (select 1 from public.articles a where a.field_report_id = NEW.id) then return NEW; end if;

  select nullif(trim(p.full_name), '') into v_name from public.profiles p where p.id = NEW.reporter_id;
  v_title := coalesce(nullif(trim(NEW.title), ''), nullif(left(trim(NEW.description), 80), ''), 'Field report');

  insert into public.articles (
    field_report_id, title_bn, content_bn, excerpt_bn, category_key, category,
    status, workflow_status, editorial_status, verification_status, human_verified,
    origin, source_type, source_name, media_type, risk_level, review_reason, is_breaking
  ) values (
    NEW.id, v_title, NEW.description, left(NEW.description, 200), 'national', 'national',
    'pending', 'draft', 'pending_review', 'pending', false,
    'manual', 'editorial', coalesce(v_name, 'Field reporter'), 'none', 'medium', 'field_report', false
  );
  return NEW;
end $$;
revoke all on function public.create_pending_article_from_field_report() from public, anon, authenticated;

drop trigger if exists trg_field_report_to_pending_article on public.field_reports;
create trigger trg_field_report_to_pending_article
  after insert or update of status on public.field_reports
  for each row execute function public.create_pending_article_from_field_report();

-- Hard guard: a reporter article can only become 'published' when a human approved it
-- (/api/admin/approve sets human_verified = true; middleware restricts that route to
-- admin / chief_editor / desk_editor). Any other writer — AI pipeline, script, bug —
-- is silently held in 'pending' instead of publishing.
create or replace function public.articles_field_report_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.field_report_id is not null
     and NEW.status = 'published'
     and (TG_OP = 'INSERT' or OLD.status is distinct from 'published')
     and NEW.human_verified is not true then
    NEW.status := 'pending';
    NEW.editorial_status := 'pending_review';
    NEW.workflow_status := 'draft';
    NEW.published_at := null;
    NEW.review_reason := coalesce(nullif(NEW.review_reason, ''), 'reporter_requires_editorial_approval');
  end if;
  return NEW;
end $$;
revoke all on function public.articles_field_report_publish_guard() from public, anon, authenticated;

drop trigger if exists articles_field_report_publish_guard on public.articles;
create trigger articles_field_report_publish_guard
  before insert or update of status, human_verified on public.articles
  for each row execute function public.articles_field_report_publish_guard();
