// ---------- キャンバス ----------
// h を省くと、高さは CSS に任せる
function setupCanvas(cv, h) {
  const w = cv.clientWidth;
  if (!w) return null;
  const dpr = window.devicePixelRatio || 1;
  if (h == null) h = cv.clientHeight || 200;
  else cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
// 静的な絵を裏に描いておき、再生中は上に点や線だけを重ねる
function makeLayer(cv, h, draw) {
  const w = cv.clientWidth;
  if (!w) return null;
  const dpr = window.devicePixelRatio || 1;
  cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const off = document.createElement('canvas');
  off.width = cv.width;
  off.height = cv.height;
  const octx = off.getContext('2d');
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const info = draw(octx, w, h) || {};
  const L = {
    info,
    w,
    h,
    frame(over) {
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      c.drawImage(off, 0, 0);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (over) over(c, info);
    }
  };
  L.frame();
  return L;
}
function canvasMsg(ctx, msg) {
  ctx.fillStyle = '#9aa3ae';
  ctx.font = '14px system-ui';
  ctx.fillText(msg, 16, 30);
}
function fitter(pts, w, h, pad) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const sc = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
  const ox = pad + (w - 2 * pad - (x1 - x0) * sc) / 2,
    oy = h - pad - (h - 2 * pad - (y1 - y0) * sc) / 2;
  const f = p => [ox + (p.x - x0) * sc, oy - (p.y - y0) * sc];
  f.sc = sc;
  f.inv = (X, Y) => ({ x: x0 + (X - ox) / sc, y: y0 + (oy - Y) / sc });
  return f;
}
function strokePath(ctx, pts, f) {
  ctx.beginPath();
  pts.forEach((p, i) => (i && !p.gap ? ctx.lineTo(...f(p)) : ctx.moveTo(...f(p))));
  ctx.stroke();
}
function drawCourseLines(ctx, f, course, proj, selIdx) {
  course.lines.forEach((l, i) => {
    if (!ptOk(l.c)) return;
    const name = course.type === 'segment' ? (i === 0 ? 'S' : i === course.lines.length - 1 ? 'G' : 'S' + i) : i ? 'S' + i : 'CL';
    const col = i === selIdx ? '#2f7bff' : '#fff',
      w = ctx.canvas.clientWidth;
    if (num(l.hdg)) {
      const s = lineSeg(l, proj);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...f(s.a));
      ctx.lineTo(...f(s.b));
      ctx.stroke();
      const [tx0, ty0] = f(s.b);
      ctx.fillStyle = col;
      ctx.font = 'bold 12px system-ui';
      ctx.fillText(name, Math.min(tx0 + 4, w - 22), Math.max(ty0 - 4, 14));
    } else {
      const [cx, cy] = f(proj(l.c));
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'bold 12px system-ui';
      ctx.fillText(name + ' ?', Math.min(cx + 8, w - 30), Math.max(cy - 6, 14));
    }
  });
}
// 標準は青→赤の虹色。色覚に配慮した配色では、青→黄（明るさも変わる）にする
const clamp01 = r => Math.min(1, Math.max(0, r));
const seqColor = r =>
  settings.cb ? `hsl(${225 - 170 * clamp01(r)},85%,${40 + 25 * clamp01(r)}%)` : `hsl(${240 - 240 * clamp01(r)},100%,55%)`;
const SEQ_GRAD = () => `linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(seqColor).join(',')})`;
const lonHue = v => (settings.cb ? (v < 0 ? 28 : 210) : v < 0 ? 0 : 130);
const labelCol = bad => (settings.cb ? (bad ? '#b35a00' : '#1f5fae') : bad ? '#c62828' : '#1b8a3a');
function niceStep(range, n) {
  const raw = range / n,
    p = 10 ** Math.floor(Math.log10(raw || 1)),
    m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function drawGRings(ctx, cx, cy, r, maxG) {
  ctx.strokeStyle = '#2a313b';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#9aa3ae';
  ctx.font = '11px system-ui';
  for (let g = 0.5; g <= maxG + 1e-9; g += 0.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * g) / maxG, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillText(g.toFixed(1), cx + 3, cy - (r * g) / maxG + 12);
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}
function drawAxes(ctx, w, h, box, maxD, yTicks, yLabel) {
  const { L, T, B, Rr } = box,
    pw = w - L - Rr,
    ph = h - T - B;
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#9aa3ae';
  ctx.strokeStyle = '#2a313b';
  ctx.lineWidth = 1;
  for (const [v, y] of yTicks) {
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - Rr, y);
    ctx.stroke();
    ctx.fillText(yLabel(v), 2, y + 4);
  }
  const ds = niceStep(maxD, 5);
  for (let d = 0; d <= maxD + 1e-6; d += ds) {
    const x = L + (d / maxD) * pw;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, T + ph);
    ctx.stroke();
    ctx.fillText(d >= 1000 ? +(d / 1000).toFixed(2) + 'km' : Math.round(d) + 'm', x - 10, h - 6);
  }
}
