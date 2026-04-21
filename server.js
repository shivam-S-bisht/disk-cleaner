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

function classifyFile(filePath) {
  const l = filePath.toLowerCase();
  const ext = path.extname(l);
  if (/^\/system\/|^\/usr\/|^\/bin\/|^\/sbin\/|\/library\/preferences\/|\/library\/keychains\/|\.app\/|\.framework\//.test(l)) return { level: 'danger', reason: 'System file' };
  if (['.dylib','.so','.a','.kext','.plist'].includes(ext)) return { level: 'danger', reason: 'System binary' };
  if (/\/library\/caches\/|\/library\/logs\/|\/tmp\/|\/private\/tmp\/|\/downloads\//.test(l)) return { level: 'safe', reason: 'Cache / temp / download' };
  if (['.log','.tmp','.temp','.cache','.bak','.old'].includes(ext)) return { level: 'safe', reason: 'Temp file' };
  if (['.dmg','.pkg'].includes(ext)) return { level: l.includes('/downloads/') ? 'safe' : 'review', reason: 'Installer' };
  if (['.zip','.tar','.gz','.bz2','.rar','.7z'].includes(ext)) return { level: l.includes('/downloads/') ? 'safe' : 'review', reason: 'Archive' };
  if (/\/documents\/|\/desktop\/|\/movies\/|\/music\/|\/pictures\//.test(l)) return { level: 'review', reason: 'Personal file' };
  if (['.mp4','.mov','.mkv','.mp3','.flac','.jpg','.jpeg','.png','.pdf','.docx','.xlsx'].includes(ext)) return { level: 'review', reason: 'Media / document' };
  return { level: 'review', reason: 'Verify before deleting' };
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
          results.push({ name: e.name, path: fp, size: fmtSize(st.size), modified: st.mtime.toISOString(), type: 'file', safety: classifyFile(fp) });
        }
      } catch {}
    } else if (e.isDirectory() && depth < maxDepth && !shouldSkip(fp)) {
      const sub = await scanDirectory(fp, minBytes, maxDepth, depth + 1);
      results.push(...sub);
    }
  }
  return results;
}

function buildTree(dirPath, minBytes, maxDepth, depth = 0) {
  const node = { name: path.basename(dirPath) || dirPath, path: dirPath, type: 'dir', size: 0, children: [] };
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return node; }

  for (const e of entries) {
    const fp = path.join(dirPath, e.name);
    if (e.isFile()) {
      try {
        const st = fs.statSync(fp);
        if (st.size >= minBytes) {
          node.children.push({ name: e.name, path: fp, type: 'file', size: st.size, modified: st.mtime.toISOString(), safety: classifyFile(fp) });
          node.size += st.size;
        }
      } catch {}
    } else if (e.isDirectory() && depth < maxDepth && !shouldSkip(fp)) {
      const child = buildTree(fp, minBytes, maxDepth, depth + 1);
      if (child.size > 0) { node.children.push(child); node.size += child.size; }
    }
  }
  return node;
}

app.get('/api/tree', (req, res) => {
  const scanPath = path.resolve(req.query.path || os.homedir());
  const minBytes = (parseFloat(req.query.minMB) || 10) * 1024 * 1024;
  const maxDepth = parseInt(req.query.maxDepth) || 6;
  if (!fs.existsSync(scanPath)) return res.status(400).json({ error: 'Path does not exist' });
  try { res.json(buildTree(scanPath, minBytes, maxDepth)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

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
  } catch (e) {
    // Signal permission errors separately so the UI can offer trash fallback
    const needsAuth = e.code === 'EACCES' || e.code === 'EPERM';
    res.status(needsAuth ? 403 : 500).json({ error: e.message, needsAuth });
  }
});

// Move to Trash via osascript — triggers macOS Touch ID / password dialog
app.post('/api/trash', (req, res) => {
  const resolved = path.resolve(req.body.filePath || '');
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  // AppleScript: move to Trash (macOS handles auth natively)
  const script = `tell application "Finder" to delete POSIX file "${resolved.replace(/"/g, '\\"')}"`;
  execFile('osascript', ['-e', script], (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ success: true, trashed: true });
  });
});

app.listen(PORT, () => console.log(`\n✅  Disk Cleaner → http://localhost:${PORT}\n`));
