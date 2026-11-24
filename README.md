# AFTERIMAGE

**A browser puzzle platformer with one mechanic: you cannot make the jump, but your past self can.**

Every run you abandon — whether you die or press `R` — leaves a piece of you standing
exactly where you stopped: in mid-air, on a pressure plate, over a pit. Those
afterimages are solid. Build the way forward out of who you were.

Six rooms. One mechanic. No installs, no account, no network calls.

```
open build/index.html through any static server:
  cd build && python3 -m http.server 8000   →  http://localhost:8000
```

---

## Controls

| key | action |
|---|---|
| `A` `D` / `←` `→` | move |
| `SPACE` / `W` / `↑` | jump |
| `R` | leave yourself behind and restart the attempt |
| `M` | mute |
| `ESC` | pause |

Mouse works for the menus. The window can be resized freely; the canvas keeps 16:9.

## The rule set

* An attempt ends when you die **or** press `R`. Either way the body crystallises into
  the one free tile it was occupying and becomes a solid block.
* You keep at most 2–3 of them per room (shown as dots in the HUD). The oldest is
  replaced, so a room is a small resource-management problem, not a checkpoint grind.
* Deaths are useful. Some rooms are solved by throwing yourself into a spike pit to
  make a step, some by stopping at the top of a jump, some by standing on a plate
  and letting go so the door stays open.
* Gold = par or better. The par shown is the number the automated solver needed.

## Rooms

| # | room | lesson | par |
|---|---|---|---|
| 1 | First Light | a failed jump is a usable step | 1 |
| 2 | Air Step | stop in mid-air | 1 |
| 3 | Hold | a body can hold a switch | 1 |
| 4 | Two Voices | two switches, one body at a time | 2 |
| 5 | Chimney | stack yourself up a shaft | 2 |
| 6 | Switchback | climb, cross, and get through | 2 |

## How it is built

* **No dependencies, no build step, no external assets.** `build/` is plain ES modules,
  Canvas2D and CSS. All art is drawn procedurally; all music and effects are
  synthesised with WebAudio at runtime. Nothing is fetched after load.
* **Deterministic core.** `build/js/engine.js` is a fixed-step (60 Hz) simulation with
  no DOM access. The game, the solver and the tests all run the *same* module.
* **Verified, not assumed.** `tools/solver.html` is a beam search over the real
  physics: it replays the real `World` with the real collision code and finds a
  winning input sequence for every room. `tools/solve_all.py` runs it in a headless
  browser, checks the winning sequence again with `simulate()`, and writes
  `tools/solutions.json` (also bundled as `build/js/solutions.js`).
  Every room is proven solvable, and proven *not* solvable with zero echoes.
* **The attract mode is that proof.** The title screen plays the verified solutions
  back through the normal input path.

### Measured (headless Chromium, software rasteriser, 1024×576 canvas)

| metric | value |
|---|---|
| physics step | **0.0052 ms** (3000 steps in 15.5 ms) |
| full frame draw | **1.78 ms** |
| requestAnimationFrame loop | **60 fps, p95 16.7 ms** |
| total download | **≈71 KB** (game + CSS + modules, gzip-n/a) |
| first frame | no network round-trips after the document |

## Layout

```
build/            the shipped game (static files, index.html at root)
  js/engine.js    physics, echoes, plates, doors — no DOM
  js/levels.js    generated room table (tools/mklevels.py)
  js/render.js    procedural art
  js/audio.js     synthesised score and effects
  js/main.js      screens, input, fixed-step loop
  js/solutions.js verified solutions used by the attract mode
tools/            level generator, solver, recorder, smoke test (not shipped)
video/            demo recording
```

## Making a room

`tools/mklevels.py` builds the room table from a tiny DSL and writes `build/js/levels.js`.
After changing a room, run `python3 tools/solve_all.py` — it re-proves the room in a
headless browser and refuses to cache a solution that `simulate()` cannot reproduce.

## Credits

Design, code, art and sound by dongjinkim, made for OpenGame Game Jam #1.
Everything in this repository is original: there are no third-party assets to license
beyond the code itself (MIT).
