# নতুন অ্যাকাউন্টে ডেপলয়মেন্ট — ব্যবহারিক নির্দেশিকা

**সংস্করণ: ৭ নভেম্বর ২০২৬ · Fresh-install only**

এই প্যাকেজ পুরোনো cloud account থেকে বিচ্ছিন্ন source distribution। এটি কোনো নতুন অ্যাকাউন্টে ইতিমধ্যে deploy করা live service নয়। নতুন project-এর key, domain, administrator ও OAuth consent আপনাকেই দিতে হবে। `FULL_REPORT_BN.md`-এ পরীক্ষা ও সীমাবদ্ধতার পূর্ণ তালিকা আছে।

## ১. প্রথম সিদ্ধান্ত: কোন পথে চালাবেন

| ব্যবহার | উপযুক্ত পথ | শর্ত |
|---|---|---|
| ব্যক্তিগত, non-commercial পরীক্ষা | নতুন GitHub + নতুন Supabase Free + নতুন Vercel Hobby | quota, inactivity ও Hobby terms মেনে; বিজ্ঞাপন/বাণিজ্যিক কার্যক্রম নয় |
| বাণিজ্যিক সংবাদসাইট, বাড়তি SaaS subscription এড়ানো | নিজের বিদ্যমান Linux/Docker host-এ সম্পূর্ণ Next.js ও worker; Supabase Free অথবা নিজের Supabase; Cloudflare DNS/TLS | নিজের hardware, বিদ্যুৎ, internet, backup ও uptime-এর খরচ/দায়িত্ব থাকে |
| Cloudflare Pages ঠিকানায় একই dynamic অ্যাপ | `deploy/cloudflare-pages/`-এর optional gateway + আলাদা স্থায়ী HTTPS Next.js origin | Pages নিজে SSR server নয়; login/API/SSR backend origin-এই চলে; live compatibility পরীক্ষা বাকি |
| Pages-এ শুধু fallback/guide | একই folder, Functions ছাড়া static public upload | পূর্ণ app নয়; এটি জরুরি guide page |

Vercel-এর বাণিজ্যিক ব্যবহারের নীতি Pages দিয়ে proxy করেও বদলায় না। শুধু free quota পাওয়ার জন্য একাধিক account/project-এ workload ভাগ করবেন না।

## ২. পরিষ্কার GitHub repository

ZIP extract করে নতুন **private repository**-তে ফাইলগুলো commit করুন। পুরোনো `.git`, `.vercel`, `.wrangler`, `.temp`, deploy logs বা `.env` কপি করবেন না। repository-কে public করা বাধ্যতামূলক নয়; মূল `LICENSE` proprietary-ই আছে। public release-এর আগে মালিকানা ও licence আলাদাভাবে ঠিক করতে হবে।

Repository → Actions permissions-এ default token read-only রাখুন। production Environment-এ reviewer approval দিন। Billing/budget settings-এ আপনার account-এ প্রযোজ্য hard stop/paid usage blocking যাচাই করুন। এই ZIP account-level billing settings বদলায় না।

প্রথমে স্থানীয় যাচাই:

```sh
npm ci
npm --prefix frontend ci
npm --prefix worker ci
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix worker run typecheck
npm --prefix worker test
node --test scripts/portable-tools.test.mjs
node scripts/check-portability.mjs
```

Node.js 22 ব্যবহার করুন। lockfile commit করুন। automatic major upgrade নয়—Dependabot PR review ও tests-এর পরে merge করুন।

## ৩. নতুন Supabase project

১. নতুন Supabase account/project তৈরি করুন; Free plan বেছে usage panel যাচাই করুন।
২. নতুন Project URL, public anon/publishable key, server service-role credential এবং database session-pooler connection string সংগ্রহ করুন। নতুন project-এর legacy service-role JWT-ই কিছু JWT-verified Edge Function-এর জন্য প্রয়োজন হতে পারে। আধুনিক `sb_secret_` key সব পুরোনো JWT gateway-এ একইভাবে কাজ করে ধরে নেবেন না।
৩. Supabase CLI install/login করুন। প্রকল্পে `supabase/config.toml` আছে; blindly `supabase init` করে এটি overwrite করবেন না।
৪. আগে disposable replay চালান: GitHub Actions → **Disposable Supabase migration replay** → Run workflow। full replay সবুজ না হওয়া পর্যন্ত production deployment নয়। sandbox-এ সব Supabase extension-সহ এই replay করা যায়নি।
৫. তারপর **নতুন ফাঁকা project**-এ:

```sh
supabase login
supabase link --project-ref YOUR_NEW_PROJECT_REF
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy --project-ref YOUR_NEW_PROJECT_REF
```

`supabase/schema.sql` এবং `storage.sql` পুরোনো reference snapshots; এগুলোকে cumulative migration-এর বিকল্প হিসেবে চালাবেন না। বিদ্যমান production database-এ এই fresh-edited historical migrations সরাসরি চালাবেন না।

নতুন database-এ প্রথম deploy-এর পরে application-এর HTTP scheduler-গুলো OFF থাকবে। নতুন origin ও Vault secret না দেওয়া পর্যন্ত cron চালু করবেন না। নতুন admin user sign-up/auth করে trusted Dashboard SQL Editor থেকে তার profile role সেট করুন। সাধারণ ব্যবহারকারীকে role পরিবর্তনের API দেবেন না। প্রয়োজনীয় Realtime publication, storage bucket policies এবং admin RLS নতুন project-এ যাচাই করুন।

## ৪. এক জায়গায় নতুন environment প্রস্তুত

`deploy/.env.example` কপি করে `deploy/.env` বানান। অন্তত এগুলো পূরণ করুন:

| নাম | কোথায় যাবে | গোপনীয়তা |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | web build/runtime | public, নতুন canonical HTTPS origin |
| `NEXT_PUBLIC_SUPABASE_URL` | web/mobile build | public, নতুন Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web/mobile build | public; RLS বাধ্যতামূলক |
| `SUPABASE_SERVICE_ROLE_KEY` | server/worker only | গোপন; browser/APK-তে কখনো নয় |
| `NEWSROOM_INGEST_KEY` | web/worker + Vault | নতুন random, অন্তত ৩২ অক্ষর |
| `CRON_SECRET` | server cron | আলাদা নতুন random, অন্তত ৩২ অক্ষর |
| `SUPABASE_DB_URL` | bootstrap/backup script only | গোপন DB connection; HTTPS নয় PostgreSQL URL |
| `RELEASE_GITHUB_REPOSITORY` | web server only | নতুন `owner/repo`; optional |
| `GITHUB_REPO`, `GITHUB_DISPATCH_TOKEN` | verification dispatch only | নতুন repo ও scoped server token; optional |
| `YOUTUBE_CHANNEL_ID`, stream/social OAuth values | সংশ্লিষ্ট integration | নতুন account-এর অনুমোদন; optional |

নতুন random secret তৈরির স্থানীয় command:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Production environment যাচাই ও নতুন origins সংরক্ষণ:

```sh
node --env-file=deploy/.env scripts/validate-env.mjs
node --env-file=deploy/.env scripts/configure-deployment.mjs
node --env-file=deploy/.env scripts/bootstrap-vault.mjs
```

শেষ command-এর জন্য root-এ `npm ci` আগে চালাতে হবে। DB TLS certificate যাচাই হবে; প্রয়োজন হলে Supabase-এর trusted CA `SUPABASE_DB_CA`-তে দিন—certificate verification বন্ধ করবেন না। secrets screen/log-এ প্রকাশ না করেই Vault-এ যায়। পুনরায় bootstrap করলে পুরোনো Vault reference নিজে review/cleanup করুন; rotation পরিকল্পিতভাবে করুন।

## ৫. Vercel: শুধু অনুমোদিত ব্যবহার

নতুন Vercel account-এ নতুন repo Import → **Root Directory `frontend`** → Framework Next.js → Node 22। `frontend/.env.example` অনুসারে variables দিন। public variables build-এর আগে দিতে হবে; পরিবর্তন করলে rebuild করুন। আলাদা `.vercel/project.json` বা পুরোনো org/project ID দরকার নেই।

প্রথম generated hostname পাওয়া গেলে সেটি `NEXT_PUBLIC_SITE_URL`-এ বসিয়ে আবার deploy করুন। Supabase Auth URL Configuration-এ সেই Site URL ও প্রয়োজনীয় callback/redirect URL-গুলো দিন। wildcards অপ্রয়োজনে ব্যবহার করবেন না। কোনো domain কেনা না থাকলে Vercel-এর generated subdomain দিয়েই non-commercial পরীক্ষা করা যায়।

`frontend/vercel.json`-এ cron খালি। নিচের scheduler পথগুলোর একটিমাত্র বেছে নেবেন। Hobby-এর দিনে একবার cron দিয়ে ঘন newsroom automation সম্ভব ধরে নেবেন না।

## ৬. নিজের Linux host-এ সম্পূর্ণ app

Docker Engine ও Compose ব্যবহার করুন। `.env` পূরণ এবং validator চালানোর পরে repository root থেকে:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build web
```

server-এর `127.0.0.1:3000`-কে আপনার HTTPS reverse proxy অথবা Cloudflare Tunnel-এর পিছনে রাখুন। public PostgreSQL port বা Docker socket খুলবেন না। `NEXT_PUBLIC_*` build-time configuration, তাই public values পাল্টালে container rebuild জরুরি।

continuous worker দরকার হলে:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml --profile automation up -d --build
```

এই worker চালু করলে একই কাজের pg_cron/GitHub scheduler বন্ধ রাখুন। container auto-restart আছে; তবে host failure recovery/monitoring/backup আপনাকেই করতে হবে। production traffic দেওয়ার আগে image build ও host-specific startup পরীক্ষা প্রয়োজন; sandbox-এ Docker ছিল না।

নিজের Supabase-ও চালাতে চাইলে official self-hosting Docker distribution আলাদাভাবে deploy করুন: https://supabase.com/docs/guides/self-hosting/docker । এই ZIP-এ কোনো অসম্পূর্ণ plain-Postgres-কে পূর্ণ Supabase বলে দেওয়া হয়নি। Auth, Storage, Realtime, Vault ও Edge runtime দরকার; কেবল PostgreSQL বসানো যথেষ্ট নয়।

## ৭. Cloudflare Pages: gateway অথবা static guide

**Gateway:** নতুন Pages project-এ Root directory `deploy/cloudflare-pages`, framework None, build command `exit 0`, output `public`। Git integration ব্যবহার করুন যাতে পাশের `functions/` folder deploy হয়; শুধু dashboard static drag-and-drop-এ Functions কাজ করবে ধরে নেবেন না।

Pages environment-এ `APP_ORIGIN=https://YOUR_SEPARATE_NEXT_SERVER` দিন। origin অবশ্যই আলাদা, স্থায়ী, বৈধ HTTPS server হবে। `NEXT_PUBLIC_SITE_URL` এবং Supabase Auth redirect settings-এ public Pages/custom hostname দিন। একই public site-কে আবার origin দিলে loop হবে—gateway তা reject করে। optional `ORIGIN_SHARED_SECRET` কেবল তখনই ব্যবহার করুন যখন origin-এও নিজস্ব matching-header access rule থাকবে; header পাঠানো নিজে থেকে origin-কে সুরক্ষিত করে না।

gateway request body/query/cookies/redirect/stream forward করে এবং response cache default `private, no-store` রাখে। এর unit tests হয়েছে; live Auth callbacks, Server Actions, বড় upload ও provider-specific redirects পরীক্ষা বাকি। এটি WebSocket gateway নয়; direct Supabase Realtime নিজের Supabase origin-এ চলবে। Next Server Actions-এর নতুন hostname/origin acceptance live যাচাই করুন। সবার আগে backend সরাসরি কাজ করছে নিশ্চিত করুন।

`/_deployment-guide`-এ static guide পাওয়া যাবে। `APP_ORIGIN` ছাড়া মূল application routes 503 দেবে—ভুল করে পুরোনো server-এ পাঠাবে না।

**Static guide only:** `public` directory আলাদাভাবে upload করতে পারেন। এটিকে পূর্ণ Next.js app বলা যাবে না।

## ৮. Scheduler: মাত্র একজন মালিক

### পথ ক — pg_cron

সব setup ও manual API test-এর পরে trusted SQL connection দিয়ে `deploy/enable-reviewed-schedules.sql` review করে চালান। এটি core newsroom প্রতি ২ ঘণ্টা, social dispatch প্রতি ৪ ঘণ্টা এবং e-paper UTC 17:30-এ enable করে। code files/review gates সরানো হয়নি; কেবল cadence নিয়ন্ত্রিত। optional newsletter/video/social-manager/YouTube jobs আলাদা readiness পরীক্ষা শেষে enable করবেন। `cron.job`-এ job name, active flag, schedule ও command যাচাই করুন।

### পথ খ — GitHub scheduled trigger

Repository Variables: `SITE_URL` এবং `AUTOMATION_ENABLED=true`; Secret: `NEWSROOM_INGEST_KEY`। তারপর **Portable bounded automation** manual run করুন। সময়সূচি default branch-এ প্রতি ২ ঘণ্টার ১৭ মিনিটে। এটি newsroom trigger, সব optional maintenance job-এর replacement নয়। pg_cron একই pipeline-এর জন্য active রাখবেন না। GitHub schedule সময়মতো চলার SLA দেয় না; public repo inactivity-তে বন্ধও হতে পারে।

### পথ গ — continuous worker

নিজস্ব host-এ worker profile। একই কাজের অন্য scheduler বন্ধ; host monitoring রাখুন। optional e-paper/video job readiness আলাদা করে পরীক্ষা করুন।

## ৯. AI ও অতিরিক্ত সেবা

কোনো paid AI/video/email/analytics account স্বয়ংক্রিয়ভাবে provision করা হয়নি। remote AI free allowance চিরস্থায়ী নয়। নিজস্ব OpenAI-compatible local model ব্যবহার করলে worker-এর `CHAT_AI_BASE_URL`, `CHAT_AI_MODEL`, `CHAT_AI_KEY` দিন। local endpoint key না চাইলে worker-এর nonempty-key contract পূরণ করতে local-only dummy value ব্যবহার করুন; এটি provider credit নয়। Bengali quality, sensitivity এবং publishing tests পাশ না করলে autopublish নয়।

Gateway-এর accepted-request budget default প্রতি UTC দিন, প্রতি task-এ ২০০; `AI_DAILY_REQUEST_LIMIT` দিয়ে server-side কমানো যায়। এটি request cap, currency/token hard cap নয়; এক request-এ provider fallback/retry হতে পারে। provider billing console-এও limits দিতে হবে। সাধারণ worker-এর direct AI calls gateway cap-এর আওতায় নয়। শুরুতে `AUTO_PUBLISH=false`, `SOCIAL_AUTOMATION_ENABLED=false` রাখুন।

newsletter-এর provider, SMTP deliverability, SMS, RTMP/live transcoding, Mux/Cloudflare Stream/Agora, X posting এবং hardware rendering-এর সম্ভাব্য খরচ আলাদা। feature code আছে, free unlimited operation-এর প্রতিশ্রুতি নেই।

## ১০. Flutter ও APK updates

পাঁচটি app-এর source আছে। নতুন build-এ **দুটি API define** দিন:

```sh
flutter build apk --release --dart-define=API_BASE=https://YOUR_SITE --dart-define=BV_API_BASE=https://YOUR_SITE --dart-define=SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co --dart-define=SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
```

application/package identity বদলানো হয়নি, যাতে feature/update compatibility অকারণে নষ্ট না হয়। কিন্তু পুরোনো install-এ in-place update দিতে একই signing key দরকার—সেটি নিজের সুরক্ষিত backup থেকে আনতে হবে। নতুন signing key দিলে পুরোনো APK-এর উপর সাধারণ update চলবে না। ZIP-এ কোনো private keystore নেই। Reader settings-এ আগে saved server থাকলে reset করে নতুন URL দিন। CI build workflows নতুন GitHub Variables থেকে URL/key নেয়; signed release-এ নতুন Secrets-এ আপনার যথাযথ signing material দিন।

## ১১. Backup, rollback ও release gate

`SUPABASE_DB_URL` ও `BACKUP_AGE_RECIPIENT` দিয়ে স্থানীয় encrypted backup:

```sh
bash scripts/backup-database.sh
```

`pg_dump` এবং `age` লাগে। custom-format dump encryption stream করে; কিন্তু Storage object bytes, auth provider configuration, Edge secrets ও external OAuth credentials আলাদা backup করতে হবে। restore করার আগে `age` দিয়ে decrypt ও `pg_restore --list` যাচাই করুন; scratch project-এ restore rehearsal ছাড়া backup-কে verified বলবেন না। script-এর restore/age round-trip এখানে চালানো হয়নি।

Release gate: full Supabase replay → backend/RLS test → manual admin login → article publish/feed/search → e-paper → approved video/comments → mobile → optional integrations → usage dashboard। তারপর traffic cutover। previous app build ও **নিজের নতুন deployment-এর** DB/storage backup রেখে rollback করুন। ZIP দিয়ে কোনো live পুরোনো account delete, revoke বা update করা হয়নি।
