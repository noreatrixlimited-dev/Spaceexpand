# Space Expand: Project Plan

> Cute 3D territory game for 4 players. Protect your Core, paint new land, steal other Cores.
> Browser first (HTML5 + Three.js), then mobile.

---

## 1. Vision

| | |
|---|---|
| **One-liner** | Squishy blobs paint flower trails to grab land and steal each other's pet eggs on a floating cookie island. |
| **Platforms** | Desktop + mobile browsers first; Android/iOS app later (Capacitor) |
| **Match length** | 3 minutes |
| **Players** | 4 (humans or bots) |
| **Feel** | Cute, bouncy, readable at a glance, short "one more round" sessions |
| **Pillars** | 1. **Risk vs. reward**: leaving home is how you grow, and it's also how you lose. 2. **Always in the game**: nobody sits out. 3. **Juicy**: every action squishes, pops or sparkles. |

---

## 2. Board Layout

Based on the original sketch:

```
+-----------+-----------+
| P1 ●      |      ● P4 |
|  (purple) |   (green) |
+-----------+-----------+
|  (red)    |    (blue) |
| P2 ●      |      ● P3 |
+-----------+-----------+
```

- The board is a **40 × 40 grid**, and each quadrant is **20 × 20**.
- Each Core sits in the outer corner of its quadrant, matching the sketch.
- Neighbours: P1–P2, P1–P4, P3–P2, P3–P4. Diagonals: **P1↔P3, P2↔P4**.
- **Starting land** is set in config and will be decided by playtesting:
  - `quadrant` (default): each player starts owning their whole quadrant, so conflict starts right away.
  - `patch`: each player starts with a 6 × 6 patch around their Core, and the rest is neutral.

---

## 3. Core Rules (MVP)

### 3.1 Movement
- Players move from cell to cell in 4 directions, with smooth animation between cells.
- They keep moving in the last direction pressed, like Snake or Paper.io.
- Base speed is **6 cells/sec**.

### 3.2 Painting and capturing land
- When a player is on their own land, nothing is drawn.
- When they leave it, they leave a **trail** (a line of flowers in their colour).
- When they get back to their own land, the loop closes:
  - All trail cells become theirs.
  - Every cell **enclosed** by their land plus the trail also becomes theirs, including enemy land.
  - Enclosed means: run a flood fill from the board edges through cells that are neither their land nor their trail. Any cell the fill doesn't reach is enclosed.
- Crossing your own trail is safe and does nothing.

### 3.3 Bonks (getting caught)
- If an enemy moves onto your trail:
  - You get **bonked**: the trail disappears, you show a dizzy animation, and after 1.5 seconds you respawn next to your Core.
  - Your Core loses **1 heart**.
- If you have no trail out, colliding with an enemy body does nothing (it's a cute bump). Bonks only come from trails.

### 3.4 Cores (pet eggs)
- Each Core has **3 hearts**.
- An enemy touching your Core removes 1 heart. The Core is then safe from hits for 3 seconds.
- A Core regains 1 heart every **30 seconds** while its owner is standing on their own land, up to 3 hearts.
- When a Core has **0 hearts**, the next enemy who touches it **picks it up**.
  - The carrier moves at **×0.7 speed**, and the stolen egg glows so everyone can see it.
  - If the carrier gets back to their **own Core**, the stolen Core is **captured**.
  - If the carrier is bonked first, the egg returns to its nest with 1 heart.

### 3.5 Being captured
- **MVP:** the captured player is out, and all their land goes to the capturer.
- **Phase 2:** the captured player becomes a **Shade** (see §5).

### 3.6 Win conditions
- You win if you're the **last Core standing**.
- If time runs out, the player with the **most land** wins. A captured Core counts as 0 land.

### 3.7 The Void (shrinking board)
- Starts at **1:00** into the match. Every **15 seconds**, one ring of cells around the edge crumbles away.
- When a Core's cell is eaten, the Core **slides one cell toward the centre**.
- A player standing on a crumbling cell gets bonked.

---

## 4. Bots (AI)

A simple state machine, with values tuned per difficulty level (Easy / Normal / Hard).

| State | Behaviour | Switches when… |
|---|---|---|
| **Expand** | Draws a short rectangular loop (4–10 cells) out from home, preferring enemy land next to its own | Loop closes → Expand again; an enemy comes near → Flee |
| **Flee** | Takes the shortest path back to its own land | Gets home → Expand or Defend |
| **Attack** | Heads for an enemy's trail or an enemy Core with 0–1 hearts | Target gone → Expand; its own Core is threatened → Defend |
| **Defend** | Goes back to its own Core and blocks attackers | Threat gone → Expand |

Difficulty controls reaction time, how far the bot ventures out, and how aggressive it is.

---

## 5. Phase 2 Mechanics (after MVP)

| Mechanic | Summary |
|---|---|
| **Shades** | A captured player becomes a ghost in the capturer's colour. Ghosts are fast, can't paint, and can bonk the trails of the capturer's enemies. If a Shade touches a third player's Core, it **breaks free** and respawns with a 3 × 3 patch and a 1-heart Core. |
| **Core compactness** | Heart regen speeds up when your land is compact and slows down when it's spread thin, so the leader can't snowball. |
| **Centre star** | A neutral power-up at the centre that rotates through **Reveal**, **Speed Boost** and **Freeze the Void (10 seconds)**. |
| **Alliances** | Two players touch trails for 2 seconds to team up. An alliance can't win together; a betrayal gives a bonus but **marks** the traitor for 20 seconds. |
| **Diagonal tunnels** | One-way tunnels between opposite corners (P1↔P3, P2↔P4) that open every 45 seconds. |
| **Emotes** | Wave, laugh, angry, heart. |

---

## 6. Art and Audio Direction: "Toy Planet"

| Element | Look |
|---|---|
| **Board** | A floating island of soft rounded cookie/marshmallow tiles, with clouds drifting below |
| **Players** | Round blobs with big eyes and tiny feet that squash and stretch while moving |
| **Colours** | P1 lavender-purple, P2 coral-red, P3 sky-blue, P4 mint-green, on a yellow-to-pink gradient sky |
| **Cores** | Pet eggs in nests with floating hearts for shields. They look scared when an enemy is near and happy when the owner is home. |
| **Trails** | Small flowers and paint drops that pop up behind the player |
| **Capture** | Tiles pop up one by one in a wave with a "boing", then grass and flowers grow on them |
| **Bonk** | Spinning stars over the head, plus a squeak |
| **Void** | Clouds eat the edge, and tiles gently float away |
| **UI** | Chunky rounded buttons in the **Fredoka** font, with soft shadows |
| **Audio** | Pops, boings and squeaks; ukulele and xylophone music |

---

## 7. Tech Stack

| Part | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Type safety as the codebase grows |
| Build / dev | **Vite** | Fast hot reload and small builds |
| Rendering | **Three.js** | Lightweight web 3D with a large ecosystem |
| Shading | `MeshToonMaterial` + outline pass | Cartoon look without an artist |
| Tiles | `InstancedMesh` | Draws all 1,600 tiles in one call, fast on phones |
| Characters / Cores | Built from primitive shapes in code (prototype); Kenney / Quaternius CC0 assets later | No modelling needed to start |
| Camera | Fixed `PerspectiveCamera` tilted ~55° | Looks 3D but reads like 2D |
| Tweens / juice | **GSAP** | Squash, bounce, pop-in |
| Particles | Three.js `Points` / sprites | Hearts, sparkles, confetti |
| Game logic | Plain TS on a 2D grid, fixed **30 Hz** tick | Kept separate from rendering, so it's ready to run on a server later |
| Land capture | Iterative flood fill (BFS) | Fast and predictable |
| Input (PC) | WASD / arrow keys | Standard |
| Input (mobile) | Swipe; virtual joystick as an option (**nipplejs**) | Feels native on phones |
| UI / HUD | HTML + CSS overlay | Easier than drawing UI in 3D |
| Audio | **Howler.js** + Kenney audio packs | Works reliably across browsers |
| Tests | **Vitest** (game logic only) | Cover the flood fill and rules |
| Hosting | GitHub Pages via GitHub Actions | Free, deploys on every push |
| *Later* online play | Node.js + **Colyseus** | Rooms and server-authoritative state |
| *Later* saves | `localStorage` → Supabase/Firebase | Start simple |
| *Later* mobile app | **Capacitor** + AdMob | App stores and rewarded ads |

---

## 8. Code Architecture

```
src/
  main.ts                 # boot: create Game, Renderer, Input, UI
  config.ts               # every tunable number (speeds, hearts, timers, grid size)
  core/                   # pure game logic: no Three.js, no DOM (portable to a server)
    Game.ts               # fixed-tick loop, match state, win checks
    Grid.ts               # cell ownership, trails, void
    capture.ts            # loop-close + flood fill
    Player.ts             # movement, trail, state (alive/bonked/carrying/shade)
    CoreEgg.ts            # hearts, regen, steal/carry
    Void.ts               # shrinking rings
    events.ts             # typed event bus (captured, bonked, coreStolen…)
  ai/
    Bot.ts                # state machine
    pathfinding.ts        # BFS on the grid
  render/                 # Three.js only; reads state + listens to events
    Renderer.ts           # scene, camera, lights, resize
    BoardView.ts          # InstancedMesh tiles, pop-up animations
    BlobView.ts           # player characters
    TrailView.ts
    EggView.ts
    Particles.ts
  input/
    Keyboard.ts
    Touch.ts
  ui/
    Hud.ts                # timer, land %, hearts
    Menus.ts              # title, pause, results
  audio/
    Sound.ts
tests/
  capture.test.ts
  rules.test.ts
```

**Key rule:** `core/` never imports from `render/`, `ui/` or `audio/`. The game logic emits events, and the visuals and sounds react to them. That keeps the logic easy to test and lets it move to a server for online play without a rewrite.

---

## 9. Roadmap

### Phase 1: Playable MVP (single player vs 3 bots)

| # | Milestone | Deliverable | Done when… |
|---|---|---|---|
| **M0** | Project setup | Vite + TS + Three.js + Vitest + Pages deploy | An empty scene is live on GitHub Pages |
| **M1** | The island | 40×40 toon tiles, sky, lights, camera, 4 coloured quadrants | The board looks cute on desktop and phone |
| **M2** | Move and paint | Blob movement, trails, loop close + flood fill | One player can grab land; flood-fill tests pass |
| **M3** | Bonks and bots | Trail-cut rule, respawn, 3 bots (Expand/Flee/Attack/Defend) | A full free-for-all match plays out on its own |
| **M4** | Cores and winning | Hearts, regen, steal/carry/capture, timer, win screen, HUD | A match can be won or lost both ways |
| **M5** | Juice | Squash/stretch, tile pop waves, particles, sounds, music | It *feels* good: playtest feedback is "cute" and "fun" |
| **M6** | The Void | Shrinking rings, sliding Cores | Matches always end in a centre fight |
| **M7** | Polish and mobile | Swipe controls, menus, difficulty select, perf pass | 30+ FPS on a mid-range Android phone |

### Phase 2: Depth
Shades → Centre star → Emotes → Core compactness → Alliances/betrayal → Diagonal tunnels → Duos mode → Themed islands (Candy, Snow, Jungle, Space).

### Phase 3: Online and launch
Colyseus rooms (quick match + private rooms with a code) → accounts and saves → hats/outfits shop → Capacitor Android build → AdMob rewarded ads → Play Store.

---

## 10. Targets

| Metric | Target |
|---|---|
| FPS | 60 on desktop, 30+ on a mid-range Android phone |
| Load size | < 1.5 MB gzipped (MVP) |
| Time to first match | < 10 seconds from opening the link |
| Match length | ~3 minutes |

---

## 11. Open Questions (decide by playtesting)

1. Should players start with the whole **quadrant** or a small **patch**?
2. Is 3 hearts plus 30-second regen too forgiving or too punishing?
3. Should crossing your **own** trail be safe (current plan) or a bonk (like Paper.io)?
4. Can a Core be stolen while its owner is standing next to it?
5. When to start the Void (1:00?) and how fast it should shrink.
6. Keyboard controls: keep moving after release (Snake-style), or stop on release?

---

## 12. Next Step

Start **M0 + M1**: set up the project and render the cute island with 4 coloured quadrants and Cores in their corners, deployed to a live link.
