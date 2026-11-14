// ---------- 幾何 ----------
function ptOk(p) {
  return !!p && num(p.lat) && num(p.lon);
}
function makeProj(lat0, lon0) {
  const kx = Math.cos(lat0 * D2R) * R * D2R,
    ky = R * D2R;
  const f = p => ({ x: (p.lon - lon0) * kx, y: (p.lat - lat0) * ky });
  f.inv = q => ({ lat: lat0 + q.y / ky, lon: lon0 + q.x / kx });
  return f;
}
function distM(a, b) {
  const dy = (b.lat - a.lat) * D2R * R,
    dx = (b.lon - a.lon) * D2R * R * Math.cos(a.lat * D2R);
  return Math.hypot(dx, dy);
}
function bearing(a, b) {
  return Math.atan2((b.lon - a.lon) * Math.cos(a.lat * D2R), b.lat - a.lat);
}
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function offsetLL(c, deg, m) {
  const pr = makeProj(c.lat, c.lon);
  return pr.inv({ x: m * Math.sin(deg * D2R), y: m * Math.cos(deg * D2R) });
}
// ラインの両端（a が進行方向の左、b が右）
function lineSeg(l, proj) {
  const c = proj(l.c),
    h = l.hdg * D2R,
    px = Math.cos(h),
    py = -Math.sin(h),
    r = l.w / 2;
  return { c, a: { x: c.x - px * r, y: c.y - py * r }, b: { x: c.x + px * r, y: c.y + py * r } };
}
// 走行区間 p1→p2 とライン q1→q2 の交点。t は p1→p2 上の位置 (0〜1)、sign は横切る向き
function segCross(p1, p2, q1, q2) {
  const rx = p2.x - p1.x,
    ry = p2.y - p1.y,
    sx = q2.x - q1.x,
    sy = q2.y - q1.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = q1.x - p1.x,
    qy = q1.y - p1.y;
  const t = (qx * sy - qy * sx) / den,
    u = (qx * ry - qy * rx) / den;
  if (t <= 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, sign: den > 0 ? 1 : -1 };
}
function lineName(c, i) {
  if (c.type === 'segment') {
    if (i === 0) return tx('lnStart');
    if (i === c.lines.length - 1) return tx('lnFinish');
  } else if (i === 0) return tx('lnControl');
  return tx('lnSector', i);
}
const nSecOf = c => (c.type === 'segment' ? c.lines.length - 1 : c.lines.length);
// 1周（1本）も計測できなかった理由（判定の記録から）。code は一覧に出す短い名前、lines は説明の文
function why0(det, minLap) {
  const g = det && det.diag,
    out = [],
    dm = d => (d >= 1000 ? fmtDist(d) : Math.round(d) + 'm');
  if (!g || det.laps.length) return { code: '', lines: out };
  let code = '';
  if (!det.loop) {
    if (g.fwd) {
      code = 'w0Goal';
      out.push(tx('whySegGoal', isFinite(g.gNear) ? dm(g.gNear) : '-', Math.round(g.gw)));
    } else if (g.rev) {
      code = 'w0Rev';
      out.push(tx('whySegRev', g.rev));
    } else if (g.near > g.w / 2 + 5) {
      code = 'w0Far';
      out.push(tx('whyFar', dm(g.near), Math.round(g.w)));
    } else {
      code = 'w0Far';
      out.push(tx('whyNoCross'));
    }
  } else if (g.near > g.w / 2 + 5 && !g.fwd && !g.rev) {
    code = 'w0Far';
    out.push(tx('whyFar', dm(g.near), Math.round(g.w)));
  } else if (!g.fwd && g.rev) {
    code = 'w0Rev';
    out.push(tx('whyRevOnly', g.rev));
  } else if (g.fwd <= 1 && (g.fwd || g.rev)) {
    code = 'w0Once';
    out.push(tx('whyOnce'));
    if (g.rev) out.push(tx('whyOnceRev', g.rev));
  } else if (!g.fwd && !g.slow) {
    code = 'w0Far';
    out.push(tx('whyNoCross'));
  }
  if (g.slow) out.push(tx('whySlow', g.slow));
  if (g.short) out.push(tx('whyShort', g.short, minLap));
  if (!code && out.length) code = 'w0Other';
  return { code, lines: out };
}

function courseProblem(c) {
  if (!c) return tx('probNoCourse');
  if (c.type === 'segment' && c.lines.length < 2) return tx('probSegLines');
  for (let i = 0; i < c.lines.length; i++) if (!ptOk(c.lines[i].c)) return tx('probPoint', lineName(c, i));
  for (let i = 0; i < c.lines.length; i++) if (!num(c.lines[i].hdg)) return tx('probHdg', lineName(c, i));
  return null;
}
// ラインの位置まで含めたコースの識別子。ラインを動かしたら別コース扱いにして、ベストを比べない
const courseKey = c =>
  c.id +
  '|' +
  c.type +
  '|' +
  c.lines.map(l => (ptOk(l.c) ? `${l.c.lat.toFixed(6)},${l.c.lon.toFixed(6)},${Math.round(l.hdg)},${Math.round(l.w)}` : '-')).join('/');
