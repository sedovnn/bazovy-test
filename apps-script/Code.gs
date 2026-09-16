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
     SHEET_ID          — проставляется скриптом при первом запуске */

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

function book() {
  var id = PROP.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* пересоздадим ниже */ }
  }
  var ss = SpreadsheetApp.create('Базовый тест — данные');
  PROP.setProperty('SHEET_ID', ss.getId());
  setupSheets(ss);
  return ss;
}

function sheet(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { setupSheets(ss); sh = ss.getSheetByName(name); }
  return sh;
}

function setupSheets(ss) {
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
  var first = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
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

  sh.appendRow([code, title, stage, new Date().toISOString()]);
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

  // 3. Строка сохраняется в любом случае.
  var rowId = Utilities.getUuid();
  writeResponse({
    rowId: rowId, code: code, stage: stage,
    durationSec: Number(p.durationSec || 0),
    orderings: orderings, map: map, answer: answer, verdict: verdict
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
  var row = [d.rowId, d.code, d.stage, new Date().toISOString(), d.durationSec];

  CONFIG.situations.forEach(function (sid) {
    row.push((d.orderings[sid] || []).join(''), d.map.perSituation[sid] === undefined ? '' : d.map.perSituation[sid]);
  });
  d.map.skills.forEach(function (sk) { row.push(sk.score, sk.zone); });

  row.push(d.answer, countWords(d.answer));

  CONFIG.abilities.forEach(function (a) {
    var got = d.verdict.ok && d.verdict.judge[a.id] ? d.verdict.judge[a.id] : null;
    row.push(got ? got.level : '', got ? (got.flag ? 'да' : '') : '',
             got ? (got.quote || '') : '', got ? (got.why || '') : '');
  });

  row.push(d.verdict.ok ? (d.verdict.judge.feedback || '') : '',
           d.verdict.ok ? 'ok' : 'error',
           d.verdict.ok ? '' : String(d.verdict.error || ''),
           d.verdict.model || '',
           JUDGE_PROMPT_VERSION, CONFIG.testVersion);

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

  var skills = CONFIG.skills.map(function (sk) {
    return { id: sk.id, name: sk.name, ability: sk.ability, zones: [0, 0, 0], levels: [0, 0, 0, 0, 0] };
  });

  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (values[i][codeCol] !== code) continue;
    count++;
    CONFIG.skills.forEach(function (sk, k) {
      var zone = String(values[i][head.indexOf(sk.id + '_zone')] || '');
      var zi = CONFIG.zones.indexOf(zone);
      if (zi >= 0) skills[k].zones[zi]++;
      if (sk.ability) {
        var lvl = Number(values[i][head.indexOf(sk.ability + '_level')] || 0);
        if (lvl >= 1 && lvl <= 5) skills[k].levels[lvl - 1]++;
      }
    });
  }

  var session = findSession(code);
  return { ok: true, session: session, summary: { count: count, skills: skills } };
}
