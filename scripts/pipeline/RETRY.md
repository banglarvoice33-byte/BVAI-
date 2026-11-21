# BVAI Retry Rule (Non-blocking)

- Render fail -> retry 1 time only.
- 2nd fail -> do not block publish.
- Log: date | video_id | attempt | error | action
- Next render uses same PRODUCTION_BATCH.md rules.
