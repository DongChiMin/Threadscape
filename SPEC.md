# TASK: Build a playable single-file HTML prototype of "Threadscape" (mobile embroidery puzzle)

Goal of this prototype: let a player FEEL the full ASMR + visual experience of stitching a picture, while also testing puzzle difficulty. Game feel is the #1 priority. Do not ask questions; decide sensibly and list assumptions at the end. Do not add features that are not listed.

## 0. Priorities (if budget runs short, cut from the bottom)
P0: stitching feel (visuals, audio, haptics, needle/thread behaviour, completion celebration)
P1: puzzle rules, solver, level generation, hearts/fail/hint/undo
P2: collection/gallery, title screen, telemetry, demo mode
Never cut a P0 item to save a P2 item.

## 1. Deliverable and constraints
- ONE self-contained file: index.html (HTML + CSS + vanilla JS). No external libraries, fonts, images, audio files or network requests. Works offline.
- Portrait, mobile-first (360x800 CSS px); also works on desktop with mouse. Touch: pointer events, touch-action:none on the canvas, no double-tap zoom, respect safe-area insets.
- Canvas 2D, devicePixelRatio capped at 2. All art is procedural. All audio is synthesized with WebAudio.
- CONFIG object at top with every tunable (hearts, timings, pitch scale, particle caps, needle spring constants, difficulty table, feature flags).
- Structure the audio engine as a registry: play('stitch', {step}), play('snip'), etc. so synthesized sounds can later be swapped for recorded samples without touching game code.
- Keep pure game logic (grid, rules, solver, generator) separate from rendering so it can be unit-tested in Node (logic section delimited by markers in index.html; test_logic.js in this folder loads it).

## 2. Rules (implement exactly)
- A level is a W x H grid. Each cell is one of: BACKGROUND (plain fabric, not part of the puzzle), COLOR k (needs stitching), TORN (hole, impassable, level 16+), PRESTITCHED (already stitched, impassable, level 6+ optional).
- The player has SPOOLS. Each spool has a color and an exact length L. For each color, the sum of its spool lengths equals the number of cells of that color still to stitch.
- Stitching a spool: select the spool, press on a cell of the same color, then drag. The path extends to an orthogonally adjacent cell only if that cell is: same color, not yet stitched, not already in the current path. Each cell is visited once.
- Dragging back onto the previous path cell retracts one stitch (free, with the reverse animation/sound).
- When path length == L: the spool is completed automatically (snip), the path becomes permanent.
- If the finger is released with length < L: the path stays "parked" (needle stays in the fabric at the head cell, thread tail hangs). The player can resume by dragging from the head, or tap the spool to unpick it. Selecting another spool unpicks any parked path first.
- DEAD END: needle at a cell with no legal continuation and length < L: show the "knot" feedback (see audio/visual) but do not cost a heart by default (CONFIG.heartOnDeadEnd = false). The player backtracks, or releases to unpick.
- REJECTED COMMIT: after a spool completes, run the per-color solvability check (section 4) for that color's remaining cells and remaining spools. If unsolvable: play the "tangle" feedback, revert that spool to the tray, lose 1 heart. If the solver hits its node limit, treat the state as solvable.
- Hearts: 3 per level. At 0 hearts: Fail panel with "Revive (+1 heart)" (stub for rewarded ad, once per level, mark // TODO rewarded ad) and "Retry".
- Hint (3 per level): the solver produces a full solution from the current state (fall back to the stored generation solution if the player has not diverged). Pulse the start cell of the next spool's path and ghost the next 2 cells.
- Undo button: unpick the most recently completed spool (unlimited in the prototype; telemetry counts it).
- Win: every color cell stitched.

## 3. Mandatory fixture: Level 1 (use exactly; also use it for solver unit tests)
Grid 4 wide x 3 high, rows top to bottom (R = red, G = green):
    R R R G
    R G G G
    R R G G
Spools: Red 6, Green 6.
Expected: the only valid starting cells for the Red spool are (row0,col2) and (row2,col1); for Green they are (row1,col1) and (row0,col3). Starting anywhere else dead-ends. Add this as a Node-testable assertion. Draw it as a simple two-colour motif inside a slightly larger fabric (background cells around it) so it still looks like a picture.

## 4. Per-color solver (pure logic)
- Colors are independent: a spool only occupies cells of its own color. Solve each color separately: partition that color's remaining cells into simple (self-avoiding, orthogonal) paths whose lengths exactly match that color's remaining spool lengths (multiset).
- Exact DFS with memoization (key = remaining-cell set + sorted remaining lengths). Branch on a deterministic cell (e.g. the remaining cell with the fewest remaining neighbours, preferring degree <= 1). Cheap pruning first: each connected component's size must be achievable as a sum of remaining lengths; isolated cells need a spool of length 1.
- Node limit per call (CONFIG.solverNodeLimit = 200000); return 'solvable' | 'unsolvable' | 'unknown'.
- API: solve(state) -> solution (list of paths) or null; isSolvable(state); validStarts(state, spool).

## 5. Levels (20, generated at load, deterministic)
- Author 20 small pixel-art motifs as string maps (cute, readable, mostly symmetric: heart, flower, leaf, mushroom, cat, fish, house, star, lotus, cherry, butterfly, owl, teapot, sunflower, moon, etc.) using a fixed palette of 6 floss colors (coral #E0534A, leaf #5AA05A, sky #4A8FD6, sunflower #F2C230, violet #8A62C6, pink #EC86AD). Level 1 is the fixture above.
- Difficulty table (CONFIG):
  - L1-5: 4x3..6x6, 2-3 colors, about 1 spool per color (allow +1 when a region has no Hamiltonian path).
  - L6-15: 6x6..8x8, 3-5 colors, 2-3 spools per color of different lengths, some PRESTITCHED anchors.
  - L16-20: 8x8..10x10, 4-6 colors, 3-5 spools per color, TORN cells.
- Generation per level: for each color, partition its cells into simple paths with a randomized self-avoiding walk (prefer neighbours with the fewest remaining neighbours, restarts with a seeded PRNG mulberry32). For early levels pick the partition with the fewest paths; for later levels pick partitions with more spools. Spool lengths = path lengths, min 2 (allow 1 only L16+). Store the generating solution on the level (for hints/demo).
- Metrics logged per level: cells, colors, spool count, startAmbiguity (valid starting cells / same-color cells), rejectedRatio (fraction of legal complete-length paths that would be rejected at the initial state, enumerate with a cap of 5000 per spool), solutions count capped at 50. Prefer candidates with higher rejectedRatio as levels increase (target >= 0.3 from L6).
- At startup self-test: every level is solvable (assert), print a console.table of the metrics.

## 6. Visual design (P0) - make it look like a real tactile embroidery hoop
Palette and light: warm, cozy, soft light from top-left; consistent soft shadows everywhere. Background: warm dark wood or soft linen-toned gradient with subtle vignette.
- Hoop: wooden ring around the fabric (outer/inner ring bevels, grain lines, a small metal tightening screw), soft shadow on the table, fabric slightly tensioned (subtle radial shading so it looks stretched).
- Fabric: Aida cloth, pre-rendered once to an offscreen canvas: linen base, fine horizontal/vertical weave lines at low alpha, per-cell corner holes (tiny dark dot with a highlight), speckle noise, gentle brightness variation.
- Printed pattern (unstitched): each color cell shows a faint tinted square inset (alpha ~0.2) with a faint "x" outline; optional colorblind symbols (circle, square, triangle, diamond, star, cross) toggle. TORN cells: dark hole with frayed edge. PRESTITCHED: stitched but slightly dimmer with a tiny anchor dot.
- Stitch (X): two diagonal thread strokes per cell. Render each with layers: dark base stroke, main color stroke, thin lighter highlight stroke, plus a fine dashed lighter stroke along the line to suggest twisted floss; round caps; slight random jitter (+-2% length/angle, seeded per cell) so no two look identical; a soft contact shadow on the fabric. Cache per-colour stitch sprites if needed for speed.
- Stitch appearance animation (~160 ms): first diagonal draws in over ~70 ms, second ~70 ms later, scale overshoot 1.15 -> 1.0, plus a dark "pucker" ring around the cell fading over ~220 ms (fabric dent), and 2-4 tiny cream lint-fibre particles.
- Needle: procedural metallic needle (gradient, bright highlight, visible eye), tilted by movement direction, drawn offset up-right so the finger never hides the tip. Tip follows the pointer with a critically damped spring and is magnetically pulled toward the head cell centre (blend 65%). Camera does a subtle ease-in zoom (about 1.04x) toward the work area while stitching and eases back on release.
- Thread: a short verlet-rope tail (about 8 nodes) hanging from the needle eye with light gravity and damping so it sways alive; a gently sagging tension line from the last stitch to the needle. Parked needle stays planted in the fabric with its tail hanging.
- Spool tray: spools as small cylindrical bobbins with wound-thread texture, highlights, shadow, and a badge showing remaining stitches. Selected spool lifts and glows (pre-rendered glow sprite, no shadowBlur). Completed spool shows a check and a loose unwound end. Up to 2 rows; shrink to fit.
- Dead-end/knot: the thread at the needle curls into a small loop/knot with a soft wobble. Tangle (rejected commit): the just-stitched thread bunches into a messy tangle, then neatly retracts into its spool.
- Spool complete: scissor-snip animation, the spool's stitches flash with a brief shine sweep along the path, a few sparkles.
- Level complete (the key moment): slow camera zoom-out, a diagonal shine wave sweeps across all stitches (each stitch pops with a tiny bounce in wave order), colored sparkle particles, hoop gives a gentle wooden "tap" wobble, picture glows softly; then a framed card "Stitched!" with 1-3 stars (hearts left), Next button, and the picture flies to the collection icon.
- UI: minimal, rounded, soft shadows; hearts top-left, level number top-center, settings top-right (sound, haptics, colorblind symbols, reduced motion); buttons for Hint (with count), Undo, Restart.
- Idle life: a few drifting lint/dust motes in the light; nothing else moves when idle.

## 7. Audio design (P0) - synthesized ASMR, must be gentle, tactile and varied
Engine: AudioContext created/resumed on the first user gesture. Chain: voices -> master gain -> soft compressor (threshold about -18 dB, ratio about 3) -> destination. Add a small convolution reverb built from generated decaying noise (0.5-0.7 s, wet ~10-14%) for warmth. Voice cap 12. Every envelope starts at 0 with a 2 ms ramp and ends at 0 (no clicks/pops). Humanize every hit: pitch +-3%, gain +-1.5 dB, tiny random timing offset. Cap trigger rate (min 30 ms between stitch sounds) and keep overall loudness comfortable (peak about -6 dBFS).
Pentatonic scale for combo pitch: C4 D4 E4 G4 A4 C5 D5 E5 G5 A5. Step index = stitch number within the current spool (clamped), different spool = different starting step offset.
Sounds:
1. stitch (per cell crossed): three layers: (a) cloth/needle "tick": 20-35 ms bandpassed noise burst (center 2.5-4 kHz, Q 3-6, fast exponential decay); (b) soft pluck: triangle/sine at the pentatonic note through a lowpass (~2 kHz), 2 ms attack, ~70 ms decay, low volume; (c) very quiet body thud: sine ~120 Hz, ~30 ms.
2. thread friction (continuous while dragging): looped noise buffer -> bandpass/highpass (~5-8 kHz) -> gain driven by smoothed pointer speed (setTargetAtTime); silent when still. Very quiet; it should read as thread sliding through cloth.
3. spool select: soft wooden "tok" (sine 220 -> 160 Hz, 60 ms) + faint rustle.
4. unpick/undo (per stitch): reverse swish + descending pluck notes, softer than forward.
5. dead-end knot: low, soft, short rubbery "mmf" (lowpassed noise + sine sliding 240 -> 160 Hz, ~180 ms), never harsh.
6. spool complete: scissor snip (two hi-passed noise bursts, ~15 ms each, 40 ms apart) + warm chime (sine at that spool's tonic +1 octave, ~400 ms decay through the reverb) + 3 tiny random high pentatonic sparkle notes.
7. tangle (rejected commit): soft "pfft" (lowpassed noise burst) + descending sine 300 -> 150 Hz (~250 ms), then the retract swish.
8. level complete: ascending pentatonic arpeggio with detuned triangle pairs through the reverb, a warm 1.5 s pad swell (two detuned sines, root + fifth), a wooden hoop "tap" (sine ~180 Hz, 80 ms).
9. UI tick: very soft click. Hint: gentle two-note rising bell.
10. Optional ambience toggle: very quiet brown-noise room tone (lowpass ~400 Hz, about -42 dB).
Mute toggle in settings. The game must still feel satisfying with sound off (visuals + haptics carry it).

## 8. Haptics (navigator.vibrate when available; toggle in settings; if unsupported, rely on visuals)
stitch 8 ms; spool complete [12,40,12]; dead-end 20 ms; tangle [30,40,30]; win [15,30,15,30,60]. Respect prefers-reduced-motion (fewer particles, no camera zoom, shorter animations).

## 9. Input details
- Process pointer movement by sampling points along the segment between the previous and current pointer positions so fast swipes never skip cells; process cells in order.
- Cell entry uses hysteresis (pointer must be inside the cell's inner 70% before it registers) to avoid flicker on borders.
- Only orthogonal moves; diagonal pointer motion resolves through legal adjacent cells only.
- Tutorial L1-2: pulsing start cells for the selected spool and a one-line instruction ("Drag the needle through every red cell"). No text walls.

## 10. Screens and meta (P2)
Title (Play, Collection, Settings; optionally a looping demo-stitching background reusing demo mode) -> Game -> Complete -> Next. Collection: gallery wall of 20 framed slots showing completed pictures (re-rendered from level data), silhouettes for locked. Persist progress/settings in localStorage inside try/catch with an in-memory fallback.

## 11. Telemetry, debug, demo (P2)
- Per level: starts, completes, rejected commits, dead ends, hearts lost, hints, undos, revives, time to complete.
- ?debug=1: overlay with these stats + level metrics, a "Skip level" button, and "Export stats" (copy JSON to clipboard).
- ?demo=1: auto-plays the stored solution at a human-like pace with the real animation and audio (for judging the feel hands-free and for recording ad footage). ?clean=1 hides all UI chrome for clean screen recording.

## 12. Performance
requestAnimationFrame with delta time; pause and suspend audio when the tab is hidden; pool particles (cap about 150); pre-render fabric, hoop, spools and glow sprites; avoid per-frame allocations and avoid shadowBlur. Target stable 60 fps on a mid-range Android phone.

## 13. Acceptance checklist
- [ ] Opens offline from index.html with no console errors.
- [ ] Level 1 fixture matches section 3 (valid starts, dead ends, completion); Node test of the pure logic passes.
- [ ] All 20 levels pass the solvability self-test; metrics table printed.
- [ ] Each stitch triggers the 3-layer sound with audible pitch climb and humanized variation; no clicks/pops; friction sound follows drag speed.
- [ ] Stitches look like twisted floss X's on Aida cloth with shadows, jitter and pucker; no two look identical.
- [ ] Needle spring, tilt, magnetic snap and thread tail feel alive; fast swipes never skip cells.
- [ ] Parked path, resume, unpick, backtrack, undo, hint, revive (once), retry all work.
- [ ] Rejected commit shows tangle + heart loss + revert; dead end shows knot without heart loss.
- [ ] Level complete sequence (shine wave, sparkle, hoop tap, framed card, fly-to-collection) plays.
- [ ] Sound-off still feels satisfying; reduced-motion and colorblind symbol options work.
- [ ] ?debug=1, ?demo=1, ?clean=1 work; stats export JSON.
- [ ] Stable frame rate with max particles (or state how verified).

## 14. When finished, reply with
(a) what you built, (b) assumptions, (c) known issues, (d) CONFIG values most worth tuning (especially audio levels, needle spring, difficulty table), (e) how you verified solver and logic (Node tests) and how you checked feel (screenshots or a description if no browser), (f) which sounds you think need real recorded samples to reach full ASMR quality.
