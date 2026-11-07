# automation-king build and QC report

## Build

- Flutter: 3.35.1
- Dart: 3.9.0
- Android SDK: API 36 / Build Tools 36.0.0
- Java: OpenJDK 17.0.20.1
- Build mode: Flutter release APK, then local Android debug/test signing
- Signing: local test keystore only; not a production/Play Store signing key

## Apps

| App | Flutter analysis | APK build | Signature |
|---|---:|---:|---:|
| admin_app | pass | pass | APK v2/v3 pass |
| reader_app | pass | pass | APK v2/v3 pass |
| reporter_app | pass | pass | APK v2/v3 pass |
| studio_app | pass | pass | APK v2/v3 pass |
| tv_app | pass | pass | APK v2/v3 pass |

ZIP integrity was checked for every APK. No emulator/device UI test was available in this sandbox.

## Source fixes

- Added missing Reporter Agora configuration getters and live endpoint URI helpers.
- Fixed Reporter Agora widget import.
- Switched Studio to the `rtmp_broadcaster` CameraController API.
- Fixed Android Gradle Kotlin DSL blocks that failed with the repository's current plugin setup.
- Added VideoHub locale-aware English/Bengali titles, accessible play labels and empty states.

## Marketing automation status

The repository already contains a guarded social distribution pipeline for Facebook, Instagram, X, LinkedIn and Telegram, including readiness checks, queue claims, per-platform budgets, spacing, idempotent external IDs and fail-closed behavior when credentials/readiness are unavailable. TikTok remains intentionally disabled until its official API scopes and production evidence are verified.

Validated: worker tests 59/59 passed; frontend typecheck passed; VideoHub localization tests 4/4 passed. The full frontend suite has one pre-existing Manager shadow event timestamp contract failure; it does not publish content or expose credentials.
