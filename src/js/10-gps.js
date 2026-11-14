// ---------- GPS ----------
let ready = false;
const geo = { watchId: null, denied: false };
const live = {
  pbLap: null,
  pbSp: [],
  lapStart: null,
  clockOff: 0,
  lastFixAt: 0,
  lastFixT: 0,
  acc: null,
  iv: [],
  err: false,
  gEma: null,
  dragPb: null,
  dragMain: 400
};
function startGeo() {
  if (geo.watchId != null || !('geolocation' in navigator) || !window.isSecureContext) return;
  geo.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}
function onPos(pos) {
  const c = pos.coords,
    now = Date.now(),
    t = pos.timestamp || now;
  if (t <= live.lastFixT) return;
  if (live.lastFixAt) {
    live.iv.push((now - live.lastFixAt) / 1000);
    if (live.iv.length > 5) live.iv.shift();
  }
  live.lastFixAt = now;
  live.lastFixT = t;
  live.acc = c.accuracy;
  live.pos = { lat: c.latitude, lon: c.longitude };
  live.clockOff = now - t;
  geo.denied = false;
  if (live.err) {
    live.err = false;
    if (rec.on) setNote(tx('recNote'));
  }
  updateGps();
  if (!rec.on || !(c.accuracy <= settings.maxAcc)) return;
  const s = rec.session,
    pts = s.points,
    last = pts[pts.length - 1];
  const p = { t, lat: c.latitude, lon: c.longitude, v: 0, acc: Math.round(c.accuracy * 10) / 10 };
  const sv = c.speed != null && c.speed >= 0 ? c.speed : null;
  if (last) {
    const dt = (t - last.t) / 1000,
      d = distM(last, p);
    if (d / dt > 120) return; // 432km/h 超の跳びは誤測位として捨てる
    // 端末が速度を出せないときは、約2秒前の点からの移動で求める。6m 未満の動きは GPS の揺れとみなす
    if (sv != null) {
      p.v = sv;
      p.sp = 1;
    } else {
      let ref = pts[pts.length - 1];
      for (let k = pts.length - 1; k >= 0 && t - pts[k].t <= 2500; k--) ref = pts[k];
      const d2 = distM(ref, p),
        dt2 = (t - ref.t) / 1000;
      p.v = d2 < Math.min(8, Math.max(3, 1.5 * c.accuracy)) ? 0 : d2 / dt2;
    }
  } else if (sv != null) {
    p.v = sv;
    p.sp = 1;
  }
  if (p.v < STILL_V) p.v = 0; // 時速約3km未満は止まっているとみなす
  pts.push(p);
  if (last && t - last.t > GAP_MS) setNote(tx('gapNote', fmtDur(t - last.t)), true);
  if (s.mode === 'free') freeLive(last, p);
  if (rec.det) {
    const ev = rec.det.push(p);
    if (s.mode === 'drag') handleDrag(ev);
    else handleEvents(ev);
  }
  if (s.mode !== 'drag' && rec.det && live.ref && live.lapStart != null) {
    const r = live.ref.at(p, live.lapStart);
    live.delta = r ? r.delta : null;
    live.pred = r ? r.pred : null;
  }
  renderMain();
  if (s.vehicle.type === 'bike' && pts.length >= 3) {
    const g = g3(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    if (g) {
      const e = live.gEma;
      live.gEma = e ? { lat: e.lat + 0.6 * (g.lat - e.lat), lon: e.lon + 0.6 * (g.lon - e.lon) } : g;
      gmPush(live.gEma);
    }
  }
  const big = s.points.length > 5000 || (s.gs && s.gs.length > 30000); // 大きくなったら書き込みの間隔を延ばす
  if (now - rec.lastSave > (big ? 30000 : 10000)) {
    rec.lastSave = now;
    s.laps = rec.det ? rec.det.laps.map(stripLap) : [];
    DB.append(s);
  }
}
// フリー走行の画面：距離・最高速・平均（走行中）を、点が届くたびに足していく（集計の決まりは rideStats と同じ）
function freeLive(q, p) {
  const f = live.free;
  if (p.v > f.vmax) f.vmax = p.v;
  if (q && p.t - q.t <= GAP_MS && (p.v > 0 || q.v > 0)) {
    f.dist += distM(q, p);
    f.mov += p.t - q.t;
  }
  setText($('#curLap'), String(Math.round(p.v * spdK())));
  setText($('#lastLap'), fmtDist(f.dist));
  setText($('#bestLap'), String(Math.round(f.vmax * spdK())));
  setText($('#secTime'), f.mov ? String(Math.round((f.dist / (f.mov / 1000)) * spdK())) : '--');
}
function onPosErr(e) {
  if (e.code === 1) geo.denied = true;
  updateGps();
  if (!rec.on) return;
  live.err = true;
  setNote(e.code === 1 ? tx('geoDenied') : e.code === 3 ? tx('geoTimeout') : tx('geoErr', e.message), true);
}
let gpsShown = '';
function updateGps() {
  let cls = '',
    txt;
  if (geo.denied) {
    cls = 'bad';
    txt = tx('gpsDenied');
  } else if (!window.isSecureContext || !('geolocation' in navigator)) {
    cls = 'bad';
    txt = tx('gpsDenied');
  } else if (!live.lastFixAt) txt = tx('gpsCheck');
  else {
    const age = (Date.now() - live.lastFixAt) / 1000,
      iv = live.iv.length ? live.iv.reduce((a, b) => a + b, 0) / live.iv.length : null;
    if (age > 3) {
      cls = 'bad';
      txt = tx('gpsLost', Math.round(age));
    } else {
      cls = live.acc <= settings.maxAcc ? 'ok' : 'weak';
      txt = tx(cls === 'ok' ? 'gpsGood' : 'gpsWeak', Math.round(live.acc)) + (iv ? ` · ${(1 / iv).toFixed(1)}Hz` : '');
    }
  }
  const key = cls + '|' + txt + '|' + settings.lang;
  if (key === gpsShown) return; // 0.1秒ごとに呼ばれるので、変わったときだけ書き換える
  gpsShown = key;
  $$('[data-gps]').forEach(el => {
    el.className = 'gpsPill ' + cls;
    el.querySelector('.gtxt').textContent = txt;
  });
}
