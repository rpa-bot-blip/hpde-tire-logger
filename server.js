'use strict';
const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'server-data');
const CFG_FILE  = path.join(DATA_DIR, 'config.json');
const USR_FILE  = path.join(DATA_DIR, 'users.json');

app.use(express.json());
app.use(express.static(__dirname));

// ---- Persist helpers ----
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---- Config / bootstrap ----
let cfg = readJSON(CFG_FILE, null);

function isConfigured() { return !!(cfg && cfg.ghToken && cfg.jwtSecret); }

// ---- GitHub API helpers ----
async function ghFetch(method, urlPath, body) {
  const url = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}/contents/${urlPath}`;
  const opts = {
    method,
    headers: {
      'Authorization': `token ${cfg.ghToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 404 && method === 'GET') return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `GitHub API error ${res.status}`);
  return { status: res.status, json };
}

async function ghReadData(username) {
  const result = await ghFetch('GET', `data/${username}/data.json`);
  if (!result) return { weekends: [], readings: [], sha: null };
  const content = Buffer.from(result.json.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return { ...JSON.parse(content), sha: result.json.sha };
}

async function ghWriteData(username, weekends, readings, sha) {
  const content = Buffer.from(JSON.stringify({ weekends, readings }, null, 2)).toString('base64');
  const body = { message: `Update tire data for ${username}`, content, branch: cfg.ghBranch };
  if (sha) body.sha = sha;
  try {
    const result = await ghFetch('PUT', `data/${username}/data.json`, body);
    return result.json.content.sha;
  } catch (e) {
    // SHA conflict — refetch and retry once
    if (e.message.includes('sha') || e.message.includes('409')) {
      const fresh = await ghReadData(username);
      body.sha = fresh.sha;
      const result = await ghFetch('PUT', `data/${username}/data.json`, body);
      return result.json.content.sha;
    }
    throw e;
  }
}

// ---- JWT helpers ----
function signToken(payload) {
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: '30d' });
}
function verifyToken(token) {
  return jwt.verify(token, cfg.jwtSecret);
}

// ---- Auth middleware ----
function requireAuth(req, res, next) {
  if (!isConfigured()) return res.status(503).json({ error: 'Server not configured' });
  const header = req.headers.authorization || '';
  const token  = header.replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = verifyToken(token); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// =============================================================
// ROUTES
// =============================================================

// ---- Setup ----
app.get('/api/setup/status', (_req, res) => {
  res.json({ configured: isConfigured() });
});

app.post('/api/setup', async (req, res) => {
  if (isConfigured()) return res.status(409).json({ error: 'Already configured' });
  const { ghToken, ghOwner, ghRepo, ghBranch, adminUsername, adminPin } = req.body;
  if (!ghToken || !adminUsername || !adminPin)
    return res.status(400).json({ error: 'ghToken, adminUsername and adminPin are required' });

  // Validate token against GitHub
  const ghRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!ghRes.ok) return res.status(400).json({ error: 'GitHub token validation failed' });

  const newCfg = {
    ghToken,
    ghOwner:   ghOwner  || 'rpa-bot-blip',
    ghRepo:    ghRepo   || 'hpde-tire-logger',
    ghBranch:  ghBranch || 'main',
    jwtSecret: crypto.randomBytes(32).toString('hex')
  };
  writeJSON(CFG_FILE, newCfg);
  cfg = newCfg;

  const pinHash = await bcrypt.hash(String(adminPin), 10);
  writeJSON(USR_FILE, [{
    username:  adminUsername,
    pinHash,
    isAdmin:   true,
    createdAt: new Date().toISOString()
  }]);

  res.json({ ok: true });
});

// ---- Auth ----
app.post('/api/login', async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'Server not configured' });
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'username and pin required' });

  const users = readJSON(USR_FILE, []);
  const user  = users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid username or PIN' });

  const valid = await bcrypt.compare(String(pin), user.pinHash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or PIN' });

  res.json({
    token:    signToken({ username: user.username, isAdmin: !!user.isAdmin }),
    username: user.username,
    isAdmin:  !!user.isAdmin
  });
});

// ---- User data ----
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const data = await ghReadData(req.user.username);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/data', requireAuth, async (req, res) => {
  const { weekends, readings, sha } = req.body;
  try {
    const newSha = await ghWriteData(req.user.username, weekends || [], readings || [], sha);
    res.json({ sha: newSha });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- User management (admin only) ----
app.get('/api/users', requireAdmin, (_req, res) => {
  const users = readJSON(USR_FILE, []).map(({ username, isAdmin, createdAt }) => ({ username, isAdmin, createdAt }));
  res.json(users);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, pin, isAdmin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'username and pin required' });

  const users = readJSON(USR_FILE, []);
  if (users.find(u => u.username.toLowerCase() === String(username).toLowerCase()))
    return res.status(409).json({ error: 'Username already exists' });

  const pinHash = await bcrypt.hash(String(pin), 10);
  users.push({ username: String(username), pinHash, isAdmin: !!isAdmin, createdAt: new Date().toISOString() });
  writeJSON(USR_FILE, users);
  res.status(201).json({ username: String(username), isAdmin: !!isAdmin });
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === req.user.username) return res.status(400).json({ error: 'Cannot delete your own account' });

  const users    = readJSON(USR_FILE, []);
  const filtered = users.filter(u => u.username !== target);
  if (filtered.length === users.length) return res.status(404).json({ error: 'User not found' });

  writeJSON(USR_FILE, filtered);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\nHPDE Tire Logger  →  http://localhost:${PORT}`);
  if (!isConfigured()) console.log('  First run: open the app in your browser to complete setup.\n');
});
