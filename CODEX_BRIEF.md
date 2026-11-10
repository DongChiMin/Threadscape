# Brief for Codex: polish visuals / animation / audio of Stitch Path (PO owns logic)

Context: SPEC.md is the full spec. index.html already runs end to end.
RULES OF ENGAGEMENT
- DO NOT edit anything between `// BEGIN PURE LOGIC` and `// END PURE LOGIC` in index.html. That block is generated from logic.js (owned by the PO). If you need a logic change, write it in `NEEDS_LOGIC.md` instead.
- You own: rendering, animation, particles, audio engine/sounds, haptics, UI/CSS, settings, collection view.
- After editing run `node test_logic.js` (must still print PASS and "in sync").
- Do not add features beyond SPEC.md. Do not touch SPEC.md, logic.js, build.js, test_logic.js.

WHAT TO IMPROVE (priority order, spec sections 6, 7, 8, 12)
1. Stitch look: each stitched cell must read as an "X" made of two twisted-floss diagonals (dark base, main color, highlight, dashed twist, round caps, +-2% seeded jitter, contact shadow, ~160 ms draw-in with 1.15 overshoot, pucker ring, 2-4 lint particles). Right now stitches look like a "V"/chevron: fix this first.
2. Layout: portrait 360x800 first. The hoop + fabric must fill the width, tray below, buttons below tray; the completed picture must be visible after the win card flies to the collection icon. Check at 360x800 and at a desktop window.
3. Needle: metallic needle with eye, tilted by motion, drawn offset up-right, spring + 65% magnetic pull to head cell; verlet thread tail (~8 nodes). Parked needle stays planted.
4. Dead-end knot and tangle (rejected commit) animations; scissor snip + shine sweep on spool complete.
5. Level complete sequence: slow zoom-out, diagonal shine wave with per-stitch pop, sparkles, hoop tap wobble, framed card, picture flies to collection icon.
6. Audio per spec section 7: 3-layer stitch sound with pentatonic climb, friction loop driven by pointer speed, snip + chime, knot, tangle, win arpeggio+pad, registry-style `play(name,opts)`, reverb, compressor, humanization, no clicks.
7. Fabric (Aida) and hoop (wood grain, bevels, screw) pre-rendered offscreen; idle dust motes only.
8. Performance: particles pooled (cap ~150), no shadowBlur, no per-frame allocations in hot paths.

FINISH WITH a short report: what changed, what you could not verify (no browser available to you), and any audio sounds that need real samples.
