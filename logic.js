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
        return { time: t, mins: Math.round((t - nowMs) / MIN), remark: d.rmk_tc || '', seq: d.eta_seq, scheduled: /原定班次|Scheduled/i.test((d.rmk_tc || '') + ' ' + (d.rmk_en || '')) };
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
  // plan: pick the LATEST bus whose arrival at Hall B <= target
  function plan(buses, trains, targetMs, nowMs, a) {
    a = Object.assign({}, DEFAULTS, a || {});
    var options = buses.map(function (b) {
      var atTsy = b.time + a.busRide * MIN;
      var atGate = atTsy + a.walkToGate * MIN;
      var train = trains.filter(function (t) { return t.time >= atGate; })[0] || null; // live only; null = no catchable live train
      var arrive = train ? train.time + (a.aelRide + a.walkToHallB) * MIN : null;
      return {
        bus: b, train: train, arrive: arrive, noTrain: !train,
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
    plan: plan, fmt: fmt, fmtSec: fmtSec, targetToMs: targetToMs };
});
