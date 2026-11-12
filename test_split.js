const fs = require('node:fs');
const assert = require('node:assert/strict');
const L = Function(fs.readFileSync(__dirname + '/logic.js', 'utf8') + ';return Logic')();

function check(rows, options = {}) {
  const original = rows.slice();
  const level = L.splitLevel(rows, { minLen: 1, preferLongSpools: true, seed: 1, ...options });
  assert.deepEqual(rows, original, 'input art stays unchanged');
  assert.equal(level.cells.join(''), rows.join(''), 'output art stays unchanged');
  const used = new Set();
  for (const { color, path } of level.solution) {
    path.forEach((cell, i) => {
      assert.equal(level.cells[cell], color);
      assert(!used.has(cell), 'solution never overlaps');
      if (i) assert(L.neighbors(level, path[i - 1]).includes(cell));
      used.add(cell);
    });
  }
  assert.equal(used.size, level.cells.filter(c => L.COLORS.includes(c)).length);
  assert.equal(L.isSolvable(L.makeState(level)), 'solvable');
  return level;
}

for (const diff of [1, 3, 5]) {
  assert.equal(L.spoolText(check(['RRRR', 'RRRR', 'RRRR'], { diff })), 'R12');
  assert.equal(L.spoolText(check(['R.RR'], { diff })), 'R2 R1');
  // Four leaves cannot fit in one path: keep the necessary singletons, but
  // prefer a three-cell path over a two-cell path and three singletons.
  assert.equal(L.spoolText(check(['.R.', 'RRR', '.R.'], { diff })), 'R3 R1 R1');
}
check(['RRRR', 'RRRR'], { minLen: 3 });
for (const pic of L.makePictures()) {
  const rows = pic.piece(0);
  const options = { diff: 5, maxSpools: 8 };
  const before = L.splitLevel(rows, { ...options, seed: 1, minLen: 1 });
  const after = check(rows, options);
  const tiny = lv => lv.spools.filter(s => s.length <= 2).length;
  console.log(`${pic.id}: spools ${before.spools.length} -> ${after.spools.length}; tiny ${tiny(before)} -> ${tiny(after)}`);
}
console.log('Editor split checks passed: long paths, necessary islands, branches, unchanged art, solvable coverage.');
