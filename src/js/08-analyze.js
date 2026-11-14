// ---------- 解析 ----------
const anaCache = new Map();
function analyze(s){
  const key = (s.rev || 0) + ':' + s.points.length + ':' + (s.gs ? s.gs.length : 0);
  let A = anaCache.get(s.id);
  if (A && A.key === key) return A;
  const p0 = s.points[0] || { lat: 0, lon: 0 };
  A = { key, proj: makeProj(p0.lat, p0.lon), traces: new Map(), pg: pointG(s), det: null };
  if (s.mode === 'free'){
    A.laps = []; A.pieces = ridePieces(s.points); A.ride = A.pieces.length ? rideStats(s.points, 0, s.points.length - 1) : null;
  } else if (s.mode === 'drag'){
    const d = new DragDetector(s.settings);
    for (const p of s.points) d.push(p);
    A.laps = d.laps; A.pieces = d.laps.slice();
  } else {
    if (!courseProblem(s.course)){
      A.det = new LapDetector(s.course, Object.assign({}, DEFAULT_OPT, s.settings));
      for (const p of s.points) A.det.push(p);
    }
    A.laps = A.det ? A.det.laps : [];
    A.pieces = A.laps.slice();
    const pts = s.points;
    if (s.course.type !== 'segment' && A.laps.length && pts.length){
      const f = A.laps[0], L = A.laps[A.laps.length - 1], a = pts[0], z = pts[pts.length - 1];
      if (a.t < f.start) A.pieces.unshift({ kind: 'out', n: 0, start: a.t, end: f.start, time: f.start - a.t, sll: a, sv: a.v, ell: f.sll, ev: f.sv, splits: [] });
      if (z.t > L.end) A.pieces.push({ kind: 'in', n: 0, start: L.end, end: z.t, time: z.t - L.end, sll: L.ell, sv: L.ev, ell: z, ev: z.v, splits: [] });
    }
  }
  for (const l of A.laps) l.excl = isExcl(s, l);
  if (!s.active) s.laps = A.laps.map(stripLap);
  if (!s.active && s.mode !== 'drag' && s.mode !== 'free') s.why0 = A.laps.length ? '' : A.det ? why0(A.det, 30).code : 'w0Course';
  if (!s.active && A.ride) s.ride = { dist: Math.round(A.ride.dist), mov: A.ride.mov, total: A.ride.total };
  anaCache.set(s.id, A);
  return A;
}
// フリー走行の集計：距離・走行時間（動いていた時間）・停車時間・GPSの途切れ。i0〜i1 は点の番号
function rideStats(pts, i0, i1){
  let dist = 0, mov = 0, gapN = 0, gapMs = 0, vmax = 0;
  for (let i = i0; i <= i1; i++){
    const p = pts[i]; if (p.v > vmax) vmax = p.v;
    if (i === i0) continue;
    const q = pts[i - 1], dt = p.t - q.t;
    if (dt > GAP_MS){ gapN++; gapMs += dt; continue; }
    if (p.v > 0 || q.v > 0){ dist += distM(q, p); mov += dt; }
  }
  const total = i1 >= i0 ? pts[i1].t - pts[i0].t : 0;
  return { dist, mov, gapN, gapMs, vmax, total, stop: Math.max(0, total - mov - gapMs), vavg: mov ? dist / (mov / 1000) : 0 };
}
// 全体と、REST_MS 以上止まった（途切れた）ところで分けた区間
function ridePieces(pts){
  if (pts.length < 2) return [];
  const mk = (kind, n, a, b) => ({ kind, n, start: pts[a].t, end: pts[b].t, time: pts[b].t - pts[a].t, sll: pts[a], sv: pts[a].v, ell: pts[b], ev: pts[b].v, splits: [], ia: a, ib: b });
  const legs = []; let a = -1, last = -1;
  for (let i = 0; i < pts.length; i++){
    if (!(pts[i].v > 0)) continue;
    if (a < 0) a = i;
    else if (pts[i].t - pts[last].t >= REST_MS){ if (last > a) legs.push([a, last]); a = i; }
    last = i;
  }
  if (a >= 0 && last > a) legs.push([a, last]);
  const out = [mk('ride', 0, 0, pts.length - 1)];
  if (legs.length > 1) legs.forEach(([x, y], k) => out.push(mk('leg', k + 1, x, y)));
  return out;
}
const isFree = s => s && s.mode === 'free';
function getTrace(s, A, pc){
  const key = pc.kind + ':' + pc.start;
  if (A.traces.has(key)) return A.traces.get(key);
  const pr = A.proj, out = [];
  const add = (ll, t, v, gl, go) => { const q = pr(ll); out.push({ t, lat: ll.lat, lon: ll.lon, x: q.x, y: q.y, v, glat: gl, glon: go, d: 0 }); };
  add(pc.sll, pc.start, pc.sv || 0, null, null);
  s.points.forEach((p, i) => { if (p.t > pc.start && p.t < pc.end) add(p, p.t, p.v, A.pg.lat[i], A.pg.lon[i]); });
  add(pc.ell, pc.end, pc.ev || 0, null, null);
  const n = out.length;
  if (n > 2){
    out[0].glat = out[1].glat; out[0].glon = out[1].glon;
    out[n - 1].glat = out[n - 2].glat; out[n - 1].glon = out[n - 2].glon;
  }
  const free = isFree(s);
  for (let i = 1; i < n; i++){
    if (free && out[i].t - out[i - 1].t > GAP_MS){ out[i].gap = true; out[i].d = out[i - 1].d; continue; } // 途切れた区間は距離に入れない
    out[i].d = out[i - 1].d + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
  }
  A.traces.set(key, out);
  return out;
}
function lapGPoints(s, A, pc){
  if (s.vehicle && s.vehicle.type === 'car') return carSamples(s, pc.start, pc.end);
  return getTrace(s, A, pc).filter(p => p.glat != null && p.glon != null).map(p => ({ t: p.t, lat: p.glat, lon: p.glon }));
}
function lapStats(s, A, pc){
  if (pc._st) return pc._st;
  const tr = getTrace(s, A, pc), inner = tr.slice(1, -1).map(p => p.v), v = inner.length ? inner : tr.map(p => p.v);
  const dist = tr[tr.length - 1].d;
  let brake = 0, coast = 0, hasData = false;
  const acc = (g, dt) => { hasData = true; if (g <= BRAKE_G) brake += dt; else if (g < ACCEL_G) coast += dt; };
  if (s.vehicle && s.vehicle.type === 'car'){
    const sm = carSamples(s, pc.start, pc.end);
    for (let i = 1; i < sm.length; i++) acc((sm[i].lon + sm[i - 1].lon) / 2, Math.min(0.3, (sm[i].t - sm[i - 1].t) / 1000));
  } else {
    for (let i = 1; i < tr.length; i++){ const a = tr[i - 1], b = tr[i]; if (a.glon != null && b.glon != null) acc((a.glon + b.glon) / 2, (b.t - a.t) / 1000); }
  }
  return (pc._st = { vmin: Math.min(...v) * spdK(), vmax: Math.max(...v) * spdK(), vavg: dist / (pc.time / 1000) * spdK(), brake, coast, hasG: hasData, dist });
}
// 振れ幅が prom 以上の山と谷
function zigzag(vals, prom){
  const out = [];
  let mode = 0, ci = 0, lo = 0, hi = 0;
  for (let i = 1; i < vals.length; i++){
    const v = vals[i];
    if (v == null) continue;
    if (vals[lo] == null) lo = i;
    if (vals[hi] == null) hi = i;
    if (mode === 0){
      if (v > vals[hi]) hi = i;
      if (v < vals[lo]) lo = i;
      if (vals[hi] - vals[lo] >= prom){ mode = hi > lo ? 1 : -1; ci = mode === 1 ? hi : lo; if (mode === 1) out.push({ i: lo, type: 'min' }); else out.push({ i: hi, type: 'max' }); }
      continue;
    }
    if (mode === 1){ if (v > vals[ci]) ci = i; else if (vals[ci] - v >= prom){ out.push({ i: ci, type: 'max' }); mode = -1; ci = i; } }
    else { if (v < vals[ci]) ci = i; else if (v - vals[ci] >= prom){ out.push({ i: ci, type: 'min' }); mode = 1; ci = i; } }
  }
  if (mode) out.push({ i: ci, type: mode === 1 ? 'max' : 'min' });
  return out;
}
const pieceLabel = pc => pc.kind === 'out' ? tx('outLap') + '*' : pc.kind === 'in' ? tx('inLap') + '*' : pc.kind === 'run' ? tx('runN', pc.n)
  : pc.kind === 'ride' ? tx('rideAll') : pc.kind === 'leg' ? tx('legN', pc.n) : tx('lapN', pc.n);
function bestPiece(A){ return A.laps.filter(l => !l.warn && !l.excl).reduce((b, l) => (!b || l.time < b.time) ? l : b, null); }
function dragMain(s){ const ds = (s.settings && s.settings.dragDist && s.settings.dragDist.length) ? s.settings.dragDist : [400]; return Math.max(...ds); }
function sessBest(s){
  const ls = (s.laps || []).filter(l => !l.warn && !l.excl);
  if (s.mode === 'drag'){
    const D = dragMain(s), v = ls.map(l => l.times && l.times[D]).filter(x => x != null);
    return v.length ? `${distLabel(D)} ${fmtS(Math.min(...v))}` : '';
  }
  return ls.length ? fmtLap(Math.min(...ls.map(l => l.time))) : '';
}
const modeKey = m => m === 'drag' ? 'modeDrag' : m === 'segment' ? 'modeSegment' : m === 'free' ? 'modeFree' : 'modeCircuit';
const sessName = s => s.mode === 'drag' ? tx('modeDrag') : s.mode === 'free' ? tx('modeFree') : (s.course ? s.course.name : '');

