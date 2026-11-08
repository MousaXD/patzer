# Chess audio — Agent 05

The default **Natural** sound theme uses only Patzer's two existing, locally bundled recorded chess-piece sounds:

- `web/src/assets/sounds/board-move.wav`
- `web/src/assets/sounds/board-capture.wav`

Both files were extracted from **"Chess Pieces Move (Close)"** by **JJTaynos**, Freesound recording [733927](https://freesound.org/people/JJTaynos/sounds/733927/), released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Source, trim points, and processing are documented in the repository's existing `THIRD_PARTY_NOTICES.md`. No proprietary Chess.com audio is included. Offline/self-hosted installations use these bundled files.

Natural creates move, capture, check, castle, promotion, game start/end, and UI-click effects by combining short, dry recordings. There are no bell oscillators or convolution-reverb sends in this default theme. Historically available Classic, Soft, and Board themes remain available as explicit choices.

## Compatibility and storage

The existing server profile fields (`sound_enabled`, `sound_set`, `move_sound_set`) and settings API stay unchanged. Existing Board or Soft profile preferences are honored if no explicit device theme exists; the historical default Classic/Classic pair maps to Natural. Users who explicitly want Classic can still choose it.

Theme and volume are device-local in `localStorage` at `patzer.audio.v1`; the selected theme additionally maps to the nearest supported legacy fields when the Settings form is saved. Volume is clamped to [0, 1]. Muting stops recorded sources. Rapid repeated moves are throttled. During delayed loads, old queued moves are dropped rather than replayed late. If one recording fails, the other is used; if both fail, Natural stays silent instead of silently falling back to the disliked synth.

## Release checks

Run `npm ci`, `npm test -- --run web/src/lib/sounds.test.ts web/src/lib/audioPreferences.test.ts`, `npm run typecheck`, and `npm run build -w web`. Listening QA must check browser autoplay policy, muted start, replay/rapid history navigation, volume extremes, failed recording requests, offline startup, all chess events, and both light and dark Settings pages.
