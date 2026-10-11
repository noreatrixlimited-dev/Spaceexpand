# Nestnappers *(working title)*

*Paint land. Steal eggs. Protect your nest!*

A cute, toy-like 3D game for 4 players (you + 3 bots). Each blob starts in a corner of a floating cookie island with a pet egg in its nest. Paint flower trails to grab land, cut other players' trails, and steal their eggs.

## Get the Android app
Every push builds an APK on GitHub Actions and publishes it as a **GitHub release** named `Nestnappers build N`.

1. Open the repo's **Releases** page and download `Nestnappers-buildN.apk` from the newest one. It's also attached as an artifact to each **Android APK** workflow run.
2. Open it on your Android phone. You may need to allow "Install unknown apps" for your browser or file manager.

The APK is signed with a debug key, which is fine for sideloading. A Play Store release needs your own signing key (see the plan).

## How to play
- **Paint:** leave your land to draw a trail, then return home to claim the trail and everything it encloses.
- **Careful:** anyone touching your trail bonks you, and your egg loses a heart.
- **Steal:** touch enemy eggs to pop their hearts. At 0 hearts, grab the egg and carry it to your own nest. Bump a thief to send an egg back.
- **Survive:** after 1:00 the clouds eat the island's edge. Grab the centre star for a speed boost, a bubble shield or a freeze on the clouds.
- **Captured?** You become a ghost. Touch another player's nest to break free.
- **Win:** be the last nest standing, or own the most land when the 3-minute timer ends.

Controls: swipe (phone), arrow keys/WASD or mouse drag (desktop), or on-screen arrow buttons (turn on in Settings).

## Develop
```bash
npm install
npm run dev        # play in the browser at http://localhost:5173
npm test           # rules, capture and bot simulation tests
npm run build      # production web build in dist/
npx cap sync android && (cd android && ./gradlew assembleDebug)   # local APK (needs Android SDK)
```

| Folder | What's inside |
|---|---|
| `src/core` | Game rules: grid, trails, flood-fill capture, eggs, the Void, power-ups (no rendering) |
| `src/ai` | Bot brains (Expand / Flee / Attack / Raid / Carry / Star / Ghost) |
| `src/render` | Three.js toon visuals: island, flowers, blobs, eggs, particles, camera |
| `src/audio` | Synthesised sound effects and music (WebAudio, no files) |
| `src/ui`, `src/input` | HUD, menus, settings/stats storage, swipe/keyboard/arrow controls |
| `android/` | Capacitor Android wrapper (icon, splash, fullscreen) |
| `scripts/gen-android-assets.mjs` | Regenerates the app icon and splash images |

The full design and roadmap are in [`docs/PLAN.md`](docs/PLAN.md).
