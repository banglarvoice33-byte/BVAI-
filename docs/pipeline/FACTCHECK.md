# BVAI নিউজ-ভিডিও পাইপলাইন: দাবি যাচাই ও সম্ভাব্যতা (২৭ নভেম্বর ২০২৬)

**চিহ্ন:** ✅ সঠিক · ❌ ভুল · ⚠️ আংশিক/শর্তসাপেক্ষ · ❓ আমি যাচাই করতে পারিনি
"লেখা ১" = প্রথম আউটপুট (পাইপলাইন ডিজাইন), "লেখা ২" = দ্বিতীয় আউটপুট (সংশোধনী)।

## ক. লেখা ১: দাবি বনাম প্রমাণ

| # | দাবি | রায় | প্রমাণ |
|---|---|---|---|
| 1 | "সোর্স উল্লেখ করলেই আইনি ঝুঁকি নেই" ধারণা ভুল | ✅ | US Copyright Office: উৎস স্বীকার করা অনুমতির বিকল্প নয়। https://webharvest.gov/peth04/20041015025432/http://copyright.gov/fls/fl102.html (বাংলাদেশের আইন আমি যাচাই করিনি; আইনজীবীর পরামর্শ নিন) |
| 2 | `isArticleSlot` এ `date.getHours()` | ❌ | `getHours()` প্রসেসের লোকাল টাইমজোন দেয়। https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Date/getHours সার্ভার সাধারণত UTC, তাই ৬ ঘণ্টা ভুল |
| 3 | পাঁচটি `VIDEO_BATCH_HOURS` | ❌ | প্রতিবার ১টি ভিডিও ধরলে দিনে ৫টি। আপনার লক্ষ্য কমপক্ষে ১২টি। নতুন কোডে ১২টি publish slot |
| 4 | ১৪ মিনিট = `minute % 14` | ❌ | প্রতি ঘণ্টায় রিসেট হয়: ০৬:৫৬ এর পর ০৭:০০ (৪ মিনিট ব্যবধান)। নতুন নিয়ম ০৬:০০ থেকে অবিচ্ছিন্ন ১৪ মিনিট গ্রিড |
| 5 | `৭৩ → তিনিশতাধিক/তেতাল্লিশ` | ❌ | ৭৩ = তিয়াত্তর, ৪৩ = তেতাল্লিশ |
| 6 | `বিকেল ৪:৩০ → চারটা থার্টি` | ❌ | বাংলা রীতি: সাড়ে চারটা, সোয়া, পৌনে, দেড়টা, আড়াইটা। https://openbooks.lib.msu.edu/basicbangla/chapter/5-2-telling-time-day-date/ , https://bangla.la.utexas.edu/resources/telling-time-in-bangla/ |
| 7 | `৩.৫ লাখ → তিন লাখ পঞ্চাশ হাজার` | ✅ | গণিতে সঠিক (৩,৫০,০০০)। স্বাভাবিক বলার রীতি "সাড়ে তিন লাখ" (কোডে সেটিই) |
| 8 | ElevenLabs: `previous_text`, `next_text`, `voice_settings`, pronunciation dictionary | ✅ | https://elevenlabs.io/docs/api-reference/text-to-speech/convert.md (ডিকশনারি সর্বোচ্চ ৩টি) |
| 9 | `style` ও `speed` প্যারামিটার (সংখ্যা সহ) | ⚠️ | ElevenLabs ডকুমেন্টে Eleven v4-এ Style ও Speed স্লাইডার নেই। কোড শুধু stability ও similarity পাঠায় |
| 10 | RLS `for select using (true)` শুধু "authenticated" এর ঝুঁকি | ⚠️ | `TO` না দিলে নীতি সব রোলে (PUBLIC), অর্থাৎ anon-ও। https://www.postgresql.org/docs/current/sql-createpolicy.html |
| 11 | Presenter-কে "প্রথম দেখায় কেউ AI বুঝবে না" | ❌ নীতিবিরুদ্ধ | YouTube বাস্তবসদৃশ synthetic ভিডিও/কণ্ঠে প্রকাশ বাধ্যতামূলক করে: https://support.google.com/youtube/answer/14328491 |
| 12 | পরিমাপ: ১২০ সেকেন্ড দর্শক ধরে রাখা সম্ভব | ❓ | কোনো প্রযুক্তি এটি নিশ্চিত করে না; প্রকাশের পর YouTube/Meta analytics দিয়ে A/B পরীক্ষা লাগবে |

## খ. লেখা ২ (সংশোধনী): দাবি বনাম প্রমাণ

| # | দাবি | রায় | প্রমাণ |
|---|---|---|---|
| 1 | `language_code` `eleven_multilingual_v2`-এ সমর্থিত নয় | ✅ | ElevenLabs API reference (উপরের লিংক) |
| 2 | তাই `eleven_multilingual_v2` দিয়ে বাংলা করুন | ❌ | ElevenLabs-এর ভাষা তালিকায় বাংলা Eleven v3 ও v4-এ আছে, Multilingual v2-র ২৯ ভাষায় নেই (ডক: Models ও Eleven v4 পাতা)। কোডে বাংলার জন্য v4/v3-ছাড়া মডেল প্রত্যাখ্যাত |
| 3 | pronunciation dictionary দিয়ে নাম ঠিক করুন | ⚠️ | alias নিয়ম সব মডেলে; phoneme (IPA) নিয়ম শুধু v3/v4 ও ইংরেজির বাইরে সীমিত। https://elevenlabs.io/blog/pronunciation-dictionary-guide |
| 4 | TTS 44.1 kHz, ভিডিও 48 kHz: ffmpeg দিয়ে resample | ✅ | ডিফল্ট `mp3_44100_128` (API reference); `resampleArgs()` |
| 5 | OpenRouter-এ `negative_prompt` নেই | ✅ | https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request |
| 6 | `fetch(pollingUrl)` সরাসরি | ❌ | `polling_url` আপেক্ষিক পথ ("/api/v1/videos/<id>"); `resolvePollingUrl()` দিয়ে পূর্ণ URL; স্ট্যাটাস failed/cancelled/expired সামলানো দরকার |
| 7 | `duration: targetDurationSeconds` যেকোনো মান | ❌ | duration মডেলের সমর্থিত তালিকার ভেতরে হতে হবে (`supportedDurations` যাচাই) |
| 8 | `\i` SQL Editor-এ চলে না | ✅ | `\i` psql-এর মেটা-কমান্ড, সার্ভার SQL নয়। https://www.postgresql.org/docs/current/app-psql.html |
| 9 | "conditional FK সম্ভব নয়, অ্যাপে যাচাই" | ⚠️ | একটি parent টেবিল (`pipeline_jobs`) রাখলে বাস্তব FK পাওয়া যায়, সেটাই করা হয়েছে |
| 10 | ১৪ মিনিট স্লটের "সংশোধন" | ❌ | নতুন ফাংশনও মূল নিয়মের সমান ফল দেয় (০, ১৪, ২৮, ৪২, ৫৬): আসলে কিছু বদলায়নি |
| 11 | Redis lock + node-cron কয়েক ইনস্ট্যান্সে | ⚠️ | Vercel cron ফাংশন ডাকে, স্থায়ী প্রসেস নয়। Supabase pg_cron ফ্রিতে প্রতি মিনিটে চলে, unique index দিয়ে ডুপ্লিকেট অসম্ভব। https://supabase.com/docs/guides/database/extensions/pgcron , https://supabase.com/docs/guides/functions/schedule-functions |
| 12 | v2 ও v3 migration দুটোই চালানো যায় | ❌ | `create table if not exists` পুরোনো টেবিল বদলায় না (v3-এর `pipeline_type` যোগ হবে না), একই নামের policy দুবার তৈরিতে ত্রুটি। এখানে একটিই migration |
| 13 | `to authenticated` policy `public.user_roles` ধরে | ⚠️ | আপনার প্রজেক্টে এই টেবিল আছে কি না আমি দেখিনি। নতুন SQL টেবিল/কলাম আছে কিনা দেখে তবেই policy বানায়, না থাকলে বাদ |
| 14 | GitHub Actions cron নির্ভরযোগ্য | ⚠️ | সর্বনিম্ন ৫ মিনিট, দেরি হতে পারে, নিষ্ক্রিয় রিপোতে বন্ধ হতে পারে (কমিউনিটি আলোচনা: https://github.com/orgs/community/discussions/185355)। তাই প্রধান শিডিউলার নয় |
| 15 | `supabase db push` Termux-এ | ⚠️ | Android-এ npm-এর বাইনারি সাধারণত চলে না, তাই SQL Editor-কে প্রধান পথ ধরা হয়েছে |

## গ. সম্ভাব্যতা: কী সম্ভব, কী প্রমাণিত

| উপাদান | রায় | প্রমাণ / শর্ত |
|---|---|---|
| সুনির্দিষ্ট শিডিউল (দিনে ৮৩ আর্টিকেল, ১২ ভিডিও) | ✅ প্রমাণিত | ২২টি টেস্ট পাস (UTC, লস অ্যাঞ্জেলেস, ঢাকা টাইমজোনে), SQL যুক্তি ১৪৪০ মিনিটে JS-এর সঙ্গে ০ গরমিল |
| বাংলা সংখ্যা/সময় TTS-নিরাপদ করা | ✅ প্রমাণিত (কোড স্তরে) | কোডে নির্ধারিত রূপান্তর + টেস্ট। শব্দতালিকা ০–৯৯ একজন বাংলা সম্পাদক একবার মেলাবেন: `node pipeline/print-bn-numbers.mjs` |
| ১০৮০×১৯২০ ভিডিও, নিচে ক্যাপশন, কোণে সোর্স, -14 LUFS | ✅ প্রমাণিত | আসল রেন্ডার: ffprobe = h264 1080×1920 30fps yuv420p, aac 48000 stereo, 10.000 s; ebur128 = -14.0 LUFS |
| দিনে ১২টি ১২০-সেকেন্ডের ভিডিও রেন্ডার করার ক্ষমতা | ✅ আনুমানিক | ১২০ সেকেন্ডের ক্লিপ ১ কোরে ১৫০ সেকেন্ডে রেন্ডার হয়েছে (সিন্থেটিক পটভূমি, আমার স্যান্ডবক্সে)। ১২টি ≈ ৩০ মিনিট/দিন। আসল ফুটেজ ও উপস্থাপক ক্লিপ যোগ হলে সময় বাড়বে, আমি তা মাপিনি |
| বাংলা ক্যাপশনের নির্ভুল রেন্ডার | ⚠️ শর্তসাপেক্ষ | ffmpeg `drawtext` বাংলা ভাঙে ("শিশুদের" → "শশ্ুিদরে"); `ass` (libass) ঠিক রেন্ডার করে। শুধু `render-sample-ass.sh` পথ ব্যবহার করুন |
| বাংলা কণ্ঠ (ElevenLabs v4/v3) | ⚠️ শর্তসাপেক্ষ | মডেল সমর্থন ডকুমেন্টে প্রমাণিত; নেটওয়ার্ক বন্ধ থাকায় আমি আসল কণ্ঠ বানিয়ে শুনিনি। একটি নমুনা শুনে উচ্চারণ যাচাই করুন |
| AI উপস্থাপক + lip-sync | ❓ | কোন lip-sync সেবা বাংলা ঠোঁটের সঙ্গে ঠিক মেলে তা আমি পরীক্ষা করিনি। তাই প্রম্পটে fallback: স্থির ছবি + ভয়েস |
| সংবাদের সঙ্গে ছবি/ভিডিও মেলানো | ⚠️ আংশিক | লাইভ সাইটের হোমপেজে ফেচের সময় অমিল ছিল (নিচে ঘ)। entity-যাচাই কমায়, শূন্য করে না; অনিশ্চিত হলে "ছবি প্রতীকী" |
| ১২০ সেকেন্ড দর্শক ধরে রাখা | ❓ | প্রযুক্তি দিয়ে নিশ্চিত নয়, প্রকাশের পর পরীক্ষা |
| মানুষ যেন AI বুঝতে না পারে | ❌ করা উচিত নয় | YouTube-সহ প্ল্যাটফর্মে প্রকাশ বাধ্যতামূলক; ফটোরিয়ালিস্টিক মান রাখা যায়, লুকানো যায় না |

## ঘ. লাইভ সাইটে (bvai-chi.vercel.app, হোমপেজ ফেচ) যা দেখেছি
- ফুটারের যোগাযোগ ইমেইল `operator@example.invalid` (placeholder)।
- কিছু ছবি `example.invalid/api/brand-card...` ঠিকানা থেকে, যা কখনো লোড হবে না।
- নিবন্ধের ছবি হিসেবে সম্পর্কহীন Wikimedia PDF-পাতার থাম্বনেইল (যেমন গাজা প্রসঙ্গে তুরস্ক-মার্কিন প্রতিরক্ষা রিপোর্টের পাতা)। ঠিক "পাখি/উটপাখি" সমস্যা।
- "ব্ল্যাক ফ্রাইডে" লেখাটি "খেলাধুলা" বিভাগে।
এগুলো আমি সীমিত ফেচ থেকে দেখেছি; রিপোর কোড দেখিনি।
