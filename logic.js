/* 接機行程 logic — works in browser and node */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TripLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var KMB_URL = 'https://data.etabus.gov.hk/v1/transport/kmb/eta/ED364A58F885DC92/68A/1';
  var MTR_URL = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=AEL&sta=TSY&lang=tc';
  var DEFAULTS = { walkToStop: 5, busRide: 16, walkToGate: 10, aelRide: 12, walkToHallB: 5 };
  var MIN = 60000;

  function parseKmb(json, nowMs) {
    var list = (json && json.data) || [];
    return list
      .filter(function (d) { return d && d.dir === 'O' && d.eta; })
      .map(function (d) {
        var t = Date.parse(d.eta);
        return { time: t, mins: Math.round((t - nowMs) / MIN), remark: d.rmk_tc || '', seq: d.eta_seq };
      })
      .filter(function (d) { return !isNaN(d.time) && d.time >= nowMs - 30000; })
      .sort(function (a, b) { return a.time - b.time; });
  }
  function parseMtr(json, nowMs) {
    if (!json || json.status === 0 && !json.data) throw new Error('MTR 暫無資料');
    var st = json.data && json.data['AEL-TSY'];
    if (!st) throw new Error('MTR 回傳格式不符');
    return (st.UP || []).filter(function (d) { return d.valid !== 'N' && d.time; }).map(function (d) {
      var t = Date.parse(d.time.replace(' ', 'T') + '+08:00');
      return { time: t, mins: Math.round((t - nowMs) / MIN), plat: d.plat, dest: d.dest };
    }).filter(function (d) { return !isNaN(d.time); }).sort(function (a, b) { return a.time - b.time; });
  }
  // Extend a live list with ESTIMATED entries (observed headway) until endMs. Live entries keep estimated:false.
  function extend(list, endMs, defGap, minGap, maxGap) {
    var out = list.map(function (x) { return Object.assign({}, x, { estimated: false }); });
    if (!out.length) return out;
    var gap = defGap;
    if (out.length > 1) {
      var gs = []; for (var i = 1; i < out.length; i++) gs.push(out[i].time - out[i - 1].time);
      gs.sort(function (a, b) { return a - b; });
      gap = Math.max(minGap, Math.min(maxGap, gs[Math.floor(gs.length / 2)]));
    }
    var t = out[out.length - 1].time + gap, tpl = out[out.length - 1];
    while (t <= endMs) { out.push(Object.assign({}, tpl, { time: t, estimated: true, remark: '' })); t += gap; }
    return out;
  }
  function window60(nowMs) { return { start: nowMs, end: nowMs + 60 * MIN }; }
  function extendBuses(buses, nowMs) { return extend(buses, nowMs + 60 * MIN, 20 * MIN, 12 * MIN, 30 * MIN); }
  function extendTrains(trains, nowMs) { return extend(trains, nowMs + 60 * MIN, 10 * MIN, 8 * MIN, 15 * MIN); }
  // plan: pick the LATEST bus whose arrival at Hall B <= target
  function plan(buses, trains, targetMs, nowMs, a) {
    a = Object.assign({}, DEFAULTS, a || {});
    var options = buses.map(function (b) {
      var atTsy = b.time + a.busRide * MIN;
      var atGate = atTsy + a.walkToGate * MIN;
      var train = trains.filter(function (t) { return t.time >= atGate; })[0] || null;
      var est = false;
      if (!train && trains.length) { // API only lists ~4 trains: extrapolate at headway
        var last = trains[trains.length - 1].time;
        var gap = trains.length > 1 ? Math.max(8 * MIN, Math.min(12 * MIN, (last - trains[0].time) / (trains.length - 1))) : 10 * MIN;
        var tt = last; while (tt < atGate) tt += gap;
        train = { time: tt, plat: trains[trains.length - 1].plat, estimated: true }; est = true;
      }
      var arrive = train ? train.time + (a.aelRide + a.walkToHallB) * MIN : null;
      return {
        bus: b, train: train, arrive: arrive, estimated: est,
        leave: b.time - a.walkToStop * MIN,
        onTime: arrive !== null && arrive <= targetMs,
        missed: b.time - a.walkToStop * MIN < nowMs
      };
    });
    var ok = options.filter(function (o) { return o.onTime && !o.missed; });
    var best = ok.length ? ok[ok.length - 1] : null;
    // if the last (latest) bus in list is on time there may be a later one we cannot see
    var latestKnown = options.length ? options[options.length - 1] : null;
    return { options: options, best: best, limited: !!(best && best === latestKnown), assumptions: a };
  }
  // HKT helpers (independent of device timezone)
  function hkParts(ms) { var d = new Date(ms + 8 * 3600000); return d; }
  function fmt(ms) { var d = hkParts(ms); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
  function fmtSec(ms) { var d = hkParts(ms); return fmt(ms) + ':' + p2(d.getUTCSeconds()); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function targetToMs(hhmm, nowMs) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return NaN;
    var d = hkParts(nowMs);
    var base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]) - 8 * 3600000;
    if (base < nowMs - 6 * 3600000) base += 86400000;
    return base;
  }
  return { KMB_URL: KMB_URL, MTR_URL: MTR_URL, DEFAULTS: DEFAULTS, parseKmb: parseKmb, parseMtr: parseMtr,
    plan: plan, extend: extend, extendBuses: extendBuses, extendTrains: extendTrains, window60: window60, fmt: fmt, fmtSec: fmtSec, targetToMs: targetToMs };
});
