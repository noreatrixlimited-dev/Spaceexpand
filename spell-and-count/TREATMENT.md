# Spell and Count! — treatment

**Style:** Crayon Picture Book · **Length:** 3:27 (the whole song) · **Audio:** the user's own Suno song, used as-is (no added score or narration) · **Format:** 1920×1080, 24 fps · **Text:** the sung letters and numbers hand-lettered on the page; the other sung lines as the book's printed words.

## Analysis that drives the cut

| Measure | Result | Tool |
|---|---|---|
| Tempo | 107.7 BPM, one beat = 0.557 s, very steady (Suno) | librosa beat tracker |
| Key | G (tonic of the chroma profile) | librosa chroma |
| Loudness | −16.0 LUFS integrated, LRA 4.1 LU, peak −3.1 dB | ffmpeg ebur128 |
| Structure | intro 0–10 s · spell verses ONE, TWO · chorus 55 s · THREE, FOUR · chorus 108 s · FIVE/SIX · SEVEN/EIGHT · break 151 s · NINE/TEN (fast) · final chorus 160 s · outro 186 s · "Yay!" 204 s | self-similarity map + Whisper small.en (offline, sherpa-onnx) |
| Lyric timings | each line from overlapping 1.6 s Whisper windows, then snapped to the beat grid (`timeline.json`) | `analysis/` |

## Three structures

1. **A colouring-book page that fills up.** One big page. Every number adds its own things to the same landscape: one sun, two birds, three apples… By the end the page is complete. The choruses pull back to show how much has been drawn.
2. **A flip through ten pages.** One page per number, with a page turn between them. Clear, but it resets the picture ten times, and the song moves too fast at NINE and TEN (about 3 s each) for page turns.
3. **Two crayons racing.** A red and a blue crayon take turns spelling. It's cute, but it competes with the lyrics and has no picture that pays off.

**Chosen: 1.** The song is cumulative ("ONE, TWO, THREE, FOUR…"), and so is the page. The final chorus can travel across everything that was counted, which a flip-book can't do.

## Logline and arc

An empty sheet of paper learns to count: each spelled number draws its own things onto the page, until night falls and ten windows light up a finished picture.

- **Setup:** a blank page; the intro calls the friends in and the first crayon line appears.
- **Turn:** at NINE the page goes dark. A blue watercolour wash sweeps over it, and nine stars that were drawn in white crayon in the first minute (invisible until now) appear.
- **Ending:** TEN windows light up one by one. The final chorus travels across all ten numbers. "Yay!" is a burst of confetti scribbles on the full page.

## Benchmark

- *A child's real crayon counting book* plus the hand-textured, boiling line of 1980s British TV animation. **Learn:** still backgrounds with living figures, wordless lyric passages carried by music, colour that spills past the line. **Don't take:** any character, design or shot.
- Kids' sing-along videos (karaoke bounce). **Learn:** the letter being sung must be unmistakable. **Don't take:** a bouncing ball, flat vector art or any channel's look.

## The page (world 3840 × 2160)

Sky above green hills. Each number has its own spot, with its spelling strip lettered beside it:

| # | What gets drawn | Where | Spelling strip |
|---|---|---|---|
| 1 | a sun with a face | top left | under the sun |
| 2 | two little birds | sky, centre left | under the birds |
| 3 | three red apples on a tree | hill, left | right of the tree |
| 4 | four kittens | grass, centre | above the kittens |
| 5 | five flowers | grass, centre right | above |
| 6 | six balloons | sky, right | beside |
| 7 | a seven-band rainbow | sky, centre right | under the arc |
| 8 | eight butterflies | over the flowers | beside |
| 9 | nine stars (white wax, hidden from frame 1) | across the sky | top centre |
| 10 | ten windows lighting up | a house, bottom right | over the roof |

## Shot list and camera

| Section | Time | Framing / move | Why |
|---|---|---|---|
| Intro | 0–10.3 | locked full blank page; a crayon line wakes and draws the hills | a beginning from nothing |
| ONE | 10.3–37 | push in to the sun corner (close); hold as letters are circled in turn | "this one" |
| TWO | 37–55 | tilt along the sky to the birds | we look where the sun looks |
| Chorus 1 | 55–64 | pull out to the full page; the sun and birds bounce on "ONE, TWO, THREE" | the tableau so far |
| THREE | 64–91 | push in to the tree; apples drop onto branches one per beat | a counted object = a beat |
| FOUR | 91–108 | slow truck right onto the grass; kittens drawn in substitution poses | reading left to right |
| Chorus 2 | 108–116 | full page, slightly higher | breath |
| FIVE / SIX | 116–134 | medium on the flowers, then crane up to the balloons | growth upward |
| SEVEN / EIGHT | 134–151 | wide sky, rainbow bands coloured one per letter; butterflies | the biggest gesture |
| Break | 151–154 | held wide while the wash moves: night falls | native move, held wide |
| NINE / TEN | 154–160.5 | stars appear; quick push to the house; windows light up | the payoff |
| Final chorus | 160.5–186 | the signature shot: one slow truck across the whole page, each number's spot pulsing as it is sung | the recap |
| Outro | 186–207 | pull out to the full page; counting bounces; "We can spell! We can count!" lettered; "Yay!" confetti | ending that echoes the empty page |

At least 6 different moves are used: push, tilt, pull, truck, crane and a held wide shot. Transitions are camera moves and drawing-on only, never a dissolve.

## Beat sheet and cue map

All cues snap to the 0.557 s beat grid of `analysis.json`. A letter is lettered (drawn on) on its first sung appearance. On each repeat it is **circled and bounced** when sung. The number word is answered with the big numeral and the counted objects, drawn one per beat. Exact seconds are in `timeline.json` (generated from `analysis/whisper_fine.json`).

## Sound

The song is the whole soundtrack, used as-is. No foley is added on top: the user's mix already fills the spectrum, and a crayon scratch would muddy the vocal. The master is brought from −16 to −14 LUFS by `mux.sh`. The silences in the song (47–51 s, 151–154 s) are where the picture breathes: no new drawing, only boil.

## Type

- Spelled letters and numbers: Gaegu Bold, hand-lettered on the page in the outline colour (plum), drawn letter by letter in about 0.35 s.
- Printed words (the non-spelled lines, e.g. "One bright sun, shining for everyone!"): Patrick Hand 54 px, bottom centre, on a ragged paper patch, written left to right, held at least 1.8 s. Also exported to `spell-and-count.srt`.

## Crayon box (11 + white)

Plum outline `#4a2a4f` · sun yellow · orange · apple red · pink · grass green · leaf green · sky blue · violet · brown · cream · white (wax resist). One watercolour: ultramarine, for night.
