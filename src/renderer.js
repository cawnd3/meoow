/* Meoow Browser - renderer UI logic */

const tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bookmarks = [];
let history = [];
let managerMode = 'bookmarks';
let settings = {};
let renderSeq = 0;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let addressBarFocused = false;

const HOME_URL = 'meoow:home';
const NEW_TAB_PAGE = 'meoow:home';
const SEARCH_PREFIX = 'meoow:search?q=';

// ---------- Язык интерфейса (i18n) ----------
let CURRENT_LANG = 'ru';
function t(key) {
  const tables = window.MEOOW_L10N || {};
  const table = tables[CURRENT_LANG] || tables.en || {};
  const ru = tables.ru || {};
  return table[key] || ru[key] || key;
}
function applyLanguage() {
  CURRENT_LANG = settings.lang || 'ru';
  document.documentElement.lang = CURRENT_LANG;
  document.title = 'Meoow Browser';
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  $$('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  applyEngineUI();
}

// ---------- Темы оформления ----------
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 246, g: 238, b: 224 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function hexToHsl(hex) { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); }
function adjustHex(hex, dh, ds, dl) {
  const { h, s, l } = hexToHsl(hex);
  const r = hslToRgb(h + dh, s + ds, l + dl);
  return rgbToHex(r.r, r.g, r.b);
}
function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function lumaOf(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function lighten(hex, dl) { return adjustHex(hex, 0, 0, dl); }
function darken(hex, dl) { return adjustHex(hex, 0, 0, -dl); }
function buildTheme(bg, accent) {
  const isDark = lumaOf(bg) < 0.45;
  const chromeBg = isDark ? lighten(bg, 14) : darken(bg, 34);
  const primaryHex = isDark ? lighten(accent, 28) : accent;
  return {
    'bg': bg,
    'chrome-bg': chromeBg,
    'toolbar-bg': chromeBg,
    'chrome-tint': isDark ? lighten(chromeBg, 6) : lighten(chromeBg, 8),
    'surface': isDark ? lighten(bg, 6) : lighten(bg, 4),
    'surface2': isDark ? lighten(bg, 12) : darken(bg, 6),
    'surface3': isDark ? lighten(bg, 20) : darken(bg, 12),
    'primary': primaryHex,
    'primary-strong': isDark ? lighten(accent, 14) : darken(accent, 10),
    'primary-soft': withAlpha(primaryHex, isDark ? 0.18 : 0.12),
    'accent': accent,
    'gold': adjustHex(accent, 30, 4, isDark ? 6 : -6),
    'text': isDark ? lighten(bg, 72) : darken(bg, 58),
    'muted': isDark ? lighten(bg, 44) : darken(bg, 30),
    'border': isDark ? lighten(bg, 18) : darken(bg, 13),
    'tab-active': chromeBg,
    'tab-inactive': withAlpha(primaryHex, isDark ? 0.14 : 0.08),
    'danger': isDark ? '#ff5a47' : '#c9301f',
    'green-url': isDark ? '#8fdc7f' : '#4d7c2f',
    'gl-1': isDark ? lighten(accent, 12) : darken(accent, 14),
    'gl-r': accent,
    'gl-y': adjustHex(accent, 4, 8, isDark ? 20 : 8),
    'gl-g': adjustHex(accent, 8, 14, isDark ? 22 : 14),
    'gl-b': adjustHex(accent, -14, -6, isDark ? 8 : -16),
    'ink': isDark ? lighten(bg, 72) : lighten(chromeBg, 82),
    'ink-dim': isDark ? lighten(bg, 44) : lighten(chromeBg, 56),
  };
}
const THEMES = {
  light: {
    'bg': '#f6eee0', 'chrome-bg': '#3a2b1e', 'toolbar-bg': '#3a2b1e', 'chrome-tint': '#45321f',
    'surface': '#fff9ee', 'surface2': '#f3e7d0', 'surface3': '#e9d9bb',
    'primary': '#c7410f', 'primary-strong': '#a3330c', 'primary-soft': 'rgba(199,65,15,.12)',
    'accent': '#d97706', 'gold': '#f1a208',
    'text': '#4a3a2a', 'muted': '#9a8a72', 'border': '#dccbb0',
    'tab-active': '#3a2b1e', 'tab-inactive': 'rgba(255,235,205,.08)',
    'danger': '#c9301f', 'green-url': '#4d7c2f',
    'gl-1': '#a8321f', 'gl-r': '#c74a10', 'gl-y': '#e07a0d', 'gl-g': '#ef9f1c', 'gl-b': '#8c5210',
    'ink': '#f6ead6', 'ink-dim': '#cfc0a6',
  },
  dark: {
    'bg': '#17120c', 'chrome-bg': '#231a11', 'toolbar-bg': '#231a11', 'chrome-tint': '#2b2013',
    'surface': '#241b11', 'surface2': '#322516', 'surface3': '#42301c',
    'primary': '#fb8b57', 'primary-strong': '#ff6b3d', 'primary-soft': 'rgba(251,139,87,.18)',
    'accent': '#f5b342', 'gold': '#f5a623',
    'text': '#f4e8d8', 'muted': '#b29f87', 'border': '#4a3a28',
    'tab-active': '#231a11', 'tab-inactive': 'rgba(251,139,87,.14)',
    'danger': '#ff5a47', 'green-url': '#8fdc7f',
    'gl-1': '#ff5f52', 'gl-r': '#ff8a4d', 'gl-y': '#ffa940', 'gl-g': '#ffc15e', 'gl-b': '#e8b65c',
    'ink': '#f4e8d8', 'ink-dim': '#c9b79e',
  },
  ocean: buildTheme('#eef6fb', '#0f62a8'),
  forest: buildTheme('#f0f6e9', '#2e7d32'),
  rose: buildTheme('#fdf3f6', '#b83280'),
  midnight: buildTheme('#10141f', '#7f9cf5'),
};
function applyTheme(theme) {
  const tname = theme || 'light';
  let map;
  if (tname === 'light') map = THEMES.light;
  else if (tname === 'dark') map = THEMES.dark;
  else if (tname === 'custom') map = buildTheme(settings.customBg || '#f6eee0', settings.customAccent || '#c7410f');
  else map = THEMES[tname] || THEMES.light;
  const isDark = tname === 'dark' || tname === 'midnight' || (tname === 'custom' && lumaOf(settings.customBg || '#f6eee0') < 0.45);
  document.body.classList.toggle('theme-dark', isDark);
  for (const k in map) {
    document.body.style.setProperty('--' + k, map[k]);
  }
}

// ---------- Utilities ----------
function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function faviconFor(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function displayTitle(tab) {
  if (tab.pageType === 'home') return t('newTabTitle');
  if (tab.pageType === 'search') return tab.query || t('newTabSearch');
  if (tab.pageType === 'settings') return t('settingsTitle');
  if (!tab.title) {
    if (!tab.url || tab.url === 'about:blank') return t('newTabTitle');
    return hostOf(tab.url) || 'Meoow';
  }
  return tab.title;
}

const MEOOW_COLORS = ['#FF5E62', '#FFB020', '#8B5CF6', '#14B8A6', '#38BDF8', '#F472B6', '#3B82F6', '#10B981'];

function paletteColor(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return MEOOW_COLORS[h % MEOOW_COLORS.length];
}

function isSearchHomeTarget(url) {
  return typeof url === 'string' && /^meoow:home$/i.test(url);
}

function isSearchTarget(url) {
  return typeof url === 'string' && /^meoow:search\?q=/i.test(url);
}

function searchQueryOf(url) {
  const m = String(url || '').match(/^meoow:search\?q=(.*)$/i);
  if (m) { try { return decodeURIComponent(m[1]); } catch {} }
  return '';
}

function pluralRu(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function newTabTarget() {
  return settings.newTabPage === 'blank' ? 'about:blank' : NEW_TAB_PAGE;
}

function applyZoom(factor) {
  tabs.forEach(t => {
    const wv = t.webview;
    if (wv && wv.wvReady) {
      try { wv.setZoomFactor((factor || 100) / 100); } catch (e) {}
    }
  });
}

// Try to treat the string as a URL; otherwise search.
function resolveInput(text) {
  text = text.trim();
  if (!text) return null;
  if (/^meoow:(home|search)/i.test(text)) return text;
  const hasSpace = /\s/.test(text);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const hasDotOrPort = /^[\w-]+(\.[\w-]+)+/.test(text) || /^[\w-]+:\d+/.test(text);
  const isLocalhost = /^localhost(:\d+)?(\/.*)?$/i.test(text);
  const looksLikeUrl = hasScheme || ((!hasSpace && (hasDotOrPort || isLocalhost)));
  if (looksLikeUrl) {
    return hasScheme ? text : 'https://' + text;
  }
  return SEARCH_PREFIX + encodeURIComponent(text);
}

// ---------- Tab creation ----------
function createTab(url, { inBackground = false } = {}) {
  const isNew = !url || isSearchHomeTarget(url);
  const isSearch = !isNew && isSearchTarget(url);
  const id = ++tabCounter;
  const tab = {
    id,
    url: isNew ? NEW_TAB_PAGE : url,
    pageType: isNew ? 'home' : (isSearch ? 'search' : 'web'),
    title: isNew ? t('newTabTitle') : (isSearch ? (searchQueryOf(url) || 'Meoow') : hostOf(url)),
    query: isSearch ? searchQueryOf(url) : null,
  };
  initTabHistory(tab);
  if (!isNew) pushHistory(tab, entryFor(tab));
  tabs.push(tab);
  renderTabs();
  if (!inBackground) activateTab(id);
  return tab;
}

function tabElement(id) { return $(`.tab[data-id="${id}"]`); }

function buildWebview(tab) {
  const wv = document.createElement('webview');
  wv.id = `webview-${tab.id}`;
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('allowfullscreen', '');
  wv.setAttribute('partition', 'persist:meoow');
  wv.classList.add('hidden');
  $('#content').appendChild(wv);

  wv.addEventListener('dom-ready', () => {
    tab.wvReady = true;
    wv.wvReady = true;
    try { wv.setZoomFactor((settings.zoom || 100) / 100); } catch (e) {}
    try {
      wv.getWebContents().on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const handled = handleGlobalKey({ key: input.key, ctrl: !!input.control, alt: !!input.alt, shift: !!input.shift });
        if (handled) event.preventDefault();
      });
    } catch (e) {}
    renderTabs();
    updateNavButtons();
    refreshStar();
    if (tab.url && tab.pageType === 'web' && tab.url !== NEW_TAB_PAGE && !tab.urlLoaded && !wv.src) {
      wv.src = tab.url;
      tab.urlLoaded = true;
    }
  });
  wv.addEventListener('did-navigate', () => {
    const u = wv.getURL();
    tab.url = u;
    tab.pageType = 'web';
    tab.favicon = null;
    tab.title = '';
    // Keep app history in sync with the loaded page when it was reached internally
    if (tab.history && tab.histPos >= 0) {
      tab.history[tab.histPos] = { type: 'web', url: u, query: null };
    }
    updateAddressBar();
    updateNavButtons();
    refreshStar();
    if (isHttpUrl(u)) window.meoow.addHistory({ url: u, title: tab.title || hostOf(u) });
    refreshHistory();
  });
  wv.addEventListener('did-navigate-in-page', () => {
    const u = wv.getURL();
    if (u === tab.url) return; // ignore duplicate events
    tab.url = u;
    updateAddressBar();
    updateNavButtons();
    if (isHttpUrl(u)) window.meoow.addHistory({ url: u, title: tab.title || hostOf(u) });
  });
  wv.addEventListener('page-title-updated', (e) => {
    const u = wv.getURL();
    tab.url = u || tab.url;
    tab.title = e.title;
    renderTabs();
    if (isHttpUrl(u)) window.meoow.addHistory({ url: u, title: e.title });
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    const icons = e.favicons;
    if (icons && icons.length) tab.favicon = icons[icons.length - 1];
    renderTabs();
  });
  wv.addEventListener('did-start-loading', () => {
    const u = wv.getURL();
    if (u) checkRisky(wv, u);
  });
  wv.addEventListener('did-start-navigation', (e) => {
    if (e.isMainFrame && e.url) checkRisky(wv, e.url);
  });
  wv.addEventListener('did-finish-load', () => {
    renderTabs();
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    updateNavButtons();
    const tab = currentTab();
    if (tab && tab.webview === wv) hideScam();
  });
  wv.addEventListener('new-window', (e) => {
    if (e.url) createTab(e.url);
  });
  wv.addEventListener('context-menu', (e) => {
    openContextMenu(e, wv);
  });
  return wv;
}

function activateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeTabId = id;
  hideScam();

  if (tab.pageType === 'settings') {
    hideSearchPage();
    hideAllWebviews();
    populateSettings();
    $('#settings').classList.remove('hidden');
    renderTabs();
    updateAddressBar();
    updateNavButtons();
    refreshStar();
    return;
  }

  if (tab.pageType === 'profiles') {
    hideSearchPage();
    hideAllWebviews();
    populateProfiles();
    $('#profiles').classList.remove('hidden');
    renderTabs();
    updateAddressBar();
    updateNavButtons();
    refreshStar();
    return;
  }

  if (tab.pageType === 'home' || tab.pageType === 'search') {
    showSearchPage(tab);
    renderTabs();
    updateAddressBar();
    updateNavButtons();
    refreshStar();
    return;
  }

  hideSearchPage();
  hideAllWebviews();
  if (!tab.webview) tab.webview = buildWebview(tab);
  tab.webview.classList.remove('hidden');
  if (tab.url !== NEW_TAB_PAGE && !tab.urlLoaded && !tab.webview.src) {
    tab.webview.src = tab.url;
    tab.urlLoaded = true;
  }

  renderTabs();
  updateAddressBar();
  updateNavButtons();
  refreshStar();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.webview) tab.webview.remove();
  tabs.splice(idx, 1);
  if (activeTabId === id) {
    activeTabId = null;
    const next = tabs[Math.min(idx, tabs.length - 1)];
    if (next) activateTab(next.id);
    else {
      keepOneOrCloseWindow();
    }
  } else {
    renderTabs();
  }
}

function keepOneOrCloseWindow() {
  if (tabs.length === 0) {
    createTab(newTabTarget());
  } else {
    renderTabs();
  }
}

// ---------- Rendering ----------
let lastTabState = '';
function renderTabs() {
  const stateKey = tabs.map(t =>
    t.id + '|' + (t.id === activeTabId ? 1 : 0) + '|' + (t.favicon || '') + '|' + displayTitle(t)
  ).join('\n');
  if (stateKey === lastTabState) {
    syncWindowTitle();
    return;
  }
  lastTabState = stateKey;
  const bar = $('#tab-bar');
  const scrollLeft = bar.scrollLeft;
  // Remove tab buttons, keep the add button
  $$('#tab-bar .tab').forEach(x => x.remove());

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.id = tab.id;

    const fav = document.createElement('span');
    fav.className = 'tab-favicon';
    if (tab.favicon) {
      fav.innerHTML = '';
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.style.width = '16px'; img.style.height = '16px';
      fav.appendChild(img);
    } else {
      let ch = 'M';
      if (tab.pageType === 'search') ch = 'П';
      else if (tab.pageType === 'settings') ch = 'Н';
      else if (tab.pageType === 'web') {
        const h = hostOf(tab.url || '');
        if (h && h.charAt(0)) ch = h.charAt(0).toUpperCase();
      }
      fav.textContent = ch;
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = displayTitle(tab);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.appendChild(fav);
    el.appendChild(title);
    el.appendChild(close);
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab.id);
    });
    el.addEventListener('click', () => activateTab(tab.id));

    enableTabDrag(el, tab.id);

    bar.insertBefore(el, $('#tab-add-btn'));
  });
  bar.scrollLeft = scrollLeft;
  syncWindowTitle();
}

function syncWindowTitle() {
  const tab = currentTab();
  const t = tab ? displayTitle(tab) : 'Meoow Browser';
  window.meoow.setTitle(t);
}

// ---------- Tab drag & reorder ----------
let tabDragState = null;

function enableTabDrag(el, tabId) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.tab-close')) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
        dragging = true;
        try { document.body.setPointerCapture(ev.pointerId); } catch (e) {}
        beginTabDrag(el, tabId, startX, startY);
      }
      moveTabDrag(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragging) endTabDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

}

function beginTabDrag(el, tabId, startX, startY) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.className = 'tab tab-ghost';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  const ph = document.createElement('div');
  ph.className = 'tab-ph';
  ph.style.width = r.width + 'px';
  el.classList.add('tab-dragging');
  el.replaceWith(ph);
  document.body.appendChild(ghost);
  ghost.style.left = r.left + 'px';
  ghost.style.top = r.top + 'px';
  tabDragState = { tabId, el, ph, ghost, startX, startY };
}

function moveTabDrag(x, y) {
  const s = tabDragState;
  if (!s) return;
  s.ghost.style.transform = 'translate(' + (x - s.startX) + 'px,' + (y - s.startY) + 'px)';
  updateDragInsert(x);
}

function updateDragInsert(px) {
  const s = tabDragState;
  if (!s) return;
  const bar = $('#tab-bar');
  const els = Array.from(bar.querySelectorAll('.tab:not(.tab-ghost):not(.tab-ph)'));
  let ref = $('#tab-add-btn');
  for (const t of els) {
    const r = t.getBoundingClientRect();
    if (px < r.left + r.width / 2) { ref = t; break; }
  }
  if (s.ph.nextSibling !== ref) {
    const before = new Map(els.map(t => [t, t.getBoundingClientRect().left]));
    bar.insertBefore(s.ph, ref);
    els.forEach((t) => {
      const dx = before.get(t) - t.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5) t.style.transform = 'translateX(' + dx + 'px)';
    });
    requestAnimationFrame(() => {
      els.forEach((t) => {
        if (t.style.transform) {
          t.style.transition = 'transform .16s ease';
          t.style.transform = '';
        }
      });
    });
    setTimeout(() => els.forEach(t => { t.style.transition = ''; t.style.transform = ''; }), 200);
  }
}

function endTabDrag() {
  const s = tabDragState;
  if (!s) return;
  const bar = $('#tab-bar');
  const phRect = s.ph.getBoundingClientRect();
  const gr = s.ghost.getBoundingClientRect();
  try { bar.insertBefore(s.el, s.ph); } catch (e) {}
  s.ph.remove();
  s.el.classList.remove('tab-dragging');
  const ids = Array.from(bar.querySelectorAll('.tab:not(.tab-ghost)')).map(t => t.dataset.id);
  const from = tabs.findIndex(t => t.id === s.tabId);
  const to = ids.indexOf(s.tabId);
  if (from !== -1 && to !== -1 && from !== to) {
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
  }
  s.ghost.style.transition = 'transform .18s ease';
  s.ghost.style.transform = 'translate(' + (phRect.left - gr.left) + 'px,' + (phRect.top - gr.top) + 'px)';
  setTimeout(() => { s.ghost.remove(); }, 190);
  tabDragState = null;
  syncWindowTitle();
}

// ---------- Navigation ----------
// App-level navigation history (works across home/search/web, unlike webview history)
function initTabHistory(tab) {
  tab.history = [];
  tab.histPos = -1;
}

function entryFor(tab) {
  if (tab.pageType === 'home') return { type: 'home', url: NEW_TAB_PAGE, query: null };
  if (tab.pageType === 'search') return { type: 'search', url: tab.url, query: tab.query };
  return { type: 'web', url: tab.url || (tab.webview && tab.webview.getURL()) || '', query: null };
}

function pushHistory(tab, entry) {
  if (!tab.history) initTabHistory(tab);
  tab.history = tab.history.slice(0, tab.histPos + 1);
  tab.history.push(entry);
  if (tab.history.length > 100) tab.history.shift();
  tab.histPos = tab.history.length - 1;
}

function canGoAppBack(tab) {
  return !!(tab && tab.history && tab.histPos > 0);
}
function canGoAppForward(tab) {
  return !!(tab && tab.history && tab.histPos >= 0 && tab.histPos < tab.history.length - 1);
}

function applyEntry(tab, entry) {
  const ov = $('#scam-overlay');
  if (ov && !ov.classList.contains('hidden')) ov.classList.add('hidden');
  if (entry.type === 'home') {
    tab.pageType = 'home';
    tab.url = NEW_TAB_PAGE;
    tab.title = t('newTabTitle');
    tab.query = null;
    showSearchPage(tab);
  } else if (entry.type === 'search') {
    tab.pageType = 'search';
    tab.url = entry.url;
    tab.query = entry.query;
    tab.title = entry.query || 'Поиск';
    showSearchPage(tab);
    renderSearchResults(tab);
  } else {
    hideSearchPage();
    if (tab.pageType === 'home' || tab.pageType === 'search') {
      tab.pageType = 'web';
      tab.favicon = null;
      tab.urlLoaded = false;
      tab.query = null;
    }
    tab.url = entry.url;
    if (tab.webview) {
      tab.webview.classList.remove('hidden');
      if (!tab.webview.wvReady) {
        // Webview not attached yet: dom-ready will trigger the load from tab.url
        tab.urlLoaded = false;
        if (!tab.webview.src || tab.webview.src !== entry.url) tab.webview.src = entry.url;
      } else {
        tab.webview.src = entry.url;
      }
      tab.urlLoaded = true;
    }
  }
  updateAddressBar();
  updateNavButtons();
  renderTabs();
  refreshStar();
}

function navigateTab(tabId, input, opts = {}) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const target = resolveInput(input);
  if (!target) return;

  let entry;
  if (isSearchHomeTarget(target)) {
    entry = { type: 'home', url: NEW_TAB_PAGE, query: null };
  } else if (isSearchTarget(target)) {
    entry = { type: 'search', url: target, query: searchQueryOf(target) || input };
  } else {
    entry = { type: 'web', url: target, query: null };
  }

  if (entry.type === 'web' && !tab.webview) tab.webview = buildWebview(tab);

  if (opts.push === false && tab.history && tab.histPos >= 0) {
    // Replace current entry (used after risky go-through / reloads)
    tab.history[tab.histPos] = entry;
  } else {
    pushHistory(tab, entry);
  }

  applyEntry(tab, entry);
}

function goBack() {
  const tab = currentTab();
  if (!canGoAppBack(tab)) return;
  tab.histPos--;
  applyEntry(tab, tab.history[tab.histPos]);
}

function goForward() {
  const tab = currentTab();
  if (!canGoAppForward(tab)) return;
  tab.histPos++;
  applyEntry(tab, tab.history[tab.histPos]);
}

// ---------- Scam protection ----------
let scamPending = null;
function hideScam() {
  const ov = $('#scam-overlay');
  if (ov) ov.classList.add('hidden');
  scamPending = null;
}
async function checkRisky(wv, url) {
  if (!url || !isHttpUrl(url)) return;
  if (settings.scamProtection === false) return;
  if (!window.meoow.isRisky) return;
  const tab = currentTab();
  if (!tab || tab.webview !== wv) return;
  if (tab.allowedUrls && tab.allowedUrls[url]) return;
  let verdict = null;
  try { verdict = await window.meoow.isRisky(url); } catch (e) { return; }
  if (!verdict) return;
  if (verdict.level === 'warn') {
    // Soft warning: just toast-less; show overlay only for high.
    return;
  }
  tab.blockedUrl = url;
  scamPending = url;
  const ov = $('#scam-overlay');
  const urlEl = ov.querySelector('.scam-url');
  urlEl.textContent = url;
  const note = ov.querySelector('.scam-note');
  note.textContent = 'Проверено защитой Meoow от фишинга. ' + (verdict.reason || '');
  ov.classList.remove('hidden');
  wv.stop();
}

function currentTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function currentWebview() {
  const tab = currentTab();
  return tab && tab.webview;
}

function updateAddressBar() {
  const tab = currentTab();
  const barInput = $('#address-bar');
  if (addressBarFocused) return;
  if (!tab) { barInput.value = ''; return; }
  if (tab.pageType === 'home') barInput.value = '';
  else if (tab.pageType === 'search') barInput.value = tab.query || '';
  else if (tab.pageType === 'settings') barInput.value = '';
  else barInput.value = tab.url;
}

function updateNavButtons() {
  const tab = currentTab();
  $('#btn-back').disabled = !canGoAppBack(tab);
  $('#btn-forward').disabled = !canGoAppForward(tab);
}

async function isPageBookmarked(url) {
  return window.meoow.isBookmarked(url);
}

async function refreshStar() {
  const tab = currentTab();
  const btn = $('#btn-star');
  if (!tab || tab.pageType !== 'web' || !tab.url) { btn.classList.remove('active'); return; }
  const bm = await isPageBookmarked(tab.url);
  btn.classList.toggle('active', bm);
}

// ---------- Search page (home + results) ----------
function hideAllWebviews() {
  $$('#content webview').forEach(x => x.classList.add('hidden'));
}

function hideSearchPage() {
  $('#search-page').classList.add('hidden');
  $('#settings').classList.add('hidden');
}

function showSearchPage(tab) {
  hideAllWebviews();
  $('#settings').classList.add('hidden');
  $('#search-page').classList.remove('hidden');
  $$('.sg-box').forEach(x => x.classList.add('hidden'));
  const isHome = tab.pageType === 'home';
  $('#sp-home').classList.toggle('hidden', !isHome);
  $('#sp-results').classList.toggle('hidden', isHome);
  if (isHome) {
    setTimeout(() => {
      $('#nt-search').focus();
      renderVisitedPanel();
    }, 30);
  } else {
    const q = tab.query || '';
    $('#sp-search').value = q;
    renderSearchResults(tab);
  }
}

function renderSearchResults(tab, pre) {
  const q = (tab.query || '').trim();
  const list = $('#sp-list');
  const status = $('#sp-status');
  const grid = $('#sp-image-grid');
  const vgrid = $('#sp-video-grid');
  const mode = tab.searchMode || 'web';
  const mySeq = ++renderSeq;
  list.innerHTML = '';
  if (grid) grid.innerHTML = '';
  if (vgrid) vgrid.innerHTML = '';
  $$('.sp-mode').forEach(m => m.classList.toggle('active', m.dataset.mode === mode));
  if (!q) { status.classList.add('hidden'); return; }

  const renderWeb = (res) => {
    const ct = currentTab();
    if (mySeq !== renderSeq || tab.id !== activeTabId || !ct || ct.pageType !== 'search') return;
    status.classList.add('hidden');
    if (grid) grid.classList.add('hidden');
    if (vgrid) vgrid.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '';
    const showError = (msg) => {
      const el = document.createElement('div');
      el.className = 'sp-error';
      el.textContent = msg;
      list.appendChild(el);
    };
    if (!res || !res.ok || !res.results || res.results.length === 0) {
      showError(res && res.error ? 'Не удалось получить результаты поиска. ' + res.error : 'Ничего не найдено.');
      return;
    }
    const seen = {};
    let added = 0;
    const items = [];
    res.results.forEach(r => {
      if (!r.url || seen[r.url]) return;
      seen[r.url] = true;
      added++;
      const item = document.createElement('div');
      item.className = 'sp-item';
      const head = document.createElement('div');
      head.className = 'sp-item-head';
      const fav = document.createElement('span');
      fav.className = 'sp-item-fav';
      const favImg = document.createElement('img');
      favImg.src = faviconFor(r.url) || '';
      favImg.alt = '';
      favImg.addEventListener('error', () => { favImg.remove(); fav.textContent = hostOf(r.url).charAt(0).toUpperCase(); });
      fav.appendChild(favImg);
      const a = document.createElement('a');
      a.className = 'sp-item-title';
      a.href = r.url;
      a.textContent = r.title || hostOf(r.url);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const t = currentTab();
        if (t) navigateTab(t.id, r.url);
      });
      head.appendChild(fav);
      head.appendChild(a);
      item.appendChild(head);
      const u = document.createElement('div');
      u.className = 'sp-item-url';
      u.textContent = hostOf(r.url);
      item.appendChild(u);
      if (r.snippet) {
        const s = document.createElement('div');
        s.className = 'sp-item-snippet';
        s.textContent = r.snippet;
        item.appendChild(s);
      }
      items.push(item);
    });
    if (!added) { showError('Ничего не найдено.'); return; }
    const src = document.createElement('div');
    src.className = 'sp-source';
    const prov = (res && res.source) ? ' · источник: ' + res.source : '';
    src.textContent = 'Meoow Search: «' + q + '» — ' + added + ' ' + pluralRu(added, 'результат', 'результата', 'результатов') + prov;
    list.appendChild(src);
    items.forEach(x => list.appendChild(x));
  };

  const renderImages = (res) => {
    const ct = currentTab();
    if (mySeq !== renderSeq || tab.id !== activeTabId || !ct || ct.pageType !== 'search') return;
    status.classList.add('hidden');
    if (!grid) return;
    list.classList.add('hidden');
    if (vgrid) vgrid.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';
    if (!res || !res.ok || !res.results || res.results.length === 0) {
      const el = document.createElement('div');
      el.className = 'sp-error';
      el.textContent = 'Картинки не найдены.';
      grid.appendChild(el);
      return;
    }
    res.results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'sp-img-card';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = r.image;
      img.alt = r.title || 'изображение';
      const title = document.createElement('div');
      title.className = 'sp-img-title';
      title.textContent = r.title || hostOf(r.url);
      const source = document.createElement('div');
      source.className = 'sp-img-source';
      source.textContent = r.source || hostOf(r.url);
      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(source);
      card.addEventListener('click', () => {
        const t = currentTab();
        if (t) navigateTab(t.id, r.url);
      });
      grid.appendChild(card);
    });
  };

  const renderVideos = (res) => {
    const ct = currentTab();
    if (mySeq !== renderSeq || tab.id !== activeTabId || !ct || ct.pageType !== 'search') return;
    status.classList.add('hidden');
    if (!vgrid) return;
    list.classList.add('hidden');
    if (grid) grid.classList.add('hidden');
    vgrid.classList.remove('hidden');
    vgrid.innerHTML = '';
    if (!res || !res.ok || !res.results || res.results.length === 0) {
      const el = document.createElement('div');
      el.className = 'sp-error';
      el.textContent = 'Видео не найдены.';
      vgrid.appendChild(el);
      return;
    }
    res.results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'sp-video-card';
      const thumb = document.createElement('div');
      thumb.className = 'sp-video-thumb';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = r.thumb;
      img.alt = r.title || 'видео';
      thumb.appendChild(img);
      if (r.duration) {
        const dur = document.createElement('span');
        dur.className = 'sp-video-duration';
        dur.textContent = r.duration;
        thumb.appendChild(dur);
      }
      const title = document.createElement('div');
      title.className = 'sp-video-title';
      title.textContent = r.title || hostOf(r.url);
      const source = document.createElement('div');
      source.className = 'sp-video-source';
      source.textContent = r.source || hostOf(r.url);
      card.appendChild(thumb);
      card.appendChild(title);
      card.appendChild(source);
      card.addEventListener('click', () => {
        const t = currentTab();
        if (t) navigateTab(t.id, r.url);
      });
      vgrid.appendChild(card);
    });
  };

  const onData = (res) => {
    if (mode === 'images') renderImages(res);
    else if (mode === 'videos') renderVideos(res);
    else renderWeb(res);
  };

  if (pre) { onData(pre); return; }

  status.textContent = 'Поиск: ' + q + (mode === 'images' ? ' (картинки)' : (mode === 'videos' ? ' (видео)' : ''));
  status.classList.remove('hidden');

  const fetchFn = mode === 'images' ? window.meoow.searchImages(q)
    : mode === 'videos' ? window.meoow.searchVideos(q)
    : window.meoow.search(q);
  fetchFn.then(onData).catch(() => {
    const ct = currentTab();
    if (mySeq !== renderSeq || tab.id !== activeTabId || !ct || ct.pageType !== 'search') return;
    status.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'sp-error';
    el.textContent = 'Ошибка поиска. Проверьте подключение к интернету.';
    if (mode === 'images' && grid) { list.classList.add('hidden'); if (vgrid) vgrid.classList.add('hidden'); grid.classList.remove('hidden'); grid.innerHTML = ''; grid.appendChild(el); }
    else if (mode === 'videos' && vgrid) { list.classList.add('hidden'); if (grid) grid.classList.add('hidden'); vgrid.classList.remove('hidden'); vgrid.innerHTML = ''; vgrid.appendChild(el); }
    else list.appendChild(el);
  });
}

// ---------- Auto-complete suggestions ----------
function attachSuggestions(inputSel, boxSel, onPick) {
  const input = $(inputSel);
  const box = $(boxSel);
  if (!input || !box) return;
  let timer = null;
  let items = [];
  let hi = -1;
  let req = 0;

  const hide = () => {
    req++;
    box.classList.add('hidden');
    box.innerHTML = '';
    items = [];
    hi = -1;
  };
  const show = (list) => {
    items = (list || []).slice(0, 8);
    hi = -1;
    box.innerHTML = '';
    if (!items.length) { hide(); return; }
    items.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'sg-item';
      const icon = document.createElement('span');
      icon.className = 'sg-item-icon';
      icon.textContent = '⌕';
      const span = document.createElement('span');
      span.className = 'sg-item-text';
      span.textContent = s;
      el.appendChild(icon);
      el.appendChild(span);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pick = s;
        hide();
        input.value = pick;
        onPick(pick);
      });
      box.appendChild(el);
    });
    box.classList.remove('hidden');
  };
  const highlight = () => {
    box.querySelectorAll('.sg-item').forEach((n, i) => n.classList.toggle('selected', i === hi));
  };

  input.addEventListener('input', () => {
    const v = input.value.trim();
    req++;
    const myReq = req;
    if (!v) { hide(); return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await window.meoow.suggest(v);
      if (myReq !== req) return;
      show(res);
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    const visible = !box.classList.contains('hidden') && items.length > 0;
    if (!visible) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hi = (hi + 1) % items.length;
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hi = (hi - 1 + items.length) % items.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (hi >= 0 && items[hi]) {
        e.preventDefault();
        const pick = items[hi];
        hide();
        input.value = pick;
        onPick(pick);
      }
    } else if (e.key === 'Escape') {
      if (visible) { e.preventDefault(); hide(); }
    }
  });

  input.addEventListener('blur', () => setTimeout(hide, 150));
}

// ---------- Bookmarks ----------
async function refreshBookmarks() {
  bookmarks = await window.meoow.getBookmarks();
  const bar = $('#bookmark-bar');
  $$('.bookmark-pill').forEach(x => x.remove());

  bookmarks.forEach(bm => {
    const pill = document.createElement('div');
    pill.className = 'bookmark-pill';
    pill.title = bm.url;

    const icon = document.createElement('span');
    icon.style.width = '14px'; icon.style.height = '14px';
    const img = document.createElement('img');
    const fi = faviconFor(bm.url);
    img.src = fi || '';
    img.style.width = '14px'; img.style.height = '14px';
    icon.appendChild(img);

    const span = document.createElement('span');
    span.className = 'bm-title';
    span.textContent = bm.title || hostOf(bm.url);

    const close = document.createElement('button');
    close.className = 'bm-close';
    close.textContent = '✕';
    close.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.meoow.removeBookmark(bm.url);
      refreshBookmarks();
      refreshStar();
    });

    pill.appendChild(icon);
    pill.appendChild(span);
    pill.appendChild(close);
    pill.addEventListener('click', () => {
      const tab = currentTab();
      if (tab) navigateTab(tab.id, bm.url);
      else createTab(bm.url);
    });

    bar.appendChild(pill);
  });
}

async function toggleBookmark() {
  const tab = currentTab();
  if (!tab || tab.pageType !== 'web' || !tab.url) return;
  const was = await isPageBookmarked(tab.url);
  if (was) {
    await window.meoow.removeBookmark(tab.url);
  } else {
    await window.meoow.addBookmark({ url: tab.url, title: tab.title || displayTitle(tab) });
  }
  refreshBookmarks();
  refreshStar();
}

// ---------- History ----------
async function refreshHistory() {
  history = await window.meoow.getHistory();
  if (!$('#sp-home').classList.contains('hidden')) {
    renderVisitedPanel();
  }
}

// ---------- Manager ----------
function openManager(mode) {
  managerMode = mode;
  $('#manager').classList.remove('hidden');
  $('#mgr-tab-book').classList.toggle('active', mode === 'bookmarks');
  $('#mgr-tab-hist').classList.toggle('active', mode === 'history');
  if (mode === 'history') {
    refreshHistory().then(renderManager);
  } else {
    renderManager();
  }
}
function closeManager() {
  $('#manager').classList.add('hidden');
}
function renderManager() {
  const list = $('#manager-list');
  list.innerHTML = '';
  const items = managerMode === 'bookmarks' ? bookmarks : history;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.padding = '40px'; empty.style.textAlign = 'center'; empty.style.color = '#9ca3af';
    empty.textContent = managerMode === 'bookmarks' ? 'Пока нет закладок' : 'История пуста';
    list.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'manager-item';

    const fav = document.createElement('span');
    fav.className = 'mi-fav';
    const img = document.createElement('img');
    img.src = faviconFor(item.url) || '';
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); fav.textContent = (item.title || hostOf(item.url)).charAt(0).toUpperCase(); });
    fav.appendChild(img);

    const info = document.createElement('span');
    info.className = 'mi-info';
    info.innerHTML = managerMode === 'bookmarks'
      ? `<span class="mi-title">${escapeHtml(item.title || hostOf(item.url))}</span>
         <span class="mi-url">${escapeHtml(item.url)}</span>`
      : `<span class="mi-title">${escapeHtml(item.title || hostOf(item.url))}</span>
         <span class="mi-url">${escapeHtml(item.url)} · ${new Date(item.time).toLocaleString()}</span>`;

    const del = document.createElement('button');
    del.innerHTML = '✕';
    del.title = managerMode === 'bookmarks' ? 'Удалить из закладок' : 'Удалить из истории';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (managerMode === 'bookmarks') {
        await window.meoow.removeBookmark(item.url);
        await refreshBookmarks();
      } else {
        await window.meoow.removeHistory(item.url);
        await refreshHistory();
      }
      renderManager();
    });

    row.appendChild(fav);
    row.appendChild(info);
    row.appendChild(del);
    row.addEventListener('click', () => {
      const tab = currentTab();
      if (tab) navigateTab(tab.id, item.url);
      else createTab(item.url);
      closeManager();
    });
    list.appendChild(row);
  });
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch (e) {}
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  legacyCopy(text);
  return Promise.resolve();
}

// ---------- Context menu ----------
let ctxMenuEl = null;
function openContextMenu(event, wv) {
  closeContextMenu();
  const el = document.createElement('div');
  el.className = 'ctx-menu';
  const items = [];
  const sel = (event.selectionText && event.selectionText.trim()) ? event.selectionText : '';
  if (event.linkURL) {
    items.push({ label: 'Открыть ссылку в новой вкладке', fn: () => createTab(event.linkURL) });
    items.push({ label: 'Скопировать адрес ссылки', fn: () => copyText(event.linkURL) });
    items.push({ type: 'sep' });
  }
  if (event.mediaType === 'image') {
    items.push({ label: 'Скопировать адрес картинки', fn: () => copyText(event.srcURL) });
    items.push({ type: 'sep' });
  }
  if (event.editFlags && event.editFlags.canCut) items.push({ label: 'Вырезать', fn: () => wv.cut() });
  if (event.editFlags && (event.editFlags.canCopy || sel)) items.push({ label: 'Копировать', fn: () => wv.copy() });
  if (event.editFlags && event.editFlags.canPaste) items.push({ label: 'Вставить', fn: () => wv.paste() });
  if (event.editFlags && event.editFlags.canSelectAll) { items.push({ type: 'sep' }); items.push({ label: 'Выделить всё', fn: () => wv.selectAll() }); }
  if (items.length) items.push({ type: 'sep' });
  items.push({ label: 'Назад', disabled: !(wv.canGoBack && wv.canGoBack()), fn: () => wv.goBack() });
  items.push({ label: 'Вперёд', disabled: !(wv.canGoForward && wv.canGoForward()), fn: () => wv.goForward() });
  items.push({ type: 'sep' });
  items.push({ label: 'Перезагрузить', fn: () => wv.reload() });

  items.forEach(it => {
    if (it.type === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      el.appendChild(sep);
    } else {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.disabled = !!it.disabled;
      b.addEventListener('click', () => { closeContextMenu(); it.fn && it.fn(); });
      el.appendChild(b);
    }
  });

  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  const x = Math.min(event.x, window.innerWidth - r.width - 6);
  const y = Math.min(event.y, window.innerHeight - r.height - 6);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  ctxMenuEl = el;
}
function closeContextMenu() {
  if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
}

// ---------- Menu ----------
function toggleMenu() {
  $('#menu-popup').classList.toggle('hidden');
}

// ---------- Аккаунт и профили ----------
let accountStateRes = {};
let pinGateTarget = null;

function avatarInitial(name) {
  const s = String(name || '?').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
}
function activeProfile() {
  const st = accountStateRes || {};
  return (st.profiles || []).find(p => p.id === st.activeProfileId) || null;
}
function fmtT(key, vars) {
  let out = t(key);
  if (vars) { Object.keys(vars).forEach(k => { out = out.replace('{{' + k + '}}', vars[k]); }); }
  return out;
}

async function refreshAccountUI() {
  try {
    accountStateRes = (await window.meoow.getAccountState()) || {};
  } catch (e) {
    accountStateRes = {};
  }
  renderProfileChip();
  renderProfilePopup();
  renderAccountSection();
  renderProfileList();
}

async function renderAccountSection() {
  const st = accountStateRes || {};
  const serverInput = $('#acc-server');
  if (serverInput) serverInput.value = (st.serverUrl || '').replace(/\/+$/, '');
  const logged = !!st.loggedIn;
  $('#acc-auth').classList.toggle('hidden', logged);
  const loggedBox = $('#acc-logged');
  if (loggedBox) loggedBox.classList.toggle('hidden', !logged);
  const eml = $('#acc-email-line');
  if (eml) eml.textContent = logged ? fmtT('accLoggedAs', { email: st.email }) : '';
  const statusLine = $('#acc-status-line');
  if (statusLine) {
    statusLine.textContent = logged ? t('accConnected') : t('accOffline');
    window.meoow.accountHealth().then(h => {
      if (statusLine) statusLine.textContent = (h && h.ok) ? t('accConnected') : t('accUnavailable');
    }).catch(() => {});
  }
}

function renderProfileChip() {
  const av = $('#profile-avatar');
  const nm = $('#profile-name');
  const p = activeProfile();
  if (p) {
    av.textContent = avatarInitial(p.name);
    av.style.background = p.color || 'var(--primary)';
    nm.textContent = p.name;
    nm.title = fmtT('profileBtn') + ': ' + p.name;
  }
}

function renderProfilePopup() {
  const list = $('#profile-pop-list');
  if (!list) return;
  list.innerHTML = '';
  const st = accountStateRes || {};
  (st.profiles || []).forEach(p => {
    const item = document.createElement('button');
    item.className = 'profile-pop-item' + (p.id === st.activeProfileId ? ' active' : '');
    const av = document.createElement('span');
    av.className = 'profile-pop-avatar';
    av.style.background = p.color || 'var(--primary)';
    av.textContent = avatarInitial(p.name);
    const nm = document.createElement('span');
    nm.className = 'profile-pop-name';
    nm.textContent = p.name;
    item.appendChild(av);
    item.appendChild(nm);
    item.addEventListener('click', () => switchProfile(p.id));
    list.appendChild(item);
  });
}

async function switchProfile(id) {
  const r = await window.meoow.profileSwitch({ id });
  if (r && r.locked) { openPinGate(id); return; }
  if (r && r.error) { showToast(r.error); return; }
  $('#profile-popup').classList.add('hidden');
  await applyProfileData();
}

async function applyProfileData() {
  await Promise.all([
    refreshBookmarks(),
    refreshHistory(),
    window.meoow.getSettings().then(s => {
      settings = s;
      applyLanguage();
      applyTheme(settings.theme);
      applyZoom(settings.zoom);
      if (!$('#settings').classList.contains('hidden')) populateSettings();
    }),
  ]);
  await refreshAccountUI();
  refreshStar();
}

function renderProfileList() {
  const box = $('#prof-profiles') || $('#acc-profiles');
  if (!box) return;
  box.innerHTML = '';
  const st = accountStateRes || {};
  (st.profiles || []).forEach(p => {
    const row = document.createElement('div');
    row.className = 'acc-profile' + (p.id === st.activeProfileId ? ' active' : '');
    const av = document.createElement('div');
    av.className = 'acc-avatar';
    av.style.background = p.color || 'var(--primary)';
    av.textContent = avatarInitial(p.name);
    const info = document.createElement('div');
    info.className = 'acc-info';
    const nm = document.createElement('div');
    nm.className = 'acc-pname';
    nm.textContent = p.name;
    nm.title = p.id;
    const sub = document.createElement('div');
    sub.className = 'acc-psub';
    sub.textContent = p.locked && p.hasPin ? 'PIN' : (p.email || (p.id === st.activeProfileId ? t('accActive') : ''));
    info.appendChild(nm); info.appendChild(sub);
    const actions = document.createElement('div');
    actions.className = 'acc-p-actions';
    const btnSwitch = document.createElement('button');
    btnSwitch.className = 'sp-btn small';
    btnSwitch.textContent = t('accSwitch');
    btnSwitch.addEventListener('click', () => switchProfile(p.id));
    actions.appendChild(btnSwitch);
    const btnPin = document.createElement('button');
    btnPin.className = 'sp-btn small';
    btnPin.textContent = t('accSetPin');
    btnPin.addEventListener('click', () => togglePinForm(row, p));
    actions.appendChild(btnPin);
    if (p.id === st.activeProfileId) {
      const btnLock = document.createElement('button');
      btnLock.className = 'sp-btn small';
      btnLock.textContent = t('accLock');
      btnLock.addEventListener('click', async () => {
        await window.meoow.profileLock({ id: p.id });
        if (p.hasPin) openPinGate(p.id); else await applyProfileData();
      });
      actions.appendChild(btnLock);
    }
    const btnRm = document.createElement('button');
    btnRm.className = 'sp-btn small danger';
    btnRm.textContent = t('accRemove');
    btnRm.disabled = (st.profiles.length <= 1) || (p.id === st.activeProfileId);
    btnRm.addEventListener('click', async () => {
      const r = await window.meoow.profileRemove({ id: p.id });
      if (r && r.error) { showToast(r.error); return; }
      await refreshAccountUI();
    });
    actions.appendChild(btnRm);
    row.appendChild(av); row.appendChild(info); row.appendChild(actions);
    box.appendChild(row);
  });
}

function togglePinForm(row, p) {
  const existing = row.querySelector('.pin-form');
  if (existing) { existing.remove(); return; }
  const form = document.createElement('div');
  form.className = 'pin-form';
  const inputs = [];
  if (p.hasPin) {
    const curr = document.createElement('input');
    curr.type = 'password'; curr.inputMode = 'numeric'; curr.maxLength = 9;
    curr.placeholder = t('accPinCurrent'); curr.autocomplete = 'off';
    inputs.push(curr); form.appendChild(curr);
  }
  const newPin = document.createElement('input');
  newPin.type = 'password'; newPin.inputMode = 'numeric'; newPin.maxLength = 9;
  newPin.placeholder = t('accPinNew'); newPin.autocomplete = 'off';
  inputs.push(newPin); form.appendChild(newPin);
  const save = document.createElement('button');
  save.className = 'sp-btn small';
  save.textContent = t('accEnter');
  save.addEventListener('click', async () => {
    const r = await window.meoow.profileSetPin({ id: p.id, oldPin: p.hasPin ? inputs[0].value : undefined, pin: inputs[inputs.length - 1].value });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('pinSetOk'));
    await refreshAccountUI();
  });
  form.appendChild(save);
  if (p.hasPin) {
    const clearB = document.createElement('button');
    clearB.className = 'sp-btn small danger';
    clearB.textContent = t('accClearPin');
    clearB.addEventListener('click', async () => {
      const r = await window.meoow.profileSetPin({ id: p.id, oldPin: inputs[0].value, pin: '' });
      if (r && r.error) { showToast(r.error); return; }
      showToast(t('pinCleared'));
      await refreshAccountUI();
    });
    form.appendChild(clearB);
  }
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save.click(); }
  });
  row.appendChild(form);
  setTimeout(() => newPin.focus(), 30);
}

// ---------- PIN gate ----------
function openPinGate(profileId) {
  pinGateTarget = profileId;
  const st = accountStateRes || {};
  const p = (st.profiles || []).find(x => x.id === profileId) || {};
  const av = $('#pin-gate-avatar');
  av.textContent = avatarInitial(p.name || '—');
  av.style.background = p.color || 'var(--primary)';
  $('#pin-input').value = '';
  $('#pin-gate-error').textContent = '';
  $('#pin-gate').classList.remove('hidden');
  setTimeout(() => $('#pin-input').focus(), 50);
}
function closePinGate() {
  $('#pin-gate').classList.add('hidden');
  pinGateTarget = null;
}
async function submitPinGate() {
  const pin = $('#pin-input').value.trim();
  if (!pinGateTarget) { closePinGate(); return; }
  const r = await window.meoow.profileUnlock({ id: pinGateTarget, pin });
  if (r && r.error) { $('#pin-gate-error').textContent = t('pinWrong'); $('#pin-input').select(); return; }
  closePinGate();
  await applyProfileData();
}

// ---------- Settings ----------
function openSettings() {
  closeManager();
  const existing = tabs.find(t => t.pageType === 'settings');
  if (existing) {
    activateTab(existing.id);
    return;
  }
  const id = ++tabCounter;
  const tab = {
    id,
    url: null,
    pageType: 'settings',
    title: t('settingsTitle'),
  };
  initTabHistory(tab);
  tabs.push(tab);
  renderTabs();
  activateTab(id);
}
function populateSettings() {
  const langSel = $('#set-lang');
  if (langSel && !langSel.options.length) {
    (window.MEOOW_LANGS || [{ code: 'ru', name: 'Русский' }]).forEach((l) => {
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.name;
      langSel.appendChild(o);
    });
  }
  if (langSel) langSel.value = settings.lang || 'ru';
  $('#set-engine').value = settings.searchEngine || 'auto';
  $('#set-newtab').value = settings.newTabPage || 'search';
  $('#set-zoom').value = String(settings.zoom || 100);
  $('#set-theme').value = settings.theme || 'light';
  $('#set-custom-bg').value = settings.customBg || '#f6eee0';
  $('#set-custom-accent').value = settings.customAccent || '#c7410f';
  const isCustom = (settings.theme || 'light') === 'custom';
  $('#set-custom-row').classList.toggle('hidden', !isCustom);
  $('#set-custom-accent-row').classList.toggle('hidden', !isCustom);
  $('#set-scrollbar').checked = settings.customScrollbar !== false;
  $('#set-darksites').checked = settings.darkSites === true;
  $('#set-scam').checked = settings.scamProtection !== false;
  $('#set-notif').checked = settings.blockNotifications === true;
  $('#set-ai-endpoint').value = settings.aiEndpoint || '';
  $('#set-ai-key').value = settings.aiKey || '';
  $('#set-ai-model').value = settings.aiModel || '';
  $('#set-ai-free').checked = settings.aiFreeChat !== false;
  applyLanguage();
  renderAccountSection();
}
function closeSettings() {
  const tab = currentTab();
  if (tab && tab.pageType === 'settings') {
    closeTab(tab.id);
  } else {
    $('#settings').classList.add('hidden');
  }
}
function openProfiles() {
  closeManager();
  const existing = tabs.find(t => t.pageType === 'profiles');
  if (existing) {
    activateTab(existing.id);
    return;
  }
  const id = ++tabCounter;
  const tab = {
    id,
    url: null,
    pageType: 'profiles',
    title: t('profilesTitle'),
  };
  initTabHistory(tab);
  tabs.push(tab);
  renderTabs();
  activateTab(id);
}
function populateProfiles() {
  renderProfileList();
  applyLanguage();
}
function closeProfiles() {
  const tab = currentTab();
  if (tab && tab.pageType === 'profiles') {
    closeTab(tab.id);
  } else {
    $('#profiles').classList.add('hidden');
  }
}
async function saveSetting(patch) {
  settings = await window.meoow.setSettings(patch);
  if (settings.theme) applyTheme(settings.theme);
  if (settings.zoom) applyZoom(settings.zoom);
  if ('searchEngine' in patch) applyEngineUI();
  if ('lang' in patch) applyLanguage();
}
async function saveAiSettings() {
  const patch = {
    aiEndpoint: $('#set-ai-endpoint').value.trim(),
    aiKey: $('#set-ai-key').value.trim(),
    aiModel: $('#set-ai-model').value.trim(),
    aiFreeChat: $('#set-ai-free').checked,
  };
  await saveSetting(patch);
  const ok = $('#set-ai-endpoint').value.trim() && $('#set-ai-key').value.trim();
  showToast($('#set-ai-free').checked
    ? (ok ? t('toastAiSaved') : t('toastAiFreeOn'))
    : t('toastAiFreeOff'));
}

function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ---------- Полноэкранный режим сайта ----------
function setContentFullscreen(on) {
  document.body.classList.toggle('chrome-fullscreen', on);
  try { window.meoow.toggleMaximize(); } catch (e) {}
}
function toggleContentFullscreen() {
  setContentFullscreen(!document.body.classList.contains('chrome-fullscreen'));
}

function closeFind() {
  $('#findbar').classList.add('hidden');
  const t = currentTab();
  if (t && t.webview) window.meoow.stopFind(t.webview.getWebContentsId());
}
function openFind() {
  $('#findbar').classList.remove('hidden');
  const i = $('#find-input');
  i.value = '';
  i.focus();
  $('#find-status').textContent = '';
}

// ---------- Поисковая система: бейдж и подсказки ----------
const ENGINE_LABELS = {
  google: 'Google',
  bing: 'Microsoft Bing',
  duckduckgo: 'DuckDuckGo',
  lite: 'DuckDuckGo Lite',
};
function applyEngineUI() {
  const eng = settings.searchEngine || 'auto';
  const name = eng === 'auto' ? t('engineAll') : (eng === 'yandex' ? t('engineYandex') : (ENGINE_LABELS[eng] || 'Meoow'));
  const nameEl = $('#sp-engine-name');
  if (nameEl) nameEl.textContent = name;
  const ph = eng === 'auto' ? t('searchPh') : t('searchPhEngine').replace('{{eng}}', name);
  const nt = $('#nt-search');
  const sp = $('#sp-search');
  if (nt) nt.placeholder = ph;
  if (sp) sp.placeholder = ph;
}

// ---------- Капля «Недавние сайты» ----------
function renderVisitedPanel() {
  const panel = $('#sp-visited');
  const list = $('#sp-visited-list');
  if (!panel || !list) return;
  const byHost = [];
  const seenHost = {};
  for (const h of history) {
    if (!isHttpUrl(h.url)) continue;
    let host;
    try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (seenHost[host]) continue;
    seenHost[host] = true;
    byHost.push({ url: h.url, host, title: h.title || '' });
    if (byHost.length >= 6) break;
  }
  if (!byHost.length) { panel.classList.add('hidden'); return; }
  list.innerHTML = '';
  byHost.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'sp-visited-item';
    row.title = e.url;
    const ic = document.createElement('div');
    ic.className = 'sp-visited-icon';
    ic.style.background = paletteColor(e.host);
    const img = document.createElement('img');
    img.src = faviconFor(e.url);
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); ic.textContent = e.host.charAt(0).toUpperCase(); });
    ic.appendChild(img);
    const main = document.createElement('div');
    main.className = 'sp-visited-main';
    const host = document.createElement('div');
    host.className = 'sp-visited-host';
    host.textContent = e.host;
    const sub = document.createElement('div');
    sub.className = 'sp-visited-sub';
    sub.textContent = e.title && e.title !== e.host ? e.title : e.url.replace(/^https?:\/\//, '');
    main.appendChild(host);
    main.appendChild(sub);
    row.appendChild(ic);
    row.appendChild(main);
    const xk = document.createElement('button');
    xk.className = 'sp-visited-xk';
    xk.innerHTML = '✕';
    xk.title = 'Скрыть из недавних';
    xk.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const doomed = [];
      for (const h of history) {
        if (!isHttpUrl(h.url)) continue;
        try {
          if (new URL(h.url).hostname.replace(/^www\./, '') === e.host) doomed.push(h.url);
        } catch {}
      }
      for (const u of doomed) await window.meoow.removeHistory(u);
      await refreshHistory();
    });
    row.appendChild(xk);
    row.addEventListener('click', () => {
      const t = currentTab();
      if (t) navigateTab(t.id, e.url);
      else createTab(e.url);
    });
    list.appendChild(row);
  });
  panel.classList.remove('hidden');
}

// ---------- Глобальные горячие клавиши ----------
function tabGo(dir) {
  if (!tabs.length) return;
  const idx = tabs.findIndex(t => t.id === activeTabId);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  if (next) activateTab(next.id);
}
function zoomTab(delta) {
  const tab = currentTab();
  const wv = tab && tab.pageType === 'web' ? tab.webview : null;
  if (!wv || !wv.wvReady) return;
  let cur = 1;
  try { cur = wv.getZoomFactor() || 1; } catch (e) {}
  if (delta === 0) cur = (settings.zoom || 100) / 100;
  else cur = cur * (delta > 0 ? 1.2 : 1 / 1.2);
  cur = Math.max(0.3, Math.min(3, cur));
  try { wv.setZoomFactor(cur); } catch (e) {}
}
function handleGlobalKey(k) {
  const ctrl = !!k.ctrl;
  const key = String(k.key || '');
  const low = key.toLowerCase();
  if (ctrl && low === 't') { createTab(newTabTarget()); return true; }
  if (ctrl && low === 'l') { $('#address-bar').focus(); $('#address-bar').select(); return true; }
  if (ctrl && low === 'w') { if (activeTabId) closeTab(activeTabId); return true; }
  if (ctrl && low === 'r' || key === 'F5') {
    const tab = currentTab();
    const wv = tab && tab.pageType === 'web' ? tab.webview : null;
    if (wv && wv.wvReady) wv.reload();
    return true;
  }
  if (ctrl && low === 'd') { toggleBookmark(); return true; }
  if (ctrl && low === 'h') { openManager('history'); return true; }
  if (ctrl && low === 'f') { openFind(); return true; }
  if (ctrl && low === 'i') { AI.toggle(); return true; }
  if (ctrl && key === 'Tab') { tabGo(k.shift ? -1 : 1); return true; }
  if (ctrl && (low === '=' || low === '+' || low === 'numadd' || low === 'numpadadd')) { zoomTab(1); return true; }
  if (ctrl && (low === '-' || low === 'numpadsubtract')) { zoomTab(-1); return true; }
  if (ctrl && (low === '0' || low === 'numpad0')) { zoomTab(0); return true; }
  if (ctrl && low === 'pagedown') { tabGo(1); return true; }
  if (ctrl && low === 'pageup') { tabGo(-1); return true; }
  if (k.alt && key === 'ArrowLeft') { goBack(); return true; }
  if (k.alt && key === 'ArrowRight') { goForward(); return true; }
  if (key === 'F11') { toggleContentFullscreen(); return true; }
  if (key === 'Escape') {
    if (document.body.classList.contains('chrome-fullscreen')) { toggleContentFullscreen(); return true; }
    if (AI && AI.open) AI.close();
    else if (!$('#findbar').classList.contains('hidden')) closeFind();
    else if (ctxMenuEl) closeContextMenu();
    else if (!$('#settings').classList.contains('hidden')) closeSettings();
    else if (!$('#manager').classList.contains('hidden')) closeManager();
    else if (!$('#menu-popup').classList.contains('hidden')) toggleMenu();
    return true;
  }
  return false;
}

// ---------- Events ----------
function setupEvents() {
  // Suggestions must be wired before Enter handlers so they can intercept keys
  attachSuggestions('#nt-search', '#sg-home', (q) => {
    const tab = currentTab();
    if (tab) navigateTab(tab.id, q);
  });
  attachSuggestions('#sp-search', '#sg-results', (q) => {
    const tab = currentTab();
    if (tab) navigateTab(tab.id, q);
  });

  // Navigation buttons
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-forward').addEventListener('click', goForward);
  $('#btn-reload').addEventListener('click', () => {
    const wv = currentWebview();
    if (wv && wv.wvReady) {
      if (wv.isLoading()) wv.stop();
      wv.reload();
    }
  });
  $('#btn-home').addEventListener('click', () => {
    const tab = currentTab();
    if (tab) navigateTab(tab.id, HOME_URL);
  });
  $('#btn-fs').addEventListener('click', toggleContentFullscreen);

  $('#nt-search').addEventListener('focus', () => {
    if ($('#nt-search').value) $('#sp-visited').classList.add('hidden');
  });
  $('#nt-search').addEventListener('blur', () => renderVisitedPanel());
  $('#nt-search').addEventListener('input', () => {
    if ($('#nt-search').value) $('#sp-visited').classList.add('hidden');
    else renderVisitedPanel();
  });

  // AI Assistant
  $('#btn-ai').addEventListener('click', () => AI.toggle());
  $('#ai-close').addEventListener('click', () => AI.close());
  $('#ai-send').addEventListener('click', () => AI.ask(AI.el.input().value));
  $('#ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); AI.ask(AI.el.input().value); }
    else if (e.key === 'Escape') { e.preventDefault(); AI.close(); }
  });

  // Клик вне панели закрывает её
  document.addEventListener('click', (e) => {
    if (!AI.open) return;
    if (e.target.closest('#ai-panel') || e.target.closest('#btn-ai')) return;
    AI.close();
  });

  // Address bar
  $('#address-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const tab = currentTab();
    if (!tab) return;
    const text = $('#address-bar').value;
    hideAddrSuggest();
    navigateTab(tab.id, text);
    $('#address-bar').blur();
  });
  $('#address-bar').addEventListener('focus', () => {
    addressBarFocused = true;
    const tab = currentTab();
    if (tab && tab.pageType !== 'home' && tab.pageType !== 'settings') {
      setTimeout(() => $('#address-bar').select(), 10);
    }
  });
  $('#address-bar').addEventListener('blur', () => {
    addressBarFocused = false;
    setTimeout(hideAddrSuggest, 150);
  });

  // Address bar: local suggestions (history + bookmarks)
  let asTimer = null;
  let asSeq = 0;
  function hideAddrSuggest() {
    const box = $('#addr-suggest');
    box.classList.add('hidden');
    box.innerHTML = '';
    asSeq++;
  }
  $('#address-bar').addEventListener('input', () => {
    clearTimeout(asTimer);
    const v = $('#address-bar').value.trim();
    if (!v) { hideAddrSuggest(); return; }
    asTimer = setTimeout(async () => {
      const seq = ++asSeq;
      const q = v.toLowerCase();
      let book, hist;
      try {
        [book, hist] = await Promise.all([window.meoow.getBookmarks(), window.meoow.getHistory()]);
      } catch (err) {
        return;
      }
      const pool = {};
      const put = (url, title) => {
        if (!isHttpUrl(url) || pool[url]) return;
        pool[url] = { url, title };
      };
      book.forEach(b => put(b.url, b.title));
      [...hist].reverse().forEach(h => put(h.url, h.title));
      const items = Object.values(pool)
        .filter(it => (it.url.toLowerCase().indexOf(q) !== -1) || (it.title || '').toLowerCase().indexOf(q) !== -1)
        .slice(0, 6);
      const box = $('#addr-suggest');
      if (seq !== asSeq) return;
      box.innerHTML = '';
      if (!items.length) { box.classList.add('hidden'); return; }
      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'addr-item';
        const img = document.createElement('img');
        const fi = faviconFor(it.url);
        img.src = fi || '';
        img.alt = '';
        const label = document.createElement('span');
        label.textContent = it.title || hostOf(it.url);
        const host = document.createElement('span');
        host.className = 'a-host';
        host.textContent = hostOf(it.url);
        row.appendChild(img);
        row.appendChild(label);
        row.appendChild(host);
        row.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const tab = currentTab();
          if (tab) navigateTab(tab.id, it.url);
          else createTab(it.url);
          hideAddrSuggest();
        });
        box.appendChild(row);
      });
      box.classList.remove('hidden');
    }, 120);
  });

  // Find in page (Ctrl+F)
  function runFind(forward) {
    const t = currentTab();
    if (!t || !t.webview) return;
    const text = $('#find-input').value;
    if (!text) {
      $('#find-status').textContent = '';
      window.meoow.stopFind(t.webview.getWebContentsId());
      return;
    }
    window.meoow.find(t.webview.getWebContentsId(), text, { findNext: true, forward: forward !== false });
  }
  window.meoow.onFound((result) => {
    if (!result || !result.finalUpdate) return;
    $('#find-status').textContent = result.matches > 0 ? (result.activeMatchOrdinal + '/' + result.matches) : '—';
    $('#find-status').style.color = result.matches > 0 ? '' : '#EA4335';
  });
  $('#find-input').addEventListener('input', () => runFind(true));
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? false : true); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); $('#address-bar').focus(); }
  });
  $('#find-next').addEventListener('click', () => runFind(true));
  $('#find-prev').addEventListener('click', () => runFind(false));
  $('#find-close').addEventListener('click', () => { closeFind(); $('#address-bar').focus(); });

  // Star
  $('#btn-star').addEventListener('click', toggleBookmark);

  // Meoow header / footer links
  const handleM = (a) => {
    if (a === 'bookmarks') openManager('bookmarks');
    else if (a === 'history') openManager('history');
    else if (a === 'settings') openSettings();
  };
  $$('.m-link[data-action]').forEach((el) => {
    el.addEventListener('click', () => handleM(el.dataset.action));
  });
  $$('.g-flink[data-action]').forEach((el) => {
    el.addEventListener('click', () => handleM(el.dataset.action));
  });

  // Tabs
  $('#tab-add-btn').addEventListener('click', () => { createTab(newTabTarget()); });

  // New tab page search (Enter in the field triggers it)
  $('#nt-search').addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      const tab = currentTab();
      if (tab) navigateTab(tab.id, $('#nt-search').value);
    }
  });

  // Results page re-search
  $('#sp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const tab = currentTab();
    if (tab) navigateTab(tab.id, $('#sp-search').value);
  });

  // Search mode tabs (Все | Картинки)
  $$('.sp-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = currentTab();
      if (!tab || tab.pageType !== 'search') return;
      const mode = btn.dataset.mode || 'web';
      if (tab.searchMode === mode) return;
      tab.searchMode = mode;
      tab.url = SEARCH_PREFIX + encodeURIComponent(tab.query || '');
      updateAddressBar();
      showSearchPage(tab);
    });
  });

  // Scam protection
  $('#scam-back').addEventListener('click', () => { hideScam(); });
  $('#scam-proceed').addEventListener('click', () => {
    const t = currentTab();
    hideScam();
    if (t && t.blockedUrl) {
      const u = t.blockedUrl;
      t.allowedUrls = t.allowedUrls || {};
      t.allowedUrls[u] = true;
      t.blockedUrl = null;
      navigateTab(t.id, u, { push: false });
    }
  });

  // Menu
  $('#btn-dev').addEventListener('click', () => window.meoow.openDevWindow());
  $('#btn-menu').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  $('#menu-bookmarks').addEventListener('click', () => { openManager('bookmarks'); toggleMenu(); });
  $('#menu-history').addEventListener('click', () => { openManager('history'); toggleMenu(); });
  $('#menu-clear-history').addEventListener('click', async () => {
    history = await window.meoow.clearHistory();
    renderManager();
    toggleMenu();
  });
  $('#menu-settings').addEventListener('click', () => { openSettings(); toggleMenu(); });
  $('#settings-close').addEventListener('click', closeSettings);
  $('#set-engine').addEventListener('change', async (e) => {
    await saveSetting({ searchEngine: e.target.value });
    applyEngineUI();
  });
  $('#set-newtab').addEventListener('change', (e) => saveSetting({ newTabPage: e.target.value }));
  $('#set-zoom').addEventListener('change', (e) => saveSetting({ zoom: +e.target.value }));
  $('#set-lang').addEventListener('change', (e) => saveSetting({ lang: e.target.value }));
  $('#set-theme').addEventListener('change', (e) => {
    const v = e.target.value;
    const isCustom = v === 'custom';
    $('#set-custom-row').classList.toggle('hidden', !isCustom);
    $('#set-custom-accent-row').classList.toggle('hidden', !isCustom);
    saveSetting({ theme: v });
  });
  $('#set-custom-bg').addEventListener('change', (e) => {
    saveSetting({ customBg: e.target.value });
    if ((settings.theme || 'light') === 'custom') applyTheme('custom');
  });
  $('#set-custom-accent').addEventListener('change', (e) => {
    saveSetting({ customAccent: e.target.value });
    if ((settings.theme || 'light') === 'custom') applyTheme('custom');
  });
  $('#set-scrollbar').addEventListener('change', (e) => saveSetting({ customScrollbar: e.target.checked }));
  $('#set-darksites').addEventListener('change', (e) => saveSetting({ darkSites: e.target.checked }));
  $('#set-scam').addEventListener('change', (e) => saveSetting({ scamProtection: e.target.checked }));
  $('#set-notif').addEventListener('change', (e) => saveSetting({ blockNotifications: e.target.checked }));
  $('#set-ai-save').addEventListener('click', saveAiSettings);;
  $('#set-clear-data').addEventListener('click', async () => {
    if (!confirm(t('confirmClear'))) return;
    await window.meoow.clearData();
    await Promise.all([refreshBookmarks(), refreshHistory()]);
    renderManager();
    refreshStar();
  });
  $('#set-reset').addEventListener('click', async () => {
    settings = await window.meoow.resetSettings();
    applyTheme(settings.theme);
    applyZoom(settings.zoom);
    applyLanguage();
    populateSettings();
    openSettings();
  });
  $('#menu-print').addEventListener('click', () => {
    const wv = currentWebview();
    if (wv && wv.wvReady) wv.print();
    toggleMenu();
  });
  $('#menu-ua').addEventListener('click', async () => {
    const ua = await window.meoow.getUserAgent();
    alert('User-Agent:\n' + ua);
    toggleMenu();
  });
  $('#menu-quit').addEventListener('click', () => window.meoow.exitApp());

  // Profile chip + popup
  $('#btn-profile').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#profile-popup').classList.toggle('hidden');
  });
  $('#profile-pop-add').addEventListener('click', async () => {
    $('#profile-popup').classList.add('hidden');
    const r = await window.meoow.profileCreate({ name: '' });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accProfileCreated'));
    await refreshAccountUI();
  });
  $('#profile-pop-manage').addEventListener('click', () => {
    $('#profile-popup').classList.add('hidden');
    openProfiles();
  });
  $('#profile-pop-lock').addEventListener('click', async () => {
    $('#profile-popup').classList.add('hidden');
    const p = activeProfile();
    await window.meoow.profileLock({ id: p.id });
    if (p.hasPin) openPinGate(p.id); else await applyProfileData();
  });
  $('#acc-add-profile')?.addEventListener('click', async () => {
    const r = await window.meoow.profileCreate({ name: '' });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accProfileCreated'));
    await refreshAccountUI();
  });
  $('#prof-add').addEventListener('click', async () => {
    const r = await window.meoow.profileCreate({ name: '' });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accProfileCreated'));
    await refreshAccountUI();
  });
  $('#acc-edit-profiles').addEventListener('click', () => openProfiles());
  $('#profiles-close').addEventListener('click', closeProfiles);

  // Account auth
  $('#acc-server').addEventListener('change', async (e) => {
    const r = await window.meoow.accountSetServer(e.target.value);
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accServerSaved'));
    await refreshAccountUI();
  });
  $('#acc-register').addEventListener('click', async () => {
    const r = await window.meoow.accountRegister({
      email: $('#acc-email').value.trim(),
      password: $('#acc-password').value,
      profileName: $('#acc-reg-name').value.trim(),
    });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accRegistered'));
    await applyProfileData();
  });
  $('#acc-login').addEventListener('click', async () => {
    const r = await window.meoow.accountLogin({
      email: $('#acc-email').value.trim(),
      password: $('#acc-password').value,
    });
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accLoggedIn'));
    await applyProfileData();
  });
  $('#acc-logout').addEventListener('click', async () => {
    const r = await window.meoow.accountLogout();
    if (r && r.error) { showToast(r.error); return; }
    showToast(t('accLoggedOut'));
    await applyProfileData();
  });

  // PIN gate
  $('#pin-unlock').addEventListener('click', submitPinGate);
  $('#pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitPinGate(); }
  });

  // Manager
  $('#manager-close').addEventListener('click', closeManager);
  $('#mgr-tab-book').addEventListener('click', () => openManager('bookmarks'));
  $('#mgr-tab-hist').addEventListener('click', () => openManager('history'));

  // Click outside popup/manager/context menu
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu-popup') && !e.target.closest('#btn-menu')) {
      $('#menu-popup').classList.add('hidden');
    }
    if (!e.target.closest('#profile-popup') && !e.target.closest('#btn-profile')) {
      $('#profile-popup').classList.add('hidden');
    }
    if (!e.target.closest('.ctx-menu')) closeContextMenu();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (handleGlobalKey({ key: e.key, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey })) {
      e.preventDefault();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#pin-gate').classList.contains('hidden')) {
        e.preventDefault();
        closePinGate();
      } else if (!$('#profile-popup').classList.contains('hidden')) {
        $('#profile-popup').classList.add('hidden');
      }
    }
  });

  // Popup new tab from main process
  window.meoow.onNewTabRequest((url) => {
    createTab(url);
  });

  // Status updates
  setInterval(() => {
    updateNavButtons();
  }, 600);
}

// ---------- AI Assistant (Meoow AI) ----------
// Безопасный арифметический парсер (без eval/new Function — CSP запрещает).
function evalArith(s0) {
  const s = String(s0).replace(/\s+/g, '');
  let i = 0;
  function parseExpr() {
    let v = parseTerm();
    while (i < s.length && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++];
      const r = parseTerm();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (i < s.length && (s[i] === '*' || s[i] === '/')) {
      const op = s[i++];
      const r = parseFactor();
      if (r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (i < s.length && s[i] === '(') {
      i++;
      const v = parseExpr();
      if (v === null || s[i] !== ')') return null;
      i++;
      return v;
    }
    if (i < s.length && s[i] === '-') {
      i++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (i < s.length && s[i] === '+') {
      i++;
      return parseFactor();
    }
    let j = i;
    while (j < s.length && /[0-9.]/.test(s[j])) j++;
    if (j === i) return null;
    const v = parseFloat(s.slice(i, j));
    i = j;
    return isFinite(v) ? v : null;
  }
  const v = parseExpr();
  if (v === null || i !== s.length) return null;
  return v;
}

const AI = {
  open: false,
  seq: 0,
  closeTimer: null,
  convo: { lastTopic: null },
  history: [],
  hintShown: false,
  el: {
    panel: () => $('#ai-panel'),
    messages: () => $('#ai-messages'),
    input: () => $('#ai-input'),
  },
  toggle() {
    this.open ? this.close() : this.openPanel();
  },
  openPanel() {
    this.open = true;
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    const p = this.el.panel();
    p.classList.remove('hidden');
    requestAnimationFrame(() => p.classList.add('open'));
    this.el.input().focus();
    if (!this.el.messages().children.length) {
      this.push('greet', 'Привет! Я Meoow AI. Просто напишите вопрос — я отвечу, найду и открою нужные сайты.');
    }
  },
  close() {
    this.open = false;
    const p = this.el.panel();
    p.classList.remove('open');
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => p.classList.add('hidden'), 260);
  },
  push(kind, text, extra) {
    const m = this.el.messages();
    const el = document.createElement('div');
    el.className = 'ai-msg ' + kind;
    el.innerHTML = text;
    if (extra) {
      const meta = document.createElement('div');
      meta.className = 'ai-meta';
      meta.textContent = extra;
      el.appendChild(meta);
    }
    m.appendChild(el);
    m.scrollTop = m.scrollHeight;
    if (kind === 'user' || kind === 'bot') {
      this.history.push({ role: kind, text });
      if (this.history.length > 40) this.history.shift();
    }
    return el;
  },
  typing(cb) {
    const k = 'ai-thinking-' + (++this.seq);
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.id = k;
    el.innerHTML = '<span class="ai-dots"><i></i><i></i><i></i></span>';
    const m = this.el.messages();
    m.appendChild(el);
    m.scrollTop = m.scrollHeight;
    const done = () => { if (document.getElementById(k)) el.remove(); };
    let out = null;
    try { out = cb(); } catch (e) { done(); }
    if (out && typeof out.then === 'function') out.then(done, done);
    else setTimeout(done, 420);
  },
  async ask(text) {
    const q = text.trim();
    if (!q) return;
    this.push('user', this.escapeHTML(q));
    this.el.input().value = '';
    this.el.input().focus();
    const lower = q.toLowerCase();

    if (this.tryCommand(lower)) return;

    this.convo.lastTopic = q;
    this.typing(async () => {
      try {
        const res = await window.meoow.aiAsk(q, { history: this.history.slice(-6), context: this.browserContext() });
        this.showAnswer(res, q);
      } catch (e) {
        this.push('bot', 'Не удалось получить ответ. Проверьте подключение к интернету и попробуйте ещё раз.');
      }
      this.wireLinks();
    });
  },
  browserContext() {
    const tab = currentTab();
    const openTabs = tabs.slice(0, 12).map(t => {
      if (t.pageType === 'settings') return 'Настройки';
      if (t.pageType === 'home') return 'Новая вкладка';
      if (t.pageType === 'search') return 'Найти: ' + (t.query || '');
      if (t.title) return t.title;
      return t.url || '—';
    });
    const recent = history.slice(0, 6).map(h => (h.title ? h.title + ' — ' : '') + h.url);
    return {
      activeUrl: (tab && tab.url) || null,
      activeTitle: (tab && tab.title) || null,
      openTabs,
      recent,
    };
  },
  showAnswer(res) {
    if (!res || !res.ok) {
      this.push('bot', 'Извините, я не смог ответить. Попробуйте переформулировать вопрос.');
      return;
    }
    const text = this.miniMd(res.text || '');
    const head = (res.sources && res.sources.length)
      ? '<div class="ai-src-label">Источники:</div>' +
        res.sources.map(s =>
          `<a href="#" data-url="${this.escapeAttr(s.url)}" class="ai-link">${this.escapeHTML(s.title || s.url)}</a>`
        ).join('<br>')
      : '';
    this.push('bot', text + (head ? '\n\n' + head : ''),
      res.mode === 'llm' ? (res.free ? 'Meoow AI · бесплатный ChatGPT-движок' : 'Meoow AI · онлайн-ответ') : 'Meoow AI · синтез из ' + (res.sources || []).length + ' источников');
    if (res.noKey && !res.free && !this.hintShown) {
      this.hintShown = true;
      this.push('sys', 'Meoow AI уже работает бесплатно на движке ChatGPT. Добавите свой ИИ-ключ — ответы станут ещё лучше: меню → Настройки → ИИ-помощник.');
    }
  },
  miniMd(s) {
    const esc = this.escapeHTML(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return esc.split('\n').map((ln) => {
      const t = ln.trim();
      if (/^[•\-]\s/.test(t)) return '<div class="ai-bullet">' + t.replace(/^[•\-]\s/, '') + '</div>';
      return ln.trim() ? '<div class="ai-line">' + ln + '</div>' : '<div class="ai-gap"></div>';
    }).join('');
  },
  tryCommand(lower) {
    // Продолжение разговора: «ещё», «дальше», «подробнее»
    if (/^(ещё|еще|ещë|дальше|далее|подробнее|подробней|продолжай|продолжи|ещё раз|еще раз|расскажи ещё|расскажи еще|и что дальше|что дальше)(?=$|[\s,.!?])/.test(lower)) {
      if (this.convo.lastTopic) {
        this.typing(async () => {
          try {
            const res = await window.meoow.aiAsk(this.convo.lastTopic, { more: true, history: this.history.slice(-6), context: this.browserContext() });
            this.showAnswer(res, this.convo.lastTopic);
          } catch (e) {
            this.push('bot', 'Не получилось продолжить. Проверьте подключение к интернету.');
          }
          this.wireLinks();
        });
        return true;
      }
      this.typing(() => this.push('bot', 'Пока нечего развивать — сначала спросите меня о чём-нибудь, например «найди про ядерную физику».'));
      return true;
    }
    // Время
    if (/(который час|сколько времени|сколько время)/.test(lower) && !/\d/.test(lower) && lower.length < 60) {
      const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      this.typing(() => this.push('bot', `Сейчас <b>${t}</b> по времени вашего устройства.`));
      return true;
    }
    // Дата
    if (/(какая сегодня дата|какое сегодня число|сегодня (число|дата)|какой сегодня день)/.test(lower)) {
      const d = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      this.typing(() => this.push('bot', `Сегодня <b>${this.capitalize(d)}</b>.`));
      return true;
    }
    // Математика: «сколько будет 2+2», «12*7»
    const mathM = lower.match(/(?:[а-яёa-z\s]+)?([\d][\d\s+\-*/^().,]*)$/);
    if (mathM) {
      const raw = mathM[1].trim();
      const expr = raw.replace(/^[\s]+|[\s]+$/g, '').replace(/^\.\*+|\*+\s*$/g, '');
      if (raw.length <= 60 && /^[\d\s+\-*/.()]+$/.test(expr) && /[\d]/.test(expr) && /[+\-*\/]/.test(expr)) {
        const val = evalArith(expr);
        if (val !== null) {
          const pretty = Number(Math.round(val * 1e6) / 1e6);
          this.typing(() => this.push('bot', `Ответ: <b>${pretty}</b>  ·  <code>${this.escapeHTML(raw)}</code>`));
          return true;
        }
      }
    }
    // Открыть сайт
    const openM = lower.match(/^(?:открой|откройте|перейди на|перейдите на|открой сайт|открой вкладку)\s+(.+)/);
    if (openM) {
      const phrase = openM[1].trim().toLowerCase();
      const known = {
        'википедию': 'https://ru.wikipedia.org/', 'википедия': 'https://ru.wikipedia.org/',
        'youtube': 'https://www.youtube.com/', 'ютуб': 'https://www.youtube.com/',
        'ютуб музыку': 'https://music.youtube.com/', 'youtube music': 'https://music.youtube.com/',
        'гугл': 'https://www.google.com/', 'google': 'https://www.google.com/',
        'bing': 'https://www.bing.com/', 'duckduckgo': 'https://duckduckgo.com/',
        'яндекс': 'https://ya.ru/', 'yandex': 'https://ya.ru/',
        'вк': 'https://vk.com/', 'вконтакте': 'https://vk.com/', 'vk': 'https://vk.com/',
        'телеграм': 'https://web.telegram.org/', 'telegram': 'https://web.telegram.org/',
        'кинопоиск': 'https://www.kinopoisk.ru/', 'kinopoisk': 'https://www.kinopoisk.ru/',
        'хабр': 'https://habr.com/', 'habr': 'https://habr.com/',
        'github': 'https://github.com/', 'гитхаб': 'https://github.com/',
        'тикток': 'https://www.tiktok.com/', 'tiktok': 'https://www.tiktok.com/',
        'инстаграм': 'https://www.instagram.com/', 'instagram': 'https://www.instagram.com/',
        'почту': 'https://mail.google.com/', 'почта': 'https://mail.google.com/', 'gmail': 'https://mail.google.com/',
        'роблокс': 'https://www.roblox.com/', 'roblox': 'https://www.roblox.com/',
        'стеам': 'https://store.steampowered.com/', 'steam': 'https://store.steampowered.com/',
        'озон': 'https://www.ozon.ru/', 'ozon': 'https://www.ozon.ru/',
        'вайлдберриз': 'https://www.wildberries.ru/', 'wildberries': 'https://www.wildberries.ru/',
        'мозилла': 'https://www.mozilla.org/', 'firefox': 'https://www.mozilla.org/',
        'дискорд': 'https://discord.com/', 'discord': 'https://discord.com/',
        'твич': 'https://www.twitch.tv/', 'twitch': 'https://www.twitch.tv/',
      };
      const keys = Object.keys(known).sort((a, b) => b.length - a.length);
      const hit = keys.find(k => phrase === k || phrase.indexOf(k) !== -1 || phrase.indexOf(known[k].replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*/, '')) !== -1);
      if (hit) {
        const url = known[hit];
        this.typing(() => {
          this.push('bot', `Открываю <b>${this.escapeHTML(hit)}</b>.`);
          this.openAndRecord(url);
        });
        return true;
      }
      this.typing(() => {
        this.push('bot', `Ищу сайт по запросу «<b>${this.escapeHTML(openM[1])}</b>»…`);
        this.doNav(openM[1]);
      });
      return true;
    }
    // Топ / список сайтов
    const topM = lower.match(/^(?:топ|список|лучшие)\s+.*?(?:сайт|сервис|ресурс|инструмент|приложение)/);
    if (topM) {
      this.typing(() => {
        this.push('bot',
          'Вот полезные сайты:\n\n• <a href="#" data-url="https://www.kinopoisk.ru/" class="ai-link">Кинопоиск</a>\n• <a href="#" data-url="https://habr.com/" class="ai-link">Хабр</a>\n• <a href="#" data-url="https://www.wikipedia.org/" class="ai-link">Википедия</a>\n• <a href="#" data-url="https://www.openstreetmap.org/" class="ai-link">OpenStreetMap</a>\n• <a href="#" data-url="https://archive.org/" class="ai-link">Internet Archive</a>\n\nКликните по названию, чтобы открыть.');
        this.wireLinks();
      });
      return true;
    }
    // Приветствие / кто ты
    if (/^(привет|здравствуй|хай|hello|hi|ку|приветик)(?=$|[\s,.!?])/.test(lower)) {
      this.typing(() => this.push('bot', 'Привет! Я Meoow AI — твой помощник в браузере. Спроси меня о чём угодно: отвечу на вопрос, найду сайт или посчитаю пример.'));
      return true;
    }
    // Что умеешь
    if (/что умеешь|помощь|help|что ты умеешь|хелп|что умеет/.test(lower)) {
      this.typing(() => this.push('bot',
        'Я умею:\n\n• <b>Общаться</b> — спросите «как дела», попросите «ещё» по любой теме\n• <b>Отвечать на вопросы</b> — спрашивай что угодно, я соберу ответ из нескольких источников\n• <b>Открывать сайты</b> — «открой YouTube», «открой Кинопоиск»\n• <b>Считать</b> — «сколько будет 17*249»\n• <b>Говорить время и дату</b> — «который час»\n• <b>Искать видео и картинки</b> — режимы на странице результатов\n\nПоиск идёт сразу по нескольким движкам, всё обрабатывается локально.'));
      return true;
    }
    // -------- Небольшой разговор (chit-chat) --------
    const say = (t, extra) => this.typing(() => this.push('bot', t, extra));
    // Как дела
    if (/^(как дела|как у тебя дела|как ты|как сам|как ты поживаешь|как жизнь|как настроение|как оно)/.test(lower)) {
      say('У меня всё отлично — поисковые движки отвечают, вкладки открываются, чат на связи. А у вас как дела?');
      return true;
    }
    if (/^(хорошо|нормально|отлично|прекрасно|неплохо|замечательно|всё хорошо|все хорошо|супер|кайф|лучше всех|так себе|плохо|грустно)/.test(lower)) {
      const ok = /плохо|грустно|так себе|устал/.test(lower);
      say(ok
        ? 'Сочувствую. Может, откроем что-нибудь интересное, чтобы немного переключиться? Или найти ответ на вопрос — тоже отличный план.'
        : 'Рад это слышать! Чем могу помочь дальше — поищем, посчитаем или откроем сайт?');
      return true;
    }
    // Понятно / ок
    if (/^(понятно|ясно|понял|поняла|ага|угу|ок|окей|оk|ладно|хорошо же|так и думал|вот оно что)/.test(lower)) {
      say('Договорились. Если понадоблюсь — я здесь, спрашивайте.');
      return true;
    }
    // Как тебя зовут / кто ты
    if (/^(как тебя зовут|кто ты|ты кто|твоё имя|как твоё имя|как тебя)|(кто ты такой)/.test(lower)) {
      say('Меня зовут <b>Meoow AI</b> — я встроенный помощник браузера Meoow. Спрашивайте что угодно: отвечу, найду, посчитаю.');
      return true;
    }
    // Кто создал
    if (/кто тебя (создал|сделал)|кто тебя создал|кто твой создатель|кто тебя придумал|твой разработчик|твои разработчики|кто тебя написал|кто тебя разработал/.test(lower)) {
      say('Меня создал разработчик браузера Meoow. Я полностью работаю локально: вопросы уходят только в поиск, а ответы собираются из найденных источников.');
      return true;
    }
    // Возраст
    if (/сколько тебе лет|какой ты версии|какая у тебя версия|ты молодой|ты взрослый/.test(lower)) {
      say('Я появился вместе с браузером Meoow (версия 1.0) — новенький, но уже умею искать, считать и разговаривать.');
      return true;
    }
    // Человек или робот
    if (/ты (человек|не человек|робот|бот|ии|искусственный интеллект|нейросеть|живой)/.test(lower)) {
      say('Я не человек — я ИИ-ассистент. Отвечаю на вопросы, собирая информацию из результатов поиска, и выполняю команды. А человека из меня делает энтузиазм.');
      return true;
    }
    // Шутка
    if (/^(пошути|шутка|анекдот|рассмеши|расскажи шутку|что-нибудь смешное|пошути-ка)/.test(lower)) {
      const jokes = [
        'Приходит программист в магазин: «Дайте мне восемь батонов». — «Вам посчитать?» — «Лучше два байта и всё упакуйте».',
        'Оптимист говорит: «Стакан наполовину полон». Пессимист: «Наполовину пуст». А я: «Кто-то тестил вёрстку под стакан?»',
        '— Доктор, у меня пакет ошибок в выводе. — Которых? — Ну, синтаксических. — Вы не больны, вы программист.',
        'Почему разработчики не любят темноту? Потому что там много candles… и всё падает на null.',
      ];
      say(jokes[Math.floor(Math.random() * jokes.length)]);
      return true;
    }
    // Прощание
    if (/^(пока|до свидания|прощай|до встречи|увидимся|бывай|всего хорошего|спокойной ночи|доброй ночи)(?=$|[\s,.!?])/.test(lower)) {
      say('До встречи! Я буду здесь, когда понадоблюсь. Возвращайтесь — поищу, посчитаю, открою. 👋');
      return true;
    }
    // Спасибо
    if (/^(спасибо|благодар)/.test(lower)) {
      say('Пожалуйста! Рад помочь. Если понадобится ещё что-нибудь — просто скажите.');
      return true;
    }
    return false;
  },
  doNav(phrase) {
    window.meoow.suggest(phrase).then((sug) => {
      const target = (sug && sug[0]) ? sug[0] : phrase;
      this.openAndRecord(target);
      this.push('bot', `Открываю результат по запросу «<b>${this.escapeHTML(phrase)}</b>».`, 'Meoow AI');
    }).catch(() => this.openAndRecord(phrase));
  },
  openAndRecord(text) {
    const tab = currentTab();
    if (tab) navigateTab(tab.id, text);
    else createTab(text);
  },
  wireLinks() {
    document.querySelectorAll('.ai-link').forEach((a) => {
      if (a.dataset.bound) return;
      a.dataset.bound = '1';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const url = a.dataset.url;
        if (url) this.openAndRecord(url);
      });
    });
  },
  escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
  escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  },
  capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

// ---------- Init ----------
(async function init() {
  settings = await window.meoow.getSettings();
  applyLanguage();
  applyTheme(settings.theme);
  setupEvents();
  await Promise.all([refreshBookmarks(), refreshHistory(), refreshAccountUI()]);
  const ap = activeProfile();
  if (ap && ap.locked && ap.hasPin) openPinGate(ap.id);
  if (ap && ap.locked && !ap.hasPin) {
    await window.meoow.profileSwitch({ id: ap.id });
    await applyProfileData();
  }
  createTab(newTabTarget());
})();