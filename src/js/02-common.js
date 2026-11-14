// ---------- 共通 ----------
const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];
// iPhone：ページ全体の拡大（ダブルタップ・ピンチ）を止める。図の拡大・ずらしは指の位置（pointer）で別に扱っているので影響しない
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
// iPhone：キーボードを閉じたあとや画面の高さが変わったあと、下のバーが画面の途中に取り残されることがある。
// 入力中でなければ、バーを置き直して位置を計算し直させる
function renav() {
  const n = document.querySelector('nav');
  if (!n) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  n.style.display = 'none';
  void n.offsetHeight;
  n.style.display = '';
  window.scrollTo(window.scrollX, window.scrollY);
}
document.addEventListener('focusout', () => setTimeout(renav, 250));
if (window.visualViewport) visualViewport.addEventListener('resize', () => setTimeout(renav, 100));
window.addEventListener('orientationchange', () => setTimeout(renav, 300));
const R = 6371008.8,
  D2R = Math.PI / 180,
  G0 = 9.80665;
const MIN_CROSS_V = 4; // m/s。これ未満のライン通過は数えない（停車中の GPS の揺れ対策）
const STILL_V = 0.8; // m/s。これ未満は停止とみなす
const BRAKE_G = -0.15,
  ACCEL_G = 0.05; // ブレーキ・惰性の判定
const MODES = ['circuit', 'drag', 'segment', 'free'];
const GAP_MS = 10000; // これ以上あいだが空いたら、GPSが途切れたとみなす（線をつながない）
const REST_MS = 180000; // フリー走行：これ以上止まったら（途切れたら）区間を分ける
const hasCourse = m => m === 'circuit' || m === 'segment';
const DRAG_DISTS = [201.168, 402.336, 200, 400, 800, 1000, 1200, 1600];
const KMH = 3.6,
  MPH = 2.2369362920544;
const spdK = () => (settings.unit === 'mph' ? MPH : KMH);
const U = () => (settings.unit === 'mph' ? 'mph' : 'km/h');
const spdTargets = u => ((u || U()) === 'mph' ? [60, 100] : [100, 200]);
const distLabel = d => {
  d = +d;
  return d === 201.168 ? '1/8mi' : d === 402.336 ? '1/4mi' : d + 'm';
};
const PAL = ['#2f7bff', '#ff9f0a', '#30d158', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff6482', '#ac8e68', '#5e5ce6'];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = o => JSON.parse(JSON.stringify(o));
const pad2 = n => String(n).padStart(2, '0');
const num = Number.isFinite;
// 大きな配列でも使える最大・最小（Math.max(...a) は要素が多いと Safari で失敗する）
const amax = (a, d = -Infinity) => {
  let m = d;
  for (const v of a) if (v > m) m = v;
  return m;
};
const amin = (a, d = Infinity) => {
  let m = d;
  for (const v of a) if (v < m) m = v;
  return m;
};
function fmtDur(ms) {
  if (ms == null || !num(ms)) return '--';
  const sec = Math.floor(Math.max(0, ms) / 1000),
    h = Math.floor(sec / 3600);
  return `${h}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
}
const fmtDist = m => (settings.unit === 'mph' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`);
// 描くときだけ点を間引く（元の記録はそのまま）。間引いた先でも、途切れ（gap）は残す
function thin(arr, max) {
  if (arr.length <= max) return arr;
  const k = Math.ceil(arr.length / max),
    out = [];
  let gap = false;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (p.gap) gap = true;
    if (i % k && i !== arr.length - 1 && !p.gap) continue;
    out.push(gap && !p.gap ? Object.assign({}, p, { gap: true }) : p);
    gap = false;
  }
  return out;
}

function fmtLap(ms, dec = 2) {
  if (ms == null || !num(ms)) return '--';
  const u = 10 ** dec,
    c = Math.round(Math.max(0, ms) / (1000 / u));
  const sec = Math.floor(c / u),
    m = Math.floor(sec / 60);
  return `${m}:${pad2(sec % 60)}.${String(c % u).padStart(dec, '0')}`;
}
const fmtS = ms => (ms == null ? '--' : (ms / 1000).toFixed(2));
const fmtSec = ms => (ms == null ? '--' : ms >= 60000 ? fmtLap(ms) : fmtS(ms));
const fmtDiff = ms => (Math.abs(ms) < 5 ? '±0.00' : (ms >= 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(2));
const diffCls = ms => (Math.abs(ms) < 5 ? '' : ms < 0 ? 'good' : 'bad'); // 0.005秒未満の差は、速い・遅いの色を付けない
const fmtGLat = g => (g == null ? '--' : `${Math.abs(g).toFixed(2)}${Math.abs(g) < 0.005 ? '' : g > 0 ? tx('R') : tx('L')}`);
const fmtGLon = g => (g == null ? '--' : `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(2)}`);
function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fileStamp(t) {
  const d = new Date(t);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
function parseLatLon(text) {
  const m = String(text).match(/(-?\d{1,3}(?:\.\d+)?)\s*[,，\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]),
    lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
