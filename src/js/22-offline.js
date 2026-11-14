// ---------- オフライン（Service Worker）と更新 ----------
let swWaiting = null;
function showUpdate(){ if (swWaiting && !rec.on) $('#updBar').hidden = false; }
function setupSW(){
  if (!('serviceWorker' in navigator) || !window.isSecureContext || !/^https?:$/.test(location.protocol)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const track = w => w && w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller){ swWaiting = w; showUpdate(); }
    });
    if (reg.waiting && navigator.serviceWorker.controller){ swWaiting = reg.waiting; showUpdate(); }
    reg.addEventListener('updatefound', () => track(reg.installing));
  }).catch(() => {});
  let reloading = false;
  // 計測中は読み込み直さない。更新は「更新」ボタンを押したときだけ
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || rec.on) return;
    reloading = true; location.reload();
  });
}
$('#updBtn').addEventListener('click', () => { if (rec.on || !swWaiting) return; $('#updBar').hidden = true; swWaiting.postMessage('skip'); });
$('#dueBtn').addEventListener('click', backupAll);
