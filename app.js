(function () {
  var L = TripLogic, $ = function (id) { return document.getElementById(id); };
  var KEYS = Object.keys(L.DEFAULTS);
  var state = { buses: [], trains: [], errors: {}, updated: null };

  function loadAssump() {
    var a = Object.assign({}, L.DEFAULTS), s = null;
    try { s = JSON.parse(localStorage.getItem('assump') || 'null'); } catch (e) {}
    if (s) KEYS.forEach(function (k) { if (typeof s[k] === 'number' && s[k] >= 0) a[k] = s[k]; });
    return a;
  }
  function readAssump() {
    var a = {};
    KEYS.forEach(function (k) { var v = parseInt($('a_' + k).value, 10); a[k] = isNaN(v) || v < 0 ? L.DEFAULTS[k] : v; });
    return a;
  }
  function saveAssump() { try { localStorage.setItem('assump', JSON.stringify(readAssump())); } catch (e) {} }

  function getJson(url) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, 10000);
    return fetch(url, { cache: 'no-store', signal: c.signal }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { clearTimeout(t); throw new Error(e.name === 'AbortError' ? '連線逾時' : (e.message === 'Failed to fetch' ? '網絡錯誤' : e.message)); });
  }

  function refresh() {
    $('refresh').disabled = true;
    var now = Date.now();
    var kb = getJson(L.KMB_URL).then(function (j) { state.buses = L.parseKmb(j, now); delete state.errors.bus; })
      .catch(function (e) { state.errors.bus = '巴士資料載入失敗：' + e.message; });
    var mt = getJson(L.MTR_URL).then(function (j) { state.trains = L.parseMtr(j, now); delete state.errors.mtr; })
      .catch(function (e) { state.errors.mtr = '機場快線資料載入失敗：' + e.message; });
    return Promise.all([kb, mt]).then(function () {
      state.updated = Date.now(); state.now = now; render(); $('refresh').disabled = false;
    });
  }

  function render() {
    var now = Date.now();
    state.eb = L.extendBuses(state.buses.filter(function (b) { return b.time >= now - 30000; }), now);
    state.et = L.extendTrains(state.trains.filter(function (t) { return t.time >= now - 30000; }), now);
    $('updated').textContent = state.updated ? '最後更新 ' + L.fmtSec(state.updated) + ' HKT' : '尚未更新';
    $('errors').innerHTML = '';
    Object.keys(state.errors).forEach(function (k) {
      var d = document.createElement('div'); d.className = 'err'; d.textContent = '⚠ ' + state.errors[k] + '（顯示的可能是舊資料，請按重新整理）'; $('errors').appendChild(d);
    });
    $('bus').innerHTML = state.buses.length ? state.buses.slice(0, 3).map(function (b) {
      var m = Math.round((b.time - now) / 60000);
      return '<li><span class="big">' + (m <= 0 ? '即將到站' : m + ' 分鐘') + '</span><span class="sub">' + L.fmt(b.time) + (b.remark ? ' · ' + esc(b.remark) : '') + '</span></li>';
    }).join('') : '<li class="muted">' + (state.errors.bus ? '無法取得資料' : '暫時沒有 68A 班次資料（可能已收車或未發車）') + '</li>';
    $('mtr').innerHTML = state.trains.length ? state.trains.map(function (t) {
      var m = Math.round((t.time - now) / 60000);
      return '<li><span class="big">' + (m <= 0 ? '即將開出' : m + ' 分鐘') + '</span><span class="sub">' + L.fmt(t.time) + ' · 月台 ' + esc(t.plat) + ' · 往' + (t.dest === 'AWE' ? '機場／博覽館' : esc(t.dest)) + '</span></li>';
    }).join('') : '<li class="muted">' + (state.errors.mtr ? '無法取得資料' : '暫時沒有班次資料') + '</li>';
    renderConn(now);
    renderPlan(now);
  }
  function renderConn(now) {
    var el = $('conn');
    if (!state.buses.length) { el.innerHTML = '<div class="muted">' + (state.errors.bus ? '無法取得巴士資料' : '暫時沒有 68A 班次資料') + '</div>'; return; }
    if (!state.trains.length) { el.innerHTML = '<div class="muted">' + (state.errors.mtr ? '無法取得機場快線資料' : '暫時沒有機場快線資料') + '</div>'; return; }
    var a = readAssump(), tgt = L.targetToMs($('target').value, now);
    var p = L.plan(state.eb.slice(0, 3), state.et, tgt, now, a);
    el.innerHTML = p.options.map(function (o, i) {
      var mins = Math.round((o.bus.time - now) / 60000), tsy = o.bus.time + a.busRide * 60000;
      var air = o.train ? o.train.time + a.aelRide * 60000 : null;
      var late = o.arrive !== null && !isNaN(tgt) && o.arrive > tgt;
      var hasT = !isNaN(tgt);
      var cls = (o.missed || late) ? 'bad' : 'ok';
      var tag = o.missed ? '需即刻出門／已來不及' : (!hasT ? '' : (late ? '遲過目標 ' + L.fmt(tgt) : '趕得及 ' + L.fmt(tgt)));
      return '<div class="conn"><div class="ch"><span class="big">' + (mins <= 0 ? '即將到站' : mins + ' 分鐘') + '</span><span class="tag ' + cls + '">' + tag + '</span></div>' +
        '<table>' +
        '<tr><td>出門</td><td class="v">' + L.fmt(o.leave) + '</td></tr>' +
        '<tr><td>68A 到站</td><td class="v">' + L.fmt(o.bus.time) + (o.bus.remark ? ' <span class="sub">' + esc(o.bus.remark) + '</span>' : '') + '</td></tr>' +
        '<tr><td>抵達青衣站</td><td class="v">' + L.fmt(tsy) + '</td></tr>' +
        '<tr><td>機場快線開出</td><td class="v">' + (o.train ? L.fmt(o.train.time) + (o.train.estimated ? '（估）' : '') + ' · 月台 ' + esc(o.train.plat) : '—') + '</td></tr>' +
        '<tr><td>抵達機場</td><td class="v">' + (air ? L.fmt(air) + ' <span class="sub">（B 廳 ' + L.fmt(o.arrive) + '）</span>' : '—') + '</td></tr>' +
        '</table></div>';
    }).join('') + '<p class="note">「實時」＝KMB 即時 ETA；「估」＝按觀察到的班距推算。' + (state.buses.length < 3 ? '目前 KMB 只提供 ' + state.buses.length + ' 班實時資料。' : 'KMB 只提供最多 3 班實時 ETA。') + '</p>';
    renderTimeline(now, a);
  }
  function renderTimeline(now, a) {
    var end = now + 60 * 60000, items = [];
    state.eb.forEach(function (b) { if (b.time <= end) {
      var tr = L.plan([b], state.et, NaN, now, a).options[0];
      items.push({ t: b.time, kind: 'bus', est: b.estimated, extra: tr.arrive ? '→ 機場 ' + L.fmt(tr.train.time + a.aelRide * 60000) : '' }); } });
    state.et.forEach(function (t) { if (t.time <= end) items.push({ t: t.time, kind: 'ael', est: t.estimated, extra: '月台 ' + esc(t.plat || '') }); });
    items.sort(function (x, y) { return x.t - y.t; });
    $('timeline').innerHTML = items.length ? items.map(function (i) {
      return '<li><span><b>' + L.fmt(i.t) + '</b> ' + (i.kind === 'bus' ? '🚌 68A' : '🚆 機場快線') + '</span><span class="sub">' + i.extra + ' <span class="badge' + (i.est ? '' : ' live') + '">' + (i.est ? '估' : '實時') + '</span></span></li>';
    }).join('') : '<li class="muted">此時段沒有資料</li>';
    $('winlabel').textContent = L.fmt(now) + ' – ' + L.fmt(end) + ' HKT';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderPlan(now) {
    var el = $('result'), tgt = L.targetToMs($('target').value, now);
    if (isNaN(tgt)) { el.innerHTML = '<span class="muted">輸入想幾點到機場，我會揀最遲都趕得及的 68A，並計出門時間。上面三班車的接駁行程不需輸入。</span>'; return; }
    if (!state.buses.length || !state.trains.length) { el.innerHTML = '<span class="muted">需要巴士及機場快線資料才能計算。</span>'; return; }
    var p = L.plan(state.eb, state.et, tgt, now, readAssump());
    if (!p.best) {
      var first = p.options.filter(function (o) { return !o.missed && o.arrive; })[0];
      el.innerHTML = '<div class="lv bad">趕不及 ' + L.fmt(tgt) + '</div><div class="sub">' +
        (first ? '最早可行：' + L.fmt(first.bus.time) + ' 巴士，預計 ' + L.fmt(first.arrive) + ' 抵達 B 廳（立即出門）。' : '可見的班次已來不及，請看下一班。') + '</div>';
      return;
    }
    var b = p.best, wait = Math.round((b.leave - now) / 60000);
    el.innerHTML = '<div class="sub">建議出門</div><div class="lv ok">' + L.fmt(b.leave) + '</div>' +
      '<div class="sub">（約 ' + (wait <= 0 ? '現在' : wait + ' 分鐘後') + '）</div>' +
      '<div style="margin-top:6px">搭 <b>' + L.fmt(b.bus.time) + '</b> 的 68A → 搭 <b>' + L.fmt(b.train.time) + '</b>' + (b.train.estimated ? '（估）' : '') +
      ' 機場快線 → <b>' + L.fmt(b.arrive) + '</b> 抵達 B 廳' +
      '<div class="sub">比目標早 ' + Math.max(0, Math.round((tgt - b.arrive) / 60000)) + ' 分鐘</div>' +
      (p.limited ? '<div class="sub">⚠ 只顯示 3 班巴士；之後可能還有更遲但仍趕得及的班次。</div>' : '') + '</div>';
  }

  function init() {
    var a = loadAssump();
    KEYS.forEach(function (k) { $('a_' + k).value = a[k]; $('a_' + k).addEventListener('input', function () { saveAssump(); render(); }); });
    $('target').addEventListener('input', function () { saveAssump(); render(); });
    $('reset').addEventListener('click', function () { KEYS.forEach(function (k) { $('a_' + k).value = L.DEFAULTS[k]; }); saveAssump(); render(); });
    $('refresh').addEventListener('click', refresh);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    refresh(); setInterval(refresh, 30000); setInterval(render, 10000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  init();
})();
