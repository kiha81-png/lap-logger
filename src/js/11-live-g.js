// ---------- ライブのGメーター ----------
const gm = { trail: [], cur: null, max: 6, w: 0, dirty: true };
function gmPush(g){ gm.cur = g; gm.trail.push(g); while (gm.trail.length > gm.max) gm.trail.shift(); gm.dirty = true; }
function drawGMeter(force){
  const cv = $('#gCanvas'), w = cv.clientWidth;
  if (!w) return;
  if (!force && !gm.dirty && gm.w === w) return; // 新しい値が来たときだけ描き直す（発熱と電池のため）
  gm.dirty = false;
  if (force || gm.w !== w){
    const dpr = window.devicePixelRatio || 1;
    cv.style.height = w + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr);
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); gm.w = w;
  }
  const ctx = cv.getContext('2d'), cx = w / 2, cy = w / 2, r = w / 2 - 4, maxG = 1.5;
  ctx.clearRect(0, 0, w, w);
  ctx.fillStyle = '#151a21'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
  drawGRings(ctx, cx, cy, r, maxG);
  const P = g => [cx + Math.max(-1, Math.min(1, g.lat / maxG)) * r, cy - Math.max(-1, Math.min(1, g.lon / maxG)) * r];
  if (gm.trail.length > 1){ ctx.strokeStyle = 'rgba(47,123,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); gm.trail.forEach((g, i) => i ? ctx.lineTo(...P(g)) : ctx.moveTo(...P(g))); ctx.stroke(); }
  if (gm.cur){
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(...P(gm.cur), Math.max(6, w / 28), 0, 2 * Math.PI); ctx.fill();
    $('#gLat').textContent = fmtGLat(gm.cur.lat); $('#gLon').textContent = fmtGLon(gm.cur.lon);
  }
}

