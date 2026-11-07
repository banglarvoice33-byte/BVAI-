# Vercel Cron থেকে Supabase Edge Automation Migration

## নতুন ownership

এই package-এ `social-dispatch-daytime`, `social-dispatch-overnight`, `social-manager-daily`, `social-manager-metrics`, `social-manager-weekly` এবং `youtube-sync-daily` আর Vercel URL ডাকবে না। নতুন target হলো Supabase Edge Functions:

- `/functions/v1/social-dispatch`
- `/functions/v1/social-manager`
- `/functions/v1/youtube-sync`

Postgres `pg_cron` schedule করবে, `pg_net` asynchronous HTTP request পাঠাবে, আর secret Supabase Vault থেকে runtime-এ resolve হবে। Supabase-এর official scheduling guidance-ও pg_cron + pg_net + Vault pattern সুপারিশ করে।

## কেন Edge Functions ব্যবহার করা হয়েছে

এই তিন ধরনের কাজ external API calls, database updates এবং bounded batch processing। এগুলো Vercel web request lifecycle থেকে আলাদা হওয়া উচিত। Edge Function-এর runtime 256 MB memory এবং plan অনুযায়ী সীমিত wall-clock duration-এর মধ্যে রাখতে হবে। তাই implementation-এ daily YouTube sync cap 6, social queue claim token, platform rate limit এবং bounded request timeout রাখা হয়েছে। Long-running video render Edge Function-এ নেওয়া হয়নি; সেটি worker/persistent render runtime-এ থাকবে।

## Migration behavior

`20261107030000_move_social_youtube_jobs_to_edge_functions.sql` প্রথমে পুরনো job definitions unschedule করে, একই নামের Supabase Function targets তৈরি করে এবং শেষে সব নতুন job inactive রাখে। ফলে migration apply করলেই production automation হঠাৎ শুরু হবে না।

`deploy/enable-edge-automation-schedules.sql` কেবল তখন চালাতে হবে যখন:

1. তিনটি Edge Function deploy হয়েছে।
2. `NEWSROOM_INGEST_KEY` অন্তত 32 characters সহ production Vault-এ আছে।
3. Edge Function secret হিসেবে একই `NEWSROOM_INGEST_KEY` সেট করা হয়েছে, অথবা function-এর Vault fallback কার্যকরভাবে পরীক্ষা হয়েছে।
4. `SUPABASE_URL` deployment setting সঠিক project URL দেখাচ্ছে।
5. প্রতিটি function-এর unauthorized request 401 এবং valid service request 200/expected response দিচ্ছে।
6. `cron.job_run_details`-এ প্রথম manual run সফল হয়েছে।

## Security contract

নতুন functions-এর `verify_jwt=false` কেবল platform-level JWT check বন্ধ রাখার জন্য। Handler নিজে constant-time comparison ব্যবহার করে exact `Authorization: Bearer ...` অথবা `x-cron-secret` credential যাচাই করে। Anonymous request গ্রহণ করা হয় না। Vercel-এর `x-vercel-cron` header আর গ্রহণ করা হয় না।

Service role key mobile app, frontend bundle, GitHub artifact বা public environment variable-এ দেওয়া যাবে না। Function-এর privileged database access server-side secret বা Supabase-provided secure environment variable-এ থাকবে।

## Deployment commands

```bash
supabase functions deploy social-dispatch --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy social-manager --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy youtube-sync --project-ref "$SUPABASE_PROJECT_REF"
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" NEWSROOM_INGEST_KEY="<same-secret-value>"
```

এরপর Supabase SQL editor বা approved migration runner দিয়ে migration apply করতে হবে। সব function endpoint health/auth check করার পরেই:

```sql
\i deploy/enable-edge-automation-schedules.sql
```

## গুরুত্বপূর্ণ limitation

Supabase Cron official documentation অনুযায়ী একসঙ্গে সর্বোচ্চ প্রায় 8টি job চালানো এবং প্রতিটি job 10 মিনিটের মধ্যে রাখা performance-এর জন্য সুপারিশ করা হয়েছে। Edge Function hosted limits plan অনুযায়ী পরিবর্তিত হতে পারে। এই migration তাই social dispatch এবং manager jobs-কে bounded কাজ হিসেবে রাখে। API provider slow হলে job retry/idempotency database claim state-এর মাধ্যমে নিয়ন্ত্রিত হবে।

## Verification checklist

Migration-এর পরে প্রত্যাশিত cron targets:

```text
social-dispatch-daytime   -> SUPABASE_URL/functions/v1/social-dispatch
social-dispatch-overnight -> SUPABASE_URL/functions/v1/social-dispatch
social-manager-daily      -> SUPABASE_URL/functions/v1/social-manager
social-manager-metrics    -> SUPABASE_URL/functions/v1/social-manager
social-manager-weekly     -> SUPABASE_URL/functions/v1/social-manager
youtube-sync-daily        -> SUPABASE_URL/functions/v1/youtube-sync
```

`www.banglarvoice24news.com` বা কোনো Vercel URL এই ছয়টি job-এর target হিসেবে আর থাকা উচিত নয়।

## References

[1]: https://supabase.com/docs/guides/functions/schedule-functions "Supabase Scheduling Edge Functions"
[2]: https://supabase.com/docs/guides/cron "Supabase Cron"
[3]: https://supabase.com/docs/guides/functions/limits "Supabase Edge Functions limits"
[4]: https://supabase.com/docs/guides/functions/auth "Supabase Securing Edge Functions"
