# Orion Refactor Audit

## Root Causes

- Calendar sync only queried the primary calendar for a narrow month window, so secondary Google calendars such as birthdays, holidays, festivals, and many recurring events never entered Orion.
- Calendar UI exposed sync state even though sync should be silent.
- Logged-out greeting/profile UI still rendered a profile shell, and profile-image caching could survive logout.
- Skin analysis had multiple fallback paths that could return generic values or direct per-request Python results instead of the long-running FastAPI model service.
- FastAPI registered duplicate skin analysis routes, making behavior order-dependent.
- Skin metrics mixed model probabilities with image heuristics, which made output diverge from trained-weight inference.
- Skin result speech used browser speech synthesis, causing a voice switch away from Gemini Live.
- Local VAD thresholds were too high for soft or far-field speech.

## File Changes

- `src/lib/googleCalendarSync.ts`: added multi-calendar Google Calendar incremental sync with per-calendar sync tokens and cached event state.
- `src/context/AppContext.tsx`: switched calendar loading to the sync service, added silent background refresh, cleared user data on logout, hardened mic constraints, and prevented default-user gallery reload after logout.
- `src/lib/googleAuth.ts`: added Google id/givenName support and token expiry handling.
- `src/lib/greeting.ts`: replaced name-free logged-out greeting and rotating logged-in first-name greetings.
- `src/components/Sidebar.tsx`: removed manual profile upload and logged-out avatar/name UI.
- `src/views/Settings.tsx`: removed stock profile-photo fallback.
- `src/views/Dashboard.tsx`: removed visible calendar sync badges.
- `src/views/SkinAnalysis/index.tsx`: removed browser TTS and forwards real model JSON/results to Gemini Live voice.
- `src/lib/geminiSkinService.ts`: keeps Gemini as a reasoning layer over model metrics, not a vision substitute.
- `server.ts`: removed direct skin subprocess fallback, rejects invalid model responses, removed fabricated report metrics, and avoids fake skin defaults.
- `ada_backend/skin_inference.py`: strict load-once model inference from configured PTH weights, RGB resize/normalize, eval/inference mode, class-order config, and probability-only metrics.
- `ada_backend/server.py`: removed duplicate skin route and forwards model JSON to Gemini Live for spoken result discussion.
- `ada_backend/ada.py`: lower-latency streaming/VAD tuning for soft or distant speech.
- `ada_backend/Dockerfile`, `ada_backend/requirements.txt`, `ada_backend/.dockerignore`: deployable FastAPI backend packaging.