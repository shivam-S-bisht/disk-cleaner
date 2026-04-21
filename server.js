const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const PORT = 3456;

app.use(express.json());
app.use(express.static('public'));

const SKIP_DIRS = new Set(['proc','sys','dev','run','.Trash','node_modules','.git','System/Volumes/Data']);

function shouldSkip(p) {
  return p.split(path.sep).some(s => SKIP_DIRS.has(s));
}

function fmtSize(bytes) {
  const u = ['B','KB','MB','GB','TB'];
  let i = 0, s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return { value: parseFloat(s.toFixed(2)), unit: u[i], bytes };
}

async function scanDirectory(dirPath, minBytes, maxDepth, depth = 0) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return results; }

  for (const e of entries) {
    const fp = path.join(dirPath, e.name);
    if (e.isFile()) {
      try {
        const st = fs.statSync(fp);
        if (st.size >= minBytes) {
          results.push({ name: e.name, path: fp, size: fmtSize(st.size), modified: st.mtime.toISOString(), type: 'file' });
        }
      } catch {}
    } else if (e.isDirectory() && depth < maxDepth && !shouldSkip(fp)) {
      const sub = await scanDirectory(fp, minBytes, maxDepth, depth + 1);
      results.push(...sub);
    }
  }
  return results;
}

app.get('/api/home', (_, res) => res.json({ home: os.homedir() }));

app.get('/api/scan', async (req, res) => {
  const scanPath = path.resolve(req.query.path || os.homedir());
  const minBytes = (parseFloat(req.query.minMB) || 50) * 1024 * 1024;
  const maxDepth = parseInt(req.query.maxDepth) || 6;
  if (!fs.existsSync(scanPath)) return res.status(400).json({ error: 'Path does not exist' });
  try {
    const files = await scanDirectory(scanPath, minBytes, maxDepth);
    files.sort((a, b) => b.size.bytes - a.size.bytes);
    res.json({ files, scanned: scanPath, count: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reveal', (req, res) => {
  const resolved = path.resolve(req.body.filePath || '');
  execFile('open', ['-R', resolved], err => err ? res.status(500).json({ error: err.message }) : res.json({ success: true }));
});

app.delete('/api/delete', (req, res) => {
  const resolved = path.resolve(req.body.filePath || '');
  try {
    const st = fs.statSync(resolved);
    if (st.isDirectory()) return res.status(400).json({ error: 'Cannot delete directories' });
    fs.unlinkSync(resolved);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`\n✅  Disk Cleaner → http://localhost:${PORT}\n`));
