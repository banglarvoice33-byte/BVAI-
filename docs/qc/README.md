# QC reports

Point-in-time reports. Re-check anything time-sensitive before relying on it.

- `bv-ai_build_and_QC_report.md` — Flutter/Dart build + analysis results for the five apps (test-signed).
- `bv-ai_optimized_APK_and_Supabase_QC.md` — ABI-split APK sizes and a Supabase/backend check.

Notes added after review (2026-11-06):

- Neither file contains keys, tokens or passwords. Keep it that way: never paste real credentials into reports.
- The APKs described there are **test-signed**. Production APKs come from the `Build and Release APKs`
  workflow, which signs with the keystore stored in GitHub Secrets. A test-signed APK cannot be installed
  over a production-signed one (uninstall first).
- The `HTTP 402 DEPLOYMENT_DISABLED` result means the Vercel Hobby team was paused for usage limits;
  it is not a Supabase schema problem.
