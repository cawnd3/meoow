(function () {
  'use strict';

  var IS_NATIVE = typeof window.MeoowNative !== 'undefined';
  var LS_OK = typeof localStorage !== 'undefined';
  function storage() { return IS_NATIVE ? window.MeoowNative : { loadData: null, saveData: null }; }

  var state = { serverUrl: 'http://10.0.2.2:18700', history: [], bookmarks: [], version: '1.0.5' };
  var currentMode = 'web';
  var lastQuery = '';

  function loadData() {
    var raw = null;
    try {
      if (IS_NATIVE) {
        raw = window.MeoowNative.loadData();
      } else if (LS_OK && localStorage.getItem('meoow')) {
        raw = localStorage.getItem('meoow');
      }
    } catch (e) {}
    if (raw) {
      try {
        var o = JSON.parse(raw);
        state.serverUrl = o.serverUrl || state.serverUrl;
        if (Array.isArray(o.history)) state.history = o.history;
        if (Array.isArray(o.bookmarks)) state.bookmarks = o.bookmarks;
        if (o.version) state.version = o.version;
      } catch (e) {}
    }
  }

  function saveData() {
    var payload = JSON.stringify({
      serverUrl: state.serverUrl,
      history: state.history.slice(0, 200),
      bookmarks: state.bookmarks,
      version: state.version,
    });
    try {
      if (IS_NATIVE) {
        window.MeoowNative.saveData(payload);
      } else if (LS_OK) {
        localStorage.setItem('meoow', payload);
      }
    } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function paletteColor(host) {
    var palette = ['#C7410F', '#E07A0D', '#8B5CF6', '#14B8A6', '#38BDF8', '#F472B6', '#3B82F6', '#10B981'];
    var h = 0;
    for (var i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function apiBase() { return state.serverUrl.replace(/\/+$/, ''); }

  function fetchText(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = null;
      if (typeof AbortController !== 'undefined') { ctrl = new AbortController(); }
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs || 9000);
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { clearTimeout(t); if (!r.ok) return reject(new Error('HTTP ' + r.status)); return resolve(r); })
        .catch(function (e) { clearTimeout(t); reject(e); });
    });
  }

  // ---------- dial ----------
  function renderDial() {
    var box = $('dial');
    var seen = {};
    var top = [];
    for (var i = state.history.length - 1; i >= 0; i--) {
      var h = state.history[i];
      var host = hostOf(h.url);
      if (!host || seen[host]) continue;
      seen[host] = true;
      top.push({ url: h.url, host: host });
      if (top.length >= 6) break;
    }
    if (!top.length) { box.innerHTML = '<div class="p-empty">Пока ничего не посещали</div>'; return; }
    box.innerHTML = '';
    top.forEach(function (e) {
      var el = document.createElement('div');
      el.className = 'dial-item';
      var av = document.createElement('div');
      av.className = 'dial-avatar';
      av.style.background = paletteColor(e.host);
      av.textContent = e.host.charAt(0).toUpperCase();
      var nm = document.createElement('div');
      nm.className = 'dial-name';
      nm.textContent = e.host;
      el.appendChild(av); el.appendChild(nm);
      el.addEventListener('click', function () { navigate(e.url); });
      box.appendChild(el);
    });
  }

  // ---------- history ----------
  function addHistory(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    var now = Date.now();
    state.history = state.history.filter(function (h) { return h.url !== url; });
    state.history.push({ url: url, title: document.title || hostOf(url), host: hostOf(url), time: now });
    saveData();
  }
  function removeHistory(url) {
    state.history = state.history.filter(function (h) { return h.url !== url; });
    saveData();
  }
  function toggleBookmark(url, title) {
    var i = state.bookmarks.findIndex(function (b) { return b.url === url; });
    if (i >= 0) state.bookmarks.splice(i, 1);
    else state.bookmarks.unshift({ url: url, title: title || hostOf(url), host: hostOf(url), time: Date.now() });
    saveData();
    return i >= 0;
  }
  function isBookmarked(url) {
    return state.bookmarks.some(function (b) { return b.url === url; });
  }

  // ---------- search ----------
  function doSearch(q) {
    lastQuery = q;
    $('results').classList.remove('hidden');
    $('home').classList.add('hidden');
    var head = $('res-head');
    head.innerHTML = 'Поиск: <b>' + esc(q) + '</b>';
    var list = $('res-list'); list.innerHTML = '';
    $('res-empty').textContent = 'Ищем…';
    var api = apiBase() + '/api/search?mode=' + encodeURIComponent(currentMode) + '&q=' + encodeURIComponent(q);
    fetchText(api, 12000)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.results || !data.results.length) {
          $('res-empty').textContent = (data && data.error) || 'Нет результатов. Попробуйте изменить запрос или проверьте настройки сервера.';
          return;
        }
        list.innerHTML = '';
        head.innerHTML = 'Поиск: <b>' + esc(q) + '</b> · ' + esc(data.source || '');
        data.results.forEach(function (r) {
          var el = document.createElement('a');
          el.className = 'res-item';
          el.href = r.url;
          var host = hostOf(r.url);
          var hostEl = '<span class="fav" style="background:' + paletteColor(host) + '">' + esc((host || '?').charAt(0).toUpperCase()) + '</span>';
          hostEl += '<span>' + esc(host) + '</span>';
          var star = isBookmarked(r.url) ? ' <span style="color:var(--gold)">★</span>' : '';
          el.innerHTML =
            '<div class="res-host">' + hostEl + star + '</div>' +
            '<div class="res-title">' + esc(r.title) + '</div>' +
            (r.snippet ? '<div class="res-snip">' + esc(r.snippet) + '</div>' : '');
          el.addEventListener('click', function (ev) { ev.preventDefault(); navigate(r.url, r.title); });
          list.appendChild(el);
        });
        var foot = document.createElement('div');
        foot.className = 'res-foot';
        foot.textContent = 'Подсказка: длинное нажатие добавляет в закладки';
        list.appendChild(foot);
      })
      .catch(function (e) {
        $('res-empty').textContent = 'Не удалось выполнить поиск: ' + e.message +
          '. Сервер недоступен — проверьте адрес API в настройках (для эмулятора 10.0.2.2).';
      });
  }

  function homeSearch(q) {
    $('results').classList.add('hidden');
    $('home').classList.remove('hidden');
    doSearch(q);
  }

  // ---------- navigation ----------
  function normalize(input) {
    var t = String(input || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (!t.indexOf(' ') && t.indexOf('.') !== -1 && !/^\d+(\.\d+){1,3}$/.test(t)) return 'https://' + t;
    return '';
  }

  function navigate(url, title) {
    try { addHistory(url); } catch (e) {}
    var canNav = function () {
      try { window.location.href = url; } catch (e) {}
    };
    if (IS_NATIVE) {
      // scam check on server
      fetchText(apiBase() + '/api/scam?url=' + encodeURIComponent(url), 6000)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.suspicious) {
            showScam(url, d.reason, canNav);
          } else {
            canNav();
          }
        })
        .catch(function () { canNav(); });
    } else {
      canNav();
    }
  }

  function showScam(url, reason, proceedFn) {
    var ov = document.createElement('div');
    ov.className = 'scam-dialog';
    ov.innerHTML =
      '<div class="scam-card">' +
      '<div class="scam-icon">⚠</div>' +
      '<h3>Подозрительный сайт</h3>' +
      '<p>' + esc(reason || url) + '</p>' +
      '<p>Переходите только если полностью доверяете адресу.</p>' +
      '<div class="scam-actions">' +
      '<button class="btn ghost" id="scam-back">Вернуться</button>' +
      '<button class="btn" id="scam-go">Всё равно перейти</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#scam-back').addEventListener('click', function () { ov.remove(); });
    ov.querySelector('#scam-go').addEventListener('click', function () { ov.remove(); proceedFn(); });
  }

  // ---------- suggest ----------
  var sugTimer = null;
  function onSuggestInput() {
    clearTimeout(sugTimer);
    var q = $('q').value.trim();
    if (!q) { $('suggest').classList.add('hidden'); return; }
    sugTimer = setTimeout(function () {
      fetchText(apiBase() + '/api/suggest?q=' + encodeURIComponent(q), 4000)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var box = $('suggest');
          if (!d || !Array.isArray(d.phrases) || !d.phrases.length) { box.classList.add('hidden'); return; }
          box.innerHTML = '';
          d.phrases.slice(0, 6).forEach(function (p) {
            var el = document.createElement('div');
            el.className = 'sug-item';
            el.textContent = p;
            el.addEventListener('click', function () {
              $('q').value = p;
              box.classList.add('hidden');
              doSearch(p);
              $('q').blur();
            });
            box.appendChild(el);
          });
          box.classList.remove('hidden');
        })
        .catch(function () { $('suggest').classList.add('hidden'); });
    }, 200);
  }

  // ---------- panels ----------
  function openSheet(title, bodyHtml) {
    $('sheet-head').innerHTML = '<span>' + esc(title) + '</span><button class="sheet-close" id="sheet-x">✕</button>';
    $('sheet-body').innerHTML = bodyHtml;
    $('panel').classList.remove('hidden');
    var x = $('sheet-x');
    if (x) x.addEventListener('click', closeSheet);
    bindSheetBody();
  }
  function closeSheet() { $('panel').classList.add('hidden'); }
  function bindSheetBody() {
    var els = document.querySelectorAll('#sheet-body .p-del');
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        var kind = this.getAttribute('data-kind');
        var url = this.getAttribute('data-url');
        if (kind === 'hist') removeHistory(url);
        else if (kind === 'bm') {
          state.bookmarks = state.bookmarks.filter(function (b) { return b.url !== url; });
          saveData();
        }
        openSheet(this.getAttribute('data-title'), listHtml(kind));
      });
    }
    var items = document.querySelectorAll('#sheet-body .p-list-item[data-url]');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function () {
        navigate(this.getAttribute('data-url'));
        closeSheet();
      });
    }
  }

  function listHtml(kind) {
    var arr = kind === 'bm' ? state.bookmarks : state.history.slice().reverse();
    if (!arr.length) {
      return '<div class="p-empty">' + (kind === 'bm' ? 'Закладок пока нет' : 'История пуста') + '</div>';
    }
    var html = '';
    arr.forEach(function (it) {
      var host = hostOf(it.url);
      html +=
        '<div class="p-list-item" data-url="' + esc(it.url) + '">' +
        '<span class="fav" style="background:' + paletteColor(host) + '">' + esc((host || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div class="p-list-main">' +
        '<div class="p-list-title">' + esc(it.title || host) + '</div>' +
        '<div class="p-list-url">' + esc(it.url) + '</div>' +
        '</div>' +
        '<button class="p-del" data-kind="' + kind + '" data-url="' + esc(it.url) + '" data-title="' +
        (kind === 'bm' ? 'Закладки' : 'История') + '">✕</button>' +
        '</div>';
    });
    return html;
  }

  function openBookmarks() { openSheet('Закладки', listHtml('bm')); }
  function openHistory() { openSheet('История', listHtml('hist')); }

  function openSettings() {
    openSheet('Настройки', '' +
      '<div class="set-row">' +
      '<div class="set-label">Адрес сервера Meoow (API)</div>' +
      '<input id="set-url" class="set-field" value="' + esc(state.serverUrl) + '" placeholder="http://10.0.2.2:18700">' +
      '<div class="set-note">На эмуляторе хост ПК — 10.0.2.2. На реальном устройстве укажите публичный адрес сервера (нужно опубликовать его в интернете).</div>' +
      '</div>' +
      '<div class="set-row"><button class="btn" id="set-save">Сохранить</button></div>' +
      '<div class="set-row"><button class="btn" id="set-test" style="background:var(--surface2);color:var(--ink);box-shadow:none">Проверить соединение</button></div>' +
      '<div class="set-note" id="set-status"></div>' +
      '<div class="set-version">Meoow Android v' + esc(state.version) + '</div>');

    var saveEl = $('set-save');
    if (saveEl) saveEl.addEventListener('click', function () {
      state.serverUrl = ($('set-url').value || '').trim().replace(/\/+$/, '');
      saveData();
      $('set-status').textContent = 'Сохранено.';
    });
    var testEl = $('set-test');
    if (testEl) testEl.addEventListener('click', function () {
      var st = $('set-status');
      st.textContent = 'Проверяю…';
      fetchText(state.serverUrl.replace(/\/+$/, '') + '/api/health', 5000)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          st.textContent = (d && d.ok) ? 'Сервер доступен ✓' : 'Сервер ответил неожиданным образом.';
        })
        .catch(function (e) { st.textContent = 'Недоступен: ' + e.message; });
    });
  }

  // ---------- events ----------
  function bind() {
    $('search-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = $('q').value.trim();
      if (!q) return;
      $('suggest').classList.add('hidden');
      var url = normalize(q);
      if (url) navigate(url);
      else { doSearch(q); $('q').blur(); }
    });

    $('q').addEventListener('input', onSuggestInput);
    $('q').addEventListener('blur', function () {
      setTimeout(function () { $('suggest').classList.add('hidden'); }, 200);
    });

    var modes = document.querySelectorAll('.mode');
    for (var i = 0; i < modes.length; i++) {
      modes[i].addEventListener('click', function () {
        var md = this.getAttribute('data-mode');
        for (var k = 0; k < modes.length; k++) modes[k].classList.remove('active');
        this.classList.add('active');
        currentMode = md;
        if (md !== 'web') {
          if (window.MeoowNative) window.MeoowNative.toast('Режимы «Картинки» и «Видео» — скоро');
          return;
        }
        if (lastQuery && $('results').classList.contains('hidden') === false) doSearch(lastQuery);
      });
    }

    $('tb-book').addEventListener('click', openBookmarks);
    $('tb-hist').addEventListener('click', openHistory);
    $('tb-set').addEventListener('click', openSettings);
    document.querySelector('.panel-backdrop').addEventListener('click', closeSheet);
  }

  // ---------- start ----------
  function start() {
    loadData();
    bind();
    if (location.hash) {
      var m = location.hash.match(/^#q=(.*)$/);
      if (m) {
        try {
          var q = decodeURIComponent(m[1]);
          $('q').value = q;
          homeSearch(q);
          return;
        } catch (e) {}
      }
    }
    renderDial();
  }

  window.meoowStart = start;
  window.meoow = {
    search: function (q) { homeSearch(q); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();