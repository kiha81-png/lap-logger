// ---------- 画面切り替え ----------
let curTab = 'v-run';
function showTab(v){
  curTab = v;
  $$('nav button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  $$('section').forEach(x => x.classList.toggle('on', x.id === v));
  if (v !== 'v-rec') stopPlay();
  renderTab();
  window.scrollTo(0, 0);
}
function renderTab(){
  if (curTab === 'v-run'){ if (!rec.on) renderHome(); else drawGMeter(true); }
  if (curTab === 'v-rec') renderRec();
  if (curTab === 'v-course') renderCourseTab();
  if (curTab === 'v-set') renderSettings();
}
$$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.v)));
function applyLang(){
  document.documentElement.lang = settings.lang;
  $$('[data-i18n]').forEach(el => el.textContent = tx(el.dataset.i18n));
  $$('[data-i18n-html]').forEach(el => el.innerHTML = tx(el.dataset.i18nHtml));
  $('#startBtn').textContent = ready ? tx('start') : tx('preparing');
  applyDim();
  updateGps();
}

