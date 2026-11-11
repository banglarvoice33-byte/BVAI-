> **সর্বশেষ সংশোধন (2026-11-11):** `IMPLEMENTATION_REPORT_20261111_BN.md` এবং `TERMUX_REPAIR_20261111_BN.txt` পড়ুন। Local verified; live deployment/distribution এখনো যাচাই বাকি।

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

## 2026-11-11 production audit addendum

Read `PRODUCTION_READINESS_AUDIT_20261111_BN.md` before enabling automation. This package includes a fail-closed canonical-site-URL fix for social dispatch and a Bangladesh-local 14-minute daytime / 60-minute overnight cadence migration. Neither change is deployed/applied to the live project. Full social/video distribution remains blocked pending schema reconciliation, provider credentials/scopes, video worker evidence and GitHub repository access.
