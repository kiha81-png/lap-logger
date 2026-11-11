/**
 * Lap Logger → Google スプレッドシート／ドライブ 保存用スクリプト（v1）
 *
 * 使い方は docs/GOOGLE_SYNC.md を見てください。
 * このスクリプトは、保存先のスプレッドシートの「拡張機能 → Apps Script」に貼り付けて使います。
 *
 * - 走行ごとに、シート「走行」に1行、シート「ラップ」に1周1行を書きます（言語が英語なら Sessions / Laps）。
 * - 同じ記録を送り直したときは、その記録の行を消してから書き直すので、行が重複しません。
 * - GPS の全データは、マイドライブのフォルダ「Lap Logger」に JSON で保存します（アプリの「読み込み」でそのまま戻せます）。
 * - スクリプトのプロパティ TOKEN（合言葉）が一致しない送信は、すべて断ります。
 */
const APP = 'lap-logger';
const FOLDER_NAME = 'Lap Logger';

function doPost(e) {
  let res;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    res = handle_(JSON.parse(e.postData.contents));
  } catch (err) {
    res = { ok: false, error: 'server', message: String((err && err.message) || err).slice(0, 300) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ブラウザで URL を開いたときの確認用（データは返さない）
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: APP, v: 1 })).setMimeType(ContentService.MimeType.JSON);
}

function handle_(b) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token) return { ok: false, error: 'notoken' };
  if (!b || b.app !== APP || typeof b.token !== 'string' || b.token !== token) return { ok: false, error: 'token' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (b.kind === 'ping') return { ok: true, v: 1, sheet: ss.getName() };
  if (b.kind !== 'session' || typeof b.id !== 'string' || !/^[\w.-]{1,80}$/.test(b.id)) return { ok: false, error: 'bad' };

  let fileUrl = '';
  if (b.file && typeof b.file.name === 'string') {
    const name = b.file.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const blob = b.file.gz
      ? Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b.file.gz), 'application/x-gzip'))
      : Utilities.newBlob(String(b.file.json || ''), 'application/json');
    blob.setName(name).setContentType('application/json');
    const folder = folder_();
    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    fileUrl = folder.createFile(blob).getUrl();
  }
  for (const t of Array.isArray(b.tables) ? b.tables : []) {
    if (t && typeof t.fileCol === 'number' && Array.isArray(t.rows)) t.rows.forEach(r => { if (Array.isArray(r)) r[t.fileCol] = fileUrl; });
    put_(ss, t, b.id);
  }
  return { ok: true, fileUrl: fileUrl };
}

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

// 1列目が記録ID。その記録の古い行を消してから、新しい行を末尾に足す
function put_(ss, t, id) {
  if (!t || typeof t.sheet !== 'string' || !Array.isArray(t.head) || !Array.isArray(t.rows)) return;
  const name = t.sheet.slice(0, 50), w = Math.min(t.head.length, 60);
  if (!w) return;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  sh.getRange(1, 1, 1, w).setValues([t.head.slice(0, w).map(cell_)]);
  sh.setFrozenRows(1);
  const last = sh.getLastRow();
  if (last > 1) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) !== id) continue;
      let j = i;
      while (j > 0 && String(ids[j - 1][0]) === id) j--;
      sh.deleteRows(j + 2, i - j + 1);
      i = j;
    }
  }
  const rows = t.rows.filter(Array.isArray).slice(0, 5000).map(r => {
    const a = r.slice(0, w).map(cell_);
    while (a.length < w) a.push('');
    a[0] = id;
    return a;
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, w).setValues(rows);
}

// 値をセルに入れる形にする。{t: ミリ秒} は日時。文字は、式や数値・日付として解釈されないようにする
function cell_(v) {
  if (v && typeof v === 'object' && typeof v.t === 'number') return new Date(v.t);
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    v = v.slice(0, 5000);
    return /^[=+\-@]/.test(v) || /^[\d\s:.\/-]+$/.test(v) ? "'" + v : v;
  }
  return '';
}

// 初回だけ、エディタでこの関数を実行して権限を許可し、合言葉を作る（実行ログに表示されます）
function setup() {
  const p = PropertiesService.getScriptProperties();
  let token = p.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    p.setProperty('TOKEN', token);
  }
  folder_();
  Logger.log('合言葉（アプリの設定に貼り付け）: ' + token);
}
