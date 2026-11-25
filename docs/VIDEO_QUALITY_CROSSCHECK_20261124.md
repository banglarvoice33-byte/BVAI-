# BVAI Video Quality and Live-System Cross-check

Date: 2026-11-24

## Evidence confirmed

The official Reuters Vertical Video product page states that its clips are ready-to-publish 9:16 videos, curated and edited by Reuters journalists, typically 25 seconds to 1.5 minutes, with mixed audio and on-screen captions. Reuters also states that the clips are framed and cut for the vertical feed rather than merely cropped from a wide shot, and that user-generated content is identified in metadata. [1] [2]

The official EBU R 128 recommendation states that programme loudness should normally be normalised to -23.0 LUFS with a general tolerance of +/-0.5 LU, and that maximum permitted true peak during production is -1 dBTP. It also distinguishes broadcast loudness targets from platform-specific distribution decisions. [3]

The supplied Prothom Alo case is authentic and dated 6 November 2026. The article reports field observation in Uttara Sector 12 and Techpara, attempts to speak with 17 Chinese citizens, translation-assisted conversations, and review of Chinese-language live-stream descriptions by four Bangla-speaking people with Chinese-language knowledge. This supports the supplied report's claim that the case had explicit field and translation-verification methodology. It does not, by itself, validate every numerical or interpretive claim in the supplied diagnosis. [4]

## BVAI live checks

- Vercel project `bvai` is linked to `banglarvoice33-byte/BVAI-`.
- Current production deployment is `READY` from main commit `0d0d53a`.
- The public home page returned HTTP 200 and rendered server-side Bengali content.
- Supabase project `rtejxeamxeycnpcwnseo` is `ACTIVE_HEALTHY`.
- Supabase inventory contains 1,228 articles, 17 videos, 25 video generation jobs, 12 delivery assets, 11 review checks, and the phase-2 claim/perceptual tables.
- Supabase health advisors returned no health lint findings.
- Vercel runtime errors in the observed window included one `/api/newsroom/cron-trigger` 60-second timeout and one `ai_rewrite_timeout` from `gateway-default`. These are release blockers for an unqualified production promotion of newsroom automation, but they are separate from the Bengali excerpt-boundary patch.

## Implementation decision

The Bengali sentence-boundary patch is safe to deploy independently because it changes only source narration/excerpt construction and adds a fail-closed production-plan validation. It does not change database schema, queue claiming, publication status, social dispatch, or cadence.

The stale root test command is also corrected separately so the release gate executes the authoritative database runner rather than missing filenames.

## Release gates

1. Root pipeline tests must pass, with explicitly documented database-dependent skips only.
2. Frontend typecheck, lint, build, and tests must pass.
3. Worker typecheck and tests must pass.
4. Preview deployment must render the home page and critical news/video routes without an error state.
5. The cron timeout must be investigated and either fixed or explicitly isolated from the Bengali patch before production promotion.
6. Supabase security-definer and no-policy findings require an authorization matrix and targeted migration, not a blanket revoke.

## References

[1]: https://reutersagency.com/vertical-video "Reuters Vertical Video"
[2]: https://reutersagency.com/insights/reuters-vertical-video "Reuters Vertical Video newsroom insight"
[3]: https://tech.ebu.ch/docs/r/r128-2014.pdf "EBU R 128 Loudness normalisation and permitted maximum level of audio signals"
[4]: https://www.prothomalo.com/bangladesh/capital/iem5i84x9a "Prothom Alo report on livestreaming in Uttara and Techpara"
