# Banglar Voice 24 — End-to-End Verification Report

**তারিখ:** 2026-11-07  
**পরীক্ষার ধরন:** ZIP source audit, local Node CI, static Supabase migration audit, local video render  
**পরীক্ষিত source:** `automation-king-fresh-portable.zip`

## Executive result

Source package-টি fresh-account deployment-এর জন্য account-neutral এবং portability check পাস করেছে। Frontend production build, worker typecheck/test/build, root portability tests এবং local Bengali reel render সফল হয়েছে। তবে Supabase disposable replay, real Auth/Storage/OAuth, Docker image build, Flutter APK/AAB build এবং GitHub/Vercel/Supabase/Cloudflare live deployment এই sandbox-এ সম্পন্ন হয়নি, কারণ কোনো live connector/project secret নেই এবং Supabase CLI, Docker, Flutter/Dart অনুপস্থিত ছিল। এগুলোকে certified বা live বলা যাবে না।

## Verified successfully

- Root portability tests: **8/8 passed**.
- Portability checker: **passed**; embedded project host, platform ID, project JWT বা old deployment state পাওয়া যায়নি। এটি complete secret scanner নয়।
- Frontend: `npm ci`, TypeScript check, Vitest suite এবং `next build` **সব সফল**। Build-এ 32 static pages generate হয়েছে। তিনটি `no-img-element` warning আছে; এটি build blocker নয়। Build-time sitemap fetch-এ Supabase/config না থাকায় `SITEMAP_ARTICLE_LOAD_FAILED { fetch failed }` দেখা গেছে।
- Worker: typecheck **passed**, Vitest **12 files / 59 tests passed**, build **passed**.
- Local video render: `edge-tts 7.3.1` install করার পর sample reel সফল হয়েছে। Output: 1080×1920, 11.76 sec, MP4, publish/upload/social queue update হয়নি।
- ZIP-এ committed `.env` বা live credential file পাওয়া যায়নি; শুধু `.env.example` ফাইল আছে।
- পাঁচটি Flutter app source পাওয়া গেছে: `admin_app`, `reader_app`, `reporter_app`, `studio_app`, `tv_app`। তাদের configuration-এ `SUPABASE_URL`, public anon key এবং API base dart-defines ব্যবহারের প্রমাণ আছে।

## Not verified / blocked by environment

### 1. Supabase migration replay

মোট **81টি migration** পাওয়া গেছে। Static ordering scan হয়েছে, কিন্তু disposable Supabase replay চালানো যায়নি কারণ local Supabase CLI/Docker নেই। GitHub workflow `Disposable Supabase migration replay` সঠিকভাবে `supabase start` এবং `supabase db reset --local --no-seed` চালানোর জন্য প্রস্তুত। Production-এ migration push করার আগে এই workflow সবুজ হওয়া বাধ্যতামূলক।

Migration history-তে একই `pg_cron` job name একাধিক migration-এ schedule/unschedule হয়েছে—যেমন `news-ingest-daytime`, `news-ingest-overnight`, `epaper-daily`, `newsletter-worker`। Fresh replay-এ এটি execute করে দেখা জরুরি; live database-এ blind replay করা যাবে না।

### 2. Real Auth/Storage/OAuth

কোনো Supabase URL, anon key, service-role key, DB URL, OAuth client বা callback origin সরবরাহ করা হয়নি। তাই sign-up/login, admin role, RLS, Storage bucket policy, Vault, YouTube OAuth callback, social provider callback বা upload authorization বাস্তবে পরীক্ষা করা হয়নি। Code-level routes ও tests উপস্থিত, কিন্তু real account behavior certified নয়।

### 3. Docker

Sandbox-এ Docker CLI/daemon নেই। তাই `deploy/compose.yml` বা `frontend/Dockerfile`/`worker/Dockerfile` image build, container boot, health check, resource limit এবং production startup পরীক্ষা করা হয়নি।

### 4. Flutter release builds

পাঁচটি app এবং GitHub Actions workflow আছে, কিন্তু sandbox-এ Flutter/Dart নেই এবং ZIP-এ signing keystore নেই। ফলে APK/AAB artifact তৈরি বা link দেওয়া সম্ভব হয়নি। CI workflow-তে Android keystore secrets এবং public build variables না দিলে signed release হবে না।

### 5. Live deployment

ZIP-এ Git remote নেই এবং এই session-এ GitHub/Vercel/Supabase/Cloudflare connector বা account access পাওয়া যায়নি। অতএব কোনো repository import, commit, migration push, environment variable write, domain/callback update বা deployment করা হয়নি। `dibashamima2008@gmail.com`-কে commit author/authority হিসেবে remote account-এ enforce করাও account access ছাড়া সম্ভব নয়।

## Scheduler and source-quality findings

বর্তমান source-এ production source schedule মূলত **15 মিনিট** (`*/15`)—এটি আপনার চাওয়া 10–14 মিনিট range পূরণ করে না। একইসঙ্গে security migration-এ scheduler default-off রাখা হয়েছে, যা নিরাপদ default। Scheduler চালু করার আগে account configuration, Vault secret, origin, collector health, retry এবং publish gate পরীক্ষা করতে হবে।

শতভাগ নির্ভরযোগ্য সংবাদ উৎসের নিশ্চয়তা প্রযুক্তিগতভাবে দেওয়া যায় না: RSS endpoint down হতে পারে, source ভুল করতে পারে, একই সংবাদ syndicate হতে পারে, বা AI ভুল করতে পারে। বর্তমান architecture-এর ভালো দিক হলো evidence/source verification, independent-source count, human review, risk gate এবং `auto_publish_allowed=false` default আছে। কিন্তু “প্রতি 10–14 মিনিটে অন্তত একটি প্রকাশিত সংবাদ” গ্যারান্টি করা যাবে না যদি quality gate কোনো item reject করে। নিরাপদ semantics হওয়া উচিত: প্রতি 12 মিনিটে ingest/verify attempt; quality gate পাস না করলে publish নয়, এবং dashboard-এ `no_publish_reason`/stale alert।

নিরাপদ rollout-এ:

1. Scheduler owner হিসেবে **একটিমাত্র** পথ নির্বাচন করতে হবে—pg_cron, GitHub schedule, অথবা continuous worker।
2. 12-minute ingest interval আলাদা migration/approved config হিসেবে প্রস্তুত করতে হবে; existing default-off policy না ভেঙে manual enable করতে হবে।
3. Minimum two independent sources, source health/kill switch, content hash, risk gate এবং human review বজায় রাখতে হবে।
4. কোনো source বা AI fallback দিয়ে quality gate bypass করা যাবে না।
5. No-valid-story হলে placeholder/news publish নয়; alert ও retry হবে।
6. 24-hour shadow run শেষে measured success rate, stale intervals, rejected items এবং duplicate rate দেখে production enable করতে হবে।

## Video rendering conclusion

ভিডিও render-এর জন্য Termux বাধ্যতামূলক নয়। Repository-তে GitHub Actions workflow আছে যা Ubuntu runner-এ FFmpeg ও `edge-tts` install করে render এবং Supabase Storage authorization endpoint-এ upload করতে পারে। এটি free-tier availability/quotas ও provider terms-এর ওপর নির্ভরশীল; unlimited free guarantee নয়। Local host, GitHub Actions, বা নিজের Docker host—তিনটির যেকোনো একটিতে render করা সম্ভব, তবে Storage upload-এর জন্য Supabase URL এবং scoped upload token/secret লাগবে।

Local sample artifact:

- `scripts/pipeline/output/reels/reel-sample-00000000-0000-4000-8000-000000000001.mp4`
- পাশে JSON metadata আছে
- এটি sample-only; কোনো live article, Storage বা social platform-এ publish হয়নি

## Required live rollout inputs

- New private GitHub repository and connector access.
- New Supabase project ref, project URL, public anon/publishable key, service-role credential, DB session-pooler URL and trusted CA if needed.
- Vercel project access and generated hostname/custom domain.
- Optional Cloudflare Pages project and separate stable HTTPS Next.js origin; Pages alone is not the full SSR app.
- Supabase Auth redirect URLs and OAuth client credentials for each enabled provider.
- Five app public build variables: `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Android signing keystore and passwords for signed release; without the original signing key, old installed apps cannot be updated in place.
- Explicit provider credentials for YouTube/social/video/email features; keep optional automation off until each feature passes its readiness test.

## Final gate status

| Gate | Status |
|---|---|
| Source portability | PASS |
| Frontend typecheck/tests/build | PASS |
| Worker typecheck/tests/build | PASS |
| Local video sample render | PASS |
| Migration static audit | PASS WITH LIVE REPLAY PENDING |
| Disposable Supabase replay | BLOCKED: CLI/Docker unavailable |
| Real Auth/Storage/OAuth | BLOCKED: live project/credentials unavailable |
| Docker image build | BLOCKED: Docker unavailable |
| Five Flutter APK/AAB builds | BLOCKED: Flutter/keystore unavailable |
| GitHub/Vercel/Supabase/Cloudflare deployment | NOT EXECUTED: no connector/access |
| 12-minute production scheduler | NOT ENABLED; current source schedule is 15-minute/default-off |
| End-to-end production certification | NOT CERTIFIED |

**Conclusion:** local code quality is promising and the main CI paths are green, but production deployment and full feature certification must wait for new-account connectors/credentials and the missing toolchains. No production data or remote account was modified by this audit.
