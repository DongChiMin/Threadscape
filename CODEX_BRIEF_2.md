# Brief 2 for Codex: make drawing the thread easy (UI side). PO owns logic.

Same rules as CODEX_BRIEF.md: do NOT edit between `// BEGIN PURE LOGIC` / `// END PURE LOGIC`; logic changes go to NEEDS_LOGIC.md; after editing run `node test_logic.js` (must print PASS + "in sync"). No features beyond this brief.

PROBLEM: players find it hard to draw the thread path. Logic.js now provides assists. Wire them into the UI.

NEW LOGIC API (already in index.html's logic block)
- `Logic.pathStatus(state, spool, path)` -> 'ok' | 'doomed' | 'unknown'. 'doomed' = no completion of this partial path can commit cleanly (it would tangle later). Cheap enough to call after every stitch (cache by path key if you like).
- `Logic.autoRun(state, spool, path)` -> array of cells the thread can add by itself (head has exactly one legal neighbour). 
- `Logic.autoStitch(state, spool)` -> a full valid path for that spool, or null.
- `Logic.validStarts(state, spool)` (existing) -> valid start cells.
- `Logic.ASSIST.warnUntilLevel` (= 10).

FEATURES (priority order)
1. AUTO-RUN: after the player enters a cell (drag or tap), append `Logic.autoRun(...)` cells automatically, one every ~55 ms, each with the normal stitch animation/sound/haptic (pitch keeps climbing). Player may keep dragging; ignore pointer cells while auto-run is playing. Stop at branch, dead end or full length (full length -> normal commit).
2. DOOMED WARNING (free, no heart): after every path change compute `pathStatus`. When 'doomed' and (level <= Logic.ASSIST.warnUntilLevel OR the Peek booster is active for this level): tint the live thread and needle tail muted red, give it a slow wobble, play a soft "uh-uh" two-note descending tone (once per transition into doomed), and show a one-line caption "This path will tangle - go back" (first 3 times only, then just the tint). Dragging back out of doomed clears it. This must NOT cost hearts and must not block moves.
3. TAP-TO-EXTEND: tapping (pointerdown+up within 250 ms, <10 px move) a cell orthogonally adjacent to the parked head extends the path by one (same rules as drag). Tapping the selected spool in the tray still unpicks. Make touch easier: cell hit test uses the inner 60% on touch (70% mouse) and diagonal pointer moves resolve to the legal neighbour closer to the pointer.
4. BOOSTER BAR (above Undo/Restart row): Hint (3/level, existing), Peek ("Smart Thread": enables the doomed warning for the rest of the level, 1 per level free for L11+ via CONFIG.freePeekPerLevel=1, then costs coins), Auto (Auto-stitch one spool: pick the selected spool or the largest undone one, animate `autoStitch` path like demo mode, commit). Undo: first 3 per level free, then CONFIG.undoCost coins.
5. COINS (soft currency, persisted in localStorage): reward on win = CONFIG.coinBase(10) + CONFIG.coinPerHeart(5)*heartsLeft; every 5th level also a chest bonus CONFIG.chestBonus(30) with a small chest-open animation on the win card. Booster costs in CONFIG: peek 20, auto 40, undo 10, hint 15 (after free uses). Not enough coins -> button shows "Watch ad" and grants the booster (stub, `// TODO rewarded ad`). Show the coin count top-right next to settings.
6. FAIL PANEL near-miss: show "N of M spools done" and a progress bar. Buttons: "Revive (+1 heart)" (once, stub ad), "Auto-stitch the rest of this spool + continue" is NOT required; keep Revive / Retry only plus the near-miss line.
7. ONBOARDING (no text walls): L1-3: pulse `validStarts` of the selected spool (existing tutorial). L1: after 3 s idle show a ghost hand that drags along `level.solution` for the selected spool, loop until the player touches. L2: one-line caption "Thread turns red when a path will tangle" the first time the warning fires. L1-5: if idle 8 s, auto-pulse the hint (free, not counted).
8. ?debug=1 overlay: show per-level metrics from Logic.metrics (including botFail) and current pathStatus.

TELEMETRY additions per level: assistsAutoRun (cells), warningsShown, peeks, autos, coinsEarned, coinsSpent.

FINISH with a short report: what changed, what you could not verify (no browser), CONFIG values worth tuning.
