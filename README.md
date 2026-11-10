# Stitch Path

A single-file mobile embroidery puzzle prototype (HTML + vanilla JS, no dependencies).

- Play: open `index.html` (or the GitHub Pages site for this repo).
- Pure game logic lives in `logic.js` and is spliced into `index.html` by `node build.js`.
- Tests: `node test_logic.js`.
- `tools/image_to_grid.html` converts a picture into a stitch grid for new tapestries.
- Debug URLs: `?debug=1`, `?demo=1`, `?clean=1`, `?unlock=1`.
