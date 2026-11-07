# 12-minute Scheduler ও Conservative Quality Gate

## কী পরিবর্তন করা হয়েছে

এই audit workspace-এ scheduler-এর canonical fallback interval **14 → 12 মিনিট** করা হয়েছে। 12 মিনিট আপনার 10–14 মিনিটের সীমার মধ্যে এবং 15 মিনিটের আগের configuration-এর চেয়ে দ্রুত। Source-specific interval database migration-এ 12 করা হয়েছে।

পরিবর্তিত ফাইল:

- `worker/src/lib/publish-gate.ts`
- `frontend/lib/publish-gate.ts`
- `worker/src/lib/publish-gate.test.ts`
- `supabase/migrations/20261107020000_reviewed_12_minute_scheduler_and_quality_gate.sql`
- `deploy/enable-reviewed-schedules.sql`

## Canonical application configuration

```ts
export const PIPELINE_INTERVAL_MINUTES = 12
export const PIPELINE_CRON = '*/12 * * * *'
export const SOURCE_DUE_GRACE_MINUTES = 2
```

`interval_minutes=12` source-এর effective due threshold বর্তমানে 10 মিনিট, কারণ 2 মিনিট grace রাখা আছে। ফলে scheduler কোনো run মিস করলে পরের run-এ source পুনরায় due হবে।

## pg_cron schedule

নতুন migration existing jobs থাকলে schedule সেট করবে, কিন্তু `active=false` রাখবে:

```sql
news-ingest-daytime   */12 0-17 * * *   -- UTC
news-ingest-overnight */12 18-23 * * *  -- UTC
```

Live enable করার manual script-এ Vault-এ অন্তত 32-character `NEWSROOM_INGEST_KEY`, `SITE_URL` এবং `SUPABASE_URL` যাচাই না হলে transaction fail করবে। এটি migration apply করলেই scheduler চালু করে না।

## Quality gate policy

Migration চারটি risk category explicit করে:

| Category | Independent sources | Successful verifiers | Human review | Authority approval | Auto publish |
|---|---:|---:|---|---|---|
| unclassified | 2 | 2 | required | no | disabled |
| routine | 2 | 2 | required | no | disabled |
| sensitive | 3 | 3 | required | required | disabled |
| critical | 3 | 3 | required | required | disabled |

এই fail-closed configuration-এ 12 মিনিটে ingest/verification attempt চলবে, কিন্তু কোনো article স্বয়ংক্রিয়ভাবে publish হবে না। Editor approval ছাড়া database `newsroom_publish_article()` publish করতে দেবে না।

## Publish হওয়ার বাধ্যতামূলক checks

Database publish RPC-এর বর্তমান logic অনুযায়ী:

1. Article-এর current content hash verification hash-এর সঙ্গে মেলাতে হবে।
2. Active policy অনুযায়ী independent supporting sources থাকতে হবে।
3. Minimum successful independent verifier count পূরণ করতে হবে।
4. সব claim-এর assessment `supported` হতে হবে; unresolved claim থাকলে block হবে।
5. Sensitive/critical item-এ admin authority approval লাগবে।
6. Human editorial approval লাগবে।
7. Source URL valid HTTPS হতে হবে।
8. AI rewrite থাকতে হবে; fallback rewrite hold হবে।
9. Bengali content ratio, minimum body length, originality, source-number consistency এবং image licence checks pass করতে হবে।
10. `AUTO_PUBLISH=false` থাকলে worker-level gate publish না করে hold করবে।

Current application gate-এর গুরুত্বপূর্ণ defaults:

```env
AUTO_PUBLISH=false
MIN_AI_SCORE=40
```

`frontend/lib/publish-gate.ts` এবং `worker/src/lib/publish-gate.ts` byte-identical রাখা হয়েছে।

## কেন auto publish disabled রাখা হয়েছে

12-minute cadence কেবল collection/verification frequency নির্ধারণ করে; প্রতি 12 মিনিটে নিশ্চিতভাবে article publish করার SLA নয়। কোনো run-এ যথেষ্ট source, verifier বা supported claim না থাকলে publish না করাই নিরাপদ আচরণ। “একটি সংবাদ অবশ্যই publish” করতে quality gate bypass করলে সংবাদ-ভুল, duplicate syndication এবং misinformation ঝুঁকি তৈরি হবে।

## Live enable করার আগে

1. Fresh Supabase project-এ full disposable migration replay সবুজ করতে হবে।
2. New project-এ Auth, Storage, Vault, RLS এবং admin role পরীক্ষা করতে হবে।
3. `NEWSROOM_INGEST_KEY` Vault-এ রাখা হয়েছে কিনা যাচাই করতে হবে।
4. pg_cron এবং GitHub/worker-এর মধ্যে একটিমাত্র scheduler owner বেছে নিতে হবে।
5. 24 ঘণ্টা shadow/hold mode চালিয়ে stale run, source 403, duplicate, verifier failure ও rejected item মাপতে হবে।
6. তারপর `deploy/enable-reviewed-schedules.sql` manual review করে চালাতে হবে।
7. প্রথম production window-তে `AUTO_PUBLISH=false` বজায় রেখে editor-approved publish পরীক্ষা করতে হবে।

এই পরিবর্তন live Supabase database-এ apply বা scheduler enable করা হয়নি।
