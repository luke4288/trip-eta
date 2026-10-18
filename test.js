const L = require('./logic.js');
(async () => {
  const now = Date.now();
  const [k, m] = await Promise.all([fetch(L.KMB_URL).then(r => r.json()), fetch(L.MTR_URL).then(r => r.json())]);
  const buses = L.parseKmb(k, now), trains = L.parseMtr(m, now);
  console.log('buses', buses.map(b => L.fmt(b.time) + ' (' + b.mins + 'm)'));
  console.log('trains', trains.map(t => L.fmt(t.time) + ' plat' + t.plat + ' ' + t.dest + ' (' + t.mins + 'm)'));
  const tgt = L.targetToMs('18:30', now);
  const p = L.plan(buses, trains, tgt, now);
  console.log('target', L.fmt(tgt));
  p.options.forEach(o => console.log(L.fmt(o.bus.time), 'leave', L.fmt(o.leave), 'train', o.train && L.fmt(o.train.time), 'arrive', o.arrive && L.fmt(o.arrive), o.onTime ? 'OK' : 'LATE'));
  console.log('best', p.best && ('bus ' + L.fmt(p.best.bus.time) + ' leave ' + L.fmt(p.best.leave)), 'limited', p.limited);
  // unit tests
  const assert = require('assert');
  assert.deepStrictEqual(L.parseKmb({data:[{dir:'O',eta:null},{dir:'I',eta:'2030-01-01T00:00:00+08:00'}]}, now), []);
  assert.strictEqual(L.fmt(Date.parse('2026-10-18T18:30:00+08:00')), '18:30');
  assert.strictEqual(L.targetToMs('18:30', Date.parse('2026-10-18T16:00:00+08:00')), Date.parse('2026-10-18T18:30:00+08:00'));
  const T = s => Date.parse('2026-10-18T'+s+':00+08:00');
  const fb = ['17:09','17:29','17:49','18:09'].map(s=>({time:T(s)}));
  const trs = ['17:50','17:59','18:10','18:20'].map(s=>({time:T(s)}));
  const pp = L.plan(fb, trs, T('18:30'), T('16:50'));
  // 17:29 bus->17:45 TY->17:55 gate->17:59 train->18:11 AIR->18:16 ; 17:49->18:05->18:15->18:20 train->18:37 late
  assert.strictEqual(L.fmt(pp.best.bus.time), '17:29');
  assert.strictEqual(L.fmt(pp.best.arrive), '18:16');
  assert.strictEqual(L.fmt(pp.best.leave), '17:24');
  const p2 = L.plan(fb, trs, T('18:45'), T('16:50'));
  assert.strictEqual(L.fmt(p2.best.bus.time), '17:49'); // 18:37
  assert.strictEqual(p2.options[3].train, null); // no live train catchable -> no extrapolation
  assert.strictEqual(p2.options[3].noTrain, true);
  const p3 = L.plan(fb, trs, T('18:30'), T('17:27')); // 17:29 bus now unreachable (leave 17:24 < now)
  assert.strictEqual(p3.best, null);
  assert.strictEqual(L.parseKmb({data:[{dir:'O',eta:'2099-01-01T00:00:00+08:00',rmk_tc:'原定班次'},{dir:'O',eta:'2099-01-01T00:10:00+08:00',rmk_tc:''}]}, now).map(b=>b.scheduled).join(), 'true,false');
  assert.ok(!('extendBuses' in L));
  console.log('unit tests OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
