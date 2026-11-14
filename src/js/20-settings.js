// ---------- 設定タブ ----------
function renderSettings() {
  $$('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.l === settings.lang));
  $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.u === settings.unit));
  $('#optHc').checked = !!settings.hc;
  $('#optCb').checked = !!settings.cb;
  $('#optLiveG').checked = !!settings.liveG;
  $$('#mainSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === (settings.liveMain === 'delta' ? 'delta' : 'last')));
  const v = curVehicle();
  $('#vehSel').innerHTML = vehicles
    .map(
      x =>
        `<option value="${esc(x.id)}"${x.id === v.id ? ' selected' : ''}>${esc(x.name)}（${esc(tx(x.type === 'car' ? 'car' : 'bike'))}）</option>`
    )
    .join('');
  $('#vehName').value = v.name;
  $$('input[name=vehType]').forEach(r => (r.checked = r.value === v.type));
  $('#bikeBox').hidden = v.type !== 'bike';
  $('#carBox').hidden = v.type !== 'car';
  $('#flipF').checked = !!v.flipF;
  $('#flipL').checked = !!v.flipL;
  if (v.cal) {
    const b = makeBasis(v.cal);
    $('#calInfo').textContent = tx('calDone', fmtDate(v.cal.at), Math.round(Math.asin(Math.max(-1, Math.min(1, b.up[2]))) / D2R));
  } else $('#calInfo').textContent = tx('calNot');
  $('#optMinLap').value = settings.minLap;
  $('#optAcc').value = settings.maxAcc;
  const lb = LS.get('lastBackup', 0);
  $('#lastBackup').textContent = lb ? tx('lastBackupAt', fmtDate(lb)) : tx('neverBackup');
  $('#verInfo').textContent = tx('verInfo', APP_VERSION);
  renderBackups();
  renderGs();
}
function applyLook() {
  document.body.classList.toggle('hc', !!settings.hc);
  document.body.classList.toggle('cb', !!settings.cb);
}
$('#unitSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.unit = b.dataset.u;
  saveSettings();
  anaCache.forEach(A => A.pieces.forEach(pc => delete pc._st));
  applyLang();
  renderTab();
});
$('#mainSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.liveMain = b.dataset.m;
  saveSettings();
  renderSettings();
});
$('#optLiveG').addEventListener('change', e => {
  settings.liveG = e.target.checked;
  saveSettings();
});
$('#optHc').addEventListener('change', e => {
  settings.hc = e.target.checked;
  saveSettings();
  applyLook();
});
$('#optCb').addEventListener('change', e => {
  settings.cb = e.target.checked;
  saveSettings();
  applyLook();
});
// 不具合の報告用。走行データや位置は入れない
async function deviceInfo() {
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  const mb = b => (b == null ? '?' : (b / 1048576).toFixed(1) + 'MB');
  return [
    `Lap Logger ${APP_VERSION} (schema ${SCHEMA})`,
    `UA: ${navigator.userAgent}`,
    `lang: ${navigator.language} / app: ${settings.lang}, unit: ${settings.unit}, hc: ${!!settings.hc}, cb: ${!!settings.cb}`,
    `screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}, orientation: ${screenAngle()}`,
    `standalone: ${matchMedia('(display-mode: standalone)').matches || !!navigator.standalone}, sw: ${!!(navigator.serviceWorker && navigator.serviceWorker.controller)}`,
    `wakeLock: ${'wakeLock' in navigator}, motion: ${typeof DeviceMotionEvent !== 'undefined'}, locks: ${!!navigator.locks}`,
    `storage: ${mb(est && est.usage)} / ${mb(est && est.quota)}, persisted: ${persisted}, db: ${!!DB.db}`,
    `recordings: ${sessions.length}, tracks: ${courses.length}, vehicles: ${vehicles.length} (${vehicles.map(v => v.type).join(',')})`,
    `gps: ${geo.denied ? 'denied' : live.lastFixAt ? 'ok ±' + Math.round(live.acc) + 'm' : 'none'}`
  ].join('\n');
}
$('#copyInfo').addEventListener('click', async () => {
  const t = await deviceInfo();
  try {
    await navigator.clipboard.writeText(t);
    alert(tx('copied'));
  } catch (e) {
    prompt(tx('copyManual'), t);
  }
});
$('#openIssues').addEventListener('click', () => {
  window.open('https://github.com/kiha81-png/lap-logger/issues/new', '_blank', 'noopener');
});
$('#showConsent').addEventListener('click', () => {
  $('#consent').hidden = false;
});
$('#langSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.lang = b.dataset.l;
  saveSettings();
  applyLang();
  renderTab();
});
$('#vehSel').addEventListener('change', e => {
  vehicleId = e.target.value;
  saveVehicles();
  renderSettings();
});
$('#vehName').addEventListener('change', e => {
  curVehicle().name = e.target.value.trim() || tx('untitled');
  saveVehicles();
  renderSettings();
});
$$('input[name=vehType]').forEach(r =>
  r.addEventListener('change', () => {
    curVehicle().type = r.value;
    saveVehicles();
    renderSettings();
  })
);
$('#flipF').addEventListener('change', e => {
  curVehicle().flipF = e.target.checked;
  saveVehicles();
});
$('#flipL').addEventListener('change', e => {
  curVehicle().flipL = e.target.checked;
  saveVehicles();
});
$('#vehNew').addEventListener('click', () => {
  const v = { id: 'v' + Date.now(), name: tx('newVehicle'), type: 'car', cal: null, flipF: false, flipL: false };
  vehicles.push(v);
  vehicleId = v.id;
  saveVehicles();
  renderSettings();
  $('#vehName').focus();
});
$('#vehDel').addEventListener('click', () => {
  if (vehicles.length < 2) {
    alert(tx('oneVeh'));
    return;
  }
  if (!confirm(tx('delVehConfirm', curVehicle().name))) return;
  vehicles = vehicles.filter(v => v.id !== vehicleId);
  vehicleId = vehicles[0].id;
  saveVehicles();
  renderSettings();
});
$('#calBtn').addEventListener('click', async () => {
  const v = curVehicle(),
    btn = $('#calBtn');
  if (!(await motionPermission())) {
    alert(tx('motionPerm'));
    return;
  }
  btn.disabled = true;
  btn.textContent = tx('calMeasuring');
  mo.cal = [];
  const wasOn = mo.listening;
  motionListen(true);
  await sleep(2000);
  const arr = mo.cal;
  mo.cal = null;
  if (!wasOn && !rec.on) motionListen(false);
  btn.disabled = false;
  btn.textContent = tx('calBtn');
  if (arr.length < 10) {
    alert(tx('calNoData'));
    return;
  }
  const g = [0, 1, 2].map(k => arr.reduce((a, x) => a + x[k], 0) / arr.length),
    m = Math.hypot(...g);
  const shake = Math.max(...arr.map(x => Math.hypot(x[0] - g[0], x[1] - g[1], x[2] - g[2])));
  if (Math.abs(m - G0) > 1.5 || shake > 1.5) {
    alert(tx('calShake'));
    return;
  }
  const cal = { g, angle: screenAngle(), at: Date.now() };
  if (Math.abs(vdot(g, screenUpDevice(cal.angle))) / m < 0.5) {
    alert(tx('calRotate'));
    return;
  }
  if (makeBasis(cal).flat < 0.3) {
    alert(tx('calFlat'));
    return;
  }
  v.cal = cal;
  saveVehicles();
  renderSettings();
});
[
  ['#optMinLap', 'minLap', 5],
  ['#optAcc', 'maxAcc', 3]
].forEach(([sel, key, min]) =>
  $(sel).addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    settings[key] = num(v) ? Math.max(min, v) : DEFAULT_OPT[key];
    saveSettings();
    renderSettings();
  })
);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (curTab === 'v-run') {
      if (rec.on) drawGMeter(true);
      else renderHome();
    }
    if (curTab === 'v-rec' && recState.view === 'lap') {
      buildLapLayers();
      lvUpdate();
    }
    if (curTab === 'v-course') {
      drawCoursePreview();
      drawLineZoom();
    }
  }, 150);
});
