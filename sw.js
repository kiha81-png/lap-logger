// オフラインで起動できるように、アプリのファイルを端末に保存しておく。
// ページ本体は、つながるときは最新版を取りに行き（3秒で諦めて保存済みのものを使う）、そのたびに保存し直す。
// アイコンなどは保存済みのものを使う。アプリを更新したら VERSION も上げる。
const VERSION = '4.0.0';
const PREFIX = 'lap-logger:' + self.registration.scope + ':';
const CACHE = PREFIX + VERSION;
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // ブラウザの HTTP キャッシュを通さず、最新のファイルを保存する
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 新しい版は、画面の「更新」ボタンを押したときだけ切り替える（計測中に入れ替わらないように）
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });

function fromNetwork(req, cache){
  // ページ移動の要求はそのまま使い回せないので、URL から作り直す
  return fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
}

// 自分のサイトのファイルだけを扱う。外部への通信はしない
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(CACHE).then(cache => {
    const saved = cache.match(req, { ignoreSearch: true });
    if (req.mode !== 'navigate') return saved.then(hit => hit || fromNetwork(req, cache));
    const net = fromNetwork(req, cache);
    const timeout = new Promise(r => setTimeout(r, 3000));
    // サーバーがエラーを返したときも、保存済みの画面を使う
    const good = net.then(res => res.ok ? res : saved.then(hit => hit || res));
    return Promise.race([good, timeout.then(() => saved)])
      .then(res => res || good)
      .catch(() => saved.then(hit => hit || Response.error()));
  }));
});
