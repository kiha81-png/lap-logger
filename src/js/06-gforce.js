// ---------- G ----------
const clampG = g => Math.max(-2.5, Math.min(2.5, g));
// GPSの連続3点から、真ん中の点の G（lat: 右が正、lon: 加速が正）
function g3(a, b, c){
  if (Math.max(a.v, b.v, c.v) < 2) return null; // ほぼ止まっているときは、GPSの揺れでGを出さない
  const dt = (c.t - a.t) / 1000;
  if (dt <= 0 || dt > 5) return null;
  const lon = (c.v - a.v) / dt / G0;
  let lat = 0;
  if (b.v >= 3 && distM(a, b) >= 1 && distM(b, c) >= 1) lat = b.v * angDiff(bearing(b, c), bearing(a, b)) / (dt / 2) / G0;
  return { lat: clampG(lat), lon: clampG(lon) };
}
// 各GPS点の G。バイクはGPSから計算、車はセンサーの値を前後0.5秒で平均
function pointG(s){
  const n = s.points.length, lat = new Array(n).fill(null), lon = new Array(n).fill(null);
  if (s.vehicle && s.vehicle.type === 'car'){
    const gs = s.gs || [], kf = s.vehicle.flipF ? -1 : 1, kl = s.vehicle.flipL ? -1 : 1;
    let j = 0;
    for (let i = 0; i < n; i++){
      const t = s.points[i].t;
      while (j < gs.length && gs[j][0] < t - 500) j++;
      let sf = 0, sl = 0, c = 0;
      for (let k = j; k < gs.length && gs[k][0] <= t + 500; k++){ sf += gs[k][1]; sl += gs[k][2]; c++; }
      if (c){ lon[i] = kf * sf / c; lat[i] = kl * sl / c; }
    }
    return { lat, lon };
  }
  const rl = new Array(n).fill(null), ro = new Array(n).fill(null);
  for (let i = 1; i < n - 1; i++){ const g = g3(s.points[i - 1], s.points[i], s.points[i + 1]); if (g){ rl[i] = g.lat; ro[i] = g.lon; } }
  const smooth = (src, dst) => { for (let i = 0; i < n; i++){ if (src[i] == null) continue; let a = 0, c = 0; for (let k = i - 1; k <= i + 1; k++) if (src[k] != null){ a += src[k]; c++; } dst[i] = a / c; } };
  smooth(rl, lat); smooth(ro, lon);
  return { lat, lon };
}
function carSamples(s, t0, t1){
  const kf = s.vehicle.flipF ? -1 : 1, kl = s.vehicle.flipL ? -1 : 1, out = [];
  for (const g of s.gs || []) if (g[0] > t0 && g[0] <= t1) out.push({ t: g[0], lon: kf * g[1], lat: kl * g[2] });
  return out;
}
const hasG = s => !(s.vehicle && s.vehicle.type === 'car' && !(s.gs && s.gs.length));

// 加速度センサー（車）
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vscl = (a, k) => a.map(x => x * k);
const vsub = (a, b) => a.map((x, i) => x - b[i]);
const vnorm = a => { const L = Math.hypot(...a) || 1; return a.map(x => x / L); };
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function screenAngle(){
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle
    : (typeof window.orientation === 'number' ? window.orientation : 0);
  return ((a % 360) + 360) % 360;
}
// 画面の「上」を端末の座標で表したもの（端末を反時計回りに回すと angle 90）
const screenUpDevice = a => a === 90 ? [1, 0, 0] : a === 180 ? [0, -1, 0] : a === 270 ? [-1, 0, 0] : [0, 1, 0];
// ゼロ合わせの値から、前・右の向きを端末の座標で求める。前は「画面の奥」を水平にしたもの
function makeBasis(cal){
  const s = vdot(cal.g, screenUpDevice(cal.angle)) >= 0 ? 1 : -1; // 端末による符号の違いを吸収
  const up = vnorm(vscl(cal.g, s)), into = [0, 0, -1];
  const fRaw = vsub(into, vscl(up, vdot(into, up)));
  const f = vnorm(fRaw);
  return { g: cal.g, s, up, f, r: vcross(f, up), flat: Math.hypot(...fRaw) };
}
const mo = { listening: false, basis: null, f: 0, l: 0, lastT: 0, lastStore: 0, count: 0, cal: null };
function onMotion(e){
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  mo.count++;
  if (mo.cal) mo.cal.push([a.x, a.y, a.z]);
  const B = mo.basis;
  if (!B) return;
  const lin = [B.s * (a.x - B.g[0]), B.s * (a.y - B.g[1]), B.s * (a.z - B.g[2])];
  const now = Date.now(), dt = mo.lastT ? Math.min(0.5, (now - mo.lastT) / 1000) : 0.02;
  mo.lastT = now;
  const al = 1 - Math.exp(-dt / 0.25);
  mo.f += al * (vdot(lin, B.f) / G0 - mo.f);
  mo.l += al * (vdot(lin, B.r) / G0 - mo.l);
  if (rec.on && now - mo.lastStore >= 100){
    mo.lastStore = now;
    rec.session.gs.push([now - live.clockOff, Math.round(mo.f * 1000) / 1000, Math.round(mo.l * 1000) / 1000]);
    const v = rec.session.vehicle;
    gmPush({ lon: (v.flipF ? -1 : 1) * mo.f, lat: (v.flipL ? -1 : 1) * mo.l });
  }
}
function motionListen(on){
  if (on && !mo.listening) window.addEventListener('devicemotion', onMotion);
  if (!on && mo.listening) window.removeEventListener('devicemotion', onMotion);
  mo.listening = on;
}
async function motionPermission(){
  if (typeof DeviceMotionEvent === 'undefined') return false;
  if (typeof DeviceMotionEvent.requestPermission === 'function'){
    try { return (await DeviceMotionEvent.requestPermission()) === 'granted'; } catch (e){ return false; }
  }
  return true;
}

