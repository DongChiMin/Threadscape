// Hi-res reveal art pipeline for tapestries.
//   node tools/hires_tool.js refs                 -> References/Hires/ref_<id>.png (gameplay grid, 1 cell = 12px, no grid lines)
//   node tools/hires_tool.js apply <id> <png> [--colors N] [--global]
//        -> quantises the image to (w*4)x(h*4) stitches, checks it against the gameplay grid
//           and writes the `hires` field into that tapestry's entry in logic.js (run `node build.js` after).
//   node tools/hires_tool.js grid <id>           -> 1x: store the gameplay grid itself as the reveal art
//   node tools/hires_tool.js preview <id>        -> References/Hires/preview_<id>.png (what is stored in logic.js)
// Image decoding uses PowerShell/System.Drawing (Windows) so any jpg/png works without npm packages.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), cp = require('node:child_process');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'References', 'Hires');
const Logic = require(path.join(ROOT, 'logic.js'));

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function crc32(buf) { let c, t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++)c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })); let x = ~0; for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8); return (~x) >>> 0 }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const picColor = (p, ch) => ch === '.' ? hex(p.background) : hex(p.palette[ch]);

function refs() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const p of Logic.makePictures()) {
    const S = 12, W = p.w * S, H = p.h * S, buf = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++)for (let x = 0; x < W; x++) { const c = picColor(p, p.rows[y / S | 0][x / S | 0]); buf.set(c, (y * W + x) * 3) }
    fs.writeFileSync(path.join(OUT, 'ref_' + p.id + '.png'), png(W, H, buf));
    console.log('ref_' + p.id + '.png', p.w + 'x' + p.h, '-> target', p.w * 4 + 'x' + p.h * 4);
  }
}

// Resize any image to W x H with a box filter (System.Drawing HighQualityBicubic) and return raw RGB.
function loadResized(file, W, H) {
  const tmp = path.join(OUT, '_tmp_' + process.pid + '.bin');
  const ps = `Add-Type -AssemblyName System.Drawing;$s=[System.Drawing.Image]::FromFile('${path.resolve(file).replace(/'/g, "''")}');$b=New-Object System.Drawing.Bitmap ${W},${H};$g=[System.Drawing.Graphics]::FromImage($b);$g.InterpolationMode='HighQualityBicubic';$g.PixelOffsetMode='HighQuality';$g.DrawImage($s,0,0,${W},${H});$o=New-Object byte[] (${W * H * 3});$i=0;for($y=0;$y -lt ${H};$y++){for($x=0;$x -lt ${W};$x++){$c=$b.GetPixel($x,$y);$o[$i]=$c.R;$o[$i+1]=$c.G;$o[$i+2]=$c.B;$i+=3}};[IO.File]::WriteAllBytes('${tmp}',$o)`;
  cp.execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  const b = fs.readFileSync(tmp); fs.unlinkSync(tmp); return b;
}

function apply(id, file, colors, opts = {}) {
  const p = Logic.makePictures().find(x => x.id === id); if (!p) throw Error('unknown tapestry ' + id);
  const K = Logic.HIRES_K, W = p.w * K, H = p.h * K, rgb = loadResized(file, W, H);
  const pixels = Array.from({ length: W * H }, (_, i) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
  const hires = Logic.quantizeHires(p, pixels, { colors, ...opts });
  const check = Logic.hiresCheck(p, hires);
  console.log(`${id}: ${W}x${H}, ${hires.palette.split(' ').length} colours, ${hires.data.length} chars, consistency ${(check.ratio * 100).toFixed(1)}% (${check.bad.length} mismatched cells)`);
  const logicPath = path.join(ROOT, 'logic.js'), text = fs.readFileSync(logicPath, 'utf8');
  fs.writeFileSync(logicPath, Logic.applyHiresEntry(text, id, hires), 'utf8');
  console.log('logic.js updated; run `node build.js`');
}

function preview(id) {
  const p = Logic.makePictures().find(x => x.id === id); if (!p?.hires) throw Error('no hires for ' + id);
  const hr = Logic.decodeHires(p), S = 4, W = hr.w * S, H = hr.h * S, buf = Buffer.alloc(W * H * 3), bg = hex(p.background);
  for (let y = 0; y < H; y++)for (let x = 0; x < W; x++) { const c = hr.colorAt(x / S | 0, y / S | 0); buf.set(c ? hex(c) : bg, (y * W + x) * 3) }
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'preview_' + id + '.png'), png(W, H, buf)); console.log('preview_' + id + '.png');
}

// 1x: the gameplay grid itself, one stitch per coloured cell; background ('.') cells stay unstitched like in the level
function grid(id) {
  const p = Logic.makePictures().find(x => x.id === id); if (!p) throw Error('unknown tapestry ' + id);
  const keys = [...new Set(p.rows.join(''))].filter(c => c !== '.'), palette = keys.map(c => ({ parent: c, hex: c === '.' ? p.background : p.palette[c] }));
  const idx = Int16Array.from(p.rows.join(''), c => keys.indexOf(c)), hires = Logic.encodeHires(p.w, p.h, idx, palette, 1);
  const logicPath = path.join(ROOT, 'logic.js'); fs.writeFileSync(logicPath, Logic.applyHiresEntry(fs.readFileSync(logicPath, 'utf8'), id, hires), 'utf8');
  console.log(id + ': 1x grid, ' + keys.length + ' colours');
}

const [cmd, a, b] = process.argv.slice(2), ci = process.argv.indexOf('--colors'), colors = ci > 0 ? +process.argv[ci + 1] : undefined;
if (cmd === 'refs') refs(); else if (cmd === 'apply') apply(a, b, colors, { global: process.argv.includes('--global'), cross: process.argv.includes('--global') ? 1 : undefined }); else if (cmd === 'preview') preview(a); else if (cmd === 'grid') grid(a);
else console.log('usage: refs | apply <id> <image> [--colors N] | preview <id>');
