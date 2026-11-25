# Agnes and ElevenLabs integration evidence

Date checked: 2026-11-26

## Agnes Video 2.5 Flash

The official Agnes documentation identifies the Flash model as `agnes-video-2.5-flash`. Video creation is asynchronous: `POST https://apihub.agnes-ai.com/v1/videos`, followed by `GET https://apihub.agnes-ai.com/agnesapi?video_id=<id>&model_name=agnes-video-2.5-flash`. The completed response uses the top-level `url` field. Flash accepts only `720P`, supports `9:16`, accepts `seconds` as the string range `"4"` through `"12"`, and supports only `n=1`. The official page recommends polling every 1–2 seconds and using `status` as the source of truth.

Source: https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash

## ElevenLabs text-to-speech

The official ElevenLabs API reference documents `POST /v1/text-to-speech/:voice_id`, the `xi-api-key` header, `model_id` in the JSON body, and `output_format` as a query parameter. The implementation therefore constructs the URL with `URL.searchParams`, rather than using the unsupported native `fetch()` option `query`.

Source: https://elevenlabs.io/docs/api-reference/text-to-speech/convert

## Repository decision

The BVAI repository already has `video_generation_jobs`, approval/quality gates, and delivery queues. A second Agnes-specific queue would create conflicting lifecycle and approval state. Agnes is therefore implemented as an opt-in visual provider inside the existing renderer, while `VIDEO_VISUAL_PROVIDER=licensed` remains the default. Generated visuals are marked synthetic, visibly disclosed, and remain behind the existing human-review gate.
