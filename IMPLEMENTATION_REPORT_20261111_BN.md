# বাংলার ভয়েস — বাস্তবায়ন ও যাচাই রিপোর্ট | ২০২৬-১১-১১

**অবস্থা: LOCAL VERIFIED / LIVE RELEASE BLOCKED.** এই রিপোর্ট এই ZIP-এর সর্বশেষ handoff; পুরোনো RELEASE_STATUS, FRESH/WEBSITE report বা historical test counts-কে নতুন live verification হিসেবে ব্যবহার করবেন না।

## কী পাওয়া গেছে এবং কী বাস্তবায়ন হয়েছে

| অংশ | মূল সমস্যা | এই সংস্করণের পরিবর্তন |
|---|---|---|
| Renderer/uploader | Renderer-এ DB claim ছিল না; manifest-এ job_id, claim_token, caption_method, content_key/script_hash অনুপস্থিত; tests-এর প্রয়োজনীয় exports-ও ছিল না | DB-এর atomic claim ও story reservation, job-specific directory, সম্পূর্ণ atomic manifest, import-safe exports ও failure fencing |
| Audio QC | uploader-এর imported audio-qc.mjs অনুপস্থিত | actual encoded-audio measurement ও two-pass normalization; -14 LUFS ±2, true peak ≤ -1 dBTP upload gate |
| Caption | পুরোনো renderer আলাদা কণ্ঠের VTT scale করত বা estimated timing বানাত | বিদ্যমান actual-audio Whisper / matching Edge voice-caption module-এর সঙ্গে renderer যুক্ত; missing accurate captions fail closed |
| Script | বানানো impact, render-date এবং মাঝপথে CTA কাটার ঝুঁকি | উৎসের সম্পূর্ণ বাক্য থেকে narration; কোনো invented impact নয়; শেষ CTA: “বিস্তারিত দেখতে বাংলার ভয়েস ওয়েবসাইট ভিজিট করুন।” |
| Trusted-source gate | JS precheck এক source মেনে নিলেও refreshEvidence দুই source চাইত | DB policy-র সঙ্গে এক/দুই source fetch requirement মিলেছে; reporter/original-এর editorial gate অক্ষুণ্ণ |
| Keyless media | arbitrary stock/thumbnail fallback, বড় download ও provenance ঘাটতি | Wikimedia Commons keyless search; ≤12 MiB/file; CC0 / CC BY-এর সীমিত subset; author/license/asset/hash metadata; SHA-256 reservation; unknown rights-এ publish নয় |
| WebM/OGV | ভিডিও input ভুলভাবে image -loop argument পেতে পারত | MP4/WebM/OGV motion-input handling; বাস্তব WebM smoke test |
| Visual | misleading BREAKING label; symbolic footage-এর স্থায়ী label ছিল না | neutral সংবাদ header, স্থায়ী “প্রতীকী ভিডিও”, source name ও creator/license overlay; source/license URLs durable metadata/provider description-এ |
| Cleanup | সফল upload-এর পর downloaded source files থেকে যেত | remote bytes checksum ও finalize transaction-এর পরই checksum/path-checked source cleanup; receipt/provenance ও rendered master retained |
| Local continuity | failed terminal claim পরের run বন্ধ করতে পারত | DB-confirmed terminal state evidence-সহ local backup-এ archive; live lease/pending upload guessed বা deleted নয় |
| Social schema | live audit-এ social_posts missing; actual registry consumer-এর নাম social_platforms/readiness | forward migration 20261111040000: missing table/claim RPC restore, service-only grants, new versioned readiness view; frontend/Edge consumers aligned |
| Social duplicate safety | timeout/crash-এর পর old article dispatcher fresh provider request পুনরায় করতে পারত | provider call-এর আগে durable dispatch_started_at barrier; ambiguous row auto-reclaim নয়; provider receipt reconciliation প্রয়োজন |
| Cadence | শেষ trigger-এর interval দিয়ে 06:00/00:00 boundary পিছিয়ে যেতে পারত | forward migration 20261111041000: Dhaka anchor-aligned slot, 78 daytime + 6 overnight = 84 trigger slots; no catch-up burst |
| Video capacity | UTC 10 attempts cap; failed attempt-ও success slot খেত | Dhaka day; সর্বোচ্চ 10 completed/review/inflight slots, আলাদা সর্বোচ্চ 30 attempts; article retry bound অক্ষুণ্ণ |
| CI/install | root lockfile নেই; npm ci ব্যর্থ; tests ignored | committed root package-lock, npm scripts/import checks, test failure blocking |
| Scheduling | GitHub-এ daily একটি render; legacy Termux --public runner broken | দশটি প্রস্তাবিত Dhaka coverage slot, cancel-in-progress=false, explicit owner github/termux; local cron opt-in, no automatic install |
| Recovery key | ephemeral CI key হারালে encrypted recovery decrypt করা যেত না | owner-retained persistent VIDEO_RECOVERY_KEY required; ephemeral fallback removed |
| Deployment | portable account handoff দরকার | read-only readiness command, checksum-verified conflict-stopping patch applier, manual full replay ও reviewed deploy workflows |

## এই সেশনে বাস্তবে যাচাই

| পরীক্ষা | ফল | কী প্রমাণ করে / সীমা |
|---|---|---|
| Root/media/quality Node suite | 64/64 PASS | mocked provider contracts, source policy, licensing, cleanup, local recovery, slot helpers, existing QC tests |
| Python caption tests | 7/7 PASS | timing conversion/empty caption checks; live ASR quality নয় |
| Worker | TypeScript PASS; 59/59 tests PASS | existing worker regressions |
| Frontend | TypeScript PASS; 141/141 tests PASS | existing website regressions |
| Frontend next build | PASS | production build; 3 existing img warnings; live backend configured ছিল না |
| Frontend lint | PASS with warnings | 3 img optimisation warnings ও next lint deprecation |
| Runtime import graph | 10 modules PASS | missing module/export এখন ধরা হয়; শুধু node --check নয় |
| Real FFmpeg render | PASS | synthetic tone + actual WebM input, Bengali overlay/ASS, 1080×1920 H.264/yuv420p, AAC/48kHz/30fps, full decode, checksum ও final loudness gate |
| PostgreSQL 16 selected replay | PASS | exact media baselines + trusted gate + new forward migrations + local fixtures; সব Supabase migrations নয় |
| DB assertions | PASS | 06:00/00:00 ও 14m boundary; 84 slots; trusted single-evidence finalize; reporter approval; social barrier/readiness/anon denial |
| Two-session DB claim race | PASS | একই article-এ একটি generation claim |
| New forward migrations reapplied | PASS | selected fixture-এ idempotent reapplication |
| Deno check | PASS | social-dispatch, social-manager, youtube-sync |
| Production npm audit | root/frontend/worker: 0 known advisories | registry snapshot; full dev graph বা perfect security guarantee নয় |
| Cloud readiness | BLOCKED, expected | এই সেশনে SUPABASE_URL/SERVICE_ROLE/SITE_URL credentials/config নেই |

Raw evidence `verification/repair-20261111/`-এ আছে। Build/test output production deployment receipt নয়। Offline tone/WebM test কোনো সংবাদ ভিডিও, বাস্তব TTS/ASR quality বা social post নয়। কোনো media-generation service ব্যবহার/বিল করা হয়নি।

## নীতি ও সীমা

Curated enabled/non-kill-switched aggregated articles existing automated article gates পাস করে published হলে trusted video path-এ প্রতিটি item-এর human approval লাগে না। এটি HTTP 200 বা source নাম দেখেই সংবাদ সত্য বলে ঘোষণা নয়। `refreshEvidence` live bytes/hash সংগ্রহ করে; নিজে semantic fact verification করে না। পুরোনো optional quality-v3 মানব-review utility runtime public path নয়; তা সরিয়ে অন্য workflows ভাঙা হয়নি।

Reporter/field/manual/original content public video delivery-তে human_verified=true এবং verification_status=verified প্রয়োজন। নতুন করে Reporter/Admin/Studio app E2E বা signed APK পরীক্ষা করা হয়নি; Flutter source অপরিবর্তিত।

Wikimedia search topic/context বেছে নেয়, প্রকৃত ঘটনার footage প্রমাণ করে না; তাই এই renderer-এর Commons visuals সর্বদা প্রতীকী। CC BY-SA/NC/ND/GFDL/unknown/public-domain-marker-only file automatic path-এ নেওয়া হয় না। Small licensed matching file না পাওয়া গেলে queue quality failure হবে, copyrighted thumbnail দিয়ে পাশ করানো হবে না। Pexels API key ছাড়া documented API access ধরে নেওয়া হয়নি; scraping যোগ করা হয়নি। প্রতিটি license ও অন্যান্য personality/privacy rights আলাদা দায়িত্ব। Source credit alone reuse permission নয়।

কাঁচা source সফল হলে delete হয়; DB hash/license/provenance reservation delete হয় না—ফাইল মুছে দিলেই duplicate prevention হয় না। master render ও local recovery backups রাখা হয়; operator-কে disk retention/backup capacity পরিচালনা করতে হবে।

দশটি সময় (বাংলাদেশ): 07:17,09:17,11:17,12:17,13:17,15:17,17:17,19:17,21:17,23:17। এগুলো পরীক্ষামূলক coverage slots, analytics-verified peak-view time নয়। ব্যর্থ হলে অন্য slot/manual retry লাগতে পারে; 10 attempts কখনো guaranteed 10 successful videos নয়। GitHub scheduler delay/drop করতে পারে; strict SLA-র জন্য durable always-on host/queue প্রয়োজন। ফোনের wake-lock-ও 24/7 uptime guarantee নয়।

84টি article trigger slot কখনো 84টি published article-এর নিশ্চয়তা নয়। আগের supplied audit-এ 4 published/24h, 12 pending, zero videos ছিল; এটি নতুন live measurement নয়। image_not_related, number_not_in_source, identical_run, rewrite deadline-এর সংশ্লিষ্ট live rows/credentials ছাড়া safe repair প্রমাণ করা যায়নি। এই safety gates শিথিল করা হয়নি এবং যাচাই ছাড়া RSS sources বাড়ানো হয়নি। Article auto-publish flags/accounts নিজে থেকে বদলানো হয়নি।

YouTube upload এবং Facebook/Instagram/TikTok delivery adapters আগেই ছিল; এই সংস্করণ নতুন adapter বাস্তবে provider-এ পোস্ট করেছে বলে দাবি করছে না। Default YouTube unlisted; public করতে account/app review ও explicit config প্রয়োজন। Existing Facebook adapter 90s limit enforce করে; 90–120s master Facebook-এ deliver হবে না—multi-target production pilot-এ duration নিশ্চিত করুন। TTS/ASR/OAuth/token expiry/platform quotas/real Bengali pronunciation এখনো live gate।

## Deploy করার সঠিক ক্রম

প্রথমে checksum-aware helper দিয়ে প্রকৃত clone-এ changes merge করুন। অন্য local revision conflict হলে helper থামবে; blind overwrite বা git reset --hard নয়। Review/CI শেষে default branch-এ merge করুন। Root/worker/frontend checks আলাদা।

`BVAI Full Supabase Replay` workflow disposable stack-এ সব migrations replay করার জন্য যোগ করা হয়েছে, কিন্তু এই sandbox-এ Docker না থাকায় তা চালানো হয়নি। Historical migrations-এ schema/view drift থাকতে পারে; full replay fail হলে release BLOCKED রেখে upstream dependency fix করতে হবে। Selected PostgreSQL fixture-কে full Supabase/Postgres17/Auth/Storage/Vault replay বলবেন না।

Migration history আগে `supabase migration list` ও `db push --dry-run` দিয়ে দেখুন। Dry-run SQL runtime validation নয়। Old migration files rewrite, blind migration repair, db reset --linked, অথবা production-এ historical full SQL concatenate করবেন না। নতুন forward migrations কার্যকর হওয়ার আগে তাদের prerequisites উপস্থিত থাকতে হবে। Supabase-এর official guidance অনুযায়ী history mismatch deliberate reconciliation ছাড়া পাশ করানো যাবে না।

Owner-confirmed project ref, Supabase access token ও DB password কেবল GitHub Secrets/Variables-এ দিন। Reviewed deploy workflow default dry-run; apply=true কেবল full replay এবং backup review-এর পরে। এই workflow social switches/cron/OAuth/site deployment enable করে না। Database migration আগে, তারপর 3 affected Edge consumers, তারপর connected Next.js deploy।

Private reels bucket, SOURCE policy, article publish, signed playback, one website video, each provider receipt ও no-duplicate retry যাচাই করুন। এরপর এক platform করে delivery enable করুন। `enabled`, `is_enabled`, `names_verified`—এই তিন registry switches deliberate account verification-এর পরে set করতে হয়; secret থাকলেই identity verified নয়।

এই bundle GitHub-এ push হয়নি; Supabase/Vercel-এ apply/deploy হয়নি। ZIP-এ .git বা ব্যবহারযোগ্য cloud session ছিল না; কোনো নতুন PAT/key বানানো, source public করা, account setting বদলানো বা বাস্তব সংবাদ/social publish করা হয়নি। পুরোনো Supabase audit-এ recorded account health এখনো একই আছে বলা হচ্ছে না।

## Official references (এই কাজে retrieved)

Wikimedia per-file reuse/license/attribution: https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
GitHub schedule delays/default branch: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
Supabase versioned migration workflow/history: https://supabase.com/docs/guides/deployment/database-migrations

Termux-এর সম্পূর্ণ কমান্ড `TERMUX_REPAIR_20261111_BN.txt`-এ। Integrity/diff inventory `UPDATE_FILE_MANIFEST.json`-এ। কোনো secret chat-এ দেবেন না; server service-role browser/APK-এ দেবেন না।
