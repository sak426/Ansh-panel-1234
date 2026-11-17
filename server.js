const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

require('dotenv').config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.PANEL_DATA || './data');
const SERVERS_DIR = path.resolve(process.env.SERVERS_DIR || './servers');
const DB_FILE = path.join(DATA_DIR, 'panel.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SERVERS_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: [], servers: [] }; }
}
function writeDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
let db = readDB();
if (!db.users.some(u => u.username === (process.env.ADMIN_USERNAME || 'admin'))) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.users.push({ id: crypto.randomUUID(), username, passwordHash: bcrypt.hashSync(password, 12), role: 'admin', servers: [] });
  writeDB(db);
  console.log(`Created admin account "${username}". Change the default password in .env.`);
}
const children = new Map();
const logs = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'ansh.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: path.join(DATA_DIR, 'uploads'),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.jar'))
});

function currentUser(req) { return db.users.find(u => u.id === req.session.userId); }
function auth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user; next();
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function canAccess(user, server) {
  return user.role === 'admin' || (server.users || []).includes(user.id);
}
function safeServerDir(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid server ID');
  return path.join(SERVERS_DIR, id);
}
function getServer(req, res, id) {
  const server = db.servers.find(s => s.id === id);
  if (!server || !canAccess(req.user, server)) { res.status(404).json({ error: 'Server not found.' }); return null; }
  return server;
}
function addLog(id, line) {
  const arr = logs.get(id) || [];
  arr.push({ time: new Date().toISOString(), line: String(line).slice(0, 2000) });
  if (arr.length > 300) arr.shift();
  logs.set(id, arr);
}
function publicServer(s) {
  return { ...s, running: children.has(s.id), jarUploaded: fs.existsSync(path.join(safeServerDir(s.id), 'server.jar')) };
}

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? { id: u.id, username: u.username, role: u.role } : null });
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username === String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.passwordHash)) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    req.session.userId = user.id;
    res.json({ ok: true, user: { username: user.username, role: user.role } });
  });
});
app.post('/api/logout', auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/dashboard', auth, (req, res) => {
  const visible = db.servers.filter(s => canAccess(req.user, s)).map(publicServer);
  const mem = process.memoryUsage();
  res.json({
    servers: visible,
    stats: { total: visible.length, running: visible.filter(s => s.running).length,
      stopped: visible.filter(s => !s.running).length,
      ramUsedMB: Math.round(mem.rss / 1048576), ramTotalMB: Math.round(os.totalmem() / 1048576),
      cpuCores: os.cpus().length, uptime: Math.floor(os.uptime()) }
  });
});

app.post('/api/servers', auth, admin, (req, res) => {
  const { name, port, ram, software, eula } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 40);
  const p = Number(port), r = Number(ram);
  if (!cleanName || !Number.isInteger(p) || p < 1024 || p > 65535 || !Number.isInteger(r) || r < 512 || r > 131072)
    return res.status(400).json({ error: 'Enter a name, port (1024–65535), and RAM (512–131072 MB).' });
  if (db.servers.some(s => s.port === p)) return res.status(409).json({ error: 'That port is already assigned in this panel.' });
  const id = crypto.randomUUID(), dir = safeServerDir(id);
  fs.mkdirSync(dir, { recursive: true });
  if (eula === true) fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  const server = { id, name: cleanName, port: p, ram: r, software: String(software || 'Paper').slice(0, 30), users: [], createdAt: new Date().toISOString() };
  db.servers.push(server); writeDB(db);
  res.json({ ok: true, server: publicServer(server) });
});

app.post('/api/servers/:id/jar', auth, admin, upload.single('jar'), (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  if (children.has(s.id)) return res.status(409).json({ error: 'Stop the server before replacing its JAR.' });
  if (!req.file) return res.status(400).json({ error: 'Upload a .jar file.' });
  const dest = path.join(safeServerDir(s.id), 'server.jar');
  fs.renameSync(req.file.path, dest);
  res.json({ ok: true });
});

app.post('/api/servers/:id/eula', auth, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  if (req.body.accept !== true) return res.status(400).json({ error: 'EULA acceptance is required.' });
  fs.writeFileSync(path.join(safeServerDir(s.id), 'eula.txt'), 'eula=true\n');
  res.json({ ok: true });
});

app.post('/api/servers/:id/start', auth, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  if (children.has(s.id)) return res.status(409).json({ error: 'Server is already running.' });
  const dir = safeServerDir(s.id), jar = path.join(dir, 'server.jar');
  if (!fs.existsSync(jar)) return res.status(400).json({ error: 'Upload server.jar first.' });
  const eulaPath = path.join(dir, 'eula.txt');
  if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true'))
    return res.status(400).json({ error: 'Accept the Minecraft EULA first.' });
  const child = spawn('java', [`-Xms256M`, `-Xmx${s.ram}M`, '-jar', 'server.jar', 'nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  children.set(s.id, child); addLog(s.id, 'Starting server process...');
  child.stdout.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(x => addLog(s.id, x)));
  child.stderr.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(x => addLog(s.id, x)));
  child.on('error', e => { addLog(s.id, `Process error: ${e.message}`); children.delete(s.id); });
  child.on('exit', code => { addLog(s.id, `Server stopped (exit ${code}).`); children.delete(s.id); });
  res.json({ ok: true });
});
app.post('/api/servers/:id/stop', auth, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  const child = children.get(s.id);
  if (!child) return res.status(409).json({ error: 'Server is not running.' });
  child.stdin.write('stop\n'); res.json({ ok: true });
});
app.post('/api/servers/:id/command', auth, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  const child = children.get(s.id);
  const command = String(req.body.command || '').trim();
  if (!child) return res.status(409).json({ error: 'Server is not running.' });
  if (!command || command.length > 500 || /[\r\n]/.test(command)) return res.status(400).json({ error: 'Invalid command.' });
  child.stdin.write(command + '\n'); res.json({ ok: true });
});
app.get('/api/servers/:id/logs', auth, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  res.json({ logs: logs.get(s.id) || [] });
});
app.delete('/api/servers/:id', auth, admin, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  if (children.has(s.id)) return res.status(409).json({ error: 'Stop the server before deleting it.' });
  db.servers = db.servers.filter(x => x.id !== s.id); writeDB(db);
  fs.rmSync(safeServerDir(s.id), { recursive: true, force: true });
  res.json({ ok: true });
});
app.get('/api/users', auth, admin, (_req, res) => res.json({ users: db.users.map(u => ({ id: u.id, username: u.username, role: u.role, servers: u.servers })) }));
app.post('/api/users', auth, admin, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username) || password.length < 10) return res.status(400).json({ error: 'Username: 3–24 letters/numbers/_/-. Password: at least 10 characters.' });
  if (db.users.some(u => u.username === username)) return res.status(409).json({ error: 'Username already exists.' });
  const user = { id: crypto.randomUUID(), username, passwordHash: bcrypt.hashSync(password, 12), role: 'user', servers: [] };
  db.users.push(user); writeDB(db); res.json({ ok: true });
});
app.post('/api/servers/:id/assign/:userId', auth, admin, (req, res) => {
  const s = getServer(req, res, req.params.id); if (!s) return;
  const u = db.users.find(x => x.id === req.params.userId && x.role === 'user');
  if (!u) return res.status(404).json({ error: 'User not found.' });
  s.users = s.users || []; if (!s.users.includes(u.id)) s.users.push(u.id); writeDB(db); res.json({ ok: true });
});
app.get('/api/system', auth, (_req, res) => {
  const total = os.totalmem(), free = os.freemem();
  res.json({ hostname: os.hostname(), platform: os.platform(), uptime: os.uptime(),
    cpu: os.cpus().length, ramTotal: total, ramFree: free,
    load: os.loadavg(), diskNote: 'Disk usage is not yet collected in this MVP.' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`ANSH Panel running on http://0.0.0.0:${PORT}`));
process.on('SIGINT', () => { for (const child of children.values()) child.kill('SIGTERM'); process.exit(0); });
