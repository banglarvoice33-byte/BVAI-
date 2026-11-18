# Enhanced video pipeline — policy v2

বর্তমান আপডেটের শুরু, ডেপ্লয় ক্রম ও সুনির্দিষ্ট সীমাবদ্ধতা: **[START_HERE_ENHANCED_BN.txt](START_HERE_ENHANCED_BN.txt)**। নিচের পুরোনো প্রতিবেদনগুলো ঐতিহাসিক; ভিডিও অনুমোদনের দ্বন্দ্বে নতুন নির্দেশনা ও 20261116 মাইগ্রেশন প্রাধান্য পাবে।

# Newsroom — fresh account-neutral distribution

নতুন ডেপলয়মেন্ট শুরু: **[FRESH_DEPLOY_BN.md](FRESH_DEPLOY_BN.md)**  
পূর্ণ audit, সীমাবদ্ধতা, পরীক্ষার ফল: **[FULL_REPORT_BN.md](FULL_REPORT_BN.md)**

## Components
- `frontend/`: Next.js SSR web, editorial/admin APIs, public feeds, e-paper, comments, video hub.
- `worker/`: bounded/continuous newsroom pipeline, editorial quality gates, social/video jobs.
- `supabase/`: schema, additive migrations, Edge Functions, Vault/RLS contracts.
- `mobile_monorepo/`: Reader, Reporter, Admin, Studio and TV Flutter sources.
- `deploy/`: portable Docker deployment and optional Cloudflare Pages gateway/guide.
- `.github/workflows/`: CI, explicitly enabled automation, manual provisioning/build workflows.

## Local checks
```sh
npm --prefix frontend ci
npm --prefix worker ci
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix worker run typecheck
npm --prefix worker test
node --test scripts/portable-tools.test.mjs
node scripts/check-portability.mjs
```

No old deployment account is configured. Fill new account settings before production.
Do not apply this fresh-install migration history to an existing production database without a separate migration plan.
Original proprietary LICENSE is preserved: free hosting and open-source dependencies do not relicense this application.
