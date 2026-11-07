# দীর্ঘমেয়াদি স্থায়িত্ব, নিরাপত্তা ও বিনা বাড়তি SaaS ফিতে পরিচালনা
## সংশোধিত প্রকল্পের পূর্ণাঙ্গ audit ও handover report

**প্রস্তুতির তারিখ: ৭ নভেম্বর ২০২৬**  
**ডেলিভারি: account-neutral source ZIP + বাংলা নির্দেশিকা + এই report + পরীক্ষার evidence**

## ১. নির্বাহী সিদ্ধান্ত

প্রদত্ত archive পরীক্ষা করে বাস্তব code/configuration সংশোধন করা হয়েছে; এটি কেবল পরামর্শের report নয়। পুরোনো Supabase project reference, GitHub deployment owner/repository linkage, Vercel deployment identifiers, cloud URL, operator email, YouTube account/playlist linkage, secret-scan baseline এবং historical deployment report বাদ/নিরপেক্ষ করা হয়েছে। নতুন account settings ছাড়া কোনো পুরোনো cloud project-এ ফিরে যাওয়ার fallback রাখা হয়নি। ব্র্যান্ডের নাম, news UI, source logic এবং mobile application identity রাখা হয়েছে—এগুলো deployment account identifier নয়।

**সবচেয়ে জরুরি সীমা:** “চিরস্থায়ী, unlimited, ১০০% future-proof ও সম্পূর্ণ খরচশূন্য” hosted production service নিশ্চিত করা যায় না। free plan বদলাতে পারে; quota, commercial-use policy, inactivity, hardware ও third-party API-র বাস্তব খরচ আছে। এই সংস্করণ dependency বিচ্ছিন্নতা, portable deployment, fail-closed security, bounded automation, backup/maintenance ও evidence-based release gate দিয়ে দীর্ঘমেয়াদি ঝুঁকি কমায়।

**বর্তমান readiness:** frontend production build, TypeScript, unit tests, local HTTP smoke, isolated queue/comments/database-config/budget checks পাশ করেছে। সব Supabase service/extension-সহ migration replay, live নতুন account deployment, Docker image এবং Flutter release build এই পরিবেশে যাচাই হয়নি। তাই “সব production feature end-to-end certified” দাবি করা হচ্ছে না। এগুলো final go-live-এর বাধ্যতামূলক gate।

## ২. কী পাওয়া গিয়েছিল এবং কী বদলেছে

| বিষয় | পূর্বের ঝুঁকি | বাস্তব সংশোধন |
|---|---|---|
| Next.js config | `.js` ও `.mjs` দুটো; security header config কার্যকর না হওয়ার ঝুঁকি | conflicting `.mjs` বাদ, একক config; lint/type checking চালু; standalone output |
| AI gateway authorization | signature verify না করে decoded JWT-এর `service_role` বিশ্বাস | exact configured service credential-এর hashed fixed-size comparison; forged-JWT regression test |
| RSS collector | handler-এর আগে authorization barrier ছিল না | POST-only + server credential verification; bundled variant-ও কঠোর করা |
| health-monitor defense | platform verification-এর ওপর নির্ভরশীল decoded-claim check | handler-এ একই exact credential barrier |
| deployment URLs | SQL cron, runtime fallback, documents ও APK release route পুরোনো account-এ বাঁধা | neutral placeholders; environment configuration; DB origin settings; নতুন release repo selection |
| scheduler খরচ | একাধিক scheduler ও পুরোনো cadence overlap করতে পারত | Vercel cron খালি, project HTTP schedulers default OFF; review-only bounded opt-in |
| AI request quota | policy-তে daily limit থাকলেও gateway reservation ছিল না | durable atomic per-task/per-UTC-day reservation; error হলে fail-closed |
| worker container | Node 20; runtime-এ floating `tsx` installation; meaningless health success | Node 22; lockfile installation; false-positive health check বাদ |
| database TLS | কয়েকটি legacy script certificate verification বন্ধ রাখত | `rejectUnauthorized: true`; নতুন Vault bootstrap-এ verified TLS |
| VideoHub | `locale` prop mismatch; English/empty-state regression | bilingual accessible rendering ও empty-state পুনরুদ্ধার; tests pass |
| Manager event test | retry timestamp ভিন্ন হলেও পুরো envelope সমান চেয়েছিল | occurrence timestamp রাখা; stable event ID ও payload-ই dedupe contract হিসেবে পরীক্ষা |
| mobile workflow | নতুন Supabase/site values build-এ consistent injection ছিল না | `API_BASE` ও `BV_API_BASE`, Supabase URL/public key দুটো workflows-এ দেওয়া |
| GitHub dispatch | hardcoded repo; upstream failure-তেও success/processing | নতুন repo env + validation; dispatch status check; accepted dispatch-এর পর processing |
| secret scan baseline | পুরোনো identifiers, JWT material ও বিস্তৃত suppressions | old baseline/ignore বাদ; narrower gitleaks configuration; portability scan |
| recovery/report artifacts | historical linked-account তথ্য ও পুরোনো success claims | পুরোনো audit binaries/log reports বাদ; নতুন authoritative guide/report |

এগুলো নতুন account-এর fresh install-এর জন্য তৈরি। historical migrations-এর URL expressions সংশোধন করা হয়েছে; ফলে এটি বিদ্যমান production-এর migration history repair package নয়। নতুন forward migration পরিকল্পনা ছাড়া চলমান DB-তে প্রয়োগ করবেন না।

## ৩. কোন ফিচার রাখা হয়েছে

Next.js SSR, public feed/RSS/sitemap, search ও news listing, editorial/admin role paths, publish-quality gate, breaking ticker/Realtime source, comments/moderation, e-paper, private approved video, YouTube inventory/live paths, newsroom ingest, social queue/dispatch, newsletter queue ও worker pipeline source বজায় আছে। Flutter Reader, Reporter, Admin, Studio ও TV sources রাখা হয়েছে। মূল news publishing gate copy frontend/worker-এ মিলিয়ে পরীক্ষা করা হয়েছে।

**Source retained আর live feature verified এক কথা নয়।** নতুন OAuth account/permission, Vault key, SMTP provider, streaming service অথবা DB schema না থাকলে সংশ্লিষ্ট feature প্রস্তুত নয়। নিরাপত্তার জন্য optional scheduler/auto-publish OFF থাকা feature deletion নয়; review-এর পরে চালু করতে হবে। পুরোনো production data, auth users বা Storage files source ZIP-এর মধ্যে ছিল না—তাই এগুলো migration হয়েছে বলা যাবে না।

Application ID/signing compatibility আলাদা বিষয়। নতুন cloud account-এ app deploy করার জন্য Android package name বদলানোর প্রয়োজন নেই। পুরোনো app update দিতে পুরোনো legitimate signing key/private Play signing setup ব্যক্তিগতভাবে ধরে রাখতে হবে; এই ZIP কোনো signing key সরবরাহ করে না।

## ৪. চার সেবার মধ্যে বাস্তবসম্মত ব্যালেন্স

### প্রস্তাবিত দায়িত্ববণ্টন

| অংশ | দায়িত্ব | খরচ নিয়ন্ত্রণ |
|---|---|---|
| GitHub | private source, review, CI, manual mobile release; optional coarse schedule | limited triggers, concurrency, timeouts; billing blocking নিজে যাচাই; public করা বাধ্যতামূলক নয় |
| Supabase | PostgreSQL/Auth/Storage/Realtime/Vault/Edge APIs | এক project, RLS, bounded jobs, ছোট media, retention policy ও usage monitoring |
| Vercel | personal non-commercial Next.js demo/preview/eligible production | business use-এর free loophole নয়; অতিরিক্ত parallel deployment নয় |
| Cloudflare | DNS/TLS/protection; optional Pages guide/gateway | whole app-কে static করে features বাদ নয়; gateway requests Functions quota নেয় |
| নিজস্ব host | commercial unrestricted Next.js execution, long worker/video/local AI | existing capacity থাকলে SaaS subscription বাঁচতে পারে; hardware/power/uptime free নয় |

সব চার provider-কে একই কাজ করানো প্রয়োজন নেই। এক canonical site, এক primary database এবং একই pipeline-এর এক scheduler owner রাখাই টেকসই। origin বদলালে configuration বদলাবে, business logic নয়। নতুন origin settings protected table থেকে SQL job URL তৈরি হয়; credentials আলাদা Vault-এ থাকে।

### দুইটি সৎ deployment profile

**ক. ব্যক্তিগত/non-commercial:** GitHub + Supabase Free + Vercel Hobby; Cloudflare optional DNS। অল্প usage-এ provider bill ছাড়াই চলতে পারে; free quota ও pause শর্ত প্রযোজ্য।

**খ. সংবাদ ব্যবসা/বিজ্ঞাপন/সাবস্ক্রিপশন:** Vercel Hobby-কে production origin ধরবেন না। existing Linux host-এ Docker Next.js/worker + Supabase Free অথবা self-hosted Supabase + Cloudflare। Pages gateway optional; এটি backend hardware-এর বিকল্প নয়। বিদ্যমান own host না থাকলে সব dynamic feature অক্ষুণ্ণ রেখে guaranteed $0 commercial deployment এই চার service দিয়ে নিশ্চিত করা যায় না।

## ৫. যাচাইকৃত free-plan সীমা

| সেবা | official source অনুযায়ী প্রাসঙ্গিক সীমা/নীতি | প্রভাব |
|---|---|---|
| Supabase Free | database 500 MB/project; file storage 1 GB; egress 5 GB ও cached egress 5 GB; 50,000 MAU; Edge invocation 500,000; automatic backup অন্তর্ভুক্ত নয়; প্রায় ১ সপ্তাহ inactivity-তে pause | media/video archive, realtime ও recovery পরিকল্পনা ছাড়া দীর্ঘমেয়াদে চলবে না |
| Vercel Hobby | non-commercial personal use; quota শেষ হলে সেবা সীমিত/বন্ধ হতে পারে; cron দিনে একবার, সময় নির্ভুল নয় | commercial newsroom-এর স্থায়ী free origin নয় |
| Cloudflare Pages Free | 500 builds/month, একসঙ্গে ১ build; static asset 25 MiB/file; Functions usage Workers quota নেয় | APK/video/static export সীমা; gateway traffic ফ্রি unlimited নয় |
| Cloudflare Workers Free | 100,000 requests/day; 10 ms CPU/request | lightweight gateway-ও traffic quota ব্যবহার করে; full Next.js runtime compatibility পৃথক পরীক্ষা |
| GitHub Free private | included compute বর্তমান documentation-এ $12/month allowance; artifact storage 500 MB | fixed unlimited minutes নয়; mobile/CI/render jobs দিয়ে allowance দ্রুত শেষ হতে পারে |
| GitHub public standard runners | eligible standard runners free; larger runners আলাদা; schedule delay/drop হতে পারে; 60-day public repo inactivity-তে schedule বন্ধ | public source exposure/licence ও cron reliability দুটো ভাবতে হবে |

GitHub-এর বর্তমান একই official page-এর standard Linux $0.006/minute উদাহরণে $12 allowance ≈ 2,000 মিনিট **হিসাবকৃত**; runner ও applicable billing model বদলালে সময়ও বদলাবে। এই allowance “আপনার খরচ শূন্য নিশ্চিত” নয়। paid usage block account setting-এ যাচাই করতে হবে।

উৎস: [Supabase pricing](https://supabase.com/pricing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)।

Cloudflare-এর current guide full-stack Next.js-এর জন্য Workers-based deployment নির্দেশ করে, static Pages export নয়। এই project-এর SSR/API/admin বজায় রাখতে static-only rewrite করা হয়নি। [Cloudflare Next.js guide](https://developers.cloudflare.com/pages/framework-guides/nextjs/)

## ৬. নিরাপত্তা ও খরচের নতুন বাধা

Exact server-key authorization JWT claim spoofing বন্ধ করে, কিন্তু leaked real service key-কে নিরাপদ করে না। server keys browser/APK/logs-এ নয়; নতুন keys তৈরি ও periodic rotation করুন। কোনো পুরোনো live key এই কাজ থেকে revoke করা হয়নি—account owner-এর আলাদা security কাজ।

DB deployment settings table RLS ও privilege-সুরক্ষিত। ordinary client origin পাল্টাতে পারে না। নতুন origin configuration ছাড়া scheduler execution error হবে, পুরোনো domain-এ যাবে না। scheduler default OFF; duplicate execution কমাতে concurrency guards আছে। manual opt-in ছাড়া nightly renderer/mobile matrix চলতে বাধ্য করা হয়নি।

Gateway budget atomic upsert দিয়ে concurrency-safe। ২৪টি concurrent reservation-এর পরীক্ষায় limit ৭ হলে ঠিক ৭টি accepted হয়েছে। default প্রতি task/day ২০০; request reservation গুনে, tokens/dollars নয়। provider fallback/retry এক accepted request-এর মধ্যে একাধিক billable call করতে পারে। direct worker AI calls পৃথক path। তাই provider-side $0/hard cap এবং manual usage review-ও প্রয়োজন।

CSP এখনো **Report-Only**। এটি enforcing CSP নয় এবং inline script protection certified বলা যাবে না। nonce-based enforcing CSP আলাদা tested rollout দরকার। existing admin/realtime/epaper functionality হঠাৎ ভাঙা এড়াতে অযাচাইকৃত CSP enforcement দেওয়া হয়নি। baseline headers বাস্তব built-server response-এ দেখা গেছে।

Rate limiting-এর কিছু path in-memory fallback ব্যবহার করে। এটি multi-instance global defence নয়। sensitive insert-এর DB limit/comments test আছে, কিন্তু সব endpoint globally abuse-proof দাবি করা হচ্ছে না। future shared limiting হলে own Redis/Valkey অথবা atomic DB path উপযুক্ত review-এর পরে ব্যবহার করুন; Upstash account বাধ্যতামূলক করা হয়নি।

## ৭. বাস্তবে চালানো পরীক্ষার ফল

| পরীক্ষা | ফল | coverage/সীমা |
|---|---|---|
| Frontend TypeScript | PASS | build errors ignore করা হয়নি |
| Frontend Vitest | ১৩৭/১৩৭ PASS, ৩৭ file | locale, publishing, auth boundary, feeds, comments helpers, gateway contract ইত্যাদি |
| Fresh source typecheck | PASS | `.next` বাদ দিয়েও TypeScript পাশ; generated route types বাধ্যতামূলক নয় |
| Deno Edge check/tests | ৩টি changed entry point check PASS; ৬/৬ test PASS | collector/risk utility tests; remote deployment নয় |
| Worker TypeScript | PASS | Node worker source |
| Worker Vitest | ৫৯/৫৯ PASS, ১২ file | collector, SSRF, rewrite fail-closed, media, publish gate, supervisor |
| Production `next build` | PASS | Next.js 15.5.29; SSR/API routes retained; standalone generated |
| ESLint | PASS with warnings | তিনটি existing `<img>` optimisation warning; error নয় |
| Portable tooling | ৮/৮ PASS | environment checks ও Pages gateway forwarding/fail-closed/redirect unit tests |
| Recovery utility Python | ১৭/১৭ PASS | utility suite, live accounts নয় |
| Video queue pgTAP | ৩২/৩২ PASS | disposable PostgreSQL 16; selected queue migration/fixture; পুরো Supabase নয় |
| Queue দুই-session claim | PASS | A lock ধরে থাকলে B একই job claim পায়নি |
| Article-comments DB/RLS | PASS | disposable PostgreSQL 16; moderation, entitlement, throttling/concurrency; selected schema |
| নতুন deployment settings/budget DB | PASS | origin resolution, 24-way concurrency, invalid cap, anonymous denial |
| Migration SQL syntax parse | ৮১ file PASS | PostgreSQL parser; extension/dependency/PLpgSQL runtime validation-এর বিকল্প নয় |
| Built HTTP smoke | PASS | missing configuration-এ health/admin 503; no-store/security headers; fail-closed |
| Production dependency audit | frontend/worker/root: ০ known advisory | বর্তমান registry snapshot; perfect security proof নয় |
| Frontend full dev graph audit | ৬ moderate advisory বাকি | ESLint/TypeScript tooling-এর minimatch dependency chain; high/critical ০ |

কোনো test skip করে বা `ignoreBuildErrors` দিয়ে pass বানানো হয়নি। unrelated Manager-event test-এর contradictory timestamp expectation সংশোধন করা হয়েছে; event ID/payload stability বজায় আছে। build-এর সময় backend settings না থাকায় sitemap data fetch warning হয়েছে; live content/sitemap verification নতুন project-এ করতে হবে।

পরীক্ষার raw logs ও JSON `verification/` folder-এ আছে। database tests PostgreSQL 16-এ হয়েছে; target Supabase PostgreSQL 17/service bundle-এর সম্পূর্ণ সামঞ্জস্যের বদলি নয়। final migration replay workflow এজন্য সরবরাহ করা হয়েছে।

## ৮. যা এখনো যাচাই বাকি এবং release-blocking

১. official Supabase local Docker/নতুন disposable project-এ **সমস্ত ৮১ migration-এর ordered replay**। syntax pass-এ missing extension, dependent object, recreated policy বা schema-drift ধরা পড়ে না। replay failure হলে migration fix/replay ছাড়া go-live নয়।
২. নতুন Supabase Auth Site URL, callback, real login, admin/chief-editor role, restricted Vault functions এবং Storage policies।
৩. Cloudflare Pages gateway-এ বাস্তব cookie/CSRF/Server Actions/redirect/upload পরীক্ষা; worker runtime adapter migration যদি বেছে নেওয়া হয়, সেটা পৃথক engineering কাজ। কোনো untested full-stack Pages-only package বলে উপস্থাপন করা হয়নি।
৪. actual Docker image build/boot, TLS proxy/host firewall, disk pressure, restart ও rollback।
৫. Flutter SDK দিয়ে পাঁচ app build, physical-device test, signing ও installed-app update। এখানে SDK/keystore ছিল না।
৬. AI provider key/model availability, Bengali quality, copyright/source licensing, real social OAuth scopes, video upload and approval এবং newsletter deliverability।
৭. encrypted backup restore, Storage byte backup এবং recovery drill।

এই সীমাগুলো report-এ রেখে দেওয়া হয়েছে, যাতে “code build হয়েছে” থেকে ভুল করে “সম্পূর্ণ production migration শেষ” ধরে না নেওয়া হয়। নতুন accounts/credentials ছাড়া remote provisioning সম্পন্ন করা নিরাপদ বা সম্ভব ছিল না; কোনো account access ধরে নেওয়া হয়নি।

## ৯. নিয়মিত পরিচালনা ও capacity policy

**প্রতিদিন:** health/stale pipeline, failed queue, provider quota/credit এবং unexpected function spikes দেখুন। fake keepalive দিয়ে provider policy এড়ানোর পরিবর্তে inactivity pause ও restore পরিকল্পনা রাখুন।

**প্রতি সপ্তাহে:** encrypted DB + Storage backup; failed job/dead-letter review; Dependabot advisory; disk/database usage। এই backup cadence নতুন process policy; ZIP download করলেই cloud backup স্বয়ংক্রিয় শুরু হয় না।

**প্রতি মাসে:** scratch restore drill, secret-access review, OAuth permissions, Auth redirect list, dependency/Node/Supabase update এবং all optional services spend review। six moderate development advisories reviewed upstream upgrade-এ resolve করুন; forced major dependency bump করে production behavior অযাচাইকৃতভাবে বদলানো হয়নি।

**Capacity thresholds (প্রস্তাবিত, provider guarantee নয়):** quota-র ৬০% usage-এ সতর্কতা, ৮০%-এ optional heavy jobs pause, ৯০%-এ নতুন video upload/render stop ও manual review। এই threshold monitoring dashboard-এ নিজে configure করতে হবে; সব provider-এর paid spend automation দিয়ে enforce হয়েছে বলা হচ্ছে না।

Media policy: Supabase Free-কে দীর্ঘ video warehouse বানাবেন না। editorial approval-সহ সীমিত source file, explicit retention ও backup। short-lived signed URL/private bucket গোপনীয় media-র জন্য বজায় রাখুন। retention কাজ কখনো all-record delete নয়; backup ও legal/editorial requirements review করে archive/cleanup করুন।

Recovery objective (প্রস্তাব): দৈনিক backup হলে সর্বোচ্চ প্রায় ২৪ ঘণ্টার data gap গ্রহণযোগ্য কি না আগে ঠিক করুন; বাস্তব RPO/RTO measured drill ছাড়া প্রতিশ্রুত SLA নয়। business-critical 24/7 newsroom-এর প্রয়োজন free-tier capability ছাড়ালে budget ছাড়া reliability দেওয়া যাবে না।

## ১০. সম্পূর্ণ open-source বিষয়ে সৎ অবস্থান

আপনার “open source” চাহিদাকে বিনা বাড়তি provider fee ও vendor-independent পরিচালনার লক্ষ্য হিসেবে নেওয়া হয়েছে। কিন্তু GitHub/Vercel/Cloudflare hosted SaaS নিজেরাই সম্পূর্ণ self-hostable open-source stack নয়। Supabase-এর official self-hosting আছে; hardware, upgrades, HTTPS, email ও backup আপনার দায়িত্ব। [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)

প্রদত্ত project-এর মূল `LICENSE` **All Rights Reserved / proprietary**। অনুমতি ছাড়া এটিকে MIT/AGPL করা হয়নি। subfolder-এর নিজস্ব MIT licence তার নিজস্ব utility-র জন্য, পুরো app-এর blanket permission নয়। পুরো প্রকল্পকে প্রকৃত open-source প্রকাশ করতে copyright owner-এর স্পষ্ট licence নির্বাচন ও third-party asset/dependency licence review দরকার।

শুধু unlimited free runner সুবিধার জন্য confidential source public করবেন না। own Linux host, Docker Engine, PostgreSQL/Supabase, নিজস্ব compatible AI endpoint এবং portability templates vendor dependency কমায়; electricity/hardware/maintenance অপসারণ করে না।

## ১১. ডেলিভারির ফাইলগুলো

- `FRESH_DEPLOY_BN.md`: নতুন GitHub/Supabase/Vercel/Pages/self-host deployment-এর ধাপে ধাপে নির্দেশিকা।
- `FULL_REPORT_BN.md`, `FULL_REPORT_BN.html`, `FULL_REPORT_BN.pdf`: একই পূর্ণ report-এর editable/পঠন/প্রিন্ট সংস্করণ।
- `deploy/compose.yml`, frontend/worker Dockerfiles: dynamic app ও worker-এর portable packaging।
- `deploy/cloudflare-pages/`: optional dynamic gateway এবং static emergency guide; full app backend নয়।
- `scripts/validate-env.mjs`, `configure-deployment.mjs`, `bootstrap-vault.mjs`: নতুন configuration ও Vault bootstrap।
- `deploy/enable-reviewed-schedules.sql`, bounded GitHub workflow: explicit scheduler activation।
- `scripts/backup-database.sh`: local encrypted database dump; Storage ও restore আলাদা।
- `verification/`: raw tests, dependency audit, SQL syntax ও HTTP smoke evidence।
- `FRESH_CHANGE_MANIFEST.json`: original ZIP-এর সঙ্গে path-level addition/modification/removal, without old values।
- `SHA256SUMS.txt`: package files integrity; downloaded ZIP-এর hash বাইরের checksum file-এও দেওয়া হয়েছে।

ZIP থেকে `node_modules`, `.next`, generated logs/cache, `.env`, linked deployment state এবং private signing material বাদ। fresh install-এ lockfile অনুযায়ী dependencies বসবে। source deletion এড়াতে unrelated app/feature folders রাখা হয়েছে; historic deployment/account reports-ই deliberate removal।

## ১২. সর্বশেষ সিদ্ধান্ত ও অগ্রাধিকার

**আজ সম্পন্ন:** account detachment, config/security remediation, migration-origin portability, bounded optional scheduler, atomic gateway request reservation, self-host/Pages gateway packaging, dependency hardening, regression fixes, build ও উপরের local validations।

**এখন আপনার পরবর্তী কাজ:** fresh guide ধরে নতুন account তৈরি → full disposable migration replay → নতুন keys/origins/Vault → অনুমোদিত hosting profile → Auth/admin/storage acceptance → one scheduler → backup/restore rehearsal → সীমিত traffic।

**দীর্ঘমেয়াদি সুপারিশ:** business production-এ Vercel Hobby policy এড়িয়ে নিজস্ব tested Next.js origin অথবা যথাযথ অনুমোদিত production hosting নিন। free plan-এর মধ্যে workload মাপুন, কিন্তু reliability/SLA নিয়ে মিথ্যা নিশ্চয়তা নয়। code/data/export/backup আলাদা করে রাখলেই কোনো provider বদলাতে হলে শুরু থেকে app বানাতে হবে না।
