# BVAI Final Production Batch (Non-blocking)

## Rules
- Never block publish.
- Warning + log only. Fix where safe.

## 1. TTS Config
- Speed: 0.92
- Pace: 130-140 words/min
- Pause after sentence: 0.4s
- Pause before number/name: 0.2s
- Tone: Classic news anchor. Calm, low, slow.
- No shouting, no drama, no emotional music.

## 2. Audio
- Voice: -16 LUFS
- Background music: 15 dB below voice

## 3. Claim
- Never invent numbers, names, dates.
- If Article does not say it, do not say it.
- If uncertain: keep original wording + mark [verify]
- End (last 5s): "Source: ..." clearly.

## 4. Scene
- Scene relevance < 70% -> auto-replace with map / text card
- No stock beauty shots.
- Footage older than 7 days without [archive] -> add [archive] label
- Visual must prove: source, date, location, which sentence it illustrates.
- If cannot prove: use map / text card.

## 5. Workflow
- Quality Scorecard step: non-blocking, continue-on-error
- Retry: 1 time only
- 2nd fail: do not block publish, log only

## 6. Final Check
- 1 test video only.
- Compare with baseline video 7f33f804, score 62.
- Human review: script, scene, Bangla, tone.
