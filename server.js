// Threadscape Local Studio Server
// Enables 1-click automatic apply from level_editor.html into logic.js and index.html without file dialogs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Logic = require('./logic.js');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function applyTapEntry(logicText, id, newEntry) {
  const startMarker = "{id:'" + id + "'";
  const startIdx = logicText.indexOf(startMarker);
  if (startIdx >= 0) {
    let bt = startIdx, count = 0;
    while (count < 4 && bt < logicText.length) {
      bt = logicText.indexOf('`', bt + 1);
      if (bt < 0) throw new Error('Không parse được entry cũ trong TAP[].');
      count++;
    }
    const closeIdx = logicText.indexOf('}', bt);
    if (closeIdx < 0) throw new Error('Không tìm thấy dấu đóng } sau spools backtick.');
    let lineStart = startIdx;
    while (lineStart > 0 && logicText[lineStart - 1] !== '\n') lineStart--;
    let lineEnd = closeIdx + 1;
    if (logicText[lineEnd] === ',') lineEnd++;
    if (logicText[lineEnd] === '\n') lineEnd++;
    return logicText.slice(0, lineStart) + '  ' + newEntry + ',\n' + logicText.slice(lineEnd);
  } else {
    const tapStart = logicText.indexOf('const TAP=[');
    if (tapStart < 0) throw new Error('Không tìm thấy const TAP=[');
    let pos = tapStart;
    while (pos < logicText.length) {
      const nl = logicText.indexOf('\n', pos);
      if (nl < 0) break;
      const line = logicText.slice(nl + 1).match(/^[ \t]*\];/);
      if (line) {
        return logicText.slice(0, nl) + ',\n  ' + newEntry + logicText.slice(nl);
      }
      pos = nl + 1;
    }
    throw new Error('Không tìm thấy dòng kết thúc ];');
  }
}

function prepareIndex(logicText) {
  const indexPath = path.join(ROOT, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const a = indexHtml.indexOf('// BEGIN PURE LOGIC');
  const b = indexHtml.indexOf('// END PURE LOGIC');
  if (a < 0 || b < 0) throw new Error('Markers BEGIN/END PURE LOGIC missing in index.html');
  const updatedHtml = indexHtml.slice(0, a) + '// BEGIN PURE LOGIC\n' + logicText.trim() + '\n' + indexHtml.slice(b);
  return { indexPath, updatedHtml };
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Ping API
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  // Direct Apply API
  if (req.method === 'POST' && req.url === '/api/apply') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { id, entryText } = data;
        if (data.kind !== 'mini' && (!id || !entryText)) throw new Error('Missing id or entryText');

        const logicPath = path.join(ROOT, 'logic.js');
        const logicText = fs.readFileSync(logicPath, 'utf8');
        const updatedLogic = data.kind === 'mini'
          ? Logic.applyMiniOverride(logicText, data.number, data.level)
          : applyTapEntry(logicText, id, entryText);
        const { indexPath, updatedHtml } = prepareIndex(updatedLogic);

        fs.writeFileSync(logicPath, updatedLogic, 'utf8');
        try {
          fs.writeFileSync(indexPath, updatedHtml, 'utf8');
        } catch (error) {
          fs.writeFileSync(logicPath, logicText, 'utf8');
          throw error;
        }

        const target = data.kind === 'mini' ? 'Level ' + data.number : id;
        console.log(`[Apply] Successfully updated "${target}" into logic.js and index.html`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: `Đã ghi đè "${target}" vào logic.js và index.html thành công!` }));
      } catch (err) {
        console.error('[Apply Error]', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Static file server
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/level_editor.html';

  const filePath = path.join(ROOT, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  Threadscape Studio Server running at:`);
  console.log(`  http://localhost:${PORT}/level_editor.html`);
  console.log(`  (API /api/apply enabled for 1-click auto-saving)`);
  console.log(`====================================================`);
});

