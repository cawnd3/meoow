/* Meoow Server - аккаунты, профили и синхронизация.
 * Чистый Node.js без внешних зависимостей. Запуск: node server/server.js
 * По умолчанию слушает порт 18700 (переменная окружения MEOOW_PORT).
 * Данные хранятся в server/data/*.json */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = +(process.env.MEOOW_PORT || 18700);
const DATA_DIR = path.resolve(process.env.MEOOW_DATA_DIR || path.join(__dirname, 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 4 * 1024 * 1024;

const PROFILE_COLORS = ['#FF5E62', '#FFB020', '#8B5CF6', '#14B8A6', '#38BDF8', '#F472B6', '#3B82F6', '#10B981'];

// ---------- tiny db ----------
function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('db read error', file, e.message); }
  return fallback;
}
function writeDb(db) {
  ensureDir();
  fs.writeFileSync(db.file, JSON.stringify(db.data, null, 2));
}
function loadDb(db) {
  ensureDir();
  db.data = readJson(db.file, db.initial);
  return db;
}
const usersDb = { file: USERS_FILE, initial: {} };
const sessionsDb = { file: SESSIONS_FILE, initial: {} };
const profilesDb = { file: PROFILES_FILE, initial: {} };
loadDb(usersDb); loadDb(sessionsDb); loadDb(profilesDb);

function cleanExpiredSessions() {
  const now = Date.now();
  for (const k in sessionsDb.data) {
    if (sessionsDb.data[k].expiresAt < now) delete sessionsDb.data[k];
  }
}
cleanExpiredSessions();

// ---------- crypto helpers ----------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return { salt, hash };
}
function checkHash(pin, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pin), salt, 64).toString('hex');
    return h === hash;
  } catch (e) { return false; }
}
function newId(prefix) {
  return prefix + crypto.randomBytes(12).toString('hex');
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------- helpers ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Meoow-Pin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
function authUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const s = sessionsDb.data[token];
  if (!s || s.expiresAt < Date.now()) return null;
  const u = usersDb.data[s.userId];
  if (!u) return null;
  return { token, user: u };
}
function meta(pid) {
  const p = profilesDb.data[pid];
  if (!p) return null;
  return { id: p.id, name: p.name, color: p.color, email: p.userEmail, hasPin: !!p.pinHash, updatedAt: p.updatedAt };
}
function findUserByEmail(email) {
  const e = String(email || '').toLowerCase();
  for (const id in usersDb.data) {
    if (usersDb.data[id].email === e) return usersDb.data[id];
  }
  return null;
}

// ---------- Meoow Search public API (мобильные/внешние клиенты) ----------
const SEARCH_TIMEOUT_MS = 8000;
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}
function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function realUrlFromLink(href) {
  if (!href) return null;
  const uddg = href.match(/[?&]uddg=([^&]+)/);
  if (uddg) { try { return decodeURIComponent(uddg[1]); } catch (e) {} }
  return href;
}
function parseBingRss(html) {
  const results = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(html))) {
    const block = m[1];
    const t = block.match(/<title>([\s\S]*?)<\/title>/i);
    const l = block.match(/<link>([\s\S]*?)<\/link>/i);
    const d = block.match(/<description>([\s\S]*?)<\/description>/i);
    const tags = /<\/?[a-z][^>]*>/gi;
    const title = t ? stripHtml(decodeEntities(t[1].replace(tags, ''))) : '';
    const url = l ? decodeEntities(l[1]).replace(tags, '').trim() : '';
    const snippet = d ? stripHtml(decodeEntities(d[1].replace(tags, ''))) : '';
    if (url && title && /^https?:\/\//i.test(url)) results.push({ title, url, snippet });
  }
  return results;
}
function parseBing(html) {
  const results = [];
  const liRe = /<li class="b_algo"[\s\S]*?<\/li>/gi;
  let m;
  while ((m = liRe.exec(html))) {
    const block = m[0];
    const a = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let url = a[1];
    if (/^https?:\/\//i.test(url) && url.indexOf('bing.com/ck/a') !== -1) {
      const u = url.match(/[?&]u=a1([^&]+)/);
      if (u) {
        try {
          const b64 = u[1].replace(/-/g, '+').replace(/_/g, '/');
          url = Buffer.from(b64, 'base64').swap16().toString('utf16le');
        } catch (e) {}
      }
    }
    const title = stripHtml(decodeEntities(a[2]));
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = p ? stripHtml(decodeEntities(p[1])) : '';
    if (url.indexOf('bing.com') === -1 && title && /^https?:\/\//i.test(url)) results.push({ title, url, snippet });
  }
  return results;
}
function parseMojeek(html) {
  const results = [];
  const liRe = /<li[^>]*>[\s\S]*?<\/li>/gi;
  let m;
  while ((m = liRe.exec(html))) {
    const block = m[0];
    if (block.indexOf('results-standard') === -1 && block.indexOf('class="title"') === -1) continue;
    const a = block.match(/<a[^>]+class="title"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = a[1];
    const title = stripHtml(decodeEntities(a[2]));
    const p = block.match(/<p[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = p ? stripHtml(decodeEntities(p[1])) : '';
    if (title && /^https?:\/\//i.test(url)) results.push({ title, url, snippet });
  }
  return results;
}
function parseDuckDuckGo(html) {
  const titles = [];
  const snippets = [];
  const anchorRe = /<a[^>]+class="[^"]*result__(a|snippet)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const hrefRe = /href="([^"]+)"/;
  let m;
  while ((m = anchorRe.exec(html))) {
    const isTitle = m[1] === 'a';
    const hrefMatch = (m[0].match(hrefRe) || [])[1];
    const text = stripHtml(decodeEntities(m[2]));
    (isTitle ? titles : snippets).push({ text, url: realUrlFromLink(hrefMatch) });
  }
  const results = [];
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    if (!t.url || !t.text || !/^https?:\/\//i.test(t.url)) continue;
    results.push({ title: t.text, url: t.url, snippet: snippets[i] ? snippets[i].text : '' });
  }
  return results;
}
const SEARCH_BACKENDS = {
  bingrss: { url: (q) => 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q), parse: parseBingRss },
  bing: { url: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q), parse: parseBing },
  mojeek: { url: (q) => 'https://www.mojeek.com/search?q=' + encodeURIComponent(q), parse: parseMojeek },
  duckduckgo: { url: (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), parse: parseDuckDuckGo },
};
const SEARCH_ORDER = ['bingrss', 'duckduckgo', 'mojeek', 'bing'];
async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}
async function meoowSearch(query) {
  if (!query || typeof query !== 'string') return { ok: false, results: [], error: 'Пустой запрос' };
  query = query.slice(0, 300);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'ru,en;q=0.8',
  };
  const seen = {};
  const merged = [];
  const sources = [];
  await Promise.all(SEARCH_ORDER.map(async (key) => {
    const b = SEARCH_BACKENDS[key];
    try {
      const res = await fetchWithTimeout(b.url(query), { headers, redirect: 'follow' });
      if (!res.ok) return;
      const html = await res.text();
      const list = b.parse(html);
      let cnt = 0;
      for (const r of list) {
        if (!r || !r.title || !r.url || !/^https?:\/\//i.test(r.url)) continue;
        const k = r.url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
        if (!k || seen[k]) continue;
        seen[k] = true;
        merged.push(r);
        cnt++;
      }
      if (cnt) sources.push(key);
    } catch (e) {}
  }));
  if (!merged.length) return { ok: false, source: null, results: [], error: 'нет результатов' };
  const names = { bingrss: 'Bing', duckduckgo: 'DuckDuckGo', mojeek: 'Mojeek', bing: 'Bing' };
  const src = sources.map(s => names[s] || s).filter((v, i, a) => a.indexOf(v) === i);
  return { ok: true, source: 'Meoow · ' + src.join(' + '), results: merged.slice(0, 20) };
}
async function meoowSuggest(query) {
  if (!query || typeof query !== 'string') return [];
  query = query.trim().slice(0, 200);
  if (!query) return [];
  try {
    const res = await fetchWithTimeout('https://www.bing.com/osjson.aspx?query=' + encodeURIComponent(query), { headers: { 'User-Agent': 'Meoow/1.0' } });
    if (res.ok) {
      const data = await res.json();
      const arr = Array.isArray(data) ? data[1] : [];
      if (Array.isArray(arr) && arr.length) return arr.filter(Boolean).slice(0, 8);
    }
  } catch (e) {}
  try {
    const res = await fetchWithTimeout('https://duckduckgo.com/ac/?q=' + encodeURIComponent(query), { headers: { 'User-Agent': 'Meoow/1.0' } });
    if (res.ok) {
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map(x => (x && x.phrase) || '').filter(Boolean).slice(0, 8);
    }
  } catch (e) {}
  return [];
}
function levenshtein(a, b) {
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const SCAM_BRANDS = ['paypal', 'google', 'facebook', 'instagram', 'whatsapp', 'telegram', 'apple', 'microsoft', 'amazon', 'binance', 'sberbank', 'aliexpress', 'github', 'netflix', 'ebay'];
function checkScamUrl(raw) {
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return { suspicious: false }; }
  const parts = host.split(/[.\-]/);
  for (const part of parts) {
    if (!part || part.length < 3) continue;
    for (const brand of SCAM_BRANDS) {
      if (part === brand) continue;
      if (part.indexOf(brand) !== -1 && part !== brand) return { suspicious: true, reason: 'Подозрительное имя ' + host };
      if (Math.abs(part.length - brand.length) <= 2 && levenshtein(part, brand) <= 2)
        return { suspicious: true, reason: 'Похоже на подделку под ' + brand + ' (' + host + ')' };
    }
  }
  return { suspicious: false };
}

// ---------- request log ----------
function log(method, pathName, status, ms) {
  console.log(`[meoow-server] ${new Date().toISOString()} ${method} ${pathName} -> ${status} (${ms}ms)`);
}

// ---------- router ----------
function route(req, res) {
  const start = Date.now();
  const u = new URL(req.url, 'http://x');
  const pathName = u.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const respond = (status, obj) => { send(res, status, obj); log(method, pathName, status, Date.now() - start); };

  // CORS preflight
  if (method === 'OPTIONS') { respond(204, {}); return; }

  // Health
  if (pathName === '/api/health') { respond(200, { ok: true, name: 'meoow-server' }); return; }

  // Search (public)
  if (pathName === '/api/search' && method === 'GET') {
    const q = u.searchParams.get('q') || '';
    const mode = u.searchParams.get('mode') || 'web';
    if (!q) { respond(400, { ok: false, error: 'Пустой запрос' }); return; }
    if (mode !== 'web') { respond(200, { ok: false, error: 'Пока доступен только режим "web"', mode, results: [] }); return; }
    meoowSearch(q).then((r) => respond(200, r));
    return;
  }

  // Suggest (public)
  if (pathName === '/api/suggest' && method === 'GET') {
    const q = u.searchParams.get('q') || '';
    meoowSuggest(q).then((list) => respond(200, { phrases: list }));
    return;
  }

  // Scam check (public)
  if (pathName === '/api/scam' && method === 'GET') {
    const url = u.searchParams.get('url') || '';
    respond(200, Object.assign({ url }, checkScamUrl(url)));
    return;
  }

  // Register
  if (pathName === '/api/register' && method === 'POST') {
    readBody(req).then(async (b) => {
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const name = String(b.name || '').trim().slice(0, 60) || 'Мой профиль';
      if (!EMAIL_RE.test(email)) return respond(400, { error: 'Неверный формат почты.' });
      if (password.length < 6) return respond(400, { error: 'Пароль должен быть не короче 6 символов.' });
      if (findUserByEmail(email)) return respond(409, { error: 'Пользователь с такой почтой уже зарегистрирован.' });
      const uid = newId('u_');
      usersDb.data[uid] = { id: uid, email, passwordSalt: null, createdAt: Date.now() };
      usersDb.data[uid].passwordSalt = crypto.randomBytes(16).toString('hex');
      usersDb.data[uid].passwordHash = crypto.scryptSync(password, usersDb.data[uid].passwordSalt, 64).toString('hex');
      const pid = newId('p_');
      profilesDb.data[pid] = {
        id: pid, userId: uid, name, color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
        userEmail: email, pinSalt: null, pinHash: null, updatedAt: Date.now(),
        settings: {}, bookmarks: [], history: [],
      };
      const token = makeToken();
      sessionsDb.data[token] = { userId: uid, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
      writeDb(usersDb); writeDb(profilesDb); writeDb(sessionsDb);
      respond(200, { token, user: { id: uid, email }, profile: meta(pid) });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Login
  if (pathName === '/api/login' && method === 'POST') {
    readBody(req).then((b) => {
      if (b.codeFlow) {
        const code = String(b.code || '');
        if (!code) return respond(400, { error: 'Введите код.' });
        const target = codesDb.data[code];
        if (!target || target.expiresAt < Date.now()) return respond(400, { error: 'Неверный или истёкший код.' });
        delete codesDb.data[code]; writeDb(codesDb);
        return createSessionAndRespond(respond, target.email);
      }
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const user = findUserByEmail(email);
      if (!user || !user.passwordHash) return respond(401, { error: 'Неверная почта или пароль.' });
      const h = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
      if (h !== user.passwordHash) return respond(401, { error: 'Неверная почта или пароль.' });
      createSessionAndRespond(respond, email);
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Logout
  if (pathName === '/api/logout' && method === 'POST') {
    const a = authUser(req);
    if (a) { delete sessionsDb.data[a.token]; writeDb(sessionsDb); }
    respond(200, { ok: true });
    return;
  }

  // Me
  if (pathName === '/api/me' && method === 'GET') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    const profiles = [];
    for (const pid in profilesDb.data) {
      if (profilesDb.data[pid].userId === a.user.id) profiles.push(meta(pid));
    }
    respond(200, { user: { id: a.user.id, email: a.user.email }, profiles });
    return;
  }

  // Create profile
  if (pathName === '/api/profiles' && method === 'POST') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    readBody(req).then((b) => {
      const pid = newId('p_');
      profilesDb.data[pid] = {
        id: pid, userId: a.user.id,
        name: String(b.name || '').trim().slice(0, 60) || 'Новый профиль',
        color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
        userEmail: a.user.email, pinSalt: null, pinHash: null, updatedAt: Date.now(),
        settings: {}, bookmarks: [], history: [],
      };
      writeDb(profilesDb);
      respond(200, { profile: meta(pid) });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Set / change PIN
  if (pathName === '/api/pin' && method === 'POST') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    readBody(req).then((b) => {
      const p = profilesDb.data[String(b.profileId || '')];
      if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
      const pin = String(b.pin || '');
      const clearing = pin === '';
      if (!clearing && !/^\d{4,8}$/.test(pin)) return respond(400, { error: 'PIN должен быть из 4–8 цифр.' });
      if (p.pinHash) {
        const old = String(b.oldPin || '');
        if (!checkHash(old, p.pinSalt, p.pinHash)) return respond(403, { error: 'Текущий PIN указан неверно.' });
      }
      if (clearing) {
        p.pinSalt = null; p.pinHash = null; p.updatedAt = Date.now();
        writeDb(profilesDb);
        return respond(200, { ok: true, hasPin: false });
      }
      const { salt, hash } = hashPin(pin);
      p.pinSalt = salt; p.pinHash = hash; p.updatedAt = Date.now();
      writeDb(profilesDb);
      respond(200, { ok: true, hasPin: true });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Verify PIN
  if (pathName === '/api/pin/verify' && method === 'POST') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    readBody(req).then((b) => {
      const p = profilesDb.data[String(b.profileId || '')];
      if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
      if (!p.pinHash) return respond(200, { ok: true });
      const pin = String(b.pin || '');
      if (!checkHash(pin, p.pinSalt, p.pinHash)) return respond(403, { error: 'Неверный PIN.' });
      respond(200, { ok: true });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Rename profile
  let m2 = pathName.match(/^\/api\/profiles\/([\w-]+)\/rename$/);
  if (m2 && method === 'POST') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    const p = profilesDb.data[m2[1]];
    if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
    readBody(req).then((b) => {
      const name = String(b.name || '').trim().slice(0, 60);
      if (name) { p.name = name; p.updatedAt = Date.now(); writeDb(profilesDb); }
      respond(200, { ok: true, profile: meta(p.id) });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Delete profile
  let m3 = pathName.match(/^\/api\/profiles\/([\w-]+)$/);
  if (m3 && method === 'DELETE') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    const p = profilesDb.data[m3[1]];
    if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
    delete profilesDb.data[m3[1]];
    writeDb(profilesDb);
    respond(200, { ok: true });
    return;
  }

  // Profile data GET
  let m = pathName.match(/^\/api\/profiles\/([\w-]+)\/data$/);
  if (m && method === 'GET') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    const p = profilesDb.data[m[1]];
    if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
    if (p.pinHash) {
      const pin = String(req.headers['x-meoow-pin'] || '');
      if (!checkHash(pin, p.pinSalt, p.pinHash)) return respond(403, { error: 'Профиль защищён PIN-кодом.' });
    }
    respond(200, {
      id: p.id, updatedAt: p.updatedAt,
      settings: p.settings || {}, bookmarks: p.bookmarks || [], history: p.history || [],
    });
    return;
  }

  // Profile data PUT (sync push)
  if (m && method === 'PUT') {
    const a = authUser(req);
    if (!a) return respond(401, { error: 'Требуется вход.' });
    const p = profilesDb.data[m[1]];
    if (!p || p.userId !== a.user.id) return respond(404, { error: 'Профиль не найден.' });
    readBody(req).then((b) => {
      if (b && typeof b === 'object') {
        if (b.settings && typeof b.settings === 'object') p.settings = b.settings;
        if (Array.isArray(b.bookmarks)) p.bookmarks = b.bookmarks;
        if (Array.isArray(b.history)) p.history = b.history;
        p.updatedAt = Date.now();
        writeDb(profilesDb);
      }
      respond(200, { ok: true, updatedAt: p.updatedAt });
    }).catch((e) => respond(400, { error: 'Ошибка запроса: ' + e.message }));
    return;
  }

  // Dev: активные пользователи (только с localhost)
  if (pathName === '/api/dev/active' && method === 'GET') {
    const ip = req.socket.remoteAddress || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      respond(403, { error: 'Раздел разработчика доступен только с localhost.' });
      return;
    }
    const now = Date.now();
    const users = [];
    const seen = {};
    for (const token in sessionsDb.data) {
      const s = sessionsDb.data[token];
      if (!s || s.expiresAt < now || !usersDb.data[s.userId]) continue;
      if (seen[s.userId]) continue;
      seen[s.userId] = true;
      const profiles = [];
      for (const pid in profilesDb.data) {
        const p = profilesDb.data[pid];
        if (p.userId !== s.userId) continue;
        profiles.push({ name: p.name, color: p.color, hasPin: !!p.pinHash, updatedAt: p.updatedAt });
      }
      users.push({
        id: s.userId,
        email: usersDb.data[s.userId].email,
        tokenPrefix: token.slice(0, 8),
        createdAt: s.createdAt || (s.expiresAt - SESSION_TTL_MS),
        expiresAt: s.expiresAt,
        profiles,
      });
    }
    users.sort((a, b) => b.createdAt - a.createdAt);
    respond(200, {
      ok: true,
      now,
      activeCount: users.length,
      totalUsers: Object.keys(usersDb.data).length,
      server: { port: PORT, dataDir: DATA_DIR },
      users,
    });
    return;
  }

  respond(404, { error: 'Не найдено.' });
}

// ---------- code (email magic-link-ish flow, dev) ----------
const codesDb = { file: path.join(DATA_DIR, 'codes.json'), initial: {} };
loadDb(codesDb);

function createSessionAndRespond(respond, email) {
  const user = findUserByEmail(email);
  const token = makeToken();
  sessionsDb.data[token] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  writeDb(sessionsDb);
  const profiles = [];
  for (const pid in profilesDb.data) {
    if (profilesDb.data[pid].userId === user.id) profiles.push(meta(pid));
  }
  respond(200, { token, user: { id: user.id, email: user.email }, profiles });
}

const server = http.createServer((req, res) => {
  try {
    route(req, res);
  } catch (e) {
    console.error('[meoow-server] error:', e);
    send(res, 500, { error: 'Внутренняя ошибка сервера.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[meoow-server] слушаю http://0.0.0.0:${PORT}`);
});

module.exports = { server }; // для тестов