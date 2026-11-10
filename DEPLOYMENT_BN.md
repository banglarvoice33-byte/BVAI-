# BVAI: পরীক্ষিত স্থানীয় quality follow-up ও নিরাপদ deployment নির্দেশনা

তারিখ: ১০ নভেম্বর ২০২৬। এই ডেলিভারি নতুন website/database stack নয়। এটি সংযুক্ত reviewed overlay-র জন্য add-only offline extension। Live integration সম্পন্ন হয়নি।

## সবচেয়ে গুরুত্বপূর্ণ অবস্থা

| বিষয় | এই সেশনে পাওয়া প্রমাণ |
|---|---|
| GitHub সংযোগ | দুটি visible repository: Shamima-Diba/manager-, Shamima-Diba/dibasala |
| কাঙ্ক্ষিত banglarvoice33-byte/BVAI- | authenticated GitHub API-তে Not Found; repo মুছে গেছে এমন সিদ্ধান্ত নয়—এই connection-এর access অনিশ্চিত/অনুপস্থিত |
| Current main / c9d35ecc… | ব্যবহারকারীর পুরোনো প্রতিবেদন; এই সেশনে পুনরায় নিশ্চিত নয় |
| Input ZIP | SHA256 aded6dffc77eafedd90f913bd8bd9f8f097195f69e55355ea59cd06bd3a3288c মিলে গেছে |
| Original payload | PATCH_MANIFEST.json অনুযায়ী ৩১/৩১ SHA256 মিলে গেছে |
| নতুন offline Node tests | ২৪টি পাস; test log সংযুক্ত |
| নতুন Python tests | ১২টি পাস: installer ৫ + existing caption converter-এর নতুন regression check ৭ |
| Original full regression | চেষ্টা হয়েছে; baseline tts-router.js, voice-captions.js, audio-qc.mjs ও package/dependency tree অনুপস্থিত; সম্পূর্ণ চালানো যায়নি |
| Live Supabase schema/RPC/index/RLS | কোনো সংযোগ/ফল নেই; যাচাই হয়নি |
| Staging TUS / website signed playback | করা হয়নি |
| Social accounts / OAuth scopes / quota | কোনো credential খোলা বা live API test হয়নি |
| Production push/migration/automation/publication | কোনোটিই করা হয়নি |

শুধু repository-তে migration থাকা database-এ সেটি প্রয়োগের প্রমাণ নয়। Vault-এ provider secrets থাকা worker সেগুলো পড়তে পারে বা token/scope/identity সঠিক—তারও প্রমাণ নয়। Google OAuth client ID/secret refresh token বা সঠিক YouTube channel identity-এর বিকল্প নয়। Email address দিয়ে channel/account ID অনুমান করা হয়নি।

## কী কোড তৈরি হয়েছে

সব নতুন code `payload/scripts/pipeline/quality-v3/`-এ। Installer কোনো existing source overwrite করে না।

### review-contract.mjs
- MP4 ও spoken script SHA256 দিয়ে review binding; বদল হলে review invalid।
- প্রতিটি claim-এর quoted evidence, locator, human review note, disputed=false বাধ্যতামূলক।
- এই নতুন contract-এর conservative policy: প্রতিটি claim-এ একটি primary এবং দুই independently owned news source; মালিকানা মানব-পর্যালোচিত হতে হবে। অন্য domain মানেই অন্য owner নয়।
- Wikipedia/Wikimedia/Wikidata-কে primary/independent-news হিসেবে নেওয়া যাবে না। Context/media metadata আলাদা role।
- source publication time, fresh capture, captured content hash; future/stale capture আটকানো। পুরোনো primary document বৈধ হতে পারে—publication age-কে event age বলা হয় না।
- প্রতিটি human QC field না থাকলে validation fail।
- Facebook edit-এর আলাদা asset/script hash, original master binding, retained claims, ৪০–৯০s এবং fresh semantic review। কোনো FFmpeg trim command নেই।

**সীমা:** JSON-এর reviewer_id/quote_verified/ownership_reviewed ব্যবহারকারী-লিখিত assertion। এটি authentication, স্বয়ংক্রিয় factual verification বা প্রকাশের অনুমতি নয়। Existing authenticated server session থেকে reviewer identity ও exact asset revision নিতে হবে; client JSON বিশ্বাস করে publish নয়। Database approval/audit persistence বা existing publish-review.mjs-এ এই gate সংযুক্ত করা হয়নি।

### media-qc.mjs
- Local FFprobe + FFmpeg দিয়ে uniformly sampled 64-bit gray dHash। Re-encoding/resizing-এর duplicate candidate খুঁজতে helper। Exact hash reservation অক্ষত রাখতে হবে।
- শুধু candidate flag; near-duplicate proof নয়। Crop, scene reorder, intro/outro বদল, partial clip reuse বাদ পড়তে পারে; blank/flat visual false positive হতে পারে। Global concurrent perceptual reservation/index implement হয়নি।
- Final audio থেকে measured integrated LUFS, true peak ও LRA। Project gate -14±1 LUFS, true peak <=-1.5 dBTP, LRA<=11। এগুলো project targets; platform guarantee নয়। Silence/NaN fail closed।
- Actual audio SHA256-bound word times থেকে scene boundary; সময়ের দৈর্ঘ্য অনুমান/scale করা নয়। Scene relevance human note বাধ্যতামূলক। ASR/alignment provenance upstream-এ যাচাই করতে হবে।
- Intl.Segmenter দিয়ে NFC Bengali grapheme-safe chunks; display spelling পাল্টায় না। এটি existing renderer-এ বসানো হয়নি; glyph shaping/font ও rendered line width human QC বাকি।
- Conservative project safe-zone rectangle ও bounding-box check; এটি সব platform UI/device-এর গ্যারান্টি নয়।

### preview.mjs / cli.mjs
- Local read-only HTML evidence/claims + user-selected MP4 preview। SHA256 না মিললে playback বন্ধ।
- কোনো signed URL, secret, DB client, network fetch বা approve/publish button নেই। CSP দিয়ে network বন্ধ ও text escaped।
- এটি proper authenticated Next.js editor/approval interface-এর বিকল্প নয়। Browser end-to-end/accessibility test হয়নি; generated HTML contract/security assertions Node-এ পরীক্ষা হয়েছে।

### metrics.mjs
- Sanitized offline snapshot থেকে Prometheus text ও alert code।
- last_successful_ingestion_at ছাড়া feed probe-কে সফল ingestion বলা হয় না।
- rejected/duplicate/cost/render/caption counters না থাকলে missing alert; বানিয়ে zero নয়।
- queued/processing/retrying/reconciliation বয়স created_at থেকে।
- independently read public visibility ছাড়া accepted/unlisted upload verified-public count নয়।
- raw checkpoint, token, provider URL/error বা arbitrary label emit হয় না।

**সীমা:** persistent event capture, Supabase queries, per-source exporter labels, scrape endpoint, alert routing ও independent publication verifier সংযুক্ত হয়নি। এই adapter-এর output কোনো live metric নয়। কাউন্টারকে durable cumulative store থেকে দিতে হবে; cost missing হলে $0 বলা যাবে না।

### supervised worker template
`payload/ops/quality-v3/`-এ systemd service example এবং serial delivery loop। Existing delivery-worker.mjs/DB fenced claims-এর ওপর নির্ভর করে। Disabled/default-off: installer systemctl চালায় না। Child output suppress করে secret/session leakage এড়ানো হয়েছে; generic tick status only।

এটি single-host supervision template, multi-host HA/failover SLA নয়। Hang deadline/watchdog, durable job schedule, service environment, recovery, readiness ও production metrics সহ staging soak-test প্রয়োজন। Termux-এ systemd সাধারণত নেই; Termux deployment client, 24/7 HA server নয়।

## পুরোনো overlay-তে পাওয়া নির্দিষ্ট অসামঞ্জস্য

1. IMPLEMENTATION_BN.md-এ optional scene example `type: visual`; generate-video.js বাস্তবে `type: video_visual` খোঁজে। Integration-এর সময় code contract মেনে চলতে হবে; এই package পুরোনো source নীরবে পাল্টায়নি।
2. পুরোনো Bengali notes-এর table list-এ video_visual_reservations বাদ; original SQL-এ পাঁচটি reservation/asset/outbox table আছে।
3. পুরোনো notes-এ ২৫ tests, supplied summary/log-এ ২৮। এই সেশনের নতুন test count আলাদা; এগুলো যোগ করে original suite PASS দাবি নয়।
4. Existing vtt-to-karaoke.py multiword cue-এর সময় character length অনুযায়ী ভাগ করে। Matched whole-cue timing থাকলেই প্রতিটি শব্দের actual measured timing প্রমাণ হয় না। নতুন helper actual word timestamps চায়, কিন্তু existing converter replace করা হয়নি।
5. deliveryTargets পুরোনো code-এ শুধু youtube/facebook/instagram; TikTok supported নয়। TikTok-কে delivery list-এ এখন দিলে unsupported platform error হবে। Site-verification file দিলেই uploader তৈরি হয় না।
6. Worker credential fallback reads the existing `api_vault` / `decrypt_vault_secret` contract. এটি Supabase native Vault-এর সঙ্গে এক কিনা live schema না দেখে নিশ্চিত নয়। Vault-এ Gemini/Grok/OpenAI থাকা স্বয়ংক্রিয় routing প্রমাণ নয়।
7. source-health last_probe_* লিখে; প্রকৃত last successful ingestion metric নয়। `--probe` read-only নয়, তাই চালানো হয়নি।
8. Review/unlisted default বনাম publicly verified publication আলাদা। Worker succeeded মানেই public visibility independently observed নয়। নতুন metric contract এই পার্থক্য ধরে; actual verifier integration বাকি।

## নিরাপদ Termux: প্রথমে tests ও dry-run

এই ZIP Download folder-এ রেখে extract করুন। Repository checkout আগে থেকেই নিজের authorized GitHub session দিয়ে রাখুন। Token chat-এ দেবেন না বা remote URL-এ embed করবেন না। উদাহরণে package folder এবং repo folder আলাদা; নিজের path অনুযায়ী বদলাবেন।

```bash
cd ~/storage/downloads
unzip BVAI-quality-followup.zip
cd BVAI-quality-followup
node --test payload/scripts/pipeline/quality-v3/quality.test.mjs payload/scripts/pipeline/quality-v3/smoke.test.mjs
python3 -m unittest discover -s verification -p '*test*.py' -v
python3 install.py --repo "$HOME/BVAI-"
```

Tests-এর জন্য Node 22.12+, Python3, FFmpeg/FFprobe প্রয়োজন; নতুন helper-এর npm dependency নেই। এটি full Next.js dependency install বা frontend build নয়। পুরোনো পূর্ণ suite চালাতে full checkout ও original lockfile অনুযায়ী dependencies প্রয়োজন। Test fixture fake repo কেবল installer behavior পরীক্ষা করে—actual website পরীক্ষা নয়।

Installer তিনটি reviewed code anchor-এর exact hash চায়: generate-video.js, delivery-worker.mjs ও original media migration। Current repo drift হলে **থামবে**। সে ক্ষেত্রে force/skip-hash নয়; current code compare করে নতুন reviewed integration লাগবে। Symlink destination ও conflicting file block হয়।

শুধু dry-run pass এবং স্থানীয় file সংযোজনে আপনার অনুমোদনের পরে:

```bash
python3 install.py --repo "$HOME/BVAI-" --apply
```

এতে শুধু নতুন helper files যোগ হয়। Existing renderer, collectors, website routes, SQL, credentials, git branch/commit বা workflow পরিবর্তন হয় না। Local install ≠ live integration।

### CLI examples — manual offline use

সম্পূর্ণ local paths নিজেরগুলো দিন; review.json-এ credential/claim token/provider upload URL রাখবেন না।

```bash
node scripts/pipeline/quality-v3/cli.mjs fingerprint /path/to/local.mp4 > /path/to/fingerprint.json
node scripts/pipeline/quality-v3/cli.mjs qc /path/to/local.mp4
node scripts/pipeline/quality-v3/cli.mjs review /path/to/review.json
node scripts/pipeline/quality-v3/cli.mjs preview /path/to/review.json /path/to/private-preview.html
node scripts/pipeline/quality-v3/cli.mjs compare /path/to/first.json /path/to/second.json
node scripts/pipeline/quality-v3/cli.mjs metrics /path/to/sanitized-metrics-snapshot.json
```

Preview file স্থানীয় রাখুন; public/ বা Git-এ দেবেন না। Evidence review sensitive হতে পারে। Metrics CLI alert থাকলে exit=2, invalid operation/input হলে exit=1।

## Supabase-এর জন্য আলাদা SQL — এখন শুধু read-only audit

`payload/scripts/pipeline/quality-v3/schema-audit.sql` নতুন migration নয়। আলাদা downloadable SQL-ও দেওয়া হয়েছে। Controlled readonly DB service connection configure করে চালান; credentials command line/chat/log-এ নয়। উদাহরণে PGSERVICE-এর config operator নিজে নিরাপদে রাখবেন।

```bash
umask 077
psql 'service=bvai_readonly' -X -v ON_ERROR_STOP=1 \
  -f scripts/pipeline/quality-v3/schema-audit.sql \
  > /path/to/private-schema-audit.txt
```

এটি BEGIN READ ONLY / ROLLBACK ব্যবহার করে; table rows, vault, RPC bodies, default values, cron command বা tokens পড়ে না। Column types, RPC identity signatures/results/grants/settings, index names/columns/validity এবং RLS metadata দেখায়। Secrets থাকতে পারে বলে full policy expression/index predicate/cron command print করে না। তাই exact policy/body semantics ও disabled legacy worker state আলাদা authorized secure inspection বাকি। Metadata audit একাই full semantic equivalence প্রমাণ নয়।

Original reviewed migration `reviewed-original/payload/supabase/migrations/20261110000000_media_delivery_reliability.sql`-এ অক্ষত আছে। নতুন unverified schema change বানানো হয়নি। আপনার কথামতো applied হয়ে থাকলে পুনরায় blindly চালাবেন না। Live snapshot ও staging approval ছাড়া এই package কোনো SQL apply করবে না। Blanket `supabase db push` নয়।

## পরবর্তী integration acceptance — প্রতিটি এখনও বাকি

- Actual latest repository source/Next.js routes/auth/collector/workflow পড়ে exact integration diff তৈরি।
- Secret value না দেখিয়ে authorized env-তে variable-name availability/account-scope results পরীক্ষা। Wrong GitHub identity ঠিক করা বা full sanitized repo ZIP প্রয়োজন।
- Authenticated editor: role enforcement, server-derived reviewer ID, private fresh signed preview, immutable asset binding, CSRF/authorization, revision concurrency, durable audit trail ও mobile preview। Client review JSON একা অনুমতি নয়।
- Perceptual candidates persistent service-only DB registry + fenced reservation flow; concurrency এবং false-positive/negative dataset। Exact story/script/MP4/global B-roll byte-hash gates বাদ নয়।
- Claim evidence contract ও measured QC render/finalization/publication gate-এ যোগ; failure হলে existing manifest/claim/provider checkpoint মুছে নয়।
- Actual ingestion counters/source ownership register; independent public read receipts; durable cost ledger; private exporter/alerts।
- প্রতি ১৪ মিনিট article due-time durable scheduling: `*/14` cron ব্যবহার নয় (প্রতি ঘণ্টায় 56→00-এ চার মিনিট gap)। Success-based scheduling বনাম slots explicit design এবং DB fencing দরকার। ২৪ ঘণ্টায় 1440/14=102.857… interval; fixed ১০৩ articles/day guarantee নয়।
- দৈনিক সর্বোচ্চ ১০ video goal, Asia/Dhaka day-boundary ও slot/counter atomicity; মানব approval না থাকলে quota পূরণের জন্য generation/publication নয়। এক-video pilot আপনার approval ছাড়া impose করা হয়নি।
- Staging-only single migration confirmation; interrupted TUS, existing object same/different bytes, expired session, checksum mismatch, restart test। Immutable path; overwrite নয়। Original media/editorial records preserve।
- Fresh signed website playback: expiry after refresh, review asset anonymous denial, authorized editor playback, published website asset end-to-end।
- Test accounts: current Meta version/app support, account identity/scopes, YouTube channel/privacy/quota, processing/resume/lost response/receipt failure/lease expiry। API acceptance ≠ public visibility।
- Supervised host soak-test, restart/network/DB failure, alert delivery, recovery artifact decrypt and existing saved-session reconciliation। Multi-host HA not yet provided।

## Platform নথি পুনরায় পরীক্ষা: ১০ নভেম্বর ২০২৬

Facebook official Reels API guide-এ ৩–৯০s এবং Page story হলে সর্বোচ্চ ৬০s বলা আছে। এই project-এর minimum master ৪০s থাকবে। Page token, CREATE_CONTENT task ও pages_show_list/pages_read_engagement/pages_manage_posts দরকার; actual granted scopes যাচাই হয়নি। App-specific Graph version অনুমান করে hardcode নয়।
https://developers.facebook.com/docs/video-api/guides/reels-publishing/

Instagram docs-এ IN_PROGRESS/FINISHED/PUBLISHED/ERROR/EXPIRED container states আছে। Retrieved page-এ ১০০ এবং ৫০ posts/24h—দুটি limit statement পাওয়া গেছে; এই অসামঞ্জস্য resolve না করে limit hardcode করা হয়নি। App/login method/account-এর actual contract ও content publishing limit endpoint verify করতে হবে।
https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing

YouTube resumable guide: lost response হলে saved original session status আগে query; 308 হলে returned byte range থেকে resume। Expired/ambiguous session-এ provider inventory reconcile না করে blind fresh post নয়। Current retrieved insert docs-এর upload privacy statement আগের প্রচলিত audit/private restriction থেকে ভিন্ন; তাই audit/privacy/quota account-এ যাচাই ছাড়া কোনো conclusion/config change হয়নি। OAuth youtube.upload-সহ documented scopes account-এ পরীক্ষা করতে হবে।
https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
https://developers.google.com/youtube/v3/docs/videos/insert
https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

Supabase TUS guide: upload session সর্বোচ্চ ২৪ ঘণ্টা, concurrent conflicting path-এ conflict, overwrite x-upsert এড়ানো, immutable path recommended। Existing object checksum প্রমাণ এবং original session checkpoint preserve রাখতে হবে।
https://supabase.com/docs/guides/storage/uploads/resumable-uploads

TikTok official docs: app approval + authorized user's video.publish scope, creator-info query, access token/open ID, provider publish ID persistence ও asynchronous status polling দরকার। Unaudited client private-view restriction আছে। Client ID/secret ও email যথেষ্ট নয়। Input ZIP-এ site-verification filename/content পাওয়া যায়নি; public/ verification asset বানানো হয়নি। পরে ঠিক ফাইলটি পেলে শুধু ওই public verification file যোগ করতে হবে, OAuth client JSON/secret কখনো public নয়।
https://developers.tiktok.com/doc/content-posting-api-get-started

GitHub schedule delay/drop হতে পারে; minimum five minutes হলেও strict every-14-min SLA নেই। তাই supervised/durable scheduler acceptance বাকি।
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

আপনার দেওয়া viral statistics, voice percentages, vendor-specific tags/SSML, claim cost বা retention thresholds verified production contract হিসেবে hardcode করা হয়নি। Display Bengali spelling ও spoken normalization আলাদা; যুক্তবর্ণ বিকৃত করে global substitution নয়।

## Rollback

নতুন helper install-এর পর স্থানীয় কোনো file না বদলালে:

```bash
python3 /path/to/BVAI-quality-followup/install.py --repo "$HOME/BVAI-" --rollback
```

শুধু installer-created, unchanged files সরবে; local edit পেলে rollback থামবে। Preexisting identical files মুছবে না। এই package কোনো DB change করে না, তাই destructive down SQL নেই। Original media/assets/outbox/provider checkpoint বা editorial record মুছবেন না। ভবিষ্যৎ integration rollback হবে reviewed commit revert + authorized workers off; applied additive DB data রেখে দেওয়া safest default। No published post automatically deleted।

## Reproducibility ও trust boundary

MANIFEST.json-এ নতুন payload hash; SHA256SUMS-এ packaged files। Hash integrity accidental drift ধরে, code authorship/production suitability certify করে না। Installer test anchors কৃত্রিম minimal tree-তে; full repo/runtime compatibility বাকি। FFmpeg smoke synthetic চার-সেকেন্ড test pattern; ৪০–১২০s real Bengali news, typography/perceptual QC বা full render smoke pass দাবি নয়। Full original renderer smoke dependency missing হওয়ায় চালানো যায়নি।

চূড়ান্ত শ্রেণিবিভাগ: **offline extension implemented/local-tested; production pipeline integration pending; staging-verified none; live-verified none.**
