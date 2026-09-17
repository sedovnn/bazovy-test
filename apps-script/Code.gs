/* Базовый тест «Карта стратегических навыков» — веб-приложение.

   Четыре действия, все через doPost:
     createSession  — завести сессию, вернуть код
     checkSession   — проверить код перед началом теста
     submit         — принять ответы, посчитать, позвать судью, записать, вернуть карту
     summary        — агрегат по коду сессии (без имён и текстов)
     rejudge        — повторно оценить записку у сохранённой строки

   Таблица создаётся сама при первом обращении. Ключ Anthropic живёт в свойствах
   скрипта и в браузер не попадает никогда.

   Свойства скрипта (Настройки проекта → Свойства скрипта):
     ANTHROPIC_API_KEY — обязательное
     MODEL             — необязательное, по умолчанию claude-sonnet-5
     SHEET_ID          — id вашей таблицы; если не задать, скрипт заведёт свою
                         и запишет сюда её id сам */

var PROP = PropertiesService.getScriptProperties();

var SHEET_SESSIONS = 'sessions';
var SHEET_RESPONSES = 'responses';

/* ---------- маршрутизация ---------- */

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Не разобрал тело запроса' });
  }

  try {
    switch (payload.action) {
      case 'createSession': return json(createSession(payload));
      case 'checkSession':  return json(checkSession(payload));
      case 'submit':        return json(submit(payload));
      case 'summary':       return json(summary(payload));
      case 'rejudge':       return json(rejudge(payload));
      default:              return json({ ok: false, error: 'Неизвестное действие: ' + payload.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/* GET отвечает коротко — чтобы можно было проверить, что приложение опубликовано. */
function doGet() {
  return json({ ok: true, service: 'Базовый тест', test: CONFIG.testVersion, judge: JUDGE_PROMPT_VERSION });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- таблица ---------- */

/* Таблица. Если в свойствах задан SHEET_ID — работаем в ней (её мог завести
   человек руками). Если нет — заводим свою при первом обращении. */
function book() {
  var id = PROP.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* пересоздадим ниже */ }
  }
  var ss = SpreadsheetApp.create('Базовый тест — данные');
  PROP.setProperty('SHEET_ID', ss.getId());
  setupSheets(ss, true);
  return ss;
}

function sheet(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { setupSheets(ss, false); sh = ss.getSheetByName(name); }
  return sh;
}

/* isNew = таблицу только что завёл сам скрипт. Пустой лист по умолчанию убираем
   ТОЛЬКО в этом случае: если таблицу завёл человек, удалять в ней листы нельзя —
   мало ли что он там держит. */
function setupSheets(ss, isNew) {
  if (!ss.getSheetByName(SHEET_SESSIONS)) {
    var s = ss.insertSheet(SHEET_SESSIONS);
    s.appendRow(['code', 'title', 'stage', 'created_at']);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_RESPONSES)) {
    var r = ss.insertSheet(SHEET_RESPONSES);
    r.appendRow(responseHeader());
    r.setFrozenRows(1);
  }
  if (!isNew) return;
  var first = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
}

/* Заголовок листа responses собирается из конфига — состав ситуаций и навыков
   задаёт спека, а не этот файл. */
function responseHeader() {
  var head = ['row_id', 'session_code', 'stage', 'submitted_at', 'duration_sec'];

  CONFIG.situations.forEach(function (sid) {
    head.push(sid + '_order', sid + '_score');
  });
  CONFIG.skills.forEach(function (sk) {
    head.push(sk.id + '_score', sk.id + '_zone');
  });

  head.push('intro_sec');
  CONFIG.situations.forEach(function (sid) { head.push(sid + '_sec'); });
  head.push('blockB_sec');

  head.push('answer_text', 'answer_words');
  CONFIG.abilities.forEach(function (a) {
    head.push(a.id + '_level', a.id + '_flag', a.id + '_quote', a.id + '_why');
  });
  head.push('feedback', 'judge_status', 'judge_error', 'judge_model', 'judge_prompt_version', 'test_version');
  return head;
}

function colIndex(sh, name) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return head.indexOf(name) + 1;
}

/* ---------- действия ---------- */

/* Замок на запись. Ждём до 30 с: судья и так держит выполнение ~20 с,
   дольше ждать бессмысленно — лучше записать без замка, чем потерять ответ. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(30000); } catch (e) {}
  try { fn(); } finally { if (got) lock.releaseLock(); }
}

function makeCode() {
  // без 0/O и 1/I: код диктуют вслух и вводят с телефона
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  for (var i = 0; i < 6; i++) out += abc.charAt(Math.floor(Math.random() * abc.length));
  return out;
}

function createSession(p) {
  var title = String(p.title || '').slice(0, 200);
  var stage = String(p.stage || 'baseline');
  var sh = sheet(SHEET_SESSIONS);

  var existing = {};
  sh.getDataRange().getValues().slice(1).forEach(function (row) { existing[row[0]] = true; });

  var code = makeCode();
  var guard = 0;
  while (existing[code] && guard++ < 50) code = makeCode();

  withLock(function () { sh.appendRow([code, title, stage, new Date().toISOString()]); });
  return { ok: true, code: code, title: title, stage: stage };
}

function findSession(code) {
  var rows = sheet(SHEET_SESSIONS).getDataRange().getValues().slice(1);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === code) return { code: rows[i][0], title: rows[i][1], stage: rows[i][2] };
  }
  return null;
}

function checkSession(p) {
  var code = String(p.code || '').toUpperCase();
  var s = findSession(code);
  if (!s) return { ok: false, error: 'no_session' };
  return { ok: true, title: s.title, stage: s.stage };
}

function submit(p) {
  var code = String(p.code || '').toUpperCase();
  var session = findSession(code);
  if (!session) return { ok: false, error: 'no_session' };

  var orderings = p.orderings || {};
  var answer = String(p.answerText || '');
  var stage = String(p.stage || session.stage || 'baseline');

  // 1. Блок А считаем всегда и первым: он не зависит от судьи.
  var map = buildMap(CONFIG.skills, orderings, null);

  // 2. Судья. Его падение не должно ронять отправку.
  var verdict = { ok: false, judge: null, error: 'не вызывался', model: '' };
  if (answer) verdict = judgeAnswer(answer);

  if (verdict.ok) map = buildMap(CONFIG.skills, orderings, verdict.judge);

  // 3. Строка сохраняется в любом случае. Под замком: группа отправляет ответы
  //    почти одновременно, и без него две записи могут наложиться.
  var rowId = Utilities.getUuid();
  withLock(function () {
    writeResponse({
      rowId: rowId, code: code, stage: stage,
      durationSec: Number(p.durationSec || 0), times: p.times || {},
      orderings: orderings, map: map, answer: answer, verdict: verdict
    });
  });

  return {
    ok: true,
    rowId: rowId,
    map: map,
    judge: verdict.ok ? verdict.judge : null,
    judge_status: verdict.ok ? 'ok' : 'error',
    judge_error: verdict.ok ? '' : verdict.error,
    feedback: verdict.ok ? (verdict.judge.feedback || '') : ''
  };
}

function writeResponse(d) {
  var sh = sheet(SHEET_RESPONSES);
  var v = {};

  v.row_id = d.rowId;
  v.session_code = d.code;
  v.stage = d.stage;
  v.submitted_at = new Date().toISOString();
  v.duration_sec = d.durationSec;

  CONFIG.situations.forEach(function (sid) {
    v[sid + '_order'] = (d.orderings[sid] || []).join('');
    v[sid + '_score'] = d.map.perSituation[sid] === undefined ? '' : d.map.perSituation[sid];
  });
  d.map.skills.forEach(function (sk) {
    v[sk.id + '_score'] = sk.score;
    v[sk.id + '_zone'] = sk.zone;
  });

  var t = d.times || {};
  v.intro_sec = t.intro === undefined ? '' : t.intro;
  CONFIG.situations.forEach(function (sid) {
    v[sid + '_sec'] = t[sid] === undefined ? '' : t[sid];
  });
  v.blockB_sec = t.blockB === undefined ? '' : t.blockB;

  v.answer_text = d.answer;
  v.answer_words = countWords(d.answer);

  CONFIG.abilities.forEach(function (a) {
    var got = d.verdict.ok && d.verdict.judge[a.id] ? d.verdict.judge[a.id] : null;
    v[a.id + '_level'] = got ? got.level : '';
    v[a.id + '_flag'] = got ? (got.flag ? 'да' : '') : '';
    v[a.id + '_quote'] = got ? (got.quote || '') : '';
    v[a.id + '_why'] = got ? (got.why || '') : '';
  });

  v.feedback = d.verdict.ok ? (d.verdict.judge.feedback || '') : '';
  v.judge_status = d.verdict.ok ? 'ok' : 'error';
  v.judge_error = d.verdict.ok ? '' : String(d.verdict.error || '');
  v.judge_model = d.verdict.model || '';
  v.judge_prompt_version = JUDGE_PROMPT_VERSION;
  v.test_version = CONFIG.testVersion;

  appendByHeader(sh, v);
}

/* Кладёт строку по именам колонок и дописывает недостающие в конец.
   Так добавление колонки не сдвигает уже накопленные строки. */
function appendByHeader(sh, values) {
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
               .map(function (h) { return String(h); });

  var missing = [];
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key) && head.indexOf(key) < 0) missing.push(key);
  }
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }

  var row = head.map(function (name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : '';
  });
  sh.appendRow(row);
}

function countWords(text) {
  var t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/* Повторная оценка сохранённой записки: читаем текст из строки, зовём судью,
   переписываем только его колонки. Расстановка не трогается. */
function rejudge(p) {
  var sh = sheet(SHEET_RESPONSES);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var idCol = head.indexOf('row_id');
  var answerCol = head.indexOf('answer_text');

  var rowNum = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === p.rowId) { rowNum = i + 1; break; }
  }
  if (rowNum < 0) return { ok: false, error: 'Строка не найдена' };

  var answer = String(values[rowNum - 1][answerCol] || '');
  if (!answer) return { ok: false, error: 'В строке нет текста записки' };

  var verdict = judgeAnswer(answer);

  CONFIG.abilities.forEach(function (a) {
    var got = verdict.ok && verdict.judge[a.id] ? verdict.judge[a.id] : null;
    set(sh, rowNum, head, a.id + '_level', got ? got.level : '');
    set(sh, rowNum, head, a.id + '_flag', got ? (got.flag ? 'да' : '') : '');
    set(sh, rowNum, head, a.id + '_quote', got ? (got.quote || '') : '');
    set(sh, rowNum, head, a.id + '_why', got ? (got.why || '') : '');
  });
  set(sh, rowNum, head, 'feedback', verdict.ok ? (verdict.judge.feedback || '') : '');
  set(sh, rowNum, head, 'judge_status', verdict.ok ? 'ok' : 'error');
  set(sh, rowNum, head, 'judge_error', verdict.ok ? '' : String(verdict.error || ''));
  set(sh, rowNum, head, 'judge_model', verdict.model || '');
  set(sh, rowNum, head, 'judge_prompt_version', JUDGE_PROMPT_VERSION);

  // пересобираем зоны и уровни на той же расстановке
  var orderings = {};
  CONFIG.situations.forEach(function (sid) {
    var raw = String(values[rowNum - 1][head.indexOf(sid + '_order')] || '');
    if (raw.length === 5) orderings[sid] = raw.split('');
  });
  var map = buildMap(CONFIG.skills, orderings, verdict.ok ? verdict.judge : null);

  return {
    ok: true, map: map,
    judge: verdict.ok ? verdict.judge : null,
    judge_status: verdict.ok ? 'ok' : 'error',
    judge_error: verdict.ok ? '' : verdict.error,
    feedback: verdict.ok ? (verdict.judge.feedback || '') : ''
  };
}

function set(sh, rowNum, head, name, value) {
  var col = head.indexOf(name);
  if (col >= 0) sh.getRange(rowNum, col + 1).setValue(value);
}

/* ---------- агрегат ---------- */

function summary(p) {
  var code = String(p.code || '').toUpperCase();
  var sh = sheet(SHEET_RESPONSES);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var codeCol = head.indexOf('session_code');

  /* Сводка идёт по ТОЙ ЖЕ общей шкале, что и карта участника: иначе у ведущего
     и у участника получаются две разные системы оценки — ровно то, чего быть
     не должно. buckets — сколько человек в низу, середине и верху шкалы.
     zones и levels остаются в ответе для подробностей, свёрнутых на экране. */
  var skills = CONFIG.skills.map(function (sk) {
    return { id: sk.id, name: sk.name, ability: sk.ability,
             buckets: [0, 0, 0], zones: [0, 0, 0], levels: [0, 0, 0, 0, 0],
             judged: 0, sum: 0 };
  });

  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (values[i][codeCol] !== code) continue;
    count++;
    CONFIG.skills.forEach(function (sk, k) {
      var max = sk.situations.length * 4;
      var score = Number(values[i][head.indexOf(sk.id + '_score')] || 0);
      var lvl = sk.ability ? Number(values[i][head.indexOf(sk.ability + '_level')] || 0) : 0;
      if (!(lvl >= 1 && lvl <= 5)) lvl = 0;

      var value = combinedValue(score, max, lvl);
      skills[k].buckets[valueBucket(value)]++;
      skills[k].sum += value;

      var zi = CONFIG.zones.indexOf(String(values[i][head.indexOf(sk.id + '_zone')] || ''));
      if (zi >= 0) skills[k].zones[zi]++;
      if (lvl) { skills[k].levels[lvl - 1]++; skills[k].judged++; }
    });
  }

  skills.forEach(function (sk) { sk.mean = count ? sk.sum / count : 0; delete sk.sum; });

  var session = findSession(code);
  return { ok: true, session: session, summary: { count: count, skills: skills } };
}
