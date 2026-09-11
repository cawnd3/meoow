(function () {
  'use strict';

  var POLL_MS = 5000;

  function $id(id) { return document.getElementById(id); }

  function humanTime(now, t) {
    if (!t) return '—';
    var s = Math.max(0, Math.round((t - now) / 1000));
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин';
    if (s < 86400) return Math.floor(s / 3600) + ' ч';
    return Math.floor(s / 86400) + ' дн';
  }

  function agoText(now, t, label) {
    if (!t) return label + ': —';
    var s = Math.round((now - t) / 1000);
    var rel = s < 0 ? 'в будущем' : humanTime(now, t);
    return label + ': ' + rel + ' назад';
  }

  function render(data) {
    var dot = $id('status-dot');
    var counts = $id('counts');
    var list = $id('list');
    var foot = $id('foot');
    var hint = $id('hint');

    if (!data || !data.ok) {
      dot.className = 'dot err';
      counts.textContent = '';
      hint.textContent = data && data.serverUrl ? 'Сервер: ' + data.serverUrl : 'Сервер недоступен';
      var url = (data && data.serverUrl) || '';
      list.innerHTML = '<div class="errbox">Не удалось запросить список.<br>Сервер Meoow не запущен или недоступен.<br>' +
        (url ? '<span class="url">' + esc(url) + '</span>' : '') + '</div>';
      foot.textContent = 'обновление каждые ' + (POLL_MS / 1000) + ' c · ' + new Date().toLocaleTimeString();
      return;
    }

    dot.className = data.activeCount > 0 ? 'dot' : 'dot err';
    counts.innerHTML = 'активных <b>' + data.activeCount + '</b> · всего <b>' + data.totalUsers + '</b>';
    hint.textContent = 'Сервер: ' + (data.server && data.server.port ? 'http://127.0.0.1:' + data.server.port : '') +
      ' · данные: ' + (data.server && data.server.dataDir || '');

    if (!data.users.length) {
      list.innerHTML = '<div class="empty">Активных пользователей сейчас нет.<br>Появится при входе в аккаунт в браузере.</div>';
      foot.textContent = 'обновление каждые ' + (POLL_MS / 1000) + ' c · ' + new Date().toLocaleTimeString();
      return;
    }

    var html = '';
    data.users.forEach(function (u, i) {
      var lastAct = 0;
      var chips = '';
      (u.profiles || []).forEach(function (p) {
        if (p.updatedAt > lastAct) lastAct = p.updatedAt;
        chips += '<span class="chip"><span class="pdot" style="background:' + esc(p.color || '#c7410f') + '"></span>' +
          esc(p.name) + (p.hasPin ? ' <span class="locked">🔒</span>' : '') + '</span>';
      });
      var remaining = humanTime(data.now, u.expiresAt);
      html += '<div class="card">' +
        '<div class="card-top"><span class="email">' + esc(u.email) + '</span>' +
        '<span class="token">' + esc(u.tokenPrefix) + '…</span></div>' +
        '<div class="times">' +
        '<div>' + agoText(data.now, u.createdAt, 'Вход') + '</div>' +
        '<div>До конца сессии: <b>' + remaining + '</b></div>' +
        (lastAct ? '<div>' + agoText(data.now, lastAct, 'Последняя активность') + '</div>' : '') +
        '</div>' +
        (chips ? '<div class="profiles">' + chips + '</div>' : '') +
        '</div>';
    });
    list.innerHTML = html;
    foot.textContent = 'обновление каждые ' + (POLL_MS / 1000) + ' c · ' + new Date().toLocaleTimeString();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function poll() {
    window.meoow.devActiveUsers().then(render).catch(function (e) {
      render({ ok: false, error: e && e.message || String(e) });
    });
  }

  poll();
  setInterval(poll, POLL_MS);
})();