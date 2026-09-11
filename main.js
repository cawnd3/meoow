const { app, BrowserWindow, ipcMain, session, dialog, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

if (process.env.MEOOW_USER_DATA) {
  app.setPath('userData', process.env.MEOOW_USER_DATA);
}

const USER_DATA_DIR = path.join(app.getPath('userData'), 'meoow-data');
const PROFILES_DIR = path.join(USER_DATA_DIR, 'p');
const PROFILES_INDEX_FILE = path.join(USER_DATA_DIR, 'profiles.json');
const ACCOUNT_FILE = path.join(USER_DATA_DIR, 'account.json');
const DEFAULT_SERVER_URL = 'http://127.0.0.1:18700';
let BOOKMARKS_FILE = path.join(USER_DATA_DIR, 'bookmarks.json');
let HISTORY_FILE = path.join(USER_DATA_DIR, 'history.json');
let SETTINGS_FILE = path.join(USER_DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = { searchEngine: 'auto', newTabPage: 'search', zoom: 100, theme: 'light', customBg: '#f6eee0', customAccent: '#c7410f', lang: 'ru', customScrollbar: true, darkSites: false, scamProtection: true, blockNotifications: false, aiFreeChat: true, aiEndpoint: '', aiKey: '', aiModel: '' };
const VALID_SEARCH_ENGINES = ['auto', 'duckduckgo', 'bing', 'lite', 'google', 'yandex'];
const VALID_LANGS = ['ru','en','uk','be','pl','de','fr','es','it','pt','nl','sv','fi','cs','hu','ro','bg','tr','el','ar','he','zh','ja','ko','hi','vi','th','id'];
const VALID_THEMES = ['light', 'dark', 'ocean', 'forest', 'rose', 'midnight', 'custom'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampSettings(raw) {
  const out = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  if (VALID_SEARCH_ENGINES.indexOf(out.searchEngine) === -1) out.searchEngine = 'auto';
  if (!['search', 'blank'].includes(out.newTabPage)) out.newTabPage = 'search';
  const z = +out.zoom;
  out.zoom = [100, 110, 125, 150].includes(z) ? z : 100;
  if (VALID_THEMES.indexOf(out.theme) === -1) out.theme = 'light';
  out.customBg = HEX_RE.test(out.customBg) ? out.customBg : '#f6eee0';
  out.customAccent = HEX_RE.test(out.customAccent) ? out.customAccent : '#c7410f';
  if (VALID_LANGS.indexOf(out.lang) === -1) out.lang = 'ru';
  out.customScrollbar = raw.customScrollbar !== false;
  out.darkSites = raw.darkSites === true;
  out.scamProtection = raw.scamProtection !== false;
  out.aiFreeChat = raw.aiFreeChat !== false;
  out.blockNotifications = raw.blockNotifications === true;
  out.aiEndpoint = typeof raw.aiEndpoint === 'string' ? raw.aiEndpoint.slice(0, 500) : '';
  out.aiKey = typeof raw.aiKey === 'string' ? raw.aiKey.slice(0, 512) : '';
  out.aiModel = typeof raw.aiModel === 'string' ? raw.aiModel.slice(0, 120) : '';
  return out;
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) { console.error('readJson error', file, e); }
  return fallback;
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) { console.error('writeJson error', file, e); }
}

// ---------- Search backend (Meoow Search) ----------
const SEARCH_TIMEOUT_MS = 9000;

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
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

async function fetchWithTimeout(url, opts = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
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

function parseDuckDuckGoLite(html) {
  const titles = [];
  const snippets = [];
  const titleRe = /<a rel="nofollow" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td class="result-snippet">([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = titleRe.exec(html))) {
    const url = realUrlFromLink(m[1]);
    const text = stripHtml(decodeEntities(m[2]));
    if (url && text) titles.push({ url, text });
  }
  while ((m = snippetRe.exec(html))) snippets.push(stripHtml(decodeEntities(m[1])));
  const results = [];
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    if (!/^https?:\/\//i.test(t.url)) continue;
    results.push({ title: t.text, url: t.url, snippet: snippets[i] || '' });
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
    if (title && /^https?:\/\//i.test(url)) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function parseYahoo(html) {
  const results = [];
  const parts = html.split(/<div[^>]+class="dd algo/gi).slice(1);
  for (const part of parts) {
    const block = part.slice(0, 6000);
    const a = block.match(/<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = a[1];
    const title = stripHtml(decodeEntities(a[2]));
    const p = block.match(/class="compText"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)
      || block.match(/class="compText"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = p ? stripHtml(decodeEntities(p[1])) : '';
    if (title && /^https?:\/\//i.test(url)) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function parseGoogle(html) {
  const results = [];
  const parts = html.split(/<div[^>]+class="[^"]*g[^"]*"/gi).slice(1);
  for (const part of parts) {
    const block = part.slice(0, 4000);
    const h = block.match(/<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    if (!h) continue;
    let url = h[1];
    if (url.indexOf('/url?') === 0) {
      const q = url.match(/[?&]q=([^&]+)/);
      if (q) { try { url = decodeURIComponent(q[1]); } catch (e) {} }
    }
    const title = stripHtml(decodeEntities(h[2]));
    const sn = block.match(/<div[^>]+class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || block.match(/<span[^>]+class="[^"]*aCOpRe[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const snippet = sn ? stripHtml(decodeEntities(sn[1])) : '';
    if (title && url && /^https?:\/\//i.test(url) && url.indexOf('google.com/') === -1) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function parseYandex(html) {
  const results = [];
  const items = html.split(/<li[^>]+class="[^"]*serp-item[^"]*"/gi).slice(1);
  for (const item of items) {
    const chunk = item.slice(0, 4000);
    const a = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]+class="[^"]*link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    if (url.indexOf('/url?') === 0) {
      const u = decodeEntities(url).match(/(?:^|[?&])url=([^&]+)/);
      if (u) { try { url = decodeURIComponent(u[1]); } catch (e) {} }
    }
    const title = stripHtml(decodeEntities(a[2]));
    const sn = chunk.match(/class="[^"]*OrganicTextContentSpan[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    let snippet = sn ? stripHtml(decodeEntities(sn[1])) : '';
    if (snippet.length > 220) snippet = snippet.slice(0, 220);
    if (title && !/yandex/.test(url) && /^https?:\/\//i.test(url)) {
      results.push({ title, url, snippet });
    }
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
          const buf = Buffer.from(b64, 'base64');
          url = buf.swap16().toString('utf16le');
        } catch (e) {}
      }
    }
    const title = stripHtml(decodeEntities(a[2]));
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = p ? stripHtml(decodeEntities(p[1])) : '';
    if (url.indexOf('bing.com') === -1 && title && /^https?:\/\//i.test(url)) {
      results.push({ title, url, snippet });
    }
  }
  return results;
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
    let snippet = d ? stripHtml(decodeEntities(d[1].replace(tags, ''))) : '';
    if (url && title && /^https?:\/\//i.test(url)) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

const UA_YA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_BACKENDS = {
  bingrss: { name: 'Bing', url: (q) => 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q), parse: parseBingRss },
  bing: { name: 'Bing', url: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q), parse: parseBing },
  duckduckgo: { name: 'DuckDuckGo', url: (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), parse: parseDuckDuckGo },
  lite: { name: 'DuckDuckGo Lite', url: (q) => 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), parse: parseDuckDuckGoLite },
  mojeek: { name: 'Mojeek', url: (q) => 'https://www.mojeek.com/search?q=' + encodeURIComponent(q), parse: parseMojeek },
  yahoo: { name: 'Yahoo', url: (q) => 'https://search.yahoo.com/search?p=' + encodeURIComponent(q), parse: parseYahoo },
  google: { name: 'Google', ua: UA_YA, url: (q) => 'https://www.google.com/search?gbv=1&num=20&hl=ru&q=' + encodeURIComponent(q), parse: parseGoogle },
  yandex: { name: 'Яндекс', ua: UA_YA, url: (q) => 'https://yandex.com/search/?text=' + encodeURIComponent(q), parse: parseYandex },
};

const SEARCH_ORDER = {
  auto: ['bingrss', 'duckduckgo', 'mojeek', 'bing', 'lite', 'yahoo'],
  duckduckgo: ['duckduckgo', 'lite', 'mojeek', 'bingrss', 'bing', 'yahoo'],
  bing: ['bingrss', 'bing', 'mojeek', 'duckduckgo', 'lite', 'yahoo'],
  lite: ['lite', 'duckduckgo', 'mojeek', 'bingrss', 'bing', 'yahoo'],
  google: ['google', 'bingrss', 'duckduckgo', 'mojeek', 'bing', 'lite', 'yahoo'],
  yandex: ['yandex', 'bingrss', 'duckduckgo', 'mojeek', 'bing', 'lite', 'yahoo'],
};

async function searchWeb(query) {
  if (!query || typeof query !== 'string') {
    return { ok: false, results: [], error: 'Пустой запрос' };
  }
  query = query.slice(0, 300);
  const engine = settings.searchEngine;
  const backends = (SEARCH_ORDER[engine] || SEARCH_ORDER.auto).map(k => BASE_BACKENDS[k]);
  const headers = {
    'User-Agent': session.defaultSession.getUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru,en;q=0.8',
  };

  // Параллельно опрашиваем несколько движков и склеиваем результаты.
  const seen = {};
  const merged = [];
  const sources = [];
  const errors = [];
  let pending = backends.length;
  let finishedEarly = false;

  const resolve = () => {
    if (merged.length) {
      let label;
      if (engine === 'auto') {
        label = 'Meoow · ' + sources.join(' + ');
      } else {
        const order = SEARCH_ORDER[engine] || SEARCH_ORDER.auto;
        const primary = BASE_BACKENDS[order[0]];
        const primaryName = primary ? primary.name : null;
        const rest = primaryName ? sources.filter(s => s !== primaryName) : sources;
        if (primaryName && sources.indexOf(primaryName) !== -1) {
          label = rest.length ? primaryName + ' + ' + rest.join(' + ') : primaryName;
        } else {
          label = (primaryName ? primaryName + ' недоступен — ' : '') + (sources.length ? sources.join(' + ') : 'нет результатов');
        }
      }
      return { ok: true, source: label, results: merged.slice(0, 20) };
    }
    return { ok: false, source: null, results: [], error: errors.join(' | ') || 'нет результатов' };
  };

  await new Promise((done) => {
    const deadline = setTimeout(() => { finishedEarly = true; done(); }, 3500);
    const check = () => {
      if (finishedEarly) return;
      if (merged.length >= 15 || pending === 0) { finishedEarly = true; clearTimeout(deadline); done(); }
    };
    for (const b of backends) {
      (async () => {
        try {
          const bh = b.ua ? Object.assign({}, headers, { 'User-Agent': b.ua }) : headers;
          const res = await fetchWithTimeout(b.url(query), { headers: bh, redirect: 'follow' }, 5000);
          if (!res.ok) { errors.push(b.name + ':' + res.status); return; }
          const html = await res.text();
          const list = b.parse(html);
          let cnt = 0;
          for (const r of list) {
            if (!r || !r.title || !r.url || !/^https?:\/\//i.test(r.url)) continue;
            const key = r.url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
            if (!key || seen[key]) continue;
            seen[key] = true;
            merged.push(r);
            cnt++;
          }
          if (cnt) sources.push(b.name);
        } catch (e) {
          errors.push(b.name + ':' + (e && e.message ? e.message : String(e)));
        } finally {
          pending--;
          check();
        }
      })();
    }
    if (pending === 0) { finishedEarly = true; clearTimeout(deadline); done(); }
  });

  return resolve();
}

// ---------- Suggest / autocomplete (DuckDuckGo) ----------
const SUGGEST_TIMEOUT_MS = 2500;

async function getSuggestions(query) {
  if (!query || typeof query !== 'string') return [];
  query = query.trim().slice(0, 200);
  if (!query) return [];
  const ua = { 'User-Agent': session.defaultSession.getUserAgent() };
  const sources = [
    'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(query),
    'https://ac.duckduckgo.com/ac/?q=' + encodeURIComponent(query) + '&type=list',
  ];
  for (const url of sources) {
    try {
      const res = await fetchWithTimeout(url, { headers: ua }, SUGGEST_TIMEOUT_MS);
      if (!res.ok) continue;
      const data = await res.json();
      let list = [];
      if (Array.isArray(data)) {
        if (data.length >= 2 && Array.isArray(data[1])) {
          list = data[1].filter(s => typeof s === 'string');
        } else {
          list = data.map(x => (typeof x === 'string' ? x : (x && x.phrase) || '')).filter(Boolean);
        }
      }
      const out = list.filter(s => s && s.length <= 300).slice(0, 8);
      if (out.length) return out;
    } catch (e) {
      // try next source
    }
  }
  return [];
}

let win = null;
let bookmarks = [];
let history = [];
let settings = Object.assign({}, DEFAULT_SETTINGS);
let historyWriteTimer = null;

function loadSettings() {
  settings = clampSettings(readJson(SETTINGS_FILE, {}));
}

function scheduleHistoryWrite() {
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  historyWriteTimer = setTimeout(() => writeJson(HISTORY_FILE, history), 400);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    icon: path.join(__dirname, 'src', 'icons', 'icon.png'),
    title: 'Meoow Browser',
    backgroundColor: '#fff7ed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send('browser:new-tab', url);
    return { action: 'deny' };
  });

  win.on('page-title-updated', (ev) => { ev.preventDefault(); });

  win.on('closed', () => {
    if (devWin && !devWin.isDestroyed()) { devWin.close(); devWin = null; }
  });

  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) console.error('[renderer] ' + message);
  });

  runSmokeIfEnabled();
}

// ---------- Dev-окно «Активные пользователи» ----------
let devWin = null;
function openDevWindow() {
  if (devWin && !devWin.isDestroyed()) { devWin.show(); devWin.focus(); return; }
  devWin = new BrowserWindow({
    width: 540,
    height: 660,
    minWidth: 380,
    minHeight: 420,
    icon: path.join(__dirname, 'src', 'icons', 'icon.png'),
    title: 'Meoow · Активные пользователи (dev)',
    backgroundColor: '#fff7ed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  devWin.loadFile(path.join(__dirname, 'src', 'dev.html'));
  devWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) console.error('[dev-win] ' + message);
  });
  devWin.on('closed', () => { devWin = null; });
}

// ---------- Профили (как в Chrome) и аккаунт ----------
const PROFILE_COLORS = ['#FF5E62', '#FFB020', '#8B5CF6', '#14B8A6', '#38BDF8', '#F472B6', '#3B82F6', '#10B981'];
let profiles = [];
let activeProfileId = null;
let account = { token: null, email: null, serverUrl: '' };
let accountServerProcess = null;
let syncTimer = null;

function profileDir(id) {
  return path.join(PROFILES_DIR, id);
}
function profileFile(id, name) {
  return path.join(profileDir(id), name);
}
function profileById(id) {
  return profiles.find(p => p.id === id) || null;
}
function newProfileId() {
  let id;
  do { id = 'p_' + crypto.randomBytes(6).toString('hex'); } while (profileById(id));
  return id;
}

function persistProfiles() {
  writeJson(PROFILES_INDEX_FILE, { activeProfileId, profiles });
}

function migrateLegacyData() {
  if (fs.existsSync(PROFILES_INDEX_FILE)) return;
  const legacy = ['settings.json', 'bookmarks.json', 'history.json'].some(f => fs.existsSync(path.join(USER_DATA_DIR, f)));
  const prof = {
    id: 'default',
    name: 'Мой профиль',
    color: PROFILE_COLORS[0],
    email: '',
    remoteId: null,
    pinSalt: null,
    pinHash: null,
    locked: false,
    createdAt: Date.now(),
    lastSync: 0,
  };
  profiles = [prof];
  activeProfileId = 'default';
  if (legacy) {
    // переносим данные старой версии в профиль
    ['settings.json', 'bookmarks.json', 'history.json'].forEach(f => {
      const src = path.join(USER_DATA_DIR, f);
      if (!fs.existsSync(src)) return;
      try { fs.mkdirSync(profileDir('default'), { recursive: true }); fs.renameSync(src, profileFile('default', f)); } catch (e) {}
    });
  }
  persistProfiles();
}

function loadProfileFiles(id) {
  SETTINGS_FILE = profileFile(id, 'settings.json');
  BOOKMARKS_FILE = profileFile(id, 'bookmarks.json');
  HISTORY_FILE = profileFile(id, 'history.json');
  loadSettings();
  bookmarks = readJson(BOOKMARKS_FILE, []);
  history = readJson(HISTORY_FILE, []);
}

function saveProfileFiles() {
  writeJson(SETTINGS_FILE, settings);
  writeJson(BOOKMARKS_FILE, bookmarks);
  writeJson(HISTORY_FILE, history);
}

function loadAccount() {
  const a = readJson(ACCOUNT_FILE, {});
  account = {
    token: typeof a.token === 'string' && a.token ? a.token : null,
    email: typeof a.email === 'string' ? a.email : '',
    serverUrl: typeof a.serverUrl === 'string' && a.serverUrl ? a.serverUrl : DEFAULT_SERVER_URL,
  };
}
function saveAccount() {
  writeJson(ACCOUNT_FILE, {
    token: account.token,
    email: account.email,
    serverUrl: account.serverUrl,
  });
}

function ensureStorage() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  migrateLegacyData();
  loadAccount();
  const idx = readJson(PROFILES_INDEX_FILE, null);
  if (idx && Array.isArray(idx.profiles) && idx.profiles.length) {
    profiles = idx.profiles;
    activeProfileId = (idx.activeProfileId && profileById(idx.activeProfileId)) ? idx.activeProfileId : profiles[0].id;
  } else {
    profiles = [{ id: 'default', name: 'Мой профиль', color: PROFILE_COLORS[0], email: '', remoteId: null, pinSalt: null, pinHash: null, locked: false, createdAt: Date.now(), lastSync: 0 }];
    activeProfileId = 'default';
    persistProfiles();
  }
  ensureLocalServer();
  loadProfileFiles(activeProfileId);
}

// ---------- Локальный PIN (scrypt, как на сервере) ----------
function hashPinLocal(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return { salt, hash };
}
function checkPinLocal(pin, salt, hash) {
  try {
    if (!salt || !hash) return false;
    return crypto.scryptSync(String(pin), salt, 64).toString('hex') === hash;
  } catch (e) { return false; }
}

// ---------- HTTP-клиент аккаунта ----------
const ACCOUNT_REQUEST_TIMEOUT = 10000;
async function apiCall(method, p, body, opts = {}) {
  if (!account.serverUrl) throw new Error('Сервер не настроен');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ACCOUNT_REQUEST_TIMEOUT);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (account.token && opts.auth !== false) headers.Authorization = 'Bearer ' + account.token;
    if (opts.pin) headers['X-Meoow-Pin'] = String(opts.pin);
    const res = await fetch(account.serverUrl + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Ошибка сервера (' + res.status + ')'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally { clearTimeout(t); }
}

// Локальный сервер аккаунта (dev): поднимаем, если URL локальный и сервер не отвечает
function ensureLocalServer() {
  if (process.env.MEOOW_TEST === '1') return;
  let u;
  try { u = new URL(account.serverUrl); } catch (e) { return; }
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return;
  const serverPath = path.join(__dirname, 'server', 'server.js');
  if (!fs.existsSync(serverPath)) return;
  fetch(account.serverUrl + '/api/health')
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(({ d }) => {
      if (!(d && d.ok)) spawnLocalServer(serverPath);
    })
    .catch(() => spawnLocalServer(serverPath));
}
function spawnLocalServer(serverPath) {
  const proc = spawn(process.execPath, [serverPath], { stdio: 'ignore' });
  accountServerProcess = proc;
  proc.on('exit', () => { if (accountServerProcess === proc) accountServerProcess = null; });
}

// ---------- Синхронизация данных профиля на сервер ----------
function scheduleProfileSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { doProfileSync(); }, 1500);
}
async function doProfileSync() {
  syncTimer = null;
  const prof = profileById(activeProfileId);
  if (!prof || !prof.remoteId || !account.token || !account.serverUrl) return;
  try {
    await apiCall('PUT', '/api/profiles/' + prof.remoteId + '/data', { settings, bookmarks, history });
    prof.lastSync = Date.now();
    persistProfiles();
  } catch (e) {
    console.error('[account] sync push failed:', e.message);
  }
}

function writeProfileData(id, data) {
  const sFile = profileFile(id, 'settings.json');
  const bFile = profileFile(id, 'bookmarks.json');
  const hFile = profileFile(id, 'history.json');
  if (data.settings && typeof data.settings === 'object') writeJson(sFile, clampSettings(data.settings));
  if (Array.isArray(data.bookmarks)) writeJson(bFile, data.bookmarks);
  if (Array.isArray(data.history)) writeJson(hFile, data.history);
}

async function bindRemoteProfiles(userEmail, remoteProfiles) {
  for (const rp of remoteProfiles) {
    let lp = profiles.find(p => p.remoteId === rp.id);
    if (!lp) {
      lp = { id: newProfileId(), name: rp.name, color: rp.color, email: userEmail, remoteId: rp.id, pinSalt: null, pinHash: null, locked: false, createdAt: Date.now(), lastSync: 0 };
      profiles.push(lp);
    }
    lp.email = userEmail;
    if (!rp.hasPin) {
      try {
        const data = await apiCall('GET', '/api/profiles/' + rp.id + '/data', undefined, {});
        writeProfileData(lp.id, data);
        lp.lastSync = Date.now();
      } catch (e) {
        console.error('[account] pull profile', rp.id, e.message);
      }
    }
  }
  persistProfiles();
}

function profileMetaForUI(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    email: p.email || (p.remoteId ? account.email : ''),
    remote: !!p.remoteId,
    hasPin: !!p.pinHash,
    locked: !!p.locked,
  };
}
function accountState() {
  return {
    loggedIn: !!account.token,
    email: account.email || '',
    serverUrl: account.serverUrl || DEFAULT_SERVER_URL,
    activeProfileId,
    profiles: profiles.map(profileMetaForUI),
  };
}

function recordHistory(url, title) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  try {
    const host = new URL(url).hostname;
    if (!host) return;
  } catch (e) { return; }
  history = history.filter(h => h.url !== url);
  history.unshift({ url, title: title || url, time: Date.now() });
  history = history.slice(0, 500);
  scheduleHistoryWrite();
  scheduleProfileSync();
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

app.on('before-quit', () => {
  if (syncTimer) {
    clearTimeout(syncTimer);
    const prof = profileById(activeProfileId);
    if (prof && prof.remoteId && account.token) {
      apiCall('PUT', '/api/profiles/' + prof.remoteId + '/data', { settings, bookmarks, history }).catch(() => {});
    }
  }
  if (historyWriteTimer) {
    clearTimeout(historyWriteTimer);
    writeJson(HISTORY_FILE, history);
  }
  if (accountServerProcess && !accountServerProcess.killed) {
    try { accountServerProcess.kill(); } catch (e) {}
  }
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.meoow.browser');
  }
  ensureStorage();
  session.defaultSession.setPermissionRequestHandler((wcContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(settings.blockNotifications !== true);
      return;
    }
    callback(true);
  });
  hookDownloads(session.defaultSession);
  createWindow();
  if (process.argv.includes('--dev-active')) {
    setTimeout(openDevWindow, 900);
  }
  initUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Forward in-page find results to the browser window
app.on('web-contents-created', (ev, contents) => {
  contents.on('found-in-page', (e2, result) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('browser:found', result);
    }
  });
  hookDownloads(contents.session);
  if (contents.getType() === 'webview') {
    contents.on('did-finish-load', () => applyPageMods(contents));
  }
});

// ---------- Page enhancements (custom scrollbar, dark sites) ----------
const SCROLLBAR_CSS = `::-webkit-scrollbar{width:14px;height:14px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(166,94,42,.45);border-radius:8px;border:3px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:rgba(166,94,42,.75);border:3px solid transparent;background-clip:content-box}::-webkit-scrollbar-corner{background:transparent}@media(prefers-color-scheme:dark){::-webkit-scrollbar-thumb{background:rgba(214,168,120,.4);border:3px solid transparent;background-clip:content-box}}`;
const DARK_SITES_CSS = `html{filter:invert(1) hue-rotate(180deg) contrast(.95)}html img,html video,html picture,html canvas,html iframe,html embed,html object{filter:invert(1) hue-rotate(180deg)}`;

const pageMods = new WeakMap();

function guestContents() {
  return webContents.getAllWebContents().filter(wc => wc.getType() === 'webview' && !wc.isDestroyed());
}

async function applyPageMods(wc) {
  try {
    const prev = pageMods.get(wc) || { scrollKey: null, darkKey: null };
    if (prev.scrollKey) { wc.removeInsertedCSS(prev.scrollKey); prev.scrollKey = null; }
    if (prev.darkKey) { wc.removeInsertedCSS(prev.darkKey); prev.darkKey = null; }
    if (settings.customScrollbar !== false) {
      prev.scrollKey = await wc.insertCSS(SCROLLBAR_CSS);
    }
    if (settings.darkSites === true) {
      prev.darkKey = await wc.insertCSS(DARK_SITES_CSS);
    }
    pageMods.set(wc, prev);
  } catch (e) {
    console.error('[page-mods] error', e && e.message);
  }
}

function applyPageModsToAll() {
  guestContents().forEach(wc => applyPageMods(wc));
}

// Downloads: ask where to save, then let the file through
const hookedSessions = new Set();
function hookDownloads(sessionOf) {
  if (hookedSessions.has(sessionOf)) return;
  hookedSessions.add(sessionOf);
  sessionOf.on('will-download', (ev, item, wc) => {
    if (process.env.MEOOW_TEST === '1') {
      item.setSavePath(path.join(app.getPath('temp'), item.getFilename()));
      item.once('done', () => {});
      return;
    }
    const name = item.getFilename();
    const target = dialog.showSaveDialogSync(win, {
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('downloads'), name || 'download')
    });
    if (!target) {
      item.cancel();
      return;
    }
    item.setSavePath(target);
    item.once('done', (e, state) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('browser:download-done', state === 'completed');
      }
    });
  });
}

// ---------- Auto-update (electron-updater) ----------
function initUpdater() {
  if (process.env.MEOOW_TEST === '1') return;          // not in regression tests
  if (!app.isPackaged) return;                          // dev mode: no updates
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;     // portable builds can't self-update

  let updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error('[updater] unavailable:', e && e.message);
    return;
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => console.log('[updater] checking for update…'));
  updater.on('update-available', (info) => console.log('[updater] update available:', info && info.version));
  updater.on('update-not-available', () => console.log('[updater] up to date'));
  updater.on('download-progress', (p) => {
    if (win && !win.isDestroyed()) {
      win.setProgressBar(Math.max(0, Math.min(1, (p && p.percent || 0) / 100)));
    }
  });
  updater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info && info.version);
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    const r = dialog.showMessageBoxSync(win, {
      type: 'info',
      title: 'Meoow',
      message: 'Обновление загружено',
      detail: 'Готова новая версия Meoow (' + (info && info.version || '?') + '). Перезапустить браузер, чтобы применить её?',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1
    });
    if (r === 0) updater.quitAndInstall();
  });
  updater.on('error', (err) => {
    console.error('[updater] error:', err && err.message);
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  });

  setTimeout(() => {
    updater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err && err.message);
    });
  }, 6000);
}

// IPC handlers
ipcMain.on('browser:exit', () => {
  app.quit();
});

ipcMain.handle('browser:get-bookmarks', () => bookmarks);
ipcMain.handle('browser:add-bookmark', (e, { url, title }) => {
  if (url && !bookmarks.some(b => b.url === url)) {
    bookmarks.unshift({ url, title: title || url });
    writeJson(BOOKMARKS_FILE, bookmarks);
    scheduleProfileSync();
  }
  return bookmarks;
});
ipcMain.handle('browser:remove-bookmark', (e, url) => {
  bookmarks = bookmarks.filter(b => b.url !== url);
  writeJson(BOOKMARKS_FILE, bookmarks);
  scheduleProfileSync();
  return bookmarks;
});
ipcMain.handle('browser:get-history', () => history);
ipcMain.handle('browser:add-history', (e, { url, title }) => {
  recordHistory(url, title);
  return true;
});
ipcMain.handle('browser:clear-history', () => {
  history = [];
  scheduleHistoryWrite();
  scheduleProfileSync();
  return history;
});
ipcMain.handle('browser:is-bookmarked', (e, url) => bookmarks.some(b => b.url === url));
ipcMain.handle('browser:get-user-agent', (e) => session.defaultSession.getUserAgent());
ipcMain.on('browser:set-title', (e, t) => {
  if (win && !win.isDestroyed()) {
    win.setTitle(String(t).slice(0, 200) || 'Meoow Browser');
  }
});
ipcMain.handle('browser:remove-history', (e, url) => {
  history = history.filter(h => h.url !== url);
  scheduleHistoryWrite();
  scheduleProfileSync();
  return history;
});
ipcMain.handle('browser:search', async (e, query) => {
  return searchWeb(query);
});

ipcMain.handle('browser:suggest', async (e, query) => {
  return getSuggestions(query);
});

// ---------- Dev: активные пользователи ----------
ipcMain.handle('browser:dev-active-users', async () => {
  try {
    return await apiCall('GET', '/api/dev/active', undefined, { auth: false });
  } catch (e) {
    return { ok: false, error: e.message || String(e), serverUrl: account.serverUrl || DEFAULT_SERVER_URL };
  }
});
ipcMain.on('browser:open-dev-window', () => openDevWindow());

// ---------- Image search (Bing images async, no API key) ----------
async function searchImages(query) {
  if (!query || typeof query !== 'string') return { ok: false, results: [] };
  query = query.trim().slice(0, 200);
  if (!query) return { ok: false, results: [] };
  const headers = { 'User-Agent': session.defaultSession.getUserAgent(), Referer: 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) };
  try {
    const res = await fetchWithTimeout('https://www.bing.com/images/async?q=' + encodeURIComponent(query) + '&first=1&count=35&relo=0&relp=0&qs=n&form=QBIR', { headers }, 9000);
    if (!res.ok) return { ok: false, results: [] };
    const html = await res.text();
    const results = [];
    const mRe = /m="([^"]+)"/g;
    let m;
    while ((m = mRe.exec(html)) && results.length < 16) {
      const raw = m[1];
      if (raw.indexOf('&quot;') === -1) continue;
      let data = null;
      try { data = JSON.parse(decodeEntities(raw)); } catch (e) { continue; }
      const img = data.murl || data.turl || '';
      const page = data.purl || data.murl || '';
      const t = decodeEntities(data.t || '');
      if (!img || !page) continue;
      let src = '';
      try { src = new URL(page).hostname.replace(/^www\./, ''); } catch (e) {}
      results.push({ title: t, url: page, image: img, source: src });
    }
    return { ok: results.length > 0, results };
  } catch (e) { return { ok: false, results: [] }; }
}
ipcMain.handle('browser:search-images', (e, query) => searchImages(query));

// ---------- Video search (Bing videos, no API key) ----------
function parseBingVideos(html) {
  const out = [];
  const mRe = /m="([^"]+)"/g;
  let m;
  while ((m = mRe.exec(html)) && out.length < 16) {
    const s = m[1];
    if (s.indexOf('&quot;') === -1) continue;
    let d = null;
    try { d = JSON.parse(decodeEntities(s)); } catch (e) { continue; }
    const url = d.murl || '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const title = decodeEntities(String(d.vt || d.t || '')).trim();
    if (!title) continue;
    const thumb = d.turl ? decodeEntities(d.turl)
      : (d.thid ? 'https://tse1.mm.bing.net/th?id=' + encodeURIComponent(d.thid) + '&pid=Api' : '');
    let src = '';
    try { src = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    out.push({ title, url, thumb, duration: String(d.du || ''), source: src });
  }
  return out;
}

async function searchVideos(query) {
  if (!query || typeof query !== 'string') return { ok: false, results: [] };
  query = query.trim().slice(0, 200);
  if (!query) return { ok: false, results: [] };
  const headers = { 'User-Agent': session.defaultSession.getUserAgent(), Referer: 'https://www.bing.com/videos/search?q=' + encodeURIComponent(query) };
  try {
    const res = await fetchWithTimeout('https://www.bing.com/videos/search?q=' + encodeURIComponent(query), { headers }, 9000);
    if (!res.ok) return { ok: false, results: [] };
    const html = await res.text();
    const results = parseBingVideos(html);
    return { ok: results.length > 0, results };
  } catch (e) { return { ok: false, results: [] }; }
}
ipcMain.handle('browser:search-videos', (e, query) => searchVideos(query));

// ---------- Meoow AI: онлайн-LLM + синтез ----------
function cleanSnippet(s) {
  if (!s) return '';
  return String(s).replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function buildAiAnswer(prompt, results) {
  const top = results.slice(0, 5);
  const facts = [];
  const first = top[0];
  const intro = 'По запросу «' + prompt + '» найдено ' + results.length +
    ' результатов.\n';
  if (first && cleanSnippet(first.snippet)) {
    facts.push('**' + first.title + '**: ' + cleanSnippet(first.snippet));
  }
  for (let i = 1; i < top.length; i++) {
    const r = top[i];
    const sn = cleanSnippet(r.snippet);
    facts.push('**' + r.title + '**' + (sn ? ' — ' + sn : ''));
  }
  if (!facts.length) {
    facts.push('Не удалось собрать подходящие фрагменты. Откройте источники ниже, чтобы найти нужную информацию.');
  }
  return intro + '\n' + facts.map(f => '• ' + f).join('\n\n');
}

function buildMoreAnswer(prompt, results) {
  const more = results.slice(5, 12);
  const facts = [];
  for (const r of more) {
    const sn = cleanSnippet(r.snippet);
    facts.push('**' + r.title + '**' + (sn ? ' — ' + sn : ''));
  }
  const intro = 'Дополнение по запросу «' + prompt + '»:\n';
  return intro + '\n' + facts.map(f => '• ' + f).join('\n\n');
}

// Вызов OpenAI-совместимого chat/completions (Groq, OpenRouter, Gemini, Ollama, любой).
async function callLLM(messages) {
  const endpoint = String(settings.aiEndpoint || '').trim();
  const key = String(settings.aiKey || '').trim();
  if (!endpoint || !key) return null;
  let url = endpoint.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(url)) url += '/chat/completions';
  const body = {
    model: String(settings.aiModel || '').trim() || 'gpt-4o-mini',
    messages,
    temperature: 0.5,
    stream: false,
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(body),
  }, 45000);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 160); } catch (e) { /* ignore */ }
    throw new Error('LLM ' + res.status + ' ' + detail);
  }
  const data = await res.json();
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('LLM empty response');
  return String(out).trim();
}

// Бесплатный ChatGPT-движок: DuckDuckGo AI-чат отдаёт тот же gpt-4o-mini, что и ChatGPT, без ключей.
function freeChatUa() {
  return session.defaultSession.getUserAgent();
}

async function duckChatGetToken() {
  const base = {
    redirect: 'follow',
    headers: {
      'User-Agent': freeChatUa(),
      'x-vqd-4': '1',
      'Accept': '*/*',
      'Origin': 'https://duckduckgo.com',
      'Referer': 'https://duckduckgo.com/',
    },
  };
  try { await fetchWithTimeout('https://duckduckgo.com/duckchat/v1/status', base, 12000); } catch (e) {}
  let token = null;
  try {
    const head = await fetchWithTimeout('https://duckduckgo.com/duckchat/v1/chat',
      Object.assign({}, base, { method: 'HEAD' }), 15000);
    token = head.headers.get('x-vqd-4');
  } catch (e) {}
  if (!token) {
    try {
      const post = await fetchWithTimeout('https://duckduckgo.com/duckchat/v1/chat',
        Object.assign({}, base, { method: 'POST', headers: Object.assign({}, base.headers, { 'Content-Type': 'application/json' }), body: '{}' }), 15000);
      token = post.headers.get('x-vqd-4');
    } catch (e) {}
  }
  return token;
}

async function callFreeDuckChat(messages) {
  const token = await duckChatGetToken();
  if (!token) return null;
  const body = { model: 'gpt-4o-mini', messages };
  const res = await fetchWithTimeout('https://duckduckgo.com/duckchat/v1/chat', {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json', 'User-Agent': freeChatUa(), 'x-vqd-4': token, 'Accept': 'text/event-stream', 'Origin': 'https://duckduckgo.com', 'Referer': 'https://duckduckgo.com/' },
    body: JSON.stringify(body),
  }, 60000);
  if (!res.ok) return null;
  const text = await res.text();
  let out = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const j = JSON.parse(payload);
      if (j && typeof j.message === 'string') out += j.message;
      else if (j && typeof j.content === 'string') out += j.content;
      else if (j && j.choices && j.choices[0] && j.choices[0].delta && typeof j.choices[0].delta.content === 'string') out += j.choices[0].delta.content;
    } catch (e) { /* не JSON — пропускаем */ }
  }
  out = out.trim();
  return out || null;
}

// Резервный бесплатный движок (OpenAI-совместимый, без ключа).
async function callFreePollinations(messages) {
  const url = 'https://text.pollinations.ai/openai';
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json', 'User-Agent': freeChatUa() },
    body: JSON.stringify({ model: 'openai', messages, temperature: 0.5, stream: false }),
  }, 45000);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('json') !== -1) {
    let data = null;
    try { data = await res.json(); } catch (e) {}
    const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return c ? String(c).trim() : null;
  }
  const text = await res.text();
  return text.trim() || null;
}

async function callFreeChatGPT(messages) {
  const duck = await callFreeDuckChat(messages);
  if (duck) return duck;
  try { return await callFreePollinations(messages); } catch (e) { return null; }
}

function buildBrowserContextCtx(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = [];
  if (ctx.activeUrl) parts.push('открытая страница: ' + ctx.activeUrl + (ctx.activeTitle ? ' (' + ctx.activeTitle + ')' : ''));
  if (Array.isArray(ctx.openTabs) && ctx.openTabs.length) parts.push('открытые вкладки: ' + ctx.openTabs.slice(0, 10).join('; '));
  if (Array.isArray(ctx.recent) && ctx.recent.length) parts.push('недавние сайты: ' + ctx.recent.slice(0, 8).join('; '));
  if (!parts.length) return '';
  return '\n\nКонтекст браузера Meoow: ' + parts.join('. ') + '.';
}

async function aiAsk(prompt, opts) {
  opts = opts || {};
  if (!prompt || typeof prompt !== 'string') return { ok: false, mode: 'err', text: '', sources: [] };
  const text = prompt.trim().slice(0, 500);
  let res = null;
  try { res = await searchWeb(text); } catch (e) { res = null; }
  const results = (res && res.results) || [];
  const srcFrom = opts.more ? Math.min(5, results.length) : 0;
  const sources = results.slice(srcFrom, srcFrom + 5).map(r => ({ title: r.title, url: r.url, snippet: cleanSnippet(r.snippet) }));

  const hasKey = !!(String(settings.aiEndpoint || '').trim() && String(settings.aiKey || '').trim());
  const ctx = buildBrowserContextCtx(opts.context);

  const makeSystem = () => (opts.more
    ? 'Ты — Meoow AI, помощник в браузере. Продолжи отвечать по той же теме, что и в предыдущих сообщениях: добавь новые детали, примеры, уточнения. Пиши живо, по-русски, без воды.'
    : 'Ты — Meoow AI, умный собеседник в браузере Meoow, работающий на движке ChatGPT (бесплатно). Отвечай на вопросы пользователя кратко и по существу (обычно 5–10 предложений), простым и тёплым русским языком, без канцелярита. Если дан «контекст из поиска» — опирайся на него и указывай источники, когда уместно. Не выдумывай фактов сверх контекста; если данных не хватает — честно скажи об этом. Форматируй короткими абзацами и списками, когда это удобно.') + ctx;

  const history = Array.isArray(opts.history) ? opts.history.slice(-6) : [];
  if (history.length && history[history.length - 1].role === 'user') history.pop();
  const contextSearch = sources.filter(s => s.snippet).slice(0, 5)
    .map((s, i) => (i + 1) + ') ' + s.title + ' — ' + s.snippet).join('\n');
  let userMsg = text;
  if (contextSearch) userMsg += '\n\nКонтекст из поиска:\n' + contextSearch;

  const buildMessages = () => {
    const messages = [{ role: 'system', content: makeSystem() }];
    for (const m of history) {
      const c = stripTags(m.text).slice(0, 1500);
      if (c && (m.role === 'user' || m.role === 'bot')) {
        messages.push({ role: m.role === 'bot' ? 'assistant' : 'user', content: c });
      }
    }
    messages.push({ role: 'user', content: userMsg });
    return messages;
  };

  if (hasKey) {
    try {
      const out = await callLLM(buildMessages());
      if (out) {
        return { ok: true, mode: 'llm', text: out, sources, query: text, noKey: false };
      }
    } catch (e) {
      console.error('[ai] LLM не ответил, переключаюсь на бесплатный движок:', e && e.message);
    }
  }

  if (settings.aiFreeChat !== false) {
    try {
      const out = await callFreeChatGPT(buildMessages());
      if (out) {
        return { ok: true, mode: 'llm', text: out, sources, query: text, noKey: true, free: true };
      }
    } catch (e) {
      console.error('[ai] бесплатный движок не ответил, возвращаюсь к синтезу:', e && e.message);
    }
  }

  let answer;
  if (!results.length) {
    answer = opts.more
      ? 'По этому вопросу больше ничего не нашлось. Сформулируйте его иначе — и я поищу ещё раз.'
      : 'Мне не удалось найти информацию по запросу «' + text + '». Попробуйте переформулировать вопрос или проверьте подключение к интернету.';
  } else if (opts.more) {
    answer = buildMoreAnswer(text, results);
  } else {
    answer = buildAiAnswer(text, results);
  }
  return { ok: true, mode: 'snippets', text: answer, sources, query: text, noKey: !hasKey };
}
ipcMain.handle('browser:ai-ask', (e, prompt, opts) => aiAsk(prompt, opts));

// ---------- Scam / phishing protection ----------
const OFFICIAL_HOSTS = {
  google: [/\.google\.(com|co\.uk|ru|de|fr|ua|pl)$/i, /^google\.com$/i],
  youtube: [/\.youtube\.com$/i],
  facebook: [/\.facebook\.com$/i],
  instagram: [/\.instagram\.com$/i],
  vk: [/(^|\.)vk\.com$/i, /^vk\.cc$/i],
  yandex: [/\.yandex\.(com|ru|ua|kz|by)$/i, /^yandex\.(com|ru)$/i],
  mail: [/\.mail\.ru$/i],
  sberbank: [/sberbank\.ru$/i],
  tinkoff: [/tinkoff\.ru$/i],
  mail: [/mail\.ru$/i, /\.mail\.ru$/i],
  binance: [/binance\.com$/i],
  apple: [/\.apple\.com$/i],
  microsoft: [/\.microsoft\.com$/i],
  amazon: [/\.amazon\.(com|co\.uk|de|fr|jp)$/i, /^amazon\.com$/i],
  paypal: [/paypal\.com$/i, /\.paypal\.com$/i],
  steam: [/steamcommunity\.com$/i, /store\.steampowered\.com$/i, /^steam\.com$/i],
  roblox: [/roblox\.com$/i, /\.roblox\.com$/i],
  wildberries: [/wildberries\.ru$/i, /\.wildberries\.ru$/i],
  ozon: [/ozon\.ru$/i, /\.ozon\.ru$/i],
  ozon: [/ozon\.ru$/i, /\.ozon\.ru$/i],
  netflix: [/netflix\.com$/i],
  twitch: [/twitch\.tv$/i],
  spotify: [/spotify\.com$/i],
};
const SENSITIVE_HOST_PATTERNS = /bank|login|account|secure|verify|wallet|pay|card|invest|crypto|loan|credit/i;

function normalizeDomain(host) {
  return host.replace(/^www\./i, '').replace(/[-_.]/g, '').toLowerCase()
    .replace(/0/g,'o').replace(/1/g,'l').replace(/3/g,'e').replace(/5/g,'s').replace(/4/g,'a').replace(/7/g,'t').replace(/8/g,'b')
    .replace(/vv/g,'w');
}
function hostMatchesOfficial(host, brand) {
  const rules = OFFICIAL_HOSTS[brand];
  return rules && rules.some(re => re.test(host));
}
function isRiskyUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (hostMatchesOfficial(host, 'google') || hostMatchesOfficial(host, 'yandex') || hostMatchesOfficial(host, 'apple') || hostMatchesOfficial(host, 'microsoft') || hostMatchesOfficial(host, 'amazon') || hostMatchesOfficial(host, 'youtube') || hostMatchesOfficial(host, 'facebook') || hostMatchesOfficial(host, 'instagram') || hostMatchesOfficial(host, 'vk') || hostMatchesOfficial(host, 'mail') || hostMatchesOfficial(host, 'sberbank') || hostMatchesOfficial(host, 'tinkoff') || hostMatchesOfficial(host, 'paypal') || hostMatchesOfficial(host, 'steam') || hostMatchesOfficial(host, 'roblox') || hostMatchesOfficial(host, 'binance') || hostMatchesOfficial(host, 'netflix') || hostMatchesOfficial(host, 'wildberries') || hostMatchesOfficial(host, 'ozon') || hostMatchesOfficial(host, 'twitch') || hostMatchesOfficial(host, 'spotify')) return null;
    const normHost = normalizeDomain(host);
    const brandHit = ['paypal','google','microsoft','apple','amazon','youtube','facebook','instagram','telegram','whatsapp','binance','coinbase','sberbank','tinkoff','vk','vkontakte','yandex','mail','gmail','netflix','steam','roblox','robux','wildberries','ozon','avito','sber','bank'].find(b => normHost.includes(b) && !normalizeDomain(host).includes('meoow'));
    if (brandHit) return { level: 'high', reason: 'домен похож на ' + brandHit + ' (' + host + ') — возможная подделка.' };
    const label = host.split('.').slice(-2).join('.');
    if (/\.top$/i.test(label) || /\.click$/i.test(label) || /\.xyz$/i.test(label) || /\.gq$/i.test(label) || /\.tk$/i.test(label)) {
      if (SENSITIVE_HOST_PATTERNS.test(host) || SENSITIVE_HOST_PATTERNS.test(u.pathname)) return { level: 'high', reason: 'подозрительный домен верхнего уровня (' + host + ') с чувствительным содержимым.' };
    }
    if (u.protocol === 'http:' && SENSITIVE_HOST_PATTERNS.test(host)) return { level: 'warn', reason: 'незащищённое соединение (HTTP) для敏感ного сайта.' };
    return null;
  } catch (e) { return null; }
}
ipcMain.handle('browser:is-risky', (e, url) => isRiskyUrl(url));

// Find in page (Ctrl+F)
ipcMain.handle('browser:find', (e, wcId, text, opts) => {
  const wc = webContents.fromId(wcId);
  if (!wc || !text) return { ok: false };
  wc.findInPage(String(text), opts || {});
  return { ok: true };
});
ipcMain.handle('browser:stop-find', (e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (wc) wc.stopFindInPage('clearSelection');
  return { ok: true };
});

// Fullscreen (F11)
ipcMain.on('browser:fullscreen', () => {
    if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.on('browser:maximize', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

function writeSettings(newSettings) {
  const prev = Object.assign({}, settings);
  const merged = clampSettings(Object.assign({}, settings, newSettings || {}));
  settings = merged;
  writeJson(SETTINGS_FILE, merged);
  scheduleProfileSync();
  if (newSettings && ('customScrollbar' in newSettings || 'darkSites' in newSettings)) {
    applyPageModsToAll();
  }
  return merged;
}

ipcMain.handle('browser:get-settings', () => settings);
ipcMain.handle('browser:set-settings', (e, patch) => writeSettings(patch));
ipcMain.handle('browser:reset-settings', () => writeSettings(DEFAULT_SETTINGS));
ipcMain.handle('browser:clear-data', () => {
  bookmarks = [];
  history = [];
  writeJson(BOOKMARKS_FILE, bookmarks);
  writeJson(HISTORY_FILE, history);
  scheduleProfileSync();
  return { bookmarks, history };
});

// ---------- Аккаунт, профили, PIN (IPC) ----------
ipcMain.handle('browser:account-state', () => accountState());

ipcMain.handle('browser:account-health', async () => {
  try {
    const d = await apiCall('GET', '/api/health', undefined, { auth: false });
    return { ok: !!(d && d.ok), url: account.serverUrl };
  } catch (e) {
    return { ok: false, url: account.serverUrl };
  }
});

ipcMain.handle('browser:account-set-server', (e, url) => {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) return { error: 'Неверный адрес сервера.' };
  account.serverUrl = u;
  saveAccount();
  ensureLocalServer();
  return accountState();
});

ipcMain.handle('browser:account-register', async (e, opts) => {
  try {
    const data = await apiCall('POST', '/api/register', {
      email: opts.email,
      password: opts.password,
      name: opts.profileName,
    }, { auth: false });
    account.token = data.token;
    account.email = data.user.email;
    saveAccount();
    const rp = data.profile;
    let lp = profiles.find(p => p.remoteId === rp.id);
    if (!lp) {
      lp = { id: newProfileId(), name: rp.name, color: rp.color, email: account.email, remoteId: rp.id, pinSalt: null, pinHash: null, locked: false, createdAt: Date.now(), lastSync: 0 };
      profiles.push(lp);
    }
    const pull = await apiCall('GET', '/api/profiles/' + rp.id + '/data', undefined, {});
    writeProfileData(lp.id, pull);
    lp.lastSync = Date.now();
    persistProfiles();
    activeProfileId = lp.id;
    loadProfileFiles(lp.id);
    saveProfileFiles();
    scheduleProfileSync();
    return { ok: true, state: accountState() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('browser:account-login', async (e, opts) => {
  try {
    const data = await apiCall('POST', '/api/login', {
      email: opts.email,
      password: opts.password,
    }, { auth: false });
    account.token = data.token;
    account.email = data.user.email;
    saveAccount();
    await bindRemoteProfiles(account.email, data.profiles || []);
    const cur = profileById(activeProfileId);
    if (cur && cur.remoteId) scheduleProfileSync();
    return { ok: true, state: accountState() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('browser:account-logout', async () => {
  if (account.token) {
    try { await apiCall('POST', '/api/logout', {}, {}); } catch (e) {}
  }
  account.token = null;
  account.email = '';
  saveAccount();
  profiles.forEach(p => { p.remoteId = null; p.email = ''; });
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-create', async (e, opts) => {
  const name = String(opts.name || '').trim().slice(0, 60) || 'Новый профиль';
  const lp = { id: newProfileId(), name, color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length], email: account.email, remoteId: null, pinSalt: null, pinHash: null, locked: false, createdAt: Date.now(), lastSync: 0 };
  profiles.push(lp);
  if (account.token) {
    try {
      const rp = await apiCall('POST', '/api/profiles', { name });
      lp.remoteId = rp.profile.id;
      await apiCall('PUT', '/api/profiles/' + rp.profile.id + '/data', { settings: {}, bookmarks: [], history: [] });
    } catch (e) {}
  }
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-rename', async (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  const name = String(opts.name || '').trim().slice(0, 60);
  if (name) p.name = name;
  if (account.token && p.remoteId) {
    try { await apiCall('POST', '/api/profiles/' + p.remoteId + '/rename', { name }); } catch (e) {}
  }
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-remove', async (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  if (p.id === activeProfileId) return { error: 'Нельзя удалить активный профиль.' };
  if (profiles.length <= 1) return { error: 'Должен остаться хотя бы один профиль.' };
  if (account.token && p.remoteId) {
    try { await apiCall('DELETE', '/api/profiles/' + p.remoteId); } catch (e) {}
  }
  profiles = profiles.filter(x => x.id !== p.id);
  try { fs.rmSync(profileDir(p.id), { recursive: true, force: true }); } catch (e) {}
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-switch', async (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  if (p.locked && p.pinHash) {
    if (!checkPinLocal(String(opts.pin || ''), p.pinSalt, p.pinHash)) {
      return { locked: true, error: 'Введите PIN.' };
    }
  }
  activeProfileId = p.id;
  p.locked = false;
  if (account.token && p.remoteId) scheduleProfileSync();
  loadProfileFiles(p.id);
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-lock', (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  p.locked = true;
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-set-pin', async (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  const pin = String(opts.pin || '');
  const clearing = pin === '';
  if (!clearing && !/^\d{4,8}$/.test(pin)) return { error: 'PIN должен состоять из 4–8 цифр.' };
  if (p.pinHash && !checkPinLocal(String(opts.oldPin || ''), p.pinSalt, p.pinHash)) {
    return { error: 'Текущий PIN указан неверно.' };
  }
  if (account.token && p.remoteId) {
    try {
      await apiCall('POST', '/api/pin', { profileId: p.remoteId, oldPin: opts.oldPin || undefined, pin });
    } catch (err) {
      return { error: err.message };
    }
  }
  if (clearing) {
    p.pinSalt = null;
    p.pinHash = null;
  } else {
    const h = hashPinLocal(pin);
    p.pinSalt = h.salt;
    p.pinHash = h.hash;
  }
  persistProfiles();
  return { ok: true, state: accountState() };
});

ipcMain.handle('browser:profile-unlock', async (e, opts) => {
  const p = profileById(opts.id);
  if (!p) return { error: 'Профиль не найден.' };
  const pin = String(opts.pin || '');
  if (p.pinHash) {
    if (!checkPinLocal(pin, p.pinSalt, p.pinHash)) return { error: 'Неверный PIN.' };
  } else if (account.token && p.remoteId) {
    try {
      await apiCall('POST', '/api/pin/verify', { profileId: p.remoteId, pin });
    } catch (err) {
      return { error: 'Неверный PIN.' };
    }
    try {
      const data = await apiCall('GET', '/api/profiles/' + p.remoteId + '/data', undefined, { pin });
      writeProfileData(p.id, data);
      p.lastSync = Date.now();
    } catch (e) {}
  }
  p.locked = false;
  activeProfileId = p.id;
  scheduleProfileSync();
  loadProfileFiles(p.id);
  persistProfiles();
  return { ok: true, state: accountState() };
});

// ---------- Smoke / regression test (enabled via MEOOW_TEST=1) ----------
function runSmokeIfEnabled() {
  if (process.env.MEOOW_TEST !== '1') return;
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const out = [];
      const errs = [];
      const run = async (label, fn) => {
        try {
          const r = await fn();
          out.push(label + '=' + JSON.stringify(r));
        } catch (err) {
          errs.push(label + ': ' + err.message);
        }
      };
      const js = (code) => win.webContents.executeJavaScript(code);
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      if (process.env.MEOOW_UI_PROBE === '1') {
        (async () => {
          const out = await js(`(async () => {
            const res = {};
            await window.meoow.addHistory({ url: 'https://example.com', title: 'Example Domain' });
            await refreshHistory();
            const v = document.querySelector('#sp-visited');
            res.droplet = !!(v && !v.classList.contains('hidden'));
            res.dropletN = v ? document.querySelectorAll('.sp-visited-item').length : 0;
            res.who = (document.querySelector('#sp-visited-host') || {}).textContent || '';
            res.badge0 = (document.querySelector('#sp-engine-name') || {}).textContent || '';
            const sel = document.querySelector('#set-engine');
            sel.value = 'google';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r2 => setTimeout(r2, 250));
            res.badge1 = (document.querySelector('#sp-engine-name') || {}).textContent || '';
            res.ph1 = (document.querySelector('#nt-search') || {}).placeholder || '';
            const btn = document.querySelector('#btn-fs');
            btn.click();
            res.fs1 = document.body.classList.contains('chrome-fullscreen') ? 'on' : 'err';
            btn.click();
            res.fs2 = document.body.classList.contains('chrome-fullscreen') ? 'on' : 'off';
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', bubbles: true }));
            res.fs3 = document.body.classList.contains('chrome-fullscreen') ? 'on' : 'off';
            sel.value = 'auto';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r2 => setTimeout(r2, 250));
            res.badge2 = (document.querySelector('#sp-engine-name') || {}).textContent || '';
            window.meoow.removeHistory('https://example.com');
            return res;
          })()`);
          console.log('UI_PROBE=' + JSON.stringify(out));
          setTimeout(() => { try { app.exit(0); } catch (e) { process.exit(0); } }, 300);
        })();
        return;
      }

      if (process.env.MEOOW_ENGINE_PROBE === '1') {
        (async () => {
          const prev = settings.searchEngine;
          for (const eng of ['google', 'yandex', 'bing', 'duckduckgo', 'lite']) {
            settings.searchEngine = eng;
            try {
              const r = await searchWeb('котики мемы');
              console.log('ENGINE_PROBE ' + eng + '=' + JSON.stringify({ src: r.source, n: r.results ? r.results.length : 0 }));
            } catch (e) {
              console.log('ENGINE_PROBE ' + eng + ' ERR=' + e.message);
            }
          }
          settings.searchEngine = prev;
          setTimeout(() => { try { app.exit(0); } catch (e) { process.exit(0); } }, 300);
        })();
        return;
      }

      if (process.env.MEOOW_FREEAI_PROBE === '1') {
        (async () => {
          try {
            const r = await callFreeChatGPT([{ role: 'user', content: 'Ответь ровно одним словом: привет!' }]);
            console.log('FREEAI_PROBE=' + (r != null ? JSON.stringify(r.slice(0, 160)) : 'null'));
          } catch (e) {
            console.log('FREEAI_PROBE_ERR=' + (e && e.message));
          }
          setTimeout(() => { try { app.exit(0); } catch (e) { process.exit(0); } }, 300);
        })();
        return;
      }

      await run('boot', () => js(`(() => ({
        tabCount: document.querySelectorAll('#tab-bar .tab').length,
        api: typeof window.meoow === 'object',
        newtab: !document.querySelector('#search-page').classList.contains('hidden')
      }))()`));

      await run('gHome', () => js(`(() => {
        const letters = Array.from(document.querySelectorAll('.g-logo > span')).map(s => s.textContent).join('');
        const c1 = getComputedStyle(document.querySelector('.gl-1')).color;
        const cy = getComputedStyle(document.querySelector('.gl-y')).color;
        const cg = getComputedStyle(document.querySelector('.gl-g')).color;
        const cr = getComputedStyle(document.querySelector('.gl-r')).color;
        const colorsOK = c1 === 'rgb(168, 50, 31)' && cy === 'rgb(224, 122, 13)' && cg === 'rgb(239, 159, 28)' && cr === 'rgb(199, 74, 16)';
        const goBtn = Array.from(document.querySelectorAll('.sp-btn:not(.danger)')).map(b => b.textContent);
        const footLinks = Array.from(document.querySelectorAll('.g-flink')).map(s => s.textContent);
        return {
          wordmark: letters,
          isMeoow: letters === 'Meoow',
          colorsOK,
          hasHeader: !!document.querySelector('.m-header'),
          headerLinks: Array.from(document.querySelectorAll('.m-link')).map(s => s.textContent),
          searchBox: !!document.querySelector('#nt-search'),
          buttons: goBtn,
          tagline: (document.querySelector('.sp-tagline') || {}).textContent || null,
          footerCountry: (document.querySelector('.g-footer-country') || {}).textContent || null,
          footLinks: footLinks,
          noGoogle: !document.querySelector('.g-lang-link') && !document.querySelector('#g-apps') && letters !== 'Google',
          scam: !!document.querySelector('#scam-overlay'),
          modes: Array.from(document.querySelectorAll('.sp-mode')).map(m => m.textContent)
        };
      })()`));

      await run('chromePts', () => js(`(() => {
        const btn = document.querySelector('#tab-add-btn');
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        const tabCovered = !!(hit && hit.closest('#search-page'));
        const bar = document.querySelector('#address-bar');
        const br = bar.getBoundingClientRect();
        const hitBar = document.elementFromPoint(Math.round(br.left + br.width / 2), Math.round(br.top + br.height / 2));
        const barCovered = !!(hitBar && hitBar.closest('#search-page'));
        return { tabAddCovered: tabCovered, addressCovered: barCovered };
      })()`));

      await run('chromeLayout', () => js(`(() => {
        const tb = document.getElementById('tab-bar').getBoundingClientRect();
        const tr = document.getElementById('toolbar').getBoundingClientRect();
        const bb = document.getElementById('bookmark-bar');
        const act = document.querySelector('.tab.active');
        const ab = document.getElementById('address-bar');
        const tabBarAboveToolbar = tb.top >= 0 && tb.bottom <= tr.top + 2;
        const activeMerges = act ? Math.abs(act.getBoundingClientRect().bottom - tr.top) < 3 : true;
        const addrPill = parseFloat(getComputedStyle(ab).borderRadius) >= 30;
        const addrVisible = ab.offsetWidth > 120 && ab.offsetHeight === 42;
        const bookmarkHiddenWhenEmpty = bb.offsetHeight === 0;
        const toolbarSane = tr.height >= 48 && tr.bottom >= tb.bottom;
        const iconsSvg = !!document.querySelector('#btn-back svg') && !!document.querySelector('#btn-star svg');
        return { tabBarAboveToolbar, activeMerges, addrPill, addrVisible, bookmarkHiddenWhenEmpty, toolbarSane, iconsSvg };
      })()`));

      await run('add3tabs', () => js(`(() => {
        const b = document.querySelector('#tab-add-btn');
        b.click(); b.click(); b.click();
        return document.querySelectorAll('#tab-bar .tab').length;
      })()`));

      await wait(200);
      await run('switchToFirst', () => js(`(() => {
        document.querySelector('#tab-bar .tab').click();
        return true;
      })()`));

      await run('homeSearch', () => js(`(() => {
        const inp = document.querySelector('#nt-search');
        inp.value = 'пример запроса';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`));
      await wait(500);
      await run('searchState1', () => js(`(() => ({
        shown: !document.querySelector('#search-page').classList.contains('hidden'),
        homeHidden: document.querySelector('#sp-home').classList.contains('hidden'),
        query: document.querySelector('#sp-search').value
      }))()`));

      await run('reSearch', () => js(`(() => {
        const inp = document.querySelector('#sp-search');
        inp.value = 'meoow re-search';
        document.querySelector('#sp-form').dispatchEvent(new Event('submit', {cancelable:true}));
        return true;
      })()`));
      await wait(500);
      await run('searchState2', () => js(`(() => ({
        shown: !document.querySelector('#search-page').classList.contains('hidden'),
        homeHidden: document.querySelector('#sp-home').classList.contains('hidden'),
        query: document.querySelector('#sp-search').value
      }))()`));

      await run('homeAgain', () => js(`(() => {
        document.querySelector('#btn-home').click();
        const inp = document.querySelector('#nt-search');
        inp.value = 'третий запрос';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`));
      await wait(500);
      await run('searchState3', () => js(`(() => ({
        shown: !document.querySelector('#search-page').classList.contains('hidden'),
        homeHidden: document.querySelector('#sp-home').classList.contains('hidden'),
        query: document.querySelector('#sp-search').value
      }))()`));

      await run('suggestApi', () => js(`window.meoow.suggest('meoow').then(r => ({ array: Array.isArray(r) }))`));

      await run('realSearch', () => js(`window.meoow.search('example.com').then(r => ({
        ok: !!(r && r.ok),
        source: (r && r.source) || null,
        n: (r && r.results && r.results.length) || 0,
        sample: (r && r.results && r.results[0] && r.results[0].url.slice(0, 40)) || ''
      }))`));

      await run('realImages', () => js(`window.meoow.searchImages('cat').then(r => ({
        ok: !!(r && r.ok),
        n: (r && r.results && r.results.length) || 0,
        sample: (r && r.results && r.results[0] && r.results[0].image.slice(0, 32)) || ''
      }))`));

      await run('realVideos', () => js(`window.meoow.searchVideos('cat videos').then(r => ({
        ok: !!(r && r.ok),
        n: (r && r.results && r.results.length) || 0,
        sample: (r && r.results && r.results[0] && r.results[0].url.slice(0, 40)) || ''
      }))`));

      await run('scamApi', () => js(`Promise.all([
        window.meoow.isRisky('https://google.com'),
        window.meoow.isRisky('https://paypa1-secure-verify-login.xyz/secure'),
        window.meoow.isRisky('http://account-verify.tinkoff.top')
      ]).then(([clean, dirty, dirtyHttp]) => ({
        cleanOk: !clean,
        dirtyOk: !!(dirty && dirty.level === 'high'),
        dirtyHttp: !!(dirtyHttp && (dirtyHttp.level === 'high' || dirtyHttp.level === 'warn')),
        reason: (dirty && dirty.reason) || ''
      }))`));

      await run('imgMode', () => js(`(async () => {
        const btn = document.querySelector('.sp-mode[data-mode="images"]');
        if (!btn) return { btn: false };
        btn.click();
        await new Promise(r => setTimeout(r, 3000));
        const grid = document.querySelector('#sp-image-grid');
        const shown = grid && !grid.classList.contains('hidden');
        const cards = grid ? grid.querySelectorAll('.sp-img-card').length : 0;
        const webListHidden = document.querySelector('#sp-list').classList.contains('hidden');
        return { btn: true, shown, cards, webListHidden };
      })()`));

      await run('vidMode', () => js(`(async () => {
        const btn = document.querySelector('.sp-mode[data-mode="videos"]');
        if (!btn) return { btn: false };
        btn.click();
        await new Promise(r => setTimeout(r, 3000));
        const grid = document.querySelector('#sp-video-grid');
        const shown = grid && !grid.classList.contains('hidden');
        const cards = grid ? grid.querySelectorAll('.sp-video-card').length : 0;
        const imagesHidden = document.querySelector('#sp-image-grid').classList.contains('hidden');
        const webListHidden = document.querySelector('#sp-list').classList.contains('hidden');
        const firstHasThumb = !!(cards && grid.querySelector('.sp-video-thumb img') && grid.querySelector('.sp-video-thumb img').getAttribute('src') || '');
        return { btn: true, shown, cards, imagesHidden, webListHidden, firstHasThumb };
      })()`));

      await run('navSubmit', () => js(`(() => {
        const bar = document.querySelector('#address-bar');
        bar.value = 'https://example.com';
        document.querySelector('#address-form').dispatchEvent(new Event('submit', {cancelable:true}));
        return true;
      })()`));
      await wait(9000);
      await run('navState', () => js(`(() => {
        const wv = document.querySelector('#content webview');
        let url = null;
        try { url = wv.getURL(); } catch (e) { url = 'err:' + e.message; }
        return { url, ready: !!(wv && wv.wvReady), backDisabled: document.querySelector('#btn-back').disabled };
      })()`));
      await run('wvSize', () => js(`(() => {
        const wv = document.querySelector('#content webview');
        if (!wv) return { found: false };
        const r = wv.getBoundingClientRect();
        let title = null;
        try { title = wv.getTitle(); } catch (e) {}
        return {
          found: true,
          visible: wv.offsetWidth > 0 && wv.offsetHeight > 0 && getComputedStyle(wv).display !== 'none',
          w: Math.round(r.width), h: Math.round(r.height),
          title
        };
      })()`));
      if (process.env.MEOOW_SHOT) {
        try {
          fs.mkdirSync(process.env.MEOOW_SHOT, { recursive: true });
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.env.MEOOW_SHOT, 'shot-web.png'), img.toPNG());
        } catch (e) { console.error('shot-web error', e); }
      }

      await run('errNav', () => js(`(() => {
        const bar = document.querySelector('#address-bar');
        bar.focus();
        bar.value = 'https://127.0.0.1:9/';
        document.querySelector('#address-form').dispatchEvent(new Event('submit', { cancelable: true }));
        return true;
      })()`));
      await wait(4500);
      await run('errPage', () => js(`(() => {
        const wv = document.querySelector('#content webview:not(.hidden)');
        if (!wv) return { wv: false };
        const r = wv.getBoundingClientRect();
        return { wv: true, w: Math.round(r.width), h: Math.round(r.height), title: (wv.getTitle() || '').slice(0, 60) };
      })()`));
      await run('goodNav', () => js(`(() => {
        const bar = document.querySelector('#address-bar');
        bar.focus();
        bar.value = 'https://example.com/';
        document.querySelector('#address-form').dispatchEvent(new Event('submit', { cancelable: true }));
        return true;
      })()`));
      await wait(4500);
      await run('backGood', () => js(`(() => {
        const wv = document.querySelector('#content webview:not(.hidden)');
        return { errHidden: !!wv, title: document.title, wvTitle: wv ? (wv.getTitle() || '') : '' };
      })()`));

      await run('navBackSearch', () => js(`(async () => {
        // From a real web page, press back until we return to a search/home page (app-level history)
        let iterations = 0;
        while (document.querySelector('#search-page').classList.contains('hidden') && iterations++ < 30) {
          document.querySelector('#btn-back').click();
          await new Promise(r => setTimeout(r, 250));
        }
        return {
          backOnSearch: !document.querySelector('#search-page').classList.contains('hidden'),
          iterations
        };
      })()`));

      await run('findTog', () => js(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
        const opened = !document.querySelector('#findbar').classList.contains('hidden') && !!document.querySelector('#find-input');
        document.querySelector('#find-close').click();
        const closedAgain = document.querySelector('#findbar').classList.contains('hidden');
        return { opened, closedAgain };
      })()`));

      await run('addrSuggest', () => js(`(async () => {
        const bar = document.querySelector('#address-bar');
        bar.focus();
        bar.value = 'exam';
        bar.dispatchEvent(new Event('input', {bubbles:true}));
        const box = document.querySelector('#addr-suggest');
        let items = 0;
        let visible = false;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 100));
          items = box.querySelectorAll('.addr-item').length;
          visible = !box.classList.contains('hidden');
          if (visible && items > 0) break;
        }
        bar.value = '';
        bar.dispatchEvent(new Event('input', {bubbles:true}));
        document.querySelector('#address-bar').blur();
        return { items, visible };
      })()`));

      await run('bmClick', () => js(`(() => { document.querySelector('#btn-star').click(); return true; })()`));
      await wait(400);
      await run('bmState', () => js(`(() => ({
        pills: document.querySelectorAll('.bookmark-pill').length,
        starActive: document.querySelector('#btn-star').classList.contains('active')
      }))()`));

      await run('dialCheck', () => js(`(async () => {
        document.querySelector('#btn-home').click();
        await new Promise(r => setTimeout(r, 400));
        const hosts = Array.from(document.querySelectorAll('.sp-visited-host')).map(t => t.textContent);
        return { droplet: !!document.querySelector('#sp-visited') && !document.querySelector('#sp-visited').classList.contains('hidden'), hosts, hasExample: hosts.some(h => h.indexOf('example.com') !== -1) };
      })()`));

      await run('mgrState', () => js(`(() => {
        document.querySelector('#btn-menu').click();
        document.querySelector('#menu-bookmarks').click();
        const rows = document.querySelectorAll('#manager-list .manager-item').length;
        document.querySelector('#manager-close').click();
        return { rows };
      })()`));

      await run('openSettings', () => js(`(() => {
        document.querySelector('#btn-menu').click();
        document.querySelector('#menu-settings').click();
        return !document.querySelector('#settings').classList.contains('hidden');
      })()`));

      await run('aiPanel', () => js(`(() => {
        const btn = document.querySelector('#btn-ai');
        if (!btn) return { btn: false };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true }));
        const opened = !document.querySelector('#ai-panel').classList.contains('hidden');
        const btnOn = !!document.querySelector('#btn-ai') && !document.querySelector('#ai-panel').classList.contains('hidden');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { btn: true, opened, btnOn };
      })()`));
      await run('aiAskApi', () => js(`window.meoow.aiAsk('что такое electron').then(r => ({
        ok: !!(r && r.ok),
        mode: (r && r.mode) || null,
        textLen: (r && r.text && r.text.length) || 0,
        srcs: (r && r.sources && r.sources.length) || 0
      }))`));
      await run('localCmds', () => js(`(async () => {
        const directMath = AI.tryCommand('сколько будет 17*249');
        const directTime = AI.tryCommand('который час');
        const panelOpen = (() => {
          document.querySelector('#btn-ai').click();
          return !document.querySelector('#ai-panel').classList.contains('hidden');
        })();
        const inp = document.querySelector('#ai-input');
        const send = document.querySelector('#ai-send');
        inp.value = 'сколько будет 17*249';
        send.click();
        await new Promise(r => setTimeout(r, 800));
        const lastMsg = document.querySelector('#ai-messages .ai-msg.bot:last-child');
        const mathOk = !!(lastMsg && lastMsg.textContent.indexOf('4233') !== -1);
        inp.value = 'который час';
        send.click();
        await new Promise(r => setTimeout(r, 800));
        const lastMsg2 = document.querySelector('#ai-messages .ai-msg.bot:last-child');
        const timeOk = !!(lastMsg2 && /\\d{2}:\\d{2}/.test(lastMsg2.textContent));
        const chitOk = !!AI.tryCommand('как дела');
        const followEmpty = !!AI.tryCommand('ещё');
        const greetOk = !!AI.tryCommand('привет');
        const outsideClose = (() => {
          document.querySelector('#btn-ai').click();
          return !document.querySelector('#ai-panel').classList.contains('hidden');
        })();
        document.querySelector('#tab-bar').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 330));
        const outsideClosed = document.querySelector('#ai-panel').classList.contains('hidden');
        const p = document.querySelector('#ai-panel');
        const reopenAfterOpen = (() => {
          document.querySelector('#btn-ai').click();
          return !p.classList.contains('hidden');
        })();
        document.querySelector('#btn-ai').click();
        document.querySelector('#btn-ai').click();
        await new Promise(r => setTimeout(r, 400));
        const reopenAfterWait = !p.classList.contains('hidden');
        const reopen = { afterOpen: reopenAfterOpen, afterWait: reopenAfterWait };
        const panelOpen2 = !document.querySelector('#ai-panel').classList.contains('hidden');
        return { directMath, directTime, panelOpen, mathOk, timeOk, chitOk, followEmpty, greetOk, outsideClose, outsideClosed, reopen, panelOpen2 };
      })()`));
      await run('setThemeDark', () => js(`(async () => {
        const sel = document.querySelector('#set-theme');
        sel.value = 'dark';
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        await new Promise(r => setTimeout(r, 300));
        return { dark: document.body.classList.contains('theme-dark'), val: document.querySelector('#set-theme').value };
      })()`));
      await run('setEngineBing', () => js(`(() => {
        const sel = document.querySelector('#set-engine');
        sel.value = 'bing';
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        return sel.value;
      })()`));
      await run('setNewTabBlank', () => js(`(() => {
        const sel = document.querySelector('#set-newtab');
        sel.value = 'blank';
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        return true;
      })()`));
      await run('blankTabTitle', () => js(`(() => {
        document.querySelector('#settings-close').click();
        document.querySelector('#tab-add-btn').click();
        const el = document.querySelector('#tab-bar .tab.active .tab-title');
        const title = el ? el.textContent : null;
        const close = document.querySelector('#tab-bar .tab.active .tab-close');
        close.click();
        return { title, settingsHidden: document.querySelector('#settings').classList.contains('hidden') };
      })()`));
      await run('restoreSettings', () => js(`window.meoow.resetSettings().then(s => ({
        engine: s.searchEngine, theme: s.theme, newtab: s.newTabPage, zoom: s.zoom
      }))`));

      await run('featureToggles', () => js(`(async () => {
        document.querySelector('#btn-menu').click();
        document.querySelector('#menu-settings').click();
        const boxes = {
          scrollbar: document.querySelector('#set-scrollbar'),
          darksites: document.querySelector('#set-darksites'),
          scam: document.querySelector('#set-scam'),
          notif: document.querySelector('#set-notif')
        };
        const exists = !!(boxes.scrollbar && boxes.darksites && boxes.scam && boxes.notif);
        let toggled = false, restored = false;
        if (exists) {
          const sbBefore = boxes.scrollbar.checked;
          boxes.scrollbar.click();
          await new Promise(r => setTimeout(r, 200));
          const s1 = await window.meoow.getSettings();
          toggled = s1.customScrollbar !== sbBefore;
          boxes.scrollbar.click();
          await new Promise(r => setTimeout(r, 200));
          const s2 = await window.meoow.getSettings();
          restored = s2.customScrollbar === sbBefore;
        }
        document.querySelector('#settings-close').click();
        return { exists, toggled, restored };
      })()`));

      await run('closeSome', () => js(`(() => {
        let n = document.querySelectorAll('#tab-bar .tab').length;
        let guard = 0;
        while (n > 1 && guard++ < 20) {
          const t = document.querySelector('#tab-bar .tab.active') || document.querySelector('#tab-bar .tab');
          if (!t) break;
          const c = t.querySelector('.tab-close');
          c.click();
          n = document.querySelectorAll('#tab-bar .tab').length;
        }
        return n;
      })()`));

      const total = await js(`document.querySelectorAll('#tab-bar .tab').length`);
      out.push('final=' + total);

      if (process.env.MEOOW_SHOT) {
        try {
          fs.mkdirSync(process.env.MEOOW_SHOT, { recursive: true });
          await run('shotHome', () => js(`(() => { document.querySelector('#btn-home').click(); return true; })()`));
          await wait(1000);
          let img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.env.MEOOW_SHOT, 'shot-home.png'), img.toPNG());
        } catch (e) {
          console.error('shot error', e);
        }
      }

      console.log('TEST_OUT ' + out.join(' | '));
      if (errs.length) console.log('TEST_ERRS ' + errs.join(' | '));
      app.quit();
    }, 2000);
  });
}