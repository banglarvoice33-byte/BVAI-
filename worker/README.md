# বাংলার ভয়েস — AI Worker Pipeline

## ওভারভিউ

২৪/৭ স্বয়ংক্রিয় বাংলা সংবাদ পাইপলাইন। ৭টি এজেন্ট মিলে কাজ করে:

| # | এজেন্ট | কাজ |
|---|--------|-----|
| 1 | Collector | RSS ফিড থেকে কাঁচা সংবাদ সংগ্রহ |
| 2 | Rewriter | বাংলায় পুনর্লিখন (AI বা ডিটার্মিনিস্টিক) |
| 3 | Media | ছবি/মিডিয়া সংযুক্তি |
| 4 | Editor | মান যাচাই ও স্কোরিং |
| 5 | Publisher | ব্যাকএন্ডে প্রকাশ |
| 6 | Social | সোশ্যাল মিডিয়ায় ব্রডকাস্ট |
| 7 | Supervisor | মানব-অনুমোদন ও পর্যবেক্ষণ |

## দ্রুত শুরু

    # Dependencies ইনস্টল
    npm install

    # Environment কপি করো
    cp .env.example .env

    # ডেভেলপমেন্ট (হট-রিলোড)
    npm run dev

    # প্রোডাকশন
    npm start

## Environment Variables

| Variable | বর্ণনা | দরকারি? |
|----------|--------|---------|
| INTERVAL_MINUTES | পোলিং বিরতি (মিনিট) | ডিফল্ট: 15 |
| NEWS_RSS_URLS | কাস্টম ফিড (কমা-সেপারেটেড) | না |
| CHAT_AI_BASE_URL | AI API বেস URL | না |
| CHAT_AI_MODEL | মডেল নাম | না |
| CHAT_AI_KEY | AI API কী (খালি = অফলাইন) | না |
| BV_BASE_URL | ব্যাকএন্ড URL | হ্যাঁ |
| NEWSROOM_INGEST_KEY | Ingest সিক্রেট | হ্যাঁ |
| AUTO_PUBLISH | স্বয়ংক্রিয় প্রকাশ | না |
| TELEGRAM_BOT_TOKEN | টেলিগ্রাম বোট | না |

সম্পূর্ণ তালিকা: .env.example দেখো।

## ডকার / Railway ডিপ্লয়

    # লোকাল বিল্ড ও রান
    docker build -t bv-worker .
    docker run --env-file .env bv-worker

Railway-তে:
1. New Project > Deploy from GitHub
2. Root Directory: worker
3. Environment variables সেট করো
4. অটো-ডিপ্লয়

## স্ট্রাকচার

    worker/
    ├── src/
    │   ├── index.ts          # Entry point
    │   ├── config.ts         # Env parsing
    │   └── agents/
    │       ├── collector.ts
    │       ├── rewriter.ts
    │       ├── media.ts
    │       ├── orchestrator.ts
    │       ├── supervisor.ts
    │       ├── registry.ts
    │       ├── chain-agents.ts
    │       ├── chat.ts
    │       └── types.ts
    ├── Dockerfile
    ├── .dockerignore
    ├── package.json
    ├── tsconfig.json
    └── .env.example

## টেস্ট

    npx vitest run


## ভিডিও ডিস্ট্রিবিউশন Queue (Facebook / YouTube)

- Queue consumer: `src/agents/video-distribution.ts`; worker process প্রতি ৬০ সেকেন্ডে সর্বোচ্চ ২টি approved job claim করে।
- কেবল `video_generation_jobs.status = publishing` approval state থেকে তৈরি queue job process হয়।
- Facebook Page native video upload: Graph API `/{page-id}/videos`; public HTTPS direct video file URL প্রয়োজন।
- YouTube upload: OAuth refresh token, configured channel identity verification, resumable upload; approved job public publish করে।
- Credentials Supabase Vault / `api_vault` থেকে runtime-এ resolve হয়; source code বা logs-এ secret রাখা হয় না।
- `VIDEO_DISTRIBUTION_WORKER_ENABLED=true` এবং DB flag `app.video_distribution_v1=true` দুটোই প্রয়োজন।
- GitHub Actions workflow `.github/workflows/video-distribution.yml` প্রতি ৫ মিনিটে one-shot consumer চালায়; Repository Actions secrets `SUPABASE_URL` ও `SUPABASE_SERVICE_ROLE_KEY` লাগবে।
- Existing YouTube watch/embed URLs direct media file নয়; worker কেবল verified `video/*` direct file URL গ্রহণ করে। Existing 11 YouTube catalogue rows পুনরায় upload করবে না।
