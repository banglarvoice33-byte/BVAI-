# BVAI Advisory + Auto-fix (Non-blocking)

## Rules
- Never block publish.
- Warning only. Fix where safe, otherwise log.

## Advisory checks
- [verify] found in script -> warn, keep original wording
- Scene relevance < 70% -> auto-replace with map / text card
- Footage older than 7 days without [archive] -> add [archive] label
- Number / name / date without Article source -> mark [verify]
- Music louder than -15 dB vs voice -> warn, lower in next render
- Speed outside 130-140 words/min -> warn

## Log format
date | video_id | check | result | action | notes
