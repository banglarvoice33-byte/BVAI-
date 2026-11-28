# pipeline/

| File | What it is | Tested by |
|---|---|---|
| `schedule.mjs` | Asia/Dhaka slot rules: 83 articles/day, 12 video publish slots | `tests/schedule.test.mjs` (also run under UTC and America/Los_Angeles) |
| `bn-speech.mjs` | Bengali digits/time/currency to spoken words for TTS | `tests/bn-speech.test.mjs` |
| `elevenlabs-tts.mjs` | Request builder + sender (Eleven v4/v3 for Bengali) | `tests/tts-video.test.mjs` (mocked network) |
| `openrouter-video.mjs` | Submit + poll for OpenRouter video jobs | `tests/tts-video.test.mjs` (mocked network) |
| `gen-verify-sql.mjs` | Regenerates `sql/02_verify.sql` from `schedule.mjs` | n/a |
| `print-bn-numbers.mjs` | Prints 0..99 so an editor can check every spelling | n/a |

Run: `node --test pipeline/tests/*.test.mjs` (Node 18+). No dependencies.

Pipeline order per video job: article text -> script (LLM) -> `normalizeBanglaForSpeech()` -> `buildTtsRequest()`
-> `synthesizeScene()` -> ffmpeg resample (`resampleArgs`) -> visuals -> assembly -> QC (repair first) -> publish
with the platform's AI-disclosure setting applied.
