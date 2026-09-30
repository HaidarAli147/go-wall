/* Go Wall — multi-sport scoreboard. No build step, no dependencies. */
'use strict';

/* ================================================================
   Constants & helpers
   ================================================================ */
const STORE_KEY = 'gowall.v2';
const FB_PERIODS = [
  { name: 'الشوط الأول', start: 0, len: 45 },
  { name: 'الشوط الثاني', start: 45, len: 45 },
  { name: 'الشوط الإضافي الأول', start: 90, len: 15 },
  { name: 'الشوط الإضافي الثاني', start: 105, len: 15 },
];
const HB_HALF = 30 * 60000;
const HB_PENALTY = 2 * 60000;
const HB_TIMEOUTS = 3;
const UNDO_LIMIT = 80;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = n => String(n).padStart(2, '0');
const fmt = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

/* ================================================================
   State
   ================================================================ */
const newTeam = (name, color) => ({ name, color, score: 0, fouls: 0, yellow: 0, red: 0, timeouts: HB_TIMEOUTS });

function defaults() {
  return {
    sport: 'football',
    sound: true,
    fb: { teams: [newTeam('الفريق الأول', '#00f0ff'), newTeam('الفريق الثاني', '#ff2d6f')], period: 0, elapsed: 0, log: [] },
    hb: { teams: [newTeam('فريق اليد أ', '#ff6a00'), newTeam('فريق اليد ب', '#00c2ff')], half: 1, remaining: HB_HALF, pens: [[], []] },
    tn: newTennis(),
  };
}

function newTennis(prev) {
  return {
    names: prev ? prev.names : ['اللاعب الأول', 'اللاعب الثاني'],
    colors: prev ? prev.colors : ['#39ff14', '#00f0ff'],
    bestOf: prev ? prev.bestOf : 3,
    noAd: prev ? prev.noAd : false,
    pts: [0, 0], games: [0, 0], sets: [0, 0],
    history: [],            // [{g:[a,b], tb:[a,b]|null}]
    server: 0, tiebreak: false, tbStart: 0, tbCount: 0,
    winner: null,
  };
}

let state = load();
const run = { fb: false, hb: false };   // clocks are runtime-only: never resume on reload
let undoStack = [];

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved || typeof saved !== 'object') return base;
    for (const k of ['sport', 'sound']) if (k in saved) base[k] = saved[k];
    for (const k of ['fb', 'hb', 'tn']) if (saved[k]) base[k] = { ...base[k], ...saved[k] };
  } catch { /* corrupted or unavailable storage: start fresh */ }
  return base;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* quota/private mode */ }
}

/* Undo covers scoring/stat changes, never the clocks. */
function pushUndo() {
  undoStack.push(JSON.stringify({ fb: state.fb, hb: state.hb, tn: state.tn }));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return toast('لا يوجد ما يمكن التراجع عنه');
  const s = JSON.parse(snap);
  const { elapsed, period } = state.fb;
  const { remaining, half } = state.hb;
  state.fb = { ...s.fb, elapsed, period };
  state.hb = { ...s.hb, remaining, half };
  state.tn = s.tn;
  sound('beep');
  toast('↶ تم التراجع');
  commit();
}
function mutate(fn) { pushUndo(); fn(); commit(); }
function commit() { save(); render(); }

/* ================================================================
   Sound (Web Audio, no assets)
   ================================================================ */
let actx = null;
function sound(kind) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const tone = (freq, dur, type = 'sine', vol = 0.12, at = 0, slideTo) => {
      const t = actx.currentTime + at;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur);
    };
    if (kind === 'beep') tone(820, 0.12);
    else if (kind === 'goal') { tone(660, 0.14, 'triangle', .16); tone(880, 0.14, 'triangle', .16, .14); tone(1100, 0.3, 'triangle', .16, .28); }
    else if (kind === 'whistle') tone(2600, 0.45, 'triangle', .22, 0, 1900);
    else if (kind === 'buzzer') tone(180, 1.1, 'sawtooth', .18);
  } catch { /* audio blocked until first gesture */ }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 2600);
}

/* ================================================================
   Modal helpers
   ================================================================ */
function modal(html) {
  const dlg = $('#modal');
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return dlg;
}
function confirmBox(title, text, okLabel = 'تأكيد') {
  return new Promise(resolve => {
    const dlg = modal(`<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="actions"><button class="btn" value="no">إلغاء</button><button class="btn danger" value="yes" autofocus>${esc(okLabel)}</button></div></form>`);
    dlg.onclose = () => resolve(dlg.returnValue === 'yes');
  });
}
function promptTime(title, current) {
  return new Promise(resolve => {
    const dlg = modal(`<form method="dialog"><h2>${esc(title)}</h2><p>اكتب الوقت بصيغة <b>دقائق:ثواني</b> مثل 12:30</p>
      <input type="text" id="time-in" value="${esc(current)}" inputmode="numeric" pattern="[0-9]{1,3}(:[0-5]?[0-9])?" autofocus>
      <div class="actions"><button class="btn" value="no" formnovalidate>إلغاء</button><button class="btn go" value="yes">حفظ</button></div></form>`);
    dlg.onclose = () => {
      if (dlg.returnValue !== 'yes') return resolve(null);
      const m = $('#time-in', dlg).value.trim().match(/^(\d{1,3})(?::([0-5]?\d))?$/);
      resolve(m ? (+m[1] * 60 + +(m[2] || 0)) * 1000 : null);
    };
  });
}
function showHelp() {
  modal(`<form method="dialog"><h2>اختصارات لوحة المفاتيح</h2><table>
    <tr><td><kbd>Space</kbd></td><td>تشغيل / إيقاف الساعة</td></tr>
    <tr><td><kbd>1</kbd> <kbd>2</kbd></td><td>هدف / نقطة للفريق (اللاعب) الأول أو الثاني</td></tr>
    <tr><td><kbd>Shift</kbd>+<kbd>1</kbd>/<kbd>2</kbd></td><td>إنقاص هدف (كرة القدم واليد)</td></tr>
    <tr><td><kbd>Z</kbd></td><td>تراجع عن آخر إجراء</td></tr>
    <tr><td><kbd>T</kbd></td><td>وضع العرض على الشاشة الكبيرة</td></tr>
    <tr><td><kbd>F</kbd></td><td>ملء الشاشة</td></tr>
    <tr><td><kbd>M</kbd></td><td>كتم / تشغيل الصوت</td></tr>
    <tr><td><kbd>?</kbd></td><td>هذه القائمة</td></tr></table>
    <p>نصيحة: اضغط على الساعة لتعديل الوقت يدويًا.</p>
    <div class="actions"><button class="btn primary" style="--tc:var(--accent)">حسنًا</button></div></form>`);
}

/* ================================================================
   Clock engine — timestamp based, so background-tab throttling can't drift it
   ================================================================ */
let lastTick = performance.now();
const fbNotified = { period: -1 };

function tick() {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;

  if (run.fb) {
    const f = state.fb, p = FB_PERIODS[f.period];
    const before = f.elapsed;
    f.elapsed += dt;
    const end = (p.start + p.len) * 60000;
    if (before < end && f.elapsed >= end && fbNotified.period !== f.period) {
      fbNotified.period = f.period;
      sound('whistle');
      toast('⏱ انتهى الوقت الأصلي — بدأ الوقت المحتسب بدل الضائع');
    }
    updateFbClock();
  }

  if (run.hb) {
    const h = state.hb;
    h.remaining -= dt;
    const expired = expirePenalties();
    if (h.remaining <= 0) {
      h.remaining = 0;
      run.hb = false;
      sound('buzzer');
      toast(h.half === 1 ? '🔔 انتهى الشوط الأول' : '🏁 انتهت المباراة');
      commit();
      return;
    }
    if (expired) sound('beep');
    updateHbClock();
    renderPenalties();
  }
}

function expirePenalties() {
  const h = state.hb; let any = false;
  h.pens = h.pens.map(list => {
    const keep = list.filter(endsAt => h.remaining > endsAt);
    if (keep.length !== list.length) any = true;
    return keep;
  });
  return any;
}

/* Setting the handball clock keeps each suspension's remaining duration intact. */
function setHbRemaining(ms) {
  const h = state.hb, delta = ms - h.remaining;
  h.pens = h.pens.map(list => list.map(e => e + delta));
  h.remaining = ms;
}

function fbLabel() {
  const f = state.fb, p = FB_PERIODS[f.period], end = p.start + p.len;
  const m = Math.floor(f.elapsed / 60000);
  return m >= end ? `${end}+${m - end + 1}'` : `${m + 1}'`;
}

/* ================================================================
   Football / Handball actions
   ================================================================ */
function toggleClock() {
  const sp = state.sport === 'football' ? 'fb' : state.sport === 'handball' ? 'hb' : null;
  if (!sp) return;
  if (sp === 'hb' && !run.hb && state.hb.remaining <= 0) return toast('انتهى الشوط — انتقل للشوط التالي أو أعد الوقت');
  run[sp] = !run[sp];
  lastTick = performance.now();
  sound(run[sp] ? 'whistle' : 'beep');
  render();
}
function pauseAll() { run.fb = run.hb = false; }

function setScore(sp, team, delta) {
  const T = state[sp].teams[team];
  if (delta < 0 && T.score === 0) return;
  mutate(() => {
    T.score += delta;
    if (sp === 'fb') {
      if (delta > 0) state.fb.log.unshift({ icon: '⚽', team, label: fbLabel() });
      else { const i = state.fb.log.findIndex(e => e.icon === '⚽' && e.team === team); if (i >= 0) state.fb.log.splice(i, 1); }
    }
  });
  if (delta > 0) sound('goal');
}

function setStat(sp, team, key, delta) {
  const T = state[sp].teams[team];
  if (delta < 0 && T[key] === 0) return;
  mutate(() => {
    T[key] += delta;
    if (sp === 'fb' && (key === 'yellow' || key === 'red')) {
      const icon = key === 'yellow' ? '🟨' : '🟥';
      if (delta > 0) state.fb.log.unshift({ icon, team, label: fbLabel() });
      else { const i = state.fb.log.findIndex(e => e.icon === icon && e.team === team); if (i >= 0) state.fb.log.splice(i, 1); }
    }
  });
  sound('beep');
}

function setPeriod(i) {
  const f = state.fb;
  f.period = i;
  f.elapsed = FB_PERIODS[i].start * 60000;
  fbNotified.period = -1;
  run.fb = false;
  sound('beep');
  commit();
}
function nudgeFb(min) {
  const f = state.fb;
  f.elapsed = Math.max(0, f.elapsed + min * 60000);
  fbNotified.period = -1;
  sound('beep');
  commit();
}

async function editClock() {
  const sp = state.sport;
  if (sp === 'football') {
    const cur = fmt(state.fb.elapsed);
    const ms = await promptTime('تعديل وقت المباراة', cur);
    if (ms != null) { state.fb.elapsed = ms; fbNotified.period = -1; commit(); }
  } else if (sp === 'handball') {
    const ms = await promptTime('تعديل الوقت المتبقي', fmt(state.hb.remaining));
    if (ms != null) { setHbRemaining(Math.min(ms, HB_HALF)); commit(); }
  }
}

function hbTimeout(team) {
  const T = state.hb.teams[team];
  if (T.timeouts <= 0) return toast('استُنفدت الأوقات المستقطعة');
  mutate(() => { T.timeouts--; });
  run.hb = false;
  sound('whistle');
  render();
}
function hbPenalty(team) {
  mutate(() => state.hb.pens[team].push(state.hb.remaining - HB_PENALTY));
  sound('beep');
}
function hbRemovePenalty(team, idx) {
  mutate(() => state.hb.pens[team].splice(idx, 1));
}
function hbNextHalf() {
  const h = state.hb;
  if (h.half >= 2) return toast('هذا هو الشوط الأخير');
  run.hb = false;
  // Carry active suspensions across the break with their remaining time intact.
  h.pens = h.pens.map(list => list.map(e => HB_HALF - (h.remaining - e)).filter(e => e < HB_HALF));
  h.half = 2;
  h.remaining = HB_HALF;
  sound('beep');
  commit();
}
function hbResetHalf() {
  run.hb = false;
  setHbRemaining(HB_HALF);
  sound('beep');
  commit();
}

/* ================================================================
   Tennis
   ================================================================ */
const PT = ['0', '15', '30', '40'];
function tnLabel(i) {
  const t = state.tn;
  if (t.tiebreak) return String(t.pts[i]);
  const a = t.pts[i], b = t.pts[1 - i];
  if (a <= 3 && b <= 3 && !(a === 3 && b === 3)) return PT[a];
  if (a === b || t.noAd) return '40';
  return a > b ? 'AD' : '40';
}

function tbServer(t) {
  const n = t.tbCount;
  return Math.floor((n + 1) / 2) % 2 === 0 ? t.tbStart : 1 - t.tbStart;
}

function tnPoint(p) {
  const t = state.tn;
  if (t.winner !== null) return toast('انتهت المباراة — ابدأ مباراة جديدة');
  pushUndo();
  const o = 1 - p;
  t.pts[p]++;
  if (t.tiebreak) {
    t.tbCount++;
    if (t.pts[p] >= 7 && t.pts[p] - t.pts[o] >= 2) tnFinishSet(p, true);
    else t.server = tbServer(t);
  } else {
    const won = t.noAd ? t.pts[p] >= 4 : t.pts[p] >= 4 && t.pts[p] - t.pts[o] >= 2;
    if (won) tnWinGame(p);
  }
  sound('beep');
  commit();
}

function tnWinGame(p) {
  const t = state.tn, o = 1 - p;
  t.games[p]++;
  t.pts = [0, 0];
  t.server = 1 - t.server;
  sound('whistle');
  if (t.games[p] >= 6 && t.games[p] - t.games[o] >= 2) return tnFinishSet(p, false);
  if (t.games[0] === 6 && t.games[1] === 6) {
    t.tiebreak = true; t.tbStart = t.server; t.tbCount = 0;
  }
}

function tnFinishSet(p, viaTiebreak) {
  const t = state.tn;
  const entry = { g: [...t.games], tb: null };
  if (viaTiebreak) { entry.g[p] = 7; entry.tb = [...t.pts]; }
  t.history.push(entry);
  t.sets[p]++;
  t.games = [0, 0];
  t.pts = [0, 0];
  if (viaTiebreak) t.server = 1 - t.tbStart;
  t.tiebreak = false; t.tbCount = 0;
  sound('goal');
  if (t.sets[p] >= Math.ceil(t.bestOf / 2)) {
    t.winner = p;
    toast(`🏆 ${t.names[p]} يفوز بالمباراة`);
  }
}

/* ================================================================
   Reset
   ================================================================ */
async function resetCurrent() {
  const names = { football: 'كرة القدم', handball: 'كرة اليد', tennis: 'التنس' };
  const ok = await confirmBox('تصفير المباراة؟', `سيتم تصفير نتيجة وساعة ${names[state.sport]} (تبقى أسماء الفرق وألوانها).`, 'نعم، صفّر');
  if (!ok) return;
  pauseAll();
  const d = defaults();
  if (state.sport === 'football') { d.fb.teams.forEach((t, i) => { t.name = state.fb.teams[i].name; t.color = state.fb.teams[i].color; }); state.fb = d.fb; fbNotified.period = -1; }
  else if (state.sport === 'handball') { d.hb.teams.forEach((t, i) => { t.name = state.hb.teams[i].name; t.color = state.hb.teams[i].color; }); state.hb = d.hb; }
  else state.tn = newTennis(state.tn);
  undoStack = [];
  sound('beep');
  commit();
}

/* ================================================================
   Rendering
   ================================================================ */
const prevBump = {};

function render() {
  const sp = state.sport;
  for (const s of ['football', 'handball', 'tennis']) {
    const tab = $(`#tab-${s}`);
    tab.setAttribute('aria-selected', String(s === sp));
    $(`#panel-${s}`).hidden = s !== sp;
  }
  $('#sound-btn').textContent = state.sound ? '🔊' : '🔇';
  document.title = `جو وول | ${state.sport === 'tennis' ? 'التنس' : state.sport === 'football' ? 'كرة القدم' : 'كرة اليد'}`;

  if (sp === 'football') $('#panel-football').innerHTML = footballHTML();
  else if (sp === 'handball') $('#panel-handball').innerHTML = handballHTML();
  else $('#panel-tennis').innerHTML = tennisHTML();

  $$('[data-bump]').forEach(el => {
    const k = el.dataset.bump, v = el.textContent;
    if (k in prevBump && prevBump[k] !== v) { el.classList.add('bump'); }
    prevBump[k] = v;
  });
  updateFbClock(); updateHbClock(); renderPenalties();
}

function nameField(sp, i, T) {
  return `<input class="name-input" data-name="${sp}" data-team="${i}" value="${esc(T.name)}" maxlength="24" aria-label="اسم الفريق ${i + 1}">
    <label class="color-pick" title="لون الفريق"><input type="color" data-color="${sp}" data-team="${i}" value="${T.color}" aria-label="لون الفريق"></label>`;
}
function stat(label, sp, i, key, value) {
  return `<div class="stat">${label}
    <button class="mini" data-action="stat" data-sport="${sp}" data-team="${i}" data-key="${key}" data-delta="-1" aria-label="إنقاص">−</button>
    <b>${value}</b>
    <button class="mini" data-action="stat" data-sport="${sp}" data-team="${i}" data-key="${key}" data-delta="1" aria-label="زيادة">+</button></div>`;
}

function footballHTML() {
  const f = state.fb;
  const card = i => {
    const T = f.teams[i];
    return `<article class="box team" style="--tc:${T.color}">
      <div class="team-head">${nameField('fb', i, T)}<span class="chip">${i === 0 ? 'صاحب الأرض' : 'الضيف'}</span></div>
      <div class="score" data-bump="fb-${i}">${T.score}</div>
      <div class="btn-row">
        <button class="btn primary big" data-action="score" data-sport="fb" data-team="${i}" data-delta="1">+1 هدف</button>
        <button class="btn big" data-action="score" data-sport="fb" data-team="${i}" data-delta="-1">&lrm;−1</button>
      </div>
      <div class="stats">
        ${stat('الأخطاء', 'fb', i, 'fouls', T.fouls)}
        ${stat('<span class="card-y"></span>', 'fb', i, 'yellow', T.yellow)}
        ${stat('<span class="card-r"></span>', 'fb', i, 'red', T.red)}
      </div></article>`;
  };
  const log = f.log.length
    ? f.log.slice(0, 30).map(e => `<li style="--tc:${f.teams[e.team].color}"><b>${esc(e.label)}</b>${e.icon}<span>${esc(f.teams[e.team].name)}</span></li>`).join('')
    : '<span class="empty">لا توجد أحداث بعد</span>';
  return `
    <div class="box statusbar" style="--sc:var(--accent)">
      <div class="period"><span class="dot ${run.fb ? 'live' : ''}"></span>${FB_PERIODS[f.period].name}</div>
      <div class="clock-wrap" data-action="edit-clock" title="اضغط لتعديل الوقت">
        <span class="clock" id="fb-clock">00:00</span>
        <div class="clock-sub"><span>الوقت المنقضي</span><span class="extra" id="fb-extra"></span></div>
      </div>
      <div class="clock-ctl">
        <button class="btn ${run.fb ? 'pause' : 'go'}" data-action="toggle">${run.fb ? '⏸ إيقاف' : '▶ بدء'}</button>
        <button class="btn sm" data-action="nudge" data-min="-1">&lrm;−1 د</button>
        <button class="btn sm" data-action="nudge" data-min="1">&lrm;+1 د</button>
        <select class="sel" data-period aria-label="الشوط">
          ${FB_PERIODS.map((p, i) => `<option value="${i}" ${i === f.period ? 'selected' : ''}>${p.name} (${p.len}د)</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="grid2">${card(0)}${card(1)}</div>
    <div class="box log"><h3>أحداث المباراة</h3><ul>${log}</ul></div>`;
}

function handballHTML() {
  const h = state.hb;
  const card = i => {
    const T = h.teams[i];
    return `<article class="box team" style="--tc:${T.color}">
      <div class="team-head">${nameField('hb', i, T)}<span class="pill">وقت مستقطع: <b>${T.timeouts}</b>/${HB_TIMEOUTS}</span></div>
      <div class="score" data-bump="hb-${i}">${T.score}</div>
      <div class="btn-row">
        <button class="btn primary big" data-action="score" data-sport="hb" data-team="${i}" data-delta="1">+1 هدف</button>
        <button class="btn big" data-action="score" data-sport="hb" data-team="${i}" data-delta="-1">&lrm;−1</button>
      </div>
      <div class="row-2">
        <button class="btn" data-action="hb-timeout" data-team="${i}" ${T.timeouts ? '' : 'disabled'}>⏱ وقت مستقطع</button>
        <button class="btn danger" data-action="hb-penalty" data-team="${i}">🚫 إيقاف دقيقتين</button>
      </div>
      <div class="pens" id="pens-${i}"></div>
    </article>`;
  };
  return `
    <div class="box statusbar" style="--sc:var(--orange)">
      <div class="period"><span class="dot ${run.hb ? 'live' : ''}"></span>كرة اليد — ${h.half === 1 ? 'الشوط الأول' : 'الشوط الثاني'}</div>
      <div class="clock-wrap" data-action="edit-clock" title="اضغط لتعديل الوقت">
        <span class="clock" id="hb-clock">30:00</span>
        <div class="clock-sub"><span>الوقت المتبقي</span></div>
      </div>
      <div class="clock-ctl">
        <button class="btn ${run.hb ? 'pause' : 'go'}" data-action="toggle">${run.hb ? '⏸ إيقاف' : '▶ بدء'}</button>
        <button class="btn sm" data-action="hb-reset-half">إعادة 30د</button>
        <button class="btn sm" data-action="hb-next-half" ${h.half >= 2 ? 'disabled' : ''}>الشوط التالي ⏭</button>
      </div>
    </div>
    <div class="grid2">${card(0)}${card(1)}</div>`;
}

function tennisHTML() {
  const t = state.tn;
  const row = i => {
    const serving = t.server === i;
    const sets = t.history.map(s => {
      const won = s.g[i] > s.g[1 - i];
      const sup = s.tb && s.g[i] === 6 ? `<sup>${s.tb[i]}</sup>` : '';
      return `<span class="tn-set ${won ? 'won' : ''}">${s.g[i]}${sup}</span>`;
    }).join('');
    const need = Math.ceil(t.bestOf / 2);
    const pips = t.bestOf > 1 ? `<div class="pips" title="المجموعات">${Array.from({ length: need }, (_, k) => `<span class="pip ${k < t.sets[i] ? 'on' : ''}"></span>`).join('')}</div>` : '';
    return `<div class="tn-row ${serving ? 'serving' : ''}" style="--tc:${t.colors[i]}">
      <button class="serve-btn ${serving ? 'on' : ''}" data-action="tn-server" data-p="${i}" title="المُرسِل" aria-label="تحديد المرسل">🎾</button>
      <input class="name-input" data-tname="${i}" value="${esc(t.names[i])}" maxlength="24" aria-label="اسم اللاعب ${i + 1}">
      <div class="tn-sets">${sets}</div>
      <div class="tn-games" data-bump="tn-g${i}">${t.games[i]}</div>
      <div><div class="tn-points" data-bump="tn-p${i}">${tnLabel(i)}</div>${pips}</div>
      <button class="btn primary big" style="font-size:18px" data-action="tn-point" data-p="${i}" ${t.winner !== null ? 'disabled' : ''}>+ نقطة</button>
    </div>`;
  };
  const head = `<div class="tn-head"><span></span><span>اللاعب</span><span>المجموعات</span><span>الأشواط</span><span>النقاط</span><span></span></div>`;
  const banner = t.winner !== null ? `<div class="winner">🏆 ${esc(t.names[t.winner])} يفوز بالمباراة!</div>` : '';
  const stateLabel = t.tiebreak ? '<span class="badge-tb">⚡ شوط فاصل (Tie-break)</span>' : '';
  return `
    <div class="box">
      <div class="tn-bar">
        <div class="period"><span class="dot live"></span>التنس الأرضي ${stateLabel}</div>
        <div class="tn-opts">
          <span>المجموعة <b style="color:var(--green)">${Math.min(t.history.length + 1, 9)}</b></span>
          <label>أفضل من
            <select class="sel" data-bestof aria-label="عدد المجموعات">
              ${[1, 3, 5].map(n => `<option value="${n}" ${n === t.bestOf ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
          <label><input type="checkbox" data-noad ${t.noAd ? 'checked' : ''}> بدون أفضلية (No-Ad)</label>
          <button class="btn sm" data-action="tn-new">مباراة جديدة</button>
        </div>
      </div>
      <div class="tn-board">${head}${row(0)}${row(1)}</div>
    </div>
    ${banner}
    <p class="tn-caption">اضغط على 🎾 لتغيير المُرسِل · التبديل يتم تلقائيًا بعد كل شوط · الشوط الفاصل عند 6-6 حتى 7 بفارق نقطتين</p>`;
}

/* Cheap, targeted updates called every tick (no full re-render). */
function updateFbClock() {
  const el = $('#fb-clock');
  if (!el) return;
  const f = state.fb, p = FB_PERIODS[f.period], end = (p.start + p.len) * 60000;
  if (f.elapsed > end) {
    el.textContent = fmt(end);
    $('#fb-extra').textContent = '+' + fmt(f.elapsed - end);
  } else {
    el.textContent = fmt(f.elapsed);
    $('#fb-extra').textContent = '';
  }
}
function updateHbClock() {
  const el = $('#hb-clock');
  if (el) el.textContent = fmt(Math.ceil(state.hb.remaining / 1000) * 1000);
}
function renderPenalties() {
  for (const i of [0, 1]) {
    const box = $(`#pens-${i}`);
    if (!box) continue;
    const list = state.hb.pens[i];
    box.innerHTML = list.length
      ? list.map((e, k) => `<div class="pen"><span>مستبعد ${k + 1}</span><span>${fmt(Math.ceil((state.hb.remaining - e) / 1000) * 1000)}</span>
          <button data-action="hb-pen-del" data-team="${i}" data-idx="${k}" aria-label="إلغاء الإيقاف">✕</button></div>`).join('')
      : '<span class="empty" style="text-align:center">لا توجد إيقافات حالية</span>';
  }
}

/* ================================================================
   Global UI actions
   ================================================================ */
let wakeLock = null;
async function setWake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported / denied */ }
}
function toggleTv() {
  const on = document.body.classList.toggle('tv');
  setWake(on);
  if (on) toast('وضع العرض — اضغط T أو ✕ للخروج (الاختصارات تعمل)');
}
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
function switchSport(s) {
  if (s === state.sport) return;
  pauseAll();
  state.sport = s;
  sound('beep');
  commit();
}

const N = el => +el.dataset.team;
const actions = {
  sport: d => switchSport(d.sport),
  undo,
  sound: () => { state.sound = !state.sound; commit(); if (state.sound) sound('beep'); },
  tv: toggleTv,
  fullscreen: toggleFullscreen,
  help: showHelp,
  reset: resetCurrent,
  toggle: toggleClock,
  score: d => setScore(d.sport, +d.team, +d.delta),
  stat: d => setStat(d.sport, +d.team, d.key, +d.delta),
  nudge: d => nudgeFb(+d.min),
  'edit-clock': editClock,
  'hb-timeout': d => hbTimeout(+d.team),
  'hb-penalty': d => hbPenalty(+d.team),
  'hb-pen-del': d => hbRemovePenalty(+d.team, +d.idx),
  'hb-next-half': hbNextHalf,
  'hb-reset-half': hbResetHalf,
  'tn-point': d => tnPoint(+d.p),
  'tn-server': d => mutate(() => { state.tn.server = +d.p; if (state.tn.tiebreak && state.tn.tbCount === 0) state.tn.tbStart = +d.p; }),
  'tn-new': async () => { if (await confirmBox('مباراة جديدة؟', 'سيتم مسح نتيجة المباراة الحالية.', 'ابدأ')) { state.tn = newTennis(state.tn); undoStack = []; commit(); } },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  el.blur?.();   // keep Space reserved for the clock, not the last-clicked button
  if (fn) fn(el.dataset);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.name) {                 // team name (no re-render: keep caret)
    state[t.dataset.name].teams[+t.dataset.team].name = t.value;
    save();
  } else if (t.dataset.tname !== undefined) {
    state.tn.names[+t.dataset.tname] = t.value;
    save();
  } else if (t.dataset.color) {
    if (t.dataset.color === 'tn') state.tn.colors[+t.dataset.team] = t.value;
    else state[t.dataset.color].teams[+t.dataset.team].color = t.value;
    t.closest('.team')?.style.setProperty('--tc', t.value);
    save();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if ('period' in t.dataset) setPeriod(+t.value);
  else if ('bestof' in t.dataset) { state.tn.bestOf = +t.value; commit(); }
  else if ('noad' in t.dataset) { state.tn.noAd = t.checked; commit(); }
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || $('#modal').open || e.ctrlKey || e.metaKey || e.altKey) return;
  const sp = state.sport, code = e.code;
  if (code === 'Space') { e.preventDefault(); toggleClock(); }
  else if (code === 'KeyZ') undo();
  else if (code === 'KeyT') toggleTv();
  else if (code === 'KeyF') toggleFullscreen();
  else if (code === 'KeyM') actions.sound();
  else if (e.key === '?' || e.key === '؟' || code === 'Slash') showHelp();
  else if (code === 'Digit1' || code === 'Digit2') {
    const i = code === 'Digit1' ? 0 : 1;
    if (sp === 'tennis') tnPoint(i);
    else setScore(sp === 'football' ? 'fb' : 'hb', i, e.shiftKey ? -1 : 1);
  }
});

window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); else lastTick = performance.now(); });

/* ================================================================
   Boot
   ================================================================ */
setInterval(tick, 100);
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
