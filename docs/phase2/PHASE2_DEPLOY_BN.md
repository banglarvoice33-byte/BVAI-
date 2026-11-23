# BVAI Phase 2 — ডিপ্লয় গাইড (Termux)

ভিত্তি: `banglarvoice33-byte/BVAI-` `main` @ `a42a5cc`। এই patch শুধু **নতুন ফাইল + ৪টি ছোট এডিট**। কিছু auto-apply হয় না, কোনো scheduler চালু হয় না, production-এ আমি কিছু লিখিনি।

## ১. অবস্থার সারণি (এর বাইরে কোনো দাবি নেই)

| অবস্থা | কী |
|---|---|
| **Implemented + লোকাল টেস্টেড** | SQL migration (রিপোর আসল migration chain-এর ওপর, দুইবার apply, rollback round-trip, ৫ SQL টেস্ট ও ৩২টি client-role denial)। Node ২০টি টেস্ট। রিপোর আগের ১২০টি টেস্ট পরিবর্তনের পরেও পাস। `pipeline-e2e.mjs` পাস, caption-QC হুক রেন্ডারে চলেছে। |
| **Live — শুধু read-only যাচাই** | migration-এর view কোয়েরিগুলো লাইভ schema-তে SELECT হিসেবে চালিয়ে কলাম মিলিয়েছি। নাম-সংঘর্ষ নেই। কোনো `CREATE`/`INSERT` চালাইনি। |
| **Staging-verified** | **নেই।** TUS/migration staging টেস্ট করিনি (staging পরিবেশ ও অনুমতি দেওয়া হয়নি)। |
| **প্ল্যাটফর্ম যাচাই** | **নেই।** YouTube/Facebook/Instagram/TikTok-এ কোনো টেস্ট অ্যাকাউন্ট দিয়ে যাচাই হয়নি। |
| **Not implemented** | ব্যয়ের USD হিসাব (শুধু request/অক্ষর কাউন্টার); automatic semantic scene-relevance; per-user authenticated claim review (UI অপারেটর-attested); still image-এর perceptual dedup। |

## ২. আগে CI ঠিক করুন (এটা ছাড়া কোনো ভিডিও রেন্ডার হবে না)

`video-render.yml`-এ `container: ubuntu:24.04` ভুলে রয়ে গেছে। এই patch-এ সেটা মোছা আছে। `gh workflow run` **রিমোট main** চালায়, তাই push ছাড়া কিছুই বদলাবে না।

## ৩. কোড প্রয়োগ

```bash
cd ~/BVAI && git pull --ff-only
# আপনার আগের ফাইল: caption-shadow patch (আগে/পরে যেকোনো ক্রমে apply হয়, আমি দুই ক্রমেই পরীক্ষা করেছি)
git apply --check bvai-phase2.patch && git apply bvai-phase2.patch
npm test 2>&1 | tail -5              # বা: node --test scripts/pipeline/tests/phase2.test.mjs
git add -A && git commit -m "phase2: perceptual dedup, claim review gate, FB variant, metrics, CI container fix"
git push
```
ফেরত নিতে: `git revert <commit>` অথবা apply করার পর `git apply -R bvai-phase2.patch`।

## ৪. Supabase (আপনি নিজে ডিপ্লয় করবেন)

ফাইল: `supabase/migrations/20261121000000_phase2_perceptual_claims_metrics.sql` (আলাদা কপি দেওয়া আছে)।
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261121000000_phase2_perceptual_claims_metrics.sql
```
অথবা SQL Editor-এ পুরো ফাইল paste করে Run। এটা idempotent এবং পুরোটা একটি transaction।

- কোড যে এটার ওপর নির্ভর করে: `perceptual-video` (auto মোডে migration না থাকলে exact-hash-only চলে, লগে `unavailable_exact_hash_only`), `publish-review.mjs` (editorial কনটেন্টে gate না পেলে **অনুমোদন প্রত্যাখ্যান**), `register-platform-variant`, `metrics-report`।
- **ক্রম:** migration আগে, তারপর code push।
- Rollback: আগে কোড revert, তারপর `scripts/pipeline/sql/phase2_rollback.sql`। এটা review/fingerprint/variant ডেটা মুছে দেয়, তাই backup নিন। কোড-লেভেল kill switch: `BVAI_PERCEPTUAL_DEDUP=off`, `BVAI_CAPTION_QC=off`।

## ৫. নতুন সেটিং (ডিফল্ট নিরাপদ, কিছু না দিলেও চলে)

| Env | মান | ডিফল্ট |
|---|---|---|
| `BVAI_PERCEPTUAL_DEDUP` | `auto` / `required` / `off` | `auto` |
| `BVAI_PERCEPTUAL_LOW_INFO` | `skip` / `allow` | `skip` |
| `BVAI_CAPTION_QC` | `shadow` / `enforce` / `off` | `shadow` (শুধু লগ + `production_plan.caption_qc`) |
| `BVAI_REQUIRE_CLAIM_REVIEW` | `true` | trusted-source: বন্ধ; editorial/reporter: **সবসময় চালু** |

রেন্ডারারে পৌঁছাতে চাইলে `video-render.yml`-এর `env:`-এ `BVAI_CAPTION_QC: ${{ vars.BVAI_CAPTION_QC || 'shadow' }}` ধরনের লাইন যোগ করুন। এক-দুই সপ্তাহ `shadow` চালিয়ে লগে `[bvai_caption_qc]` দেখে তবেই `enforce` করুন।

## ৬. দৈনিক ব্যবহার

**Claim-by-claim review UI** (শুধু আপনার ফোনের `127.0.0.1`):
```bash
BVAI_REVIEWER="আপনার নাম" node --env-file=.env scripts/pipeline/review-server.mjs
```
টার্মিনালে ছাপা one-time URL ব্রাউজারে খুলুন। ভিডিও দেখে-শুনে প্রতিটি বাক্যের verdict + প্রমাণ (`https://… | primary_document | independent`) ও ১১টি চেকলিস্ট দিন। `verified` পেতে লাগে ≥১টি primary/official সূত্র **অথবা** ≥২টি news সূত্র যেগুলো আপনি স্পষ্টভাবে `independent` চিহ্নিত করেছেন। আলাদা domain মানেই স্বাধীন, এমন ধরে নেওয়া হয় না। গেট পাস হলে:
`node --env-file=.env scripts/pipeline/publish-review.mjs JOB_UUID --approve-website`

**Facebook (৯০ সেকেন্ডের বেশি মাস্টার):** নিজে ≤৯০ সেকেন্ডের সম্পাদিত কাট বানান (1080×1920, H.264+AAC), তারপর:
`node --env-file=.env scripts/pipeline/register-platform-variant.mjs VIDEO_UUID cut.mp4 --approved-by "নাম"`
কিছু স্বয়ংক্রিয়ভাবে ছাঁটা হয় না। variant ছাড়া আগের মতোই `dead_letter` হবে। শুধু খালি checkpoint-এর সারি requeue হয়।

**মেট্রিক্স:** `node --env-file=.env scripts/pipeline/metrics-report.mjs` (exit 0/1/2, পড়া না গেলে 3)। GitHub-এ `BVAI Media Metrics (manual)`, `schedule` অংশ মন্তব্যে বন্ধ। `BVAI_ALERT_WEBHOOK_URL` (https) দিলে dedupe করে পাঠায়।

## ৭. লাইভ অবস্থা (read-only, ২১ নভেম্বর ১৪:১২ ঢাকা)

- ingestion সুস্থ (pg_cron `bvai-newsroom-14m` প্রতি মিনিটে), ২৪ঘ-এ ৯৪ আর্টিকেল, ভিডিও-যোগ্য candidate ৮৬, `scheduler_due_now=true`, peak-window কোটা মোট দিনে ১০ (2+2+2+3+1)।
- ২১ তারিখে জব ফেল: SSL (`container`), `All TTS providers failed`। ২৩ নভেম্বরের পুনঃ-যাচাইয়ে গত ২৪ঘ-এ রেন্ডার ২, ফেল ০।
- `video_delivery_outbox` তখন খালি, অর্থাৎ ডেলিভারি কখনো হয়নি।
- `api_vault` নাম: `OAUTH_CLIENT_ID/SECRET`, `YOUTUBE_REFRESH_TOKEN`, `TIKTOK_CLIENT_KEY/SECRET`, GEMINI/GROQ/OPENAI। **নেই:** `SOCIAL_FACEBOOK_PAGE_TOKEN`, Instagram টোকেন, `TIKTOK_ACCESS_TOKEN`; Grok/xAI key কোথাও নেই (কোড Groq ব্যবহার করে)। GitHub variables আমি দেখতে পারিনি।
- TikTok verification ফাইল রিপোতে আছে (`frontend/public/tiktok…txt`)। লাইভ URL আমি যাচাই করতে পারিনি, নিজে খুলে দেখুন।
- DB-ড্রিফট: লাইভে `ops_alerts`, `ops_probe_state` ইত্যাদি আছে, কিন্তু রিপোর migration-এ নেই। নতুন কোনো পরিবেশে migration-chain থেকে এগুলো তৈরি হবে না।

## ৮. সীমাবদ্ধতা (লুকাইনি)

- **Perceptual dedup** (৬৪-বিট dHash, Hamming ≤১০, ≥৬০% ফ্রেম মিল)। সিনথেটিক ক্লিপে মাপা: re-encode+rescale **ধরা পড়েছে**, trim **ধরা পড়েছে**, ছোট বক্স-overlay **ধরা পড়েছে**, **hflip ধরা পড়েনি**, heavy crop **ধরা পড়েনি**, সম্পর্কহীন ক্লিপ ঠিকভাবে আলাদা। এগুলো সিনথেটিক ক্লিপ, আসল Commons/Pixabay ফুটেজে হার ভিন্ন হতে পারে। ছবি (still) কভার করে না।
- Caption QC শুধু ASS-এর টেক্সট/safe-zone/grapheme দেখে, **পিক্সেলে বার্ন হওয়া ফলাফল** দেখে না। ফোনে ভিডিও চালিয়ে দেখার ধাপ মানুষের।
- Review UI অপারেটর-attested। প্রতি-ইউজার authenticated review ওয়েবসাইটের admin route-এর পথে।

## ৯. পরামর্শ (counter-perspective)

দিনে ১০টি ভিডিও × প্রতিটিতে claim-by-claim মানুষের যাচাই = আপনার সময়ের বড় অংশ। রিপোর বর্তমান নীতিতে trusted-source সংবাদ স্বয়ংক্রিয় এবং reporter কনটেন্টে মানুষ বাধ্যতামূলক। প্রথম ১৪ দিন trusted-source স্বয়ংক্রিয় রেখে দৈনিক ২–৩টির নমুনা review করুন, `BVAI_REQUIRE_CLAIM_REVIEW=true` শুধু সংবেদনশীল বিভাগে। তাহলেই মান ধরে রেখে গতি পাবেন।
