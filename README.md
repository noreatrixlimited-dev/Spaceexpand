# Nestnappers *(working title)*

*Paint land. Steal eggs. Protect your nest!*

A cute 3D territory game in the style of Paper.io, for 4 players (you + 3 bots). Each toy robot starts near the edge of a floating island with a pet egg in its nest. Draw trails to grab smooth, round chunks of land, throw paint balls, cut other players' trails, and steal their eggs.

There are three maps: **Classic** (circle), **Candy** (rounded square) and **Honeycomb** (hexagon).

## Get the Android app
Every push builds an APK on GitHub Actions and publishes it as a **GitHub release** named `Nestnappers build N`.

1. Open the repo's **Releases** page and download `Nestnappers-buildN.apk` from the newest one. It's also attached as an artifact to each **Android APK** workflow run.
2. Open it on your Android phone. You may need to allow "Install unknown apps" for your browser or file manager.

The APK is signed with a debug key, which is fine for sideloading. A Play Store release needs your own signing key (see the plan).

## First time?
Press **Play** and a 30-second guided ride teaches you as you go: ride out, ride back to your colour, throw a ball. After that you play a real match.

The game shows rather than tells:
- your trail pulses and turns red as it gets risky (with a heartbeat sound),
- a ring under you means a throw is ready.

Combo pop-ups celebrate big moments: Double grab!, Huge grab!, Revenge!, Trail hunter!, Egg grabbed! and Nest captured! After a match, the next one starts by itself in 5 seconds (or tap Menu).

## How to play
- **Ride:** drag anywhere on the screen (a joystick appears under your finger). Your robot rides a board like a snowboard: it builds up speed from a stop, carves smooth turns while leaning into them, throws snow spray, and slows a little in hard turns. On a keyboard, use WASD/arrows (8 directions).
- **Paint:** leave your land to draw a trail, then return home to claim the trail and everything it encloses.
- **Throw:** tap the screen, press the ball button, or press Space. The ball auto-aims at an enemy, trail or nest near where you're facing.
  - A splash paints a patch of land in your colour.
  - It cuts any enemy trail it lands on (that player gets bonked).
  - It stuns and knocks back players it hits, and they drop any egg they're carrying.
  - It pops a heart off an enemy nest.
- **More land = more balls:** your pouch grows from 3 to 12 balls and refills faster the more land you own. The smallest player refills faster, and rainbow ball piles appear on unclaimed land.
- **Careful:** anyone touching your trail bonks you, and your egg loses a heart.
- **Steal:** touch enemy eggs to pop their hearts. At 0 hearts, grab the egg; the moment you touch any land in your own colour, the nest is captured. Bump a rider carrying an egg to send it back.
- **Survive:** after 1:00 the clouds eat the rounded island from its edge inward. Grab the centre star for a speed boost, a bubble shield or a freeze on the clouds.
- **Captured?** Once a nest is captured it never comes back: that player is out (bots drift on as ghosts that can cut their capturer's rivals' trails). If it's your nest, the match ends for you and goes to results.
- **Win:** be the last nest standing, or own the most land when the 3-minute timer ends.
- **No difficulty menu:** the bots adapt on their own. Your first match and matches after losses are gentle (the bots go easy and mostly leave you alone). After two wins in a row the bots sharpen up and gang up on you. During every match they ease off or push harder depending on how you're doing.

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
| `src/core` | Game rules on a fine invisible grid (3 cells per character width): trails, flood-fill capture, eggs, balls, the Void, power-ups (no rendering) |
| `src/maps.ts` | Map shapes (circle, rounded square, hexagon) and colour themes |
| `src/ai` | Bot brains (Expand / Flee / Attack / Raid / Carry / Star / Ghost) and the match director (adaptive difficulty) |
| `src/render` | Three.js visuals: smooth shader-drawn territory and trails, island and background, robots, eggs, balls, particles, camera |
| `src/audio` | Synthesised sound effects and music (WebAudio, no files) |
| `src/ui`, `src/input` | HUD, menus, settings/stats storage, swipe/keyboard/arrow controls |
| `android/` | Capacitor Android wrapper (icon, splash, fullscreen) |
| `scripts/gen-android-assets.mjs` | Regenerates the app icon and splash images |

The full design and roadmap are in [`docs/PLAN.md`](docs/PLAN.md).
